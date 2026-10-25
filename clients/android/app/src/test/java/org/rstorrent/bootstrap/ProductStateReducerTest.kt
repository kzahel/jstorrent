package org.rstorrent.bootstrap

import java.math.BigInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rstorrent.bootstrap.uniffi.SafStorageObjectKind
import org.rstorrent.session.uniffi.ActivePiece
import org.rstorrent.session.uniffi.ActivePieceStageView
import org.rstorrent.session.uniffi.ActiveSeedLimit
import org.rstorrent.session.uniffi.AdvertisedPeerEndpointStatus
import org.rstorrent.session.uniffi.ApplicationNetworkPrerequisiteView
import org.rstorrent.session.uniffi.ApplicationNetworkRuntimeState
import org.rstorrent.session.uniffi.ApplicationNetworkRuntimeView
import org.rstorrent.session.uniffi.BandwidthDirectionRuntimeView
import org.rstorrent.session.uniffi.BandwidthRuntimeView
import org.rstorrent.session.uniffi.CatalogPageRequest
import org.rstorrent.session.uniffi.CatalogPageView
import org.rstorrent.session.uniffi.ClientSettings
import org.rstorrent.session.uniffi.ClientSettingsApplicationState
import org.rstorrent.session.uniffi.ClientSettingsRuntimeView
import org.rstorrent.session.uniffi.Command
import org.rstorrent.session.uniffi.DeliveryPolicy
import org.rstorrent.session.uniffi.DiagnosticCategory
import org.rstorrent.session.uniffi.DiagnosticEvent
import org.rstorrent.session.uniffi.DiagnosticRetention
import org.rstorrent.session.uniffi.DiagnosticSeverity
import org.rstorrent.session.uniffi.EffectiveListenerSettings
import org.rstorrent.session.uniffi.EncryptionPolicy
import org.rstorrent.session.uniffi.FileCatalogState
import org.rstorrent.session.uniffi.FileIndexRange
import org.rstorrent.session.uniffi.FilePriority
import org.rstorrent.session.uniffi.FileSelectionView
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.HttpsServerAuthenticationPolicy
import org.rstorrent.session.uniffi.IndexRange
import org.rstorrent.session.uniffi.Ipv6PinholeStatus
import org.rstorrent.session.uniffi.LibraryArchivedFilter
import org.rstorrent.session.uniffi.LibraryAvailabilityFilter
import org.rstorrent.session.uniffi.LibraryFacetsView
import org.rstorrent.session.uniffi.LibraryGrouping
import org.rstorrent.session.uniffi.LibraryMediaItemView
import org.rstorrent.session.uniffi.LibraryMediaKind
import org.rstorrent.session.uniffi.LibraryMediaQuery
import org.rstorrent.session.uniffi.LibraryMediaRole
import org.rstorrent.session.uniffi.LibraryMediaSort
import org.rstorrent.session.uniffi.ListenerPolicy
import org.rstorrent.session.uniffi.ListenerStatus
import org.rstorrent.session.uniffi.MediaCatalogState
import org.rstorrent.session.uniffi.MediaFileAvailability
import org.rstorrent.session.uniffi.MediaItemView
import org.rstorrent.session.uniffi.MediaRoleView
import org.rstorrent.session.uniffi.PendingFileSelectionBase
import org.rstorrent.session.uniffi.PortMappingPolicy
import org.rstorrent.session.uniffi.PortMappingStatus
import org.rstorrent.session.uniffi.ProgressAssessment
import org.rstorrent.session.uniffi.ProgressDisposition
import org.rstorrent.session.uniffi.ProgressPhase
import org.rstorrent.session.uniffi.ProgressReason
import org.rstorrent.session.uniffi.SeedAdmissionView
import org.rstorrent.session.uniffi.SeedGoalStatusView
import org.rstorrent.session.uniffi.SeedGoalView
import org.rstorrent.session.uniffi.SessionCurrentRatesView
import org.rstorrent.session.uniffi.SessionUdpStatus
import org.rstorrent.session.uniffi.SpeedCurrentRate
import org.rstorrent.session.uniffi.SpeedHistoryAppend
import org.rstorrent.session.uniffi.SpeedHistoryView
import org.rstorrent.session.uniffi.SpeedMetric
import org.rstorrent.session.uniffi.SpeedMetricAvailability
import org.rstorrent.session.uniffi.SpeedPersistenceState
import org.rstorrent.session.uniffi.SpeedRange
import org.rstorrent.session.uniffi.SpeedSeriesAppend
import org.rstorrent.session.uniffi.SpeedSeriesView
import org.rstorrent.session.uniffi.StorageSettingsSnapshot
import org.rstorrent.session.uniffi.StorageState
import org.rstorrent.session.uniffi.SubscriptionSpec
import org.rstorrent.session.uniffi.TorrentEtaView
import org.rstorrent.session.uniffi.TorrentFieldUpdate
import org.rstorrent.session.uniffi.TorrentLifetimeView
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentProtocolIdentities
import org.rstorrent.session.uniffi.TorrentRowUpdate
import org.rstorrent.session.uniffi.TorrentSeedingView
import org.rstorrent.session.uniffi.TorrentState
import org.rstorrent.session.uniffi.TorrentTransferLimits
import org.rstorrent.session.uniffi.TorrentView
import org.rstorrent.session.uniffi.TransferRateLimit
import org.rstorrent.session.uniffi.ViewPatch
import org.rstorrent.session.uniffi.ViewProjection
import org.rstorrent.session.uniffi.ViewSelector
import org.rstorrent.session.uniffi.ViewSnapshot
import org.rstorrent.session.uniffi.ViewUpdate
import org.rstorrent.session.uniffi.ViewUpdatePayload
import org.rstorrent.bootstrap.ui.TorrentFilter
import org.rstorrent.bootstrap.ui.TorrentSort
import org.rstorrent.bootstrap.ui.filteredAndSortedTorrents
import org.rstorrent.bootstrap.ui.parseRateLimit
import org.rstorrent.bootstrap.ui.RATE_LIMIT_PRESETS
import org.rstorrent.bootstrap.ui.customRateText
import org.rstorrent.bootstrap.ui.torrentPresentationName

