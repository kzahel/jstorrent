package org.rstorrent.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.rstorrent.session.uniffi.ProgressAssessment
import org.rstorrent.session.uniffi.ProgressDisposition
import org.rstorrent.session.uniffi.ProgressPhase
import org.rstorrent.session.uniffi.ProgressReason
import org.rstorrent.session.uniffi.SeedAdmissionView
import org.rstorrent.session.uniffi.SessionCurrentRatesView
import org.rstorrent.session.uniffi.SpeedCurrentRate
import org.rstorrent.session.uniffi.SpeedMetric
import org.rstorrent.session.uniffi.StorageState
import org.rstorrent.session.uniffi.TorrentEtaView
import org.rstorrent.session.uniffi.TorrentLifetimeView
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentProtocolIdentities
import org.rstorrent.session.uniffi.TorrentState
import org.rstorrent.session.uniffi.TorrentTransferLimits
import org.rstorrent.session.uniffi.TorrentSeedingView
import org.rstorrent.session.uniffi.TorrentView
import org.rstorrent.session.uniffi.TransferRateLimit

class ProductOngoingNotificationTest {
    @Test
    fun metadataAcquisitionWithCompletedSeedsIsNotReady() {
        val metadata = torrent("metadata").copy(
            state = TorrentState.AWAITING_METADATA,
            operationalState = TorrentOperationalState.STARTING,
            metadataAvailable = false,
            progress = ProgressAssessment(
                ProgressDisposition.ACTIVE,
                ProgressPhase.METADATA,
                ProgressReason.ACQUIRING_METADATA,
                emptyList(),
            ),
        )
        val seed = torrent("seed").copy(
            state = TorrentState.COMPLETE,
            operationalState = TorrentOperationalState.SEEDING,
        )
        val product = ProductState(ready = true, torrents = mapOf("metadata" to metadata, "seed" to seed))
        assertEquals(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.GETTING_METADATA),
            productOngoingNotificationMessage(product),
        )
        assertEquals(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.SEEDING, 1),
            productOngoingNotificationMessage(product.copy(torrents = mapOf("seed" to seed))),
        )
        assertEquals(
            ProductOngoingNotificationRates(0UL, 0UL),
            productOngoingNotificationContent(product.copy(torrents = mapOf("seed" to seed))).rates,
        )
    }

    @Test
    fun operationalStartingAndCheckingAreNotIdleAndArchivedWorkIsExcluded() {
        listOf(
            TorrentOperationalState.STARTING to ProductOngoingNotificationMessage.Kind.STARTING,
            TorrentOperationalState.CHECKING to ProductOngoingNotificationMessage.Kind.CHECKING,
        ).forEach { (state, kind) ->
            val active = torrent("one").copy(operationalState = state)
            assertEquals(
                ProductOngoingNotificationMessage(kind),
                productOngoingNotificationMessage(ProductState(ready = true, torrents = mapOf("one" to active))),
            )
            assertEquals(
                ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.READY),
                productOngoingNotificationMessage(
                    ProductState(ready = true, torrents = mapOf("one" to active.copy(archived = true))),
                ),
            )
        }
    }

    @Test
    fun ongoingTextIsGenericAndCountBased() {
        assertEquals(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.OPENING_PROFILE),
            productOngoingNotificationMessage(ProductState()),
        )
        assertEquals(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.NEEDS_ATTENTION),
            productOngoingNotificationMessage(
                ProductState(
                    ready = false,
                    error = ProductError.Technical("/secret/path magnet:?xt=private"),
                ),
            ),
        )
        assertEquals(
            ProductOngoingNotificationMessage(
                ProductOngoingNotificationMessage.Kind.DOWNLOADING,
                1,
            ),
            productOngoingNotificationMessage(
                ProductState(ready = true, torrents = mapOf("one" to torrent("one"))),
            ),
        )
        assertEquals(
            ProductOngoingNotificationMessage(
                ProductOngoingNotificationMessage.Kind.DOWNLOADING,
                2,
            ),
            productOngoingNotificationMessage(
                ProductState(
                    ready = true,
                    torrents = mapOf("one" to torrent("one"), "two" to torrent("two")),
                ),
            ),
        )
        assertEquals(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.READY_CHROME),
            productOngoingNotificationMessage(ProductState(ready = true, companionPort = 9876U)),
        )
        assertEquals(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.READY),
            productOngoingNotificationMessage(ProductState(ready = true)),
        )
    }

    @Test
    fun downloadingAndBackgroundSeedingAlwaysShowBothRates() {
        val downloading =
            ProductState(
                ready = true,
                torrents = mapOf("one" to torrent("one")),
                currentRates = rates(download = "1048576", upload = null),
            )
        assertEquals(
            ProductOngoingNotificationContent(
                ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.DOWNLOADING, 1),
                ProductOngoingNotificationRates(1_048_576UL, 0UL),
            ),
            productOngoingNotificationContent(downloading),
        )
        val seeding =
            ProductState(
                ready = true,
                lifecycle = ProductLifecycleState(reason = "retain_background_seeding"),
            )
        assertEquals(
            ProductOngoingNotificationContent(
                ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.SEEDING_BACKGROUND),
                ProductOngoingNotificationRates(0UL, 0UL),
            ),
            productOngoingNotificationContent(seeding),
        )
    }

    @Test
    fun readyStatesShowRatesOnlyWhileTransferring() {
        assertNull(productOngoingNotificationContent(ProductState(ready = true)).rates)
        assertNull(
            productOngoingNotificationContent(
                ProductState(ready = true, currentRates = rates(download = "0", upload = "0")),
            ).rates,
        )
        assertEquals(
            ProductOngoingNotificationRates(0UL, 512UL),
            productOngoingNotificationContent(
                ProductState(
                    ready = true,
                    companionPort = 9876U,
                    currentRates = rates(download = "0", upload = "512"),
                ),
            ).rates,
        )
    }

    @Test
    fun blockedStatesNeverShowRates() {
        val transferring = rates(download = "100", upload = "100")
        listOf(
            ProductState(currentRates = transferring),
            ProductState(
                ready = true,
                error = ProductError.Technical("failed"),
                currentRates = transferring,
            ),
            ProductState(
                ready = true,
                torrents = mapOf("one" to torrent("one")),
                dataReset = reset(ProductDataResetPhase.REMOVING_TORRENTS),
                currentRates = transferring,
            ),
        ).forEach { product -> assertNull(productOngoingNotificationContent(product).rates) }
    }

    @Test
    fun dataResetDominatesOrdinaryStatus() {
        val downloading = mapOf("one" to torrent("one"))
        assertEquals(
            ProductOngoingNotificationMessage(
                ProductOngoingNotificationMessage.Kind.CLEARING_DATA_PROGRESS,
                count = 2,
                total = 5,
            ),
            productOngoingNotificationMessage(
                ProductState(
                    ready = true,
                    torrents = downloading,
                    dataReset = reset(ProductDataResetPhase.REMOVING_TORRENTS),
                ),
            ),
        )
        assertEquals(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.CLEARING_DATA),
            productOngoingNotificationMessage(
                ProductState(dataReset = reset(ProductDataResetPhase.RESTARTING_APPLICATION)),
            ),
        )
        assertEquals(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.NEEDS_ATTENTION),
            productOngoingNotificationMessage(
                ProductState(
                    ready = true,
                    dataReset =
                        reset(ProductDataResetPhase.REMOVING_TORRENTS)
                            .copy(failure = ProductDataResetFailureState("failed", "detail")),
                ),
            ),
        )
        assertEquals(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.READY),
            productOngoingNotificationMessage(
                ProductState(
                    ready = true,
                    dataReset = reset(ProductDataResetPhase.VERIFYING_APPLICATION).copy(complete = true),
                ),
            ),
        )
    }

    @Test
    fun throttlePostsStatusAtOnceAndCoalescesRates() {
        val throttle = ProductOngoingNotificationThrottle(rateIntervalMillis = 2_000L)
        val first = downloadingContent(download = 100UL)
        assertEquals(0L, throttle.delayMillis(first, nowMillis = 10_000L))
        throttle.posted(first, nowMillis = 10_000L)

        assertNull(throttle.delayMillis(first, nowMillis = 10_500L))
        val faster = downloadingContent(download = 200UL)
        assertEquals(1_500L, throttle.delayMillis(faster, nowMillis = 10_500L))
        assertEquals(0L, throttle.delayMillis(faster, nowMillis = 12_500L))

        val more =
            faster.copy(
                message = ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.DOWNLOADING, 2),
            )
        assertEquals(0L, throttle.delayMillis(more, nowMillis = 10_500L))
        assertEquals(0L, throttle.delayMillis(first.copy(rates = null), nowMillis = 10_500L))

        throttle.forget()
        assertEquals(0L, throttle.delayMillis(first, nowMillis = 10_500L))
    }

    private fun downloadingContent(download: ULong) =
        ProductOngoingNotificationContent(
            ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.DOWNLOADING, 1),
            ProductOngoingNotificationRates(download, 0UL),
        )

    private fun rates(
        download: String?,
        upload: String?,
    ) = SessionCurrentRatesView(
        capturedMillis = "0",
        rates =
            listOf(
                SpeedCurrentRate(SpeedMetric.PAYLOAD_RECEIVED, download),
                SpeedCurrentRate(SpeedMetric.PAYLOAD_UPLOADED, upload),
                SpeedCurrentRate(SpeedMetric.PEER_WIRE_RECEIVED, "999999"),
            ),
    )

    private fun reset(phase: ProductDataResetPhase) =
        ProductDataResetState(
            operationId = "reset",
            phase = phase,
            completedTorrents = 2,
            totalTorrents = 5,
            deleteDataRequested = false,
            downgradedToKeep = false,
        )

    private fun torrent(id: String) =
        TorrentView(
            safetySummary = null,
            torrentId = id,
            protocolIdentities = TorrentProtocolIdentities(v1 = null, v2 = null),
            displayName = "Secret name",
            sourceDisplayName = null,
            sourceSizeBytes = null,
            state = TorrentState.DOWNLOADING,
            operationalState = TorrentOperationalState.DOWNLOADING,
            downloadQueuePosition = null,
            transferLimits =
                TorrentTransferLimits(TransferRateLimit.Unlimited, TransferRateLimit.Unlimited),
            storageState = StorageState.AVAILABLE,
            storageRoot = "secret-root",
            metadataAvailable = true,
            privateTorrent = false,
            awaitingFileSelection = false,
            pendingFileSelectionPosition = null,
            fileCatalogId = null,
            selectableFileCount = 0U,
            selectedFileCount = 0U,
            selectableFileBytes = "0",
            selectedFileBytes = "0",
            pieceCount = 1U,
            totalSizeBytes = "1",
            verifiedPieceCount = 0U,
            requestedBytes = "1",
            receivedBytes = "1",
            storedBytes = "0",
            activePeerConnections = 1U,
            configuredTrackerCount = 1U,
            payloadDownloadRateBytes = "1",
            requiredPayloadBytes = "1",
            remainingPayloadBytes = "1",
            etaPayloadDownloadRateBytes = "1",
            eta = TorrentEtaView.Unavailable,
            lifetime = TorrentLifetimeView("0", "1", "0", "0", "0", "0"),
            seeding = TorrentSeedingView(SeedAdmissionView.INELIGIBLE, null, null),
            progress =
                ProgressAssessment(
                    ProgressDisposition.ACTIVE,
                    ProgressPhase.TRANSFER,
                    ProgressReason.TRANSFERRING_PIECES,
                    emptyList(),
                ),
            checking = null,
            archived = false,
            removalState = null,
            deleteDataSupported = true,
            forceRecheckAvailable = true,
            error = null,
        )
}
