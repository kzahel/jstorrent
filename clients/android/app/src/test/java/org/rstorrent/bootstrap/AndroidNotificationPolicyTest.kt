package org.rstorrent.bootstrap

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rstorrent.session.uniffi.ProgressAssessment
import org.rstorrent.session.uniffi.ProgressDisposition
import org.rstorrent.session.uniffi.ProgressPhase
import org.rstorrent.session.uniffi.ProgressReason
import org.rstorrent.session.uniffi.SeedAdmissionView
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

class AndroidNotificationPolicyTest {
    @Test
    fun initialTerminalRowsEstablishBaselineWithoutEdges() {
        val policy = AndroidNotificationPolicy()
        policy.baseline(
            listOf(
                torrent("complete", TorrentState.COMPLETE),
                torrent("error", TorrentState.ERROR),
                torrent("repair", TorrentState.NEEDS_REPAIR),
                torrent("storage", TorrentState.PAUSED, storage = StorageState.NEEDS_REPAIR),
            ),
        )

        assertEquals(
            emptyList<ProductNotificationEdge>(),
            policy.applyPatch(
                listOf(
                    torrent("complete", TorrentState.COMPLETE),
                    torrent("error", TorrentState.ERROR),
                    torrent("repair", TorrentState.NEEDS_REPAIR),
                    torrent("storage", TorrentState.PAUSED, storage = StorageState.NEEDS_REPAIR),
                ),
                emptyList(),
            ).edges,
        )
    }

    @Test
    fun ordinaryProgressThenCompletionEmitsExactlyOnce() {
        val policy = AndroidNotificationPolicy()
        policy.baseline(listOf(torrent(received = 10UL, verified = 1U)))

        assertEquals(
            emptyList<ProductNotificationEdge>(),
            policy.applyPatch(listOf(torrent(received = 20UL, verified = 2U)), emptyList()).edges,
        )
        val edge =
            policy.applyPatch(
                listOf(torrent(state = TorrentState.COMPLETE, received = 20UL, verified = 2U)),
                emptyList(),
            ).edges.single()
        assertEquals(ProductNotificationCategory.DOWNLOAD_COMPLETE, edge.category)
        assertEquals("Verified torrent", edge.displayName)
        assertEquals(
            emptyList<ProductNotificationEdge>(),
            policy.applyPatch(
                listOf(torrent(state = TorrentState.COMPLETE, received = 20UL, verified = 2U)),
                emptyList(),
            ).edges,
        )
    }

    @Test
    fun coalescedFinalProgressCanComplete() {
        val policy = AndroidNotificationPolicy()
        policy.baseline(listOf(torrent(received = 10UL, verified = 1U)))

        val edges =
            policy.applyPatch(
                listOf(torrent(state = TorrentState.COMPLETE, received = 20UL, verified = 2U)),
                emptyList(),
            ).edges

        assertEquals(ProductNotificationCategory.DOWNLOAD_COMPLETE, edges.single().category)
    }

    @Test
    fun checkingClearsCompletionEligibility() {
        val policy = AndroidNotificationPolicy()
        policy.baseline(listOf(torrent(received = 10UL, verified = 1U)))
        policy.applyPatch(listOf(torrent(received = 20UL, verified = 2U)), emptyList())
        policy.applyPatch(
            listOf(torrent(state = TorrentState.CHECKING, received = 20UL, verified = 2U)),
            emptyList(),
        )

        assertEquals(
            emptyList<ProductNotificationEdge>(),
            policy.applyPatch(
                listOf(torrent(state = TorrentState.COMPLETE, received = 20UL, verified = 2U)),
                emptyList(),
            ).edges,
        )
    }