class ProductStateReducerTest {
    @Test
    fun settingsDraftPreservesDirtyFieldsAcrossClonedAuthorityAndConvergesByReceipt() {
        var draft =
            SettingsDraftState<ClientSettingsField>().authority(
                "client-settings",
                "7",
                mapOf(
                    ClientSettingsField.PEER_CONNECTION_LIMIT to 200U,
                    ClientSettingsField.UPLOAD_SLOTS to 8U.toUShort(),
                ),
            )
        draft =
            draft.edit(
                mapOf(ClientSettingsField.PEER_CONNECTION_LIMIT to 321U),
            )
        draft =
            draft.authority(
                "client-settings",
                "8",
                mapOf(
                    ClientSettingsField.PEER_CONNECTION_LIMIT to 200U,
                    ClientSettingsField.UPLOAD_SLOTS to 9U.toUShort(),
                ),
            )
        assertEquals(321U, draft.materialized()[ClientSettingsField.PEER_CONNECTION_LIMIT])
        assertEquals(9U.toUShort(), draft.materialized()[ClientSettingsField.UPLOAD_SLOTS])
        assertEquals(emptySet<ClientSettingsField>(), draft.conflicts)

        draft = draft.beginSubmit()
        draft = draft.accepted("client-settings", "9")
        assertEquals("9", draft.submission?.acceptedRevision)
        draft =
            draft.authority(
                "client-settings",
                "8",
                mapOf(
                    ClientSettingsField.PEER_CONNECTION_LIMIT to 200U,
                    ClientSettingsField.UPLOAD_SLOTS to 10U.toUShort(),
                ),
            )
        assertEquals(321U, draft.materialized()[ClientSettingsField.PEER_CONNECTION_LIMIT])
        val converged =
            mapOf<ClientSettingsField, Any>(
                ClientSettingsField.PEER_CONNECTION_LIMIT to 321U,
                ClientSettingsField.UPLOAD_SLOTS to 10U.toUShort(),
            )
        draft = draft.authority("client-settings", "9", converged)
        assertEquals(null, draft.submission)
        assertEquals(emptyMap<ClientSettingsField, Any>(), draft.overlays)
    }

    @Test
    fun settingsDraftKeepsANewerEditWhenTheCapturedValueConverges() {
        var draft =
            SettingsDraftState<TorrentSettingsField>().authority(
                TORRENT_ID,
                "10",
                mapOf(
                    TorrentSettingsField.UPLOAD_RATE_LIMIT to TransferRateLimit.Unlimited,
                    TorrentSettingsField.DOWNLOAD_RATE_LIMIT to TransferRateLimit.Unlimited,
                ),
            )
        val first = TransferRateLimit.Limited(64U * 1_024U)
        val newer = TransferRateLimit.Limited(96U * 1_024U)
        draft = draft.edit(mapOf(TorrentSettingsField.DOWNLOAD_RATE_LIMIT to first))
        draft = draft.beginSubmit()
        draft = draft.edit(mapOf(TorrentSettingsField.DOWNLOAD_RATE_LIMIT to newer))
        draft = draft.accepted(TORRENT_ID, "11")
        draft =
            draft.authority(
                TORRENT_ID,
                "11",
                mapOf(
                    TorrentSettingsField.UPLOAD_RATE_LIMIT to TransferRateLimit.Unlimited,
                    TorrentSettingsField.DOWNLOAD_RATE_LIMIT to first,
                ),
            )

        assertEquals(null, draft.submission)
        assertEquals(newer, draft.materialized()[TorrentSettingsField.DOWNLOAD_RATE_LIMIT])
        assertEquals(first, draft.editBases[TorrentSettingsField.DOWNLOAD_RATE_LIMIT])
    }

    @Test
    fun serviceDraftCaptureUsesTheAuthorityRevisionAndWaitsForConvergence() {
        var draft =
            SettingsDraftState<TorrentSettingsField>().authority(
                TORRENT_ID,
                "41",
                mapOf<TorrentSettingsField, Any>(
                    TorrentSettingsField.UPLOAD_RATE_LIMIT to TransferRateLimit.Unlimited,
                    TorrentSettingsField.DOWNLOAD_RATE_LIMIT to TransferRateLimit.Unlimited,
                ),
            )
        draft =
            draft.edit(
                mapOf(
                    TorrentSettingsField.DOWNLOAD_RATE_LIMIT to
                        TransferRateLimit.Limited(64U * 1_024U),
                ),
            )

        val captured = captureSettingsDraftRequest(draft)
        assertEquals(TORRENT_ID, captured.request?.resourceKey)
        assertEquals("41", captured.request?.expectedRevision)
        assertEquals(
            TransferRateLimit.Limited(64U * 1_024U),
            captured.request?.values?.get(TorrentSettingsField.DOWNLOAD_RATE_LIMIT),
        )
        draft = captured.draft.accepted(TORRENT_ID, "42")
        assertEquals(null, captureSettingsDraftRequest(draft).request)

        draft =
            draft.authority(
                TORRENT_ID,
                "42",
                mapOf<TorrentSettingsField, Any>(
                    TorrentSettingsField.UPLOAD_RATE_LIMIT to TransferRateLimit.Unlimited,
                    TorrentSettingsField.DOWNLOAD_RATE_LIMIT to
                        TransferRateLimit.Limited(64U * 1_024U),
                ),
            )
        assertEquals(emptyMap<TorrentSettingsField, Any>(), draft.overlays)
        assertEquals(null, captureSettingsDraftRequest(draft).request)
    }

    @Test
    fun settingsDraftReportsConflictFailureIdentityAndOpaqueRevisions() {
        var draft =
            SettingsDraftState<ClientSettingsField>().authority(
                "client-settings",
                "18446744073709551616",
                mapOf(ClientSettingsField.IPV6_ENABLED to true),
            )
        draft = draft.edit(mapOf(ClientSettingsField.IPV6_ENABLED to false))
        draft =
            draft.authority(
                "client-settings",
                "18446744073709551617",
                mapOf(ClientSettingsField.IPV6_ENABLED to "changed elsewhere"),
            )
        assertEquals(setOf(ClientSettingsField.IPV6_ENABLED), draft.conflicts)
        draft = draft.beginSubmit().failed("client-settings", "x".repeat(600))
        assertEquals(512, draft.failure?.length)
        assertEquals(false, draft.materialized()[ClientSettingsField.IPV6_ENABLED])
        assertEquals(
            1,
            compareSettingsRevisions("18446744073709551617", "9999999999999999999"),
        )

        draft =
            draft.authority(
                "another-resource",
                "1",
                mapOf(ClientSettingsField.IPV6_ENABLED to true),
            )
        assertEquals(emptyMap<ClientSettingsField, Any>(), draft.overlays)
        assertEquals("another-resource", draft.resourceKey)
    }

    @Test
    fun clientSettingsRemainTypedAcrossTheKotlinContract() {
        val settings =
            ClientSettings(
                            fileSafety = org.rstorrent.session.uniffi.FileSafetySettings(true, org.rstorrent.session.uniffi.FileSafetyPreset.RECOMMENDED, emptyList(), true),
                listener = ListenerPolicy.FixedLoopback(65_535U.toUShort()),
                preferredListenPort = 6_881U.toUShort(),
                portMapping = PortMappingPolicy.UPNP,
                peerConnectionLimit = 2_000U,
                uploadSlots = 50U.toUShort(),
                activeDownloads = 20U.toUShort(),
                activeSeeds = ActiveSeedLimit.Limited(500U.toUShort()),
                shareRatioLimitPercent = UInt.MAX_VALUE,
                finishedDownloadRatioLimitPercent = UInt.MAX_VALUE,
                finishedTimeLimitSeconds = UInt.MAX_VALUE,
                seedStopRatioPercent = org.rstorrent.session.uniffi.SeedStopLimit.Off,
                seedStopTimeSeconds = org.rstorrent.session.uniffi.SeedStopLimit.Off,
                uploadRateLimit = TransferRateLimit.Limited(1_024U),
                downloadRateLimit = TransferRateLimit.Unlimited,
                encryption = EncryptionPolicy.REQUIRED,
                ipv6Enabled = true,
                dhtEnabled = false,
                peerExchangeEnabled = false,
                trackerHttpsServerAuthentication = HttpsServerAuthenticationPolicy.DISABLED,
            )

        val patch = clientSettingsPatch(
            peerConnectionLimit = settings.peerConnectionLimit,
            activeSeeds = ActiveSeedLimit.Unlimited,
            shareRatioLimitPercent = 250U,
            finishedDownloadRatioLimitPercent = 800U,
            finishedTimeLimitSeconds = 90_000U,
            encryption = settings.encryption,
            dhtEnabled = settings.dhtEnabled,
            peerExchangeEnabled = settings.peerExchangeEnabled,
        )
        val command = Command.UpdateClientSettings(patch)
        assertEquals(2_000U, command.patch.peerConnectionLimit)
        assertEquals(EncryptionPolicy.REQUIRED, command.patch.encryption)
        assertEquals(ActiveSeedLimit.Unlimited, command.patch.activeSeeds)
        assertEquals(250U, command.patch.shareRatioLimitPercent)
        assertEquals(800U, command.patch.finishedDownloadRatioLimitPercent)
        assertEquals(90_000U, command.patch.finishedTimeLimitSeconds)
        assertEquals(false, command.patch.dhtEnabled)
        assertEquals(false, command.patch.peerExchangeEnabled)
        assertEquals(null, command.patch.uploadSlots)
        assertEquals(settings, clientSettings(settings).configured)
    }

    @Test
    fun transferRateLimitsRemainSemanticAndAtomicAcrossTheKotlinContract() {
        assertEquals(null, parseRateLimit("0.5"))
        assertEquals(TransferRateLimit.Limited(1_024U), parseRateLimit("1"))
        assertEquals(TransferRateLimit.Limited(UInt.MAX_VALUE), parseRateLimit("4194303.9990234375"))
        assertEquals("1024", customRateText(TransferRateLimit.Unlimited))
        assertEquals("1.5", customRateText(TransferRateLimit.Limited(1_536U), java.util.Locale.US))
        assertEquals(
            listOf(100U * 1_024U, 500U * 1_024U, 1_048_576U, 5U * 1_048_576U, 10U * 1_048_576U),
            RATE_LIMIT_PRESETS,
        )
        RATE_LIMIT_PRESETS.forEach {
            assertEquals(TransferRateLimit.Limited(it), parseRateLimit(customRateText(TransferRateLimit.Limited(it))))
        }

        val limits =
            TorrentTransferLimits(
                upload = TransferRateLimit.Limited(64U * 1_024U),
                download = TransferRateLimit.Unlimited,
            )
        val patch = torrentSettingsPatch(downloadRateLimit = limits.download)
        val command = Command.UpdateTorrentSettings(TORRENT_ID, patch)
        assertEquals(TORRENT_ID, command.torrentId)
        assertEquals(null, command.patch.uploadRateLimit)
        assertEquals(TransferRateLimit.Unlimited, command.patch.downloadRateLimit)
    }

    @Test
    fun highCardinalityCatalogUsesRangesAndPagesInTheKotlinContract() {
        val fileCount = 374_998U
        val command =
            Command.SetFilePriorityRanges(
                TORRENT_ID,
                listOf(FileIndexRange(0U, fileCount)),
                FilePriority.NORMAL,
            )
        val subscription =
            SubscriptionSpec(
                ViewSelector.Torrent(TORRENT_ID),
                ViewProjection.FILES,
                DeliveryPolicy(0U, 256U * 1024U),
                null,
                CatalogPageRequest(fileCount - 1_024U, 1_024U),
            )
        val snapshot =
            ViewSnapshot.Files(
                TORRENT_ID,
                FileCatalogState.AVAILABLE,
                null,
                CatalogPageView(fileCount - 1_024U, 1_024U, fileCount, null),
                emptyList(),
            )

        assertEquals(1, command.ranges.size)
        assertEquals(fileCount, command.ranges.single().endExclusive)
        assertEquals(1_024U, subscription.catalogPage?.limit)
        assertEquals(fileCount, snapshot.page.total)
        assertEquals(emptyList<Any>(), snapshot.files)
    }

    @Test
    fun safRemovalDeletesExactFilesAndPreservesUnrelatedDocuments() {
        val documents =
            mutableMapOf(
                "test" to SafStorageObjectKind.DIRECTORY,
                "test/episode.mkv" to SafStorageObjectKind.FILE,
                "test/notes.txt" to SafStorageObjectKind.FILE,
                ".t1-owner.rstorrent-parts" to SafStorageObjectKind.FILE,
            )
        val deleted = mutableListOf<String>()
        deleteDataArtifacts(
            name = "test",
            torrentId = "t1-owner",
            tree = true,
            files = listOf(listOf("episode.mkv")),
            directories = listOf(emptyList()),
            root = "",
            find = { parent, name ->
                listOf(parent, name).filter(String::isNotEmpty).joinToString("/")
                    .takeIf(documents::containsKey)
            },
            kind = { documents.getValue(it) },
            isEmptyDirectory = { directory ->
                documents.keys.none { it.startsWith("$directory/") }
            },
            delete = { document ->
                deleted += document
                documents.remove(document) != null
            },
        )
        assertEquals(listOf("test/episode.mkv", ".t1-owner.rstorrent-parts"), deleted)
        assertEquals(
            mapOf(
                "test" to SafStorageObjectKind.DIRECTORY,
                "test/notes.txt" to SafStorageObjectKind.FILE,
            ),
            documents,
        )

        deleteDataArtifacts(
            name = "test",
            torrentId = "t1-owner",
            tree = true,
            files = listOf(listOf("episode.mkv")),
            directories = listOf(emptyList()),
            root = "",
            find = { parent, name ->
                listOf(parent, name).filter(String::isNotEmpty).joinToString("/")
                    .takeIf(documents::containsKey)
            },
            kind = { documents.getValue(it) },
            isEmptyDirectory = { false },
            delete = { false },
        )
    }

    @Test
    fun safRemovalSurfacesProviderRefusalWithoutContinuing() {
        val attempted = mutableListOf<String>()
        assertThrows(IllegalStateException::class.java) {
            deleteDataArtifacts(
                name = "test.bin",
                torrentId = "t1-owner",
                tree = false,
                files = listOf(emptyList()),
                directories = emptyList(),
                root = "root",
                find = { _, name -> name.takeIf { it == "test.bin" } },
                kind = { SafStorageObjectKind.FILE },
                isEmptyDirectory = { true },
                delete = { document ->
                    attempted += document
                    false
                },
            )
        }
        assertEquals(listOf("test.bin"), attempted)
    }