    @Test
    fun zeroWorkAndImportedCompletionDoNotNotify() {
        val policy = AndroidNotificationPolicy()
        policy.baseline(listOf(torrent(state = TorrentState.PAUSED, received = 0UL, verified = 0U)))
        assertTrue(
            policy.applyPatch(
                listOf(torrent(state = TorrentState.COMPLETE, received = 0UL, verified = 0U)),
                emptyList(),
            ).edges.isEmpty(),
        )

        policy.reset()
        policy.baseline(listOf(torrent(state = TorrentState.COMPLETE, received = 100UL, verified = 10U)))
        assertTrue(
            policy.applyPatch(
                listOf(torrent(state = TorrentState.COMPLETE, received = 100UL, verified = 10U)),
                emptyList(),
            ).edges.isEmpty(),
        )
    }

    @Test
    fun attentionEmitsOnEntryRearmsAfterRecoveryAndIgnoresMessageChurn() {
        val policy = AndroidNotificationPolicy()
        policy.baseline(listOf(torrent()))

        val first = policy.applyPatch(listOf(torrent(state = TorrentState.ERROR)), emptyList())
        assertEquals(ProductNotificationCategory.NEEDS_ATTENTION, first.edges.single().category)
        assertTrue(
            policy.applyPatch(
                listOf(torrent(state = TorrentState.ERROR, error = "different secret")),
                emptyList(),
            ).edges.isEmpty(),
        )
        policy.applyPatch(listOf(torrent(state = TorrentState.PAUSED)), emptyList())
        assertEquals(
            ProductNotificationCategory.NEEDS_ATTENTION,
            policy.applyPatch(
                listOf(torrent(storage = StorageState.NEEDS_REPAIR)),
                emptyList(),
            ).edges.single().category,
        )
    }

    @Test
    fun storageRepairRoutesToExactRootAndAttentionWins() {
        val policy = AndroidNotificationPolicy()
        policy.baseline(listOf(torrent(received = 1UL, verified = 1U)))

        val edge =
            policy.applyPatch(
                listOf(
                    torrent(
                        state = TorrentState.COMPLETE,
                        storage = StorageState.NEEDS_REPAIR,
                        received = 2UL,
                        verified = 2U,
                    ),
                ),
                emptyList(),
            ).edges.single()

        assertEquals(ProductNotificationCategory.NEEDS_ATTENTION, edge.category)
        assertEquals(ProductNotificationRoute.StorageRepair("downloads"), edge.route)
    }

    @Test
    fun removalCancelsAndTerminalReaddIsSuppressed() {
        val policy = AndroidNotificationPolicy()
        policy.baseline(listOf(torrent()))

        val removed = policy.applyPatch(emptyList(), listOf(ID))
        assertEquals(listOf(ID), removed.removedTorrentIds)
        assertTrue(
            policy.applyPatch(
                listOf(torrent(state = TorrentState.ERROR)),
                emptyList(),
            ).edges.isEmpty(),
        )
        policy.applyPatch(listOf(torrent(state = TorrentState.PAUSED)), emptyList())
        assertEquals(
            ProductNotificationCategory.NEEDS_ATTENTION,
            policy.applyPatch(listOf(torrent(state = TorrentState.ERROR)), emptyList())
                .edges
                .single()
                .category,
        )
    }

    @Test
    fun removedHistoryIsBounded() {
        val policy = AndroidNotificationPolicy(removedLimit = 2)
        policy.baseline(emptyList())
        policy.applyPatch(emptyList(), listOf("first", "second", "third"))

        assertEquals(2, policy.removedHistorySize)

        assertTrue(
            policy.applyPatch(
                listOf(torrent(id = "second", state = TorrentState.ERROR)),
                emptyList(),
            ).edges.isEmpty(),
        )
        assertTrue(
            policy.applyPatch(
                listOf(torrent(id = "first", state = TorrentState.ERROR)),
                emptyList(),
            ).edges.isEmpty(),
        )
    }