    @Test
    fun safRemovalPreservesLegacyHiddenAndUnrelatedFiles() {
        val documents =
            mutableMapOf(
                "test" to SafStorageObjectKind.DIRECTORY,
                "test/preserve.txt" to SafStorageObjectKind.FILE,
                ".t1-owner.rstorrent-staging" to SafStorageObjectKind.DIRECTORY,
                ".t1-owner.rstorrent-staging/sentinel" to SafStorageObjectKind.FILE,
                ".t1-owner.rstorrent-parts" to SafStorageObjectKind.FILE,
            )
        deleteDataArtifacts(
            name = "test",
            torrentId = "t1-owner",
            tree = true,
            files = listOf(listOf("episode.mkv")),
            directories = listOf(emptyList()),
            root = "",
            find = { parent, name ->
                listOf(parent, name).filter(String::isNotEmpty).joinToString("/")
                    .takeIf(documents::containsKey)
            },
            kind = { documents.getValue(it) },
            isEmptyDirectory = { directory ->
                documents.keys.none { it.startsWith("$directory/") }
            },
            delete = { document -> documents.remove(document) != null },
        )
        assertEquals(
            mapOf(
                "test" to SafStorageObjectKind.DIRECTORY,
                "test/preserve.txt" to SafStorageObjectKind.FILE,
                ".t1-owner.rstorrent-staging" to SafStorageObjectKind.DIRECTORY,
                ".t1-owner.rstorrent-staging/sentinel" to SafStorageObjectKind.FILE,
            ),
            documents,
        )
    }

    @Test
    fun safRemovalPreflightsAllExpectedFilesBeforeMutation() {
        val documents =
            mutableMapOf(
                "test" to SafStorageObjectKind.DIRECTORY,
                "test/first.mkv" to SafStorageObjectKind.FILE,
                "test/wrong" to SafStorageObjectKind.DIRECTORY,
                ".t1-owner.rstorrent-parts" to SafStorageObjectKind.FILE,
            )
        val deleted = mutableListOf<String>()
        assertThrows(IllegalStateException::class.java) {
            deleteDataArtifacts(
                name = "test",
                torrentId = "t1-owner",
                tree = true,
                files = listOf(listOf("first.mkv"), listOf("wrong")),
                directories = listOf(emptyList()),
                root = "",
                find = { parent, name ->
                    listOf(parent, name).filter(String::isNotEmpty).joinToString("/")
                        .takeIf(documents::containsKey)
                },
                kind = { documents.getValue(it) },
                isEmptyDirectory = { true },
                delete = { document -> deleted += document; true },
            )
        }
        assertEquals(emptyList<String>(), deleted)
    }

    @Test
    fun diagnosticSnapshotsAndPatchesRemainOrderedAndBounded() {
        val event =
            DiagnosticEvent(
                "7",
                "1000",
                DiagnosticSeverity.WARNING,
                DiagnosticCategory("discovery.peer"),
                "discovery_exhausted",
                TORRENT_ID,
                "No discovery source",
                emptyList(),
                emptyList(),
            )
        val snapshot =
            update(
                "1",
                "0",
                "0",
                ViewUpdatePayload.Snapshot(
                    ViewSnapshot.Diagnostics(listOf(event), DiagnosticRetention("3", "4")),
                ),
            )
        val patched =
            update(
                "2",
                "0",
                "0",
                ViewUpdatePayload.Patch(
                    ViewPatch.Diagnostics(
                        listOf(event.copy(sequence = "8", code = "retry_scheduled")),
                        DiagnosticRetention("3", "4"),
                    ),
                ),
            )
        val reduced =
            ProductStateReducer.reduce(
                ProductStateReducer.reduce(ProductState(), snapshot),
                patched,
            )
        assertEquals(listOf("7", "8"), reduced.diagnostics.map { it.sequence })
        assertEquals("3", reduced.diagnosticSourceEvicted)
    }

    @Test
    fun currentRatesReplaceIndependentlyOfSpeedHistory() {
        val snapshot =
            update(
                "1",
                "0",
                "1",
                ViewUpdatePayload.Snapshot(
                    ViewSnapshot.SessionCurrentRates(
                        SessionCurrentRatesView(
                            "1000",
                            listOf(SpeedCurrentRate(SpeedMetric.PAYLOAD_RECEIVED, "10")),
                        ),
                    ),
                ),
            )
        val patch =
            update(
                "2",
                "1",
                "2",
                ViewUpdatePayload.Patch(
                    ViewPatch.SessionCurrentRates(
                        SessionCurrentRatesView(
                            "1100",
                            listOf(SpeedCurrentRate(SpeedMetric.PAYLOAD_RECEIVED, "25")),
                        ),
                    ),
                ),
            )

        val reduced = ProductStateReducer.reduce(ProductStateReducer.reduce(ProductState(), snapshot), patch)

        assertEquals("1100", reduced.currentRates?.capturedMillis)
        assertEquals("25", reduced.currentRates?.rates?.single()?.bytes)
        assertEquals(null, reduced.speed)
    }

    @Test
    fun speedHistoryAppendPreservesEveryCompletedBucketAndRejectsGaps() {
        val snapshot =
            update(
                "1",
                "0",
                "1",
                ViewUpdatePayload.Snapshot(ViewSnapshot.SessionSpeedHistory(speedHistory())),
            )
        val initial = ProductStateReducer.reduce(ProductState(), snapshot)
        val append =
            SpeedHistoryAppend(
                capturedMillis = "400",
                historyEpoch = "history-1",
                baseCompleteThroughMillis = "200",
                startMillis = "100",
                completeThroughMillis = "400",
                persistence = null,
                series =
                    listOf(
                        SpeedSeriesAppend(
                            SpeedMetric.PAYLOAD_RECEIVED,
                            listOf("30", null),
                        ),
                    ),
            )
        val reduced =
            ProductStateReducer.reduce(
                initial,
                update(
                    "2",
                    "1",
                    "2",
                    ViewUpdatePayload.Patch(ViewPatch.SessionSpeedHistory(append)),
                ),
            )

        assertEquals(listOf("20", "30", "30", null), reduced.speed?.series?.single()?.values)
        assertEquals("400", reduced.speed?.completeThroughMillis)

        assertThrows(ViewContinuityException::class.java) {
            ProductStateReducer.reduce(
                initial,
                update(
                    "2",
                    "1",
                    "2",
                    ViewUpdatePayload.Patch(
                        ViewPatch.SessionSpeedHistory(
                            append.copy(baseCompleteThroughMillis = "100"),
                        ),
                    ),
                ),
            )
        }
    }

    @Test
    fun pieceRangesRemainExactAboveLegacyU16Boundary() {
        val snapshot =
            update(
                sequence = "1",
                baseRevision = "0",
                revision = "1",
                payload =
                    ViewUpdatePayload.Snapshot(
                        ViewSnapshot.PieceActivity(
                            TORRENT_ID,
                            100_000U,
                            listOf(IndexRange(65_534U, 65_537U)),
                            listOf(
                                ActivePiece(
                                    "90000:1",
                                    90_000U,
                                    1U,
                                    16_384U,
                                    ActivePieceStageView.RECEIVED,
                                    listOf(IndexRange(0U, 16_384U)),
                                    listOf(IndexRange(0U, 8_192U)),
                                    emptyList(),
                                    "10",
                                    null,
                                ),
                            ),
                        ),
                    ),
            )
        val patch =
            update(
                sequence = "2",
                baseRevision = "1",
                revision = "2",
                payload =
                    ViewUpdatePayload.Patch(
                        ViewPatch.PieceActivity(
                            TORRENT_ID,
                            100_000U,
                            listOf(IndexRange(99_998U, 100_000U)),
                            listOf(IndexRange(65_535U, 65_536U)),
                            emptyList(),
                            emptyList(),
                            listOf("90000:1"),
                        ),
                    ),
            )

        val state =
            ProductStateReducer.reduce(
                ProductStateReducer.reduce(ProductState(), snapshot),
                patch,
            )

        assertEquals(
            listOf(
                IndexRange(65_534U, 65_535U),
                IndexRange(65_536U, 65_537U),
                IndexRange(99_998U, 100_000U),
            ),
            state.pieces.getValue(TORRENT_ID).verified,
        )
        assertEquals(100_000U, state.pieces.getValue(TORRENT_ID).pieceCount)
        assertEquals(emptyList<ActivePiece>(), state.pieces.getValue(TORRENT_ID).active)
    }

    @Test
    fun listPatchesConvergeAndSequenceGapsAreRejected() {
        val initial =
            ProductStateReducer.reduce(
                ProductState(),
                update(
                    sequence = "1",
                    baseRevision = "0",
                    revision = "7",
                    payload =
                        ViewUpdatePayload.Snapshot(
                            ViewSnapshot.TorrentList(
                                listOf(torrent("first", TorrentState.DOWNLOADING)),
                                storage(),
                                clientSettings(),
                            ),
                        ),
                ),
            )
        assertTrue(initial.ready)
        assertTrue(initial.checkingStorage)
        val converged =
            ProductStateReducer.reduce(
                initial,
                update(
                    sequence = "2",
                    baseRevision = "7",
                    revision = "8",
                    payload =
                        ViewUpdatePayload.Patch(
                            ViewPatch.TorrentList(
                                listOf(torrent("second", TorrentState.PAUSED)),
                                emptyList(),
                                listOf("first"),
                                null,
                                null,
                            ),
                        ),
                ),
            )

        assertEquals(setOf("second"), converged.torrents.keys)
        assertThrows(ViewContinuityException::class.java) {
            ProductStateReducer.reduce(
                converged,
                update(
                    sequence = "4",
                    baseRevision = "8",
                    revision = "9",
                    payload =
                        ViewUpdatePayload.Patch(
                            ViewPatch.TorrentList(
                                emptyList(),
                                emptyList(),
                                emptyList(),
                                null,
                                null,
                            ),
                        ),
                ),
            )
        }
    }

    @Test
    fun sparseTorrentPatchesClearNullableFieldsAndRequireAnExistingRow() {
        val initial =
            ProductStateReducer.reduce(
                ProductState(),
                update(
                    sequence = "1",
                    baseRevision = "0",
                    revision = "7",
                    payload =
                        ViewUpdatePayload.Snapshot(
                            ViewSnapshot.TorrentList(
                                listOf(torrent("first", TorrentState.DOWNLOADING)),
                                storage(),
                                clientSettings(),
                            ),
                        ),
                ),
            )
        val patched =
            ProductStateReducer.reduce(
                initial,
                update(
                    sequence = "2",
                    baseRevision = "7",
                    revision = "8",
                    payload =
                        ViewUpdatePayload.Patch(
                            ViewPatch.TorrentList(
                                emptyList(),
                                listOf(
                                    TorrentRowUpdate(
                                        "first",
                                        listOf(
                                            TorrentFieldUpdate.DisplayName(null),
                                            TorrentFieldUpdate.TotalSizeBytes(null),
                                            TorrentFieldUpdate.AwaitingFileSelection(true),
                                            TorrentFieldUpdate.PendingFileSelectionPosition(2U),
                                            TorrentFieldUpdate.FileCatalogId("a".repeat(64)),
                                            TorrentFieldUpdate.SelectableFileCount(3U),
                                            TorrentFieldUpdate.SelectedFileCount(2U),
                                            TorrentFieldUpdate.SelectableFileBytes("1500"),
                                            TorrentFieldUpdate.SelectedFileBytes("1200"),
                                            TorrentFieldUpdate.PayloadDownloadRateBytes("4096"),
                                            TorrentFieldUpdate.PrivateTorrent(true),
                                            TorrentFieldUpdate.SourceSizeBytes("1048576"),
                                            TorrentFieldUpdate.Lifetime(
                                                TorrentLifetimeView(
                                                    "14",
                                                    "7",
                                                    "1801",
                                                    "100",
                                                    "90",
                                                    "200",
                                                ),
                                            ),
                                            TorrentFieldUpdate.Seeding(
                                                TorrentSeedingView(
                                                    SeedAdmissionView.QUEUED,
                                                    SeedGoalView(
                                                        SeedGoalStatusView.MET,
                                                        true,
                                                        false,
                                                        false,
                                                    ),
                                                    null,
                                                ),
                                            ),
                                        ),
                                    ),
                                ),
                                emptyList(),
                                null,
                                null,
                            ),
                        ),
                ),
            )

        assertEquals(null, patched.torrents.getValue("first").displayName)
        assertEquals(null, patched.torrents.getValue("first").totalSizeBytes)
        assertTrue(patched.torrents.getValue("first").awaitingFileSelection)
        assertEquals(2U, patched.torrents.getValue("first").pendingFileSelectionPosition)
        assertEquals("a".repeat(64), patched.torrents.getValue("first").fileCatalogId)
        assertEquals(3U, patched.torrents.getValue("first").selectableFileCount)
        assertEquals(2U, patched.torrents.getValue("first").selectedFileCount)
        assertEquals("1500", patched.torrents.getValue("first").selectableFileBytes)
        assertEquals("1200", patched.torrents.getValue("first").selectedFileBytes)
        assertEquals("4096", patched.torrents.getValue("first").payloadDownloadRateBytes)
        assertFalse(initial.torrents.getValue("first").privateTorrent)
        assertTrue(patched.torrents.getValue("first").privateTorrent)
        assertEquals(null, initial.torrents.getValue("first").sourceSizeBytes)
        assertEquals("1048576", patched.torrents.getValue("first").sourceSizeBytes)
        assertEquals("14", patched.torrents.getValue("first").lifetime.uploadedPayloadBytes)
        assertEquals(SeedAdmissionView.QUEUED, patched.torrents.getValue("first").seeding.admission)

        assertThrows(ViewContinuityException::class.java) {
            ProductStateReducer.reduce(
                initial,
                update(
                    sequence = "2",
                    baseRevision = "7",
                    revision = "8",
                    payload =
                        ViewUpdatePayload.Patch(
                            ViewPatch.TorrentList(
                                emptyList(),
                                listOf(
                                    TorrentRowUpdate(
                                        "missing",
                                        listOf(TorrentFieldUpdate.StoredBytes("1")),
                                    ),
                                ),
                                emptyList(),
                                null,
                                null,
                            ),
                        ),
                ),
            )
        }
    }