    @Test
    fun namesAreWhitespaceNormalizedUnicodeBoundedAndNeverUseTorrentId() {
        assertEquals(null, boundedNotificationName("  \n\t "))
        assertEquals("one two", boundedNotificationName(" one\n\t two "))
        val input = "😀".repeat(121)
        val output = requireNotNull(boundedNotificationName(input))
        assertEquals(120, output.codePointCount(0, output.length))
        assertTrue(output.endsWith("…"))

        val policy = AndroidNotificationPolicy()
        policy.baseline(listOf(torrent(displayName = null, sourceDisplayName = null)))
        val edge =
            policy.applyPatch(listOf(torrent(state = TorrentState.ERROR, displayName = null)), emptyList())
                .edges
                .single()
        assertEquals(null, edge.displayName)
    }

    @Test
    fun opaqueTagsAreStableCategoryScopedAndDoNotContainRawId() {
        val completion = productNotificationTag(ProductNotificationCategory.DOWNLOAD_COMPLETE, ID)
        val repeated = productNotificationTag(ProductNotificationCategory.DOWNLOAD_COMPLETE, ID)
        val attention = productNotificationTag(ProductNotificationCategory.NEEDS_ATTENTION, ID)

        assertEquals(completion, repeated)
        assertFalse(completion.contains(ID))
        assertFalse(completion == attention)
    }

    @Test
    fun routedNotificationAcceptsOnlyOwnedOpaqueAutomaticTags() {
        val packageName = "org.rstorrent.bootstrap"
        ProductNotificationCategory.entries.forEach { category ->
            val tag = productNotificationTag(category, ID)
            val action = AndroidNotificationContract.routeAction(packageName, tag)
            val identity =
                requireNotNull(
                    AndroidNotificationContract.routedNotification(packageName, action),
                )
            assertEquals(tag, identity.tag)
            assertEquals(eventNotificationId(category), identity.id)
        }

        assertNull(
            AndroidNotificationContract.routedNotification(
                packageName,
                "$packageName.action.NOTIFICATION_ROUTE.rstorrent-download_complete-$ID",
            ),
        )
        assertNull(
            AndroidNotificationContract.routedNotification(
                packageName,
                "other.package.action.NOTIFICATION_ROUTE." +
                    productNotificationTag(ProductNotificationCategory.DOWNLOAD_COMPLETE, ID),
            ),
        )
    }

    private fun torrent(
        id: String = ID,
        state: TorrentState = TorrentState.DOWNLOADING,
        storage: StorageState = StorageState.AVAILABLE,
        received: ULong = 0UL,
        verified: UInt = 0U,
        displayName: String? = "Verified torrent",
        sourceDisplayName: String? = null,
        error: String? = null,
    ): TorrentView =
        TorrentView(
            torrentId = id,
            protocolIdentities = TorrentProtocolIdentities(v1 = null, v2 = null),
            displayName = displayName,
            sourceDisplayName = sourceDisplayName,
            sourceSizeBytes = null,
            state = state,
            operationalState = TorrentOperationalState.DOWNLOADING,
            downloadQueuePosition = null,
            transferLimits =
                TorrentTransferLimits(TransferRateLimit.Unlimited, TransferRateLimit.Unlimited),
            storageState = storage,
            storageRoot = "downloads",
            metadataAvailable = true,
            privateTorrent = false,
            awaitingFileSelection = false,
            pendingFileSelectionPosition = null,
            fileCatalogId = null,
            selectableFileCount = 0U,
            selectedFileCount = 0U,
            selectableFileBytes = "0",
            selectedFileBytes = "0",
            pieceCount = 10U,
            totalSizeBytes = "100",
            verifiedPieceCount = verified,
            requestedBytes = received.toString(),
            receivedBytes = received.toString(),
            storedBytes = received.toString(),
            activePeerConnections = 1U,
            configuredTrackerCount = 1U,
            payloadDownloadRateBytes = "1",
            requiredPayloadBytes = "100",
            remainingPayloadBytes = "50",
            etaPayloadDownloadRateBytes = "1",
            eta = TorrentEtaView.Unavailable,
            lifetime = TorrentLifetimeView("0", received.toString(), "0", "0", "0", "0"),
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
            error = error,
        )

    companion object {
        private const val ID = "t1-0123456789abcdef0123456789abcdef"
    }
}