    @Test
    fun fileCatalogSnapshotsAndPatchesFeedTheProductState() {
        val first = file("first", 0U)
        val second = file("second", 1U)
        val initial =
            ProductStateReducer.reduce(
                ProductState(),
                update(
                    "1",
                    "0",
                    "1",
                    ViewUpdatePayload.Snapshot(
                        ViewSnapshot.Files(
                            TORRENT_ID,
                            FileCatalogState.AVAILABLE,
                            null,
                            CatalogPageView(0U, 1_024U, 2U, null),
                            listOf(first),
                        ),
                    ),
                ),
            )
        val patched =
            ProductStateReducer.reduce(
                initial,
                update(
                    "2",
                    "1",
                    "2",
                    ViewUpdatePayload.Patch(
                        ViewPatch.Files(
                            TORRENT_ID,
                            listOf(second),
                            emptyList(),
                            listOf(first.fileId),
                        ),
                    ),
                ),
            )

        assertEquals(listOf(second.fileId), patched.files.getValue(TORRENT_ID).files.keys.toList())
        assertEquals(2U, patched.files.getValue(TORRENT_ID).page.total)
    }

    @Test
    fun pendingFileSelectionDraftUsesNormalSkipAndCompactRanges() {
        val pending =
            torrent("pending", TorrentState.PAUSED).apply {
                awaitingFileSelection = true
                selectableFileCount = 3U
                selectedFileCount = 2U
                selectableFileBytes = "1500"
                selectedFileBytes = "1200"
            }
        val first = file("first", 0U).copy(lengthBytes = "1000")
        val second =
            file("second", 1U).copy(
                lengthBytes = "200",
                selection = FileSelectionView.HIGH,
            )
        val skipped =
            file("third", 2U).copy(
                lengthBytes = "300",
                selection = FileSelectionView.SKIPPED,
            )

        var draft = PendingFileSelectionDraft()
        assertEquals(PendingFileSelectionSummary(2, BigInteger("1200")), draft.summary(pending))
        draft = requireNotNull(draft.toggle(first))
        draft = requireNotNull(draft.toggle(second))
        assertEquals(PendingFileSelectionSummary(0, BigInteger.ZERO), draft.summary(pending))
        assertEquals(1, draft.compactOverrides().size)
        assertEquals(FileIndexRange(0U, 2U), draft.compactOverrides().single().range)
        assertEquals(false, draft.compactOverrides().single().selected)

        draft = draft.selectNone()
        draft = requireNotNull(draft.toggle(skipped))
        assertEquals(PendingFileSelectionBase.NONE, draft.base)
        assertEquals(PendingFileSelectionSummary(1, BigInteger("300")), draft.summary(pending))
        assertEquals(true, draft.compactOverrides().single().selected)
    }

    @Test
    fun pendingFileSelectionDraftRejectsAnExtraSparseOverride() {
        var draft = PendingFileSelectionDraft()
        repeat(MAX_PENDING_FILE_SELECTION_OVERRIDES) { index ->
            draft = requireNotNull(draft.toggle(file("sparse", (index * 2).toUInt())))
        }
        assertNull(draft.toggle(file("overflow", (MAX_PENDING_FILE_SELECTION_OVERRIDES * 2).toUInt())))
    }

    @Test
    fun pendingFileSelectionDraftSupportsThousandsOfContiguousFilesAndSafety() {
        var draft = PendingFileSelectionDraft()
        repeat(10_000) { index -> draft = requireNotNull(draft.toggle(file("large", index.toUInt()))) }
        assertEquals(FileIndexRange(0U, 10_000U), draft.compactOverrides().single().range)
        val blocked = file("installer", 10_000U).copy(safety = org.rstorrent.session.uniffi.FileSafetyView(".exe", org.rstorrent.session.uniffi.FileSafetyPreset.RECOMMENDED, false, true))
        assertEquals(false, draft.selectAll().selected(blocked))
        assertEquals(draft, draft.toggle(blocked))
        val pending = torrent("pending", TorrentState.PAUSED).apply {
            selectableFileCount = 2U; selectableFileBytes = "100"
            safetySummary = org.rstorrent.session.uniffi.FileSafetySummary(1U, "20")
        }
        assertEquals(PendingFileSelectionSummary(1, BigInteger("80")), draft.selectAll().summary(pending))
    }

    @Test
    fun mediaCatalogSnapshotsAndPatchesFeedTheProductState() {
        val first = media("0", 0U, "0")
        val verified = media("0", 0U, "1024")
        val initial =
            ProductStateReducer.reduce(
                ProductState(),
                update(
                    "1",
                    "0",
                    "1",
                    ViewUpdatePayload.Snapshot(
                        ViewSnapshot.Media(
                            TORRENT_ID,
                            MediaCatalogState.AVAILABLE,
                            2U,
                            listOf(first),
                        ),
                    ),
                ),
            )
        val patched =
            ProductStateReducer.reduce(
                initial,
                update(
                    "2",
                    "1",
                    "2",
                    ViewUpdatePayload.Patch(
                        ViewPatch.Media(TORRENT_ID, listOf(verified), emptyList()),
                    ),
                ),
            )

        assertEquals(
            "1024",
            patched.media.getValue(TORRENT_ID).items.getValue("0").verifiedBytes,
        )
        assertEquals(2U, patched.media.getValue(TORRENT_ID).totalNonPaddingFiles)
    }

    @Test
    fun libraryMediaPagesAndRowPatchesFeedTheProductState() {
        val subscription =
            SubscriptionSpec(
                ViewSelector.Library(
                    LibraryMediaQuery(
                        text = "show",
                        kinds = listOf(LibraryMediaKind.VIDEO),
                        roles = listOf(LibraryMediaRole.EPISODE),
                        availability = LibraryAvailabilityFilter.ANY,
                        archived = LibraryArchivedFilter.EXCLUDE,
                        torrentId = null,
                        groupId = null,
                        grouping = LibraryGrouping.UNGROUPED,
                        sort = LibraryMediaSort.TITLE,
                        descending = false,
                    ),
                ),
                ViewProjection.LIBRARY_MEDIA,
                DeliveryPolicy(0U, 256U * 1024U),
                null,
                CatalogPageRequest(0U, 100U),
            )
        val initial =
            ProductStateReducer.reduce(
                ProductState(),
                update(
                    "1",
                    "0",
                    "1",
                    ViewUpdatePayload.Snapshot(
                        ViewSnapshot.LibraryMedia(
                            CatalogPageView(0U, 100U, 2U, null),
                            libraryFacets(),
                            listOf(libraryItem(0U, "0"), libraryItem(1U, "0")),
                            emptyList(),
                        ),
                    ),
                ),
            )
        val patched =
            ProductStateReducer.reduce(
                initial,
                update(
                    "2",
                    "1",
                    "2",
                    ViewUpdatePayload.Patch(
                        ViewPatch.LibraryMedia(listOf(libraryItem(1U, "512"))),
                    ),
                ),
            )

        assertEquals(100U, subscription.catalogPage?.limit)
        assertEquals(listOf("0", "512"), patched.libraryMedia?.items?.map { it.verifiedBytes })
        assertEquals(2U, patched.libraryMedia?.page?.total)
    }

    @Test
    fun libraryFiltersUseOperationalStateAndSortingIsStable() {
        val queued =
            torrent("queued", TorrentState.PAUSED).copy(
                displayName = "Zulu",
                operationalState = TorrentOperationalState.QUEUED,
                downloadQueuePosition = 2U,
            )
        val active =
            torrent("active", TorrentState.DOWNLOADING).copy(
                displayName = "Alpha",
                operationalState = TorrentOperationalState.DOWNLOADING,
                downloadQueuePosition = 1U,
            )
        val finished =
            torrent("finished", TorrentState.COMPLETE).copy(
                operationalState = TorrentOperationalState.PAUSED,
            )
        val provisional =
            torrent("provisional", TorrentState.PAUSED).copy(
                displayName = null,
                sourceDisplayName = "Magnet name",
            )

        assertEquals("Magnet name", torrentPresentationName(provisional))

        assertEquals(
            listOf("active"),
            filteredAndSortedTorrents(
                listOf(queued, active, finished),
                TorrentFilter.ACTIVE,
                TorrentSort.STABLE,
            ).map(TorrentView::torrentId),
        )
        assertEquals(
            listOf("active", "finished", "queued"),
            filteredAndSortedTorrents(
                listOf(queued, active, finished),
                TorrentFilter.ALL,
                TorrentSort.NAME,
            ).map(TorrentView::torrentId),
        )
    }

    @Test
    fun librarySortingRetainsTheFiveHundredRowBound() {
        val torrents =
            List(500) { index ->
                torrent("torrent-${index.toString().padStart(3, '0')}", TorrentState.PAUSED).copy(
                    displayName = "Torrent ${500 - index}",
                    operationalState = TorrentOperationalState.QUEUED,
                    downloadQueuePosition = index.toUInt(),
                )
            }

        val sorted =
            filteredAndSortedTorrents(torrents, TorrentFilter.ALL, TorrentSort.STABLE)

        assertEquals(500, sorted.size)
        assertEquals("torrent-000", sorted.first().torrentId)
        assertEquals("torrent-499", sorted.last().torrentId)
    }

    private fun storage(): StorageSettingsSnapshot =
        StorageSettingsSnapshot(emptyList(), null, false, true)

    private fun file(
        id: String,
        index: UInt,
    ): FileView =
        FileView(
            safety = null,
            fileId = id,
            fileIndex = index,
            path = listOf("file-$index.bin"),
            lengthBytes = "1024",
            torrentOffsetBytes = (index.toULong() * 1024UL).toString(),
            firstPiece = index,
            lastPiece = index,
            selection = FileSelectionView.NORMAL,
            padding = false,
            doneBytes = "0",
            verifiedBytes = "0",
            mediaAvailability = MediaFileAvailability.UNVERIFIED,
        )

    private fun media(
        id: String,
        index: UInt,
        verifiedBytes: String,
    ): MediaItemView =
        MediaItemView(
            mediaId = id,
            fileIndex = index,
            path = listOf("Show.Name.S01E02.mkv"),
            extension = "mkv",
            lengthBytes = "1024",
            selection = FileSelectionView.NORMAL,
            doneBytes = verifiedBytes,
            verifiedBytes = verifiedBytes,
            mediaAvailability =
                if (verifiedBytes == "1024") {
                    MediaFileAvailability.AVAILABLE
                } else {
                    MediaFileAvailability.UNVERIFIED
                },
            role = MediaRoleView.Episode("Show Name", 1U, 2U, null),
        )

    private fun libraryItem(
        index: UInt,
        verifiedBytes: String,
    ): LibraryMediaItemView =
        LibraryMediaItemView(
            itemId = "$TORRENT_ID:$index",
            torrentId = TORRENT_ID,
            torrentName = "Show Name",
            fileIndex = index,
            fileName = "Show.Name.S01E0${index + 1U}.mkv",
            title = "Episode ${index + 1U}",
            kind = LibraryMediaKind.VIDEO,
            role = LibraryMediaRole.EPISODE,
            seriesTitle = "Show Name",
            seriesId = "series:show name",
            seasonNumber = 1U.toUShort(),
            episodeNumber = (index + 1U).toUShort(),
            endingEpisodeNumber = null,
            albumTitle = null,
            albumId = null,
            discNumber = null,
            trackNumber = null,
            year = null,
            extension = "mkv",
            lengthBytes = "1024",
            verifiedBytes = verifiedBytes,
            offline = verifiedBytes == "1024",
            archived = false,
            mediaAvailability = MediaFileAvailability.UNVERIFIED,
        )

    private fun libraryFacets(): LibraryFacetsView =
        LibraryFacetsView(
            items = 2U,
            video = 2U,
            audio = 0U,
            episodes = 2U,
            movies = 0U,
            otherVideos = 0U,
            tracks = 0U,
            offline = 0U,
            incomplete = 2U,
            series = 1U,
            albums = 0U,
            torrents = 1U,
            metadataPending = 0U,
        )

    private fun clientSettings(
        configured: ClientSettings =
            ClientSettings(
                            fileSafety = org.rstorrent.session.uniffi.FileSafetySettings(true, org.rstorrent.session.uniffi.FileSafetyPreset.RECOMMENDED, emptyList(), true),
                listener = ListenerPolicy.Disabled,
                preferredListenPort = 6_881U.toUShort(),
                portMapping = PortMappingPolicy.DISABLED,
                peerConnectionLimit = 200U,
                uploadSlots = 8U.toUShort(),
                activeDownloads = 3U.toUShort(),
                activeSeeds = ActiveSeedLimit.Limited(5U.toUShort()),
                shareRatioLimitPercent = 200U,
                finishedDownloadRatioLimitPercent = 700U,
                finishedTimeLimitSeconds = 86_400U,
                seedStopRatioPercent = org.rstorrent.session.uniffi.SeedStopLimit.Off,
                seedStopTimeSeconds = org.rstorrent.session.uniffi.SeedStopLimit.Off,
                uploadRateLimit = TransferRateLimit.Unlimited,
                downloadRateLimit = TransferRateLimit.Unlimited,
                encryption = EncryptionPolicy.ALLOW,
                ipv6Enabled = true,
                dhtEnabled = true,
                peerExchangeEnabled = true,
                trackerHttpsServerAuthentication = HttpsServerAuthenticationPolicy.SYSTEM_TRUST,
            ),
    ): ClientSettingsRuntimeView =
        ClientSettingsRuntimeView(
            configured = configured,
            applicationNetwork =
                ApplicationNetworkRuntimeView(
                    requestedGeneration = "1",
                    requestedPrerequisite = ApplicationNetworkPrerequisiteView.ALLOWED,
                    effectiveGeneration = "1",
                    effectivePrerequisite = ApplicationNetworkPrerequisiteView.ALLOWED,
                    state = ApplicationNetworkRuntimeState.ALLOWED,
                    degradedDetail = null,
                ),
            effectiveListener =
                EffectiveListenerSettings(
                    listener = ListenerPolicy.Disabled,
                    preferredListenPort = 6_881U.toUShort(),
                ),
            effectivePortMapping = PortMappingPolicy.DISABLED,
            effectivePeerConnectionLimit = 200U,
            effectiveUploadSlots = 8U.toUShort(),
            effectiveActiveDownloads = configured.activeDownloads,
            effectiveActiveSeeds = configured.activeSeeds,
            effectiveUploadRateLimit = configured.uploadRateLimit,
            effectiveDownloadRateLimit = configured.downloadRateLimit,
            activeDownloadsClampReason = null,
            activeDownloadCount = 0U.toUShort(),
            checkingCount = 0U.toUShort(),
            activeSeedCount = 0U.toUShort(),
            inactiveSeedCount = 0U.toUShort(),
            effectiveEncryption = configured.encryption,
            effectiveIpv6Enabled = configured.ipv6Enabled,
            effectiveDhtEnabled = configured.dhtEnabled,
            effectivePeerExchangeEnabled = configured.peerExchangeEnabled,
            effectiveTrackerHttpsServerAuthentication =
                configured.trackerHttpsServerAuthentication,
            transportApplication =
                if (configured.listener == ListenerPolicy.Disabled) {
                    ClientSettingsApplicationState.Applied
                } else {
                    ClientSettingsApplicationState.Applying
                },
            portMappingApplication = ClientSettingsApplicationState.Applied,
            peerConnectionsApplication = ClientSettingsApplicationState.Applied,
            uploadSlotsApplication = ClientSettingsApplicationState.Applied,
            bandwidthApplication = ClientSettingsApplicationState.Applied,
            bandwidth =
                BandwidthRuntimeView(
                    upload = bandwidthDirection(),
                    download = bandwidthDirection(),
                ),
            encryptionApplication = ClientSettingsApplicationState.Applied,
            ipv6Application = ClientSettingsApplicationState.Applied,
            dhtApplication = ClientSettingsApplicationState.Applied,
            peerExchangeApplication = ClientSettingsApplicationState.Applied,
            trackerHttpsAuthenticationApplication = ClientSettingsApplicationState.Applied,
            listenerStatus = ListenerStatus.Disabled,
            sessionUdpStatus = SessionUdpStatus.Unavailable,
            portMappingStatus = PortMappingStatus.Disabled,
            udpPortMappingStatus = PortMappingStatus.Disabled,
            ipv6PinholeStatus = Ipv6PinholeStatus.Disabled,
            advertisedPeerEndpoint = AdvertisedPeerEndpointStatus.Unavailable,
            transportFamilies = emptyList(),
        )

    private fun bandwidthDirection(): BandwidthDirectionRuntimeView =
        BandwidthDirectionRuntimeView(
            registeredTorrents = 0U,
            activeWaiters = 0U,
            queuedRequestedBytes = "0",
            grantedBytes = "0",
            returnedBytes = "0",
            cancelledRequests = "0",
            throttleWaitMicros = "0",
            throttleWaitHighWaterMicros = "0",
            currentBurstCreditBytes = "0",
        )

    private fun speedHistory() =
        SpeedHistoryView(
            capturedMillis = "250",
            historyEpoch = "history-1",
            range = SpeedRange.SECONDS30,
            bucketMillis = "100",
            startMillis = "0",
            completeThroughMillis = "200",
            live = true,
            persistence = SpeedPersistenceState.HEALTHY,
            series =
                listOf(
                    SpeedSeriesView(
                        SpeedMetric.PAYLOAD_RECEIVED,
                        listOf("10", null, "20", "30"),
                    ),
                ),
            catalog =
                listOf(
                    SpeedMetricAvailability(SpeedMetric.PAYLOAD_RECEIVED, true, null),
                ),
        )

    private fun update(
        sequence: String,
        baseRevision: String,
        revision: String,
        payload: ViewUpdatePayload,
    ): ViewUpdate =
        ViewUpdate(
            2U.toUShort(),
            "stream-1",
            "epoch-1",
            sequence,
            baseRevision,
            revision,
            payload,
        )

    private fun torrent(
        id: String,
        state: TorrentState,
    ): TorrentView =
        TorrentView(
            safetySummary = null,
            torrentId = id,
            protocolIdentities =
                TorrentProtocolIdentities(
                    v1 = "0123456789abcdef0123456789abcdef01234567",
                    v2 = null,
                ),
            displayName = "Verified torrent",
            sourceDisplayName = null,
            sourceSizeBytes = null,
            state = state,
            operationalState = TorrentOperationalState.DOWNLOADING,
            downloadQueuePosition = null,
            transferLimits =
                TorrentTransferLimits(
                    TransferRateLimit.Unlimited,
                    TransferRateLimit.Unlimited,
                ),
            storageState = StorageState.AVAILABLE,
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
            pieceCount = 100_000U,
            totalSizeBytes = "1638400000",
            verifiedPieceCount = 65_536U,
            requestedBytes = "16384",
            receivedBytes = "16384",
            storedBytes = "8192",
            activePeerConnections = 0U,
            configuredTrackerCount = 2U,
            payloadDownloadRateBytes = "0",
            requiredPayloadBytes = "1638400000",
            remainingPayloadBytes = "565248000",
            etaPayloadDownloadRateBytes = "0",
            eta = TorrentEtaView.Unavailable,
            lifetime = TorrentLifetimeView("0", "0", "0", "0", "0", "0"),
            seeding = TorrentSeedingView(SeedAdmissionView.INELIGIBLE, null, null),
            progress = ProgressAssessment(
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

    companion object {
        private const val TORRENT_ID = "t1-0123456789abcdef0123456789abcdef"
    }
}
