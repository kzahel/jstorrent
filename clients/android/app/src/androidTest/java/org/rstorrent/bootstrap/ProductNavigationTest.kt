package org.rstorrent.bootstrap

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.rstorrent.bootstrap.ui.ProductApp
import org.rstorrent.bootstrap.ui.LibraryBrowseState
import org.rstorrent.bootstrap.ui.LibraryGroupSelection
import org.rstorrent.bootstrap.ui.LibraryPreset
import org.rstorrent.bootstrap.ui.PrimaryDestination
import org.rstorrent.bootstrap.ui.libraryMediaRequest
import org.rstorrent.session.uniffi.LibraryFacetsView
import org.rstorrent.session.uniffi.LibraryGroupView
import org.rstorrent.session.uniffi.LibraryMediaItemView
import org.rstorrent.session.uniffi.LibraryMediaKind
import org.rstorrent.session.uniffi.LibraryMediaRole
import androidx.compose.ui.test.performTextInput
import org.rstorrent.bootstrap.ui.PendingFileSelectionDialog
import org.rstorrent.bootstrap.ui.ProductThemeMode
import org.rstorrent.bootstrap.ui.FileSelectionBottomBar
import org.rstorrent.bootstrap.ui.FilesScreen
import org.rstorrent.bootstrap.ui.RstorrentTheme
import org.rstorrent.session.uniffi.ApplicationNetworkPrerequisiteView
import org.rstorrent.session.uniffi.ApplicationNetworkRuntimeState
import org.rstorrent.session.uniffi.ApplicationNetworkRuntimeView
import org.rstorrent.session.uniffi.ActiveSeedLimit
import org.rstorrent.session.uniffi.ProgressAssessment
import org.rstorrent.session.uniffi.ProgressDisposition
import org.rstorrent.session.uniffi.ProgressPhase
import org.rstorrent.session.uniffi.ProgressReason
import org.rstorrent.session.uniffi.SeedAdmissionView
import org.rstorrent.session.uniffi.AdvertisedPeerEndpointStatus
import org.rstorrent.session.uniffi.BandwidthDirectionRuntimeView
import org.rstorrent.session.uniffi.BandwidthRuntimeView
import org.rstorrent.session.uniffi.ClientSettings
import org.rstorrent.session.uniffi.ClientSettingsApplicationState
import org.rstorrent.session.uniffi.ClientSettingsPatch
import org.rstorrent.session.uniffi.ClientSettingsRuntimeView
import org.rstorrent.session.uniffi.CatalogPageView
import org.rstorrent.session.uniffi.EffectiveListenerSettings
import org.rstorrent.session.uniffi.EncryptionPolicy
import org.rstorrent.session.uniffi.FileCatalogState
import org.rstorrent.session.uniffi.FilePriority
import org.rstorrent.session.uniffi.FileSelectionView
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.HttpsServerAuthenticationPolicy
import org.rstorrent.session.uniffi.Ipv6PinholeStatus
import org.rstorrent.session.uniffi.ListenerBindFailureReason
import org.rstorrent.session.uniffi.ListenerPolicy
import org.rstorrent.session.uniffi.ListenerStatus
import org.rstorrent.session.uniffi.MediaFileAvailability
import org.rstorrent.session.uniffi.PortMappingPolicy
import org.rstorrent.session.uniffi.PortMappingStatus
import org.rstorrent.session.uniffi.PendingFileSelectionBase
import org.rstorrent.session.uniffi.SessionUdpStatus
import org.rstorrent.session.uniffi.StorageRootAvailability
import org.rstorrent.session.uniffi.StorageRootSnapshot
import org.rstorrent.session.uniffi.StorageSettingsSnapshot
import org.rstorrent.session.uniffi.StorageState
import org.rstorrent.session.uniffi.TorrentTransferLimits
import org.rstorrent.session.uniffi.TransferRateLimit
import org.rstorrent.session.uniffi.TorrentEtaView
import org.rstorrent.session.uniffi.TorrentLifetimeView
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentProtocolIdentities
import org.rstorrent.session.uniffi.TorrentState
import org.rstorrent.session.uniffi.TorrentSeedingView
import org.rstorrent.session.uniffi.TorrentView
import org.rstorrent.session.uniffi.TorrentSettingsPatch

class ProductNavigationTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun libraryCompletedSeedAndMetadataRowsShowRelevantProgress() {
        val seed = torrent().copy(
            displayName = "Completed seed",
            state = TorrentState.COMPLETE,
            operationalState = TorrentOperationalState.SEEDING,
            downloadQueuePosition = null,
            remainingPayloadBytes = "0",
            verifiedPieceCount = 4U,
            lifetime = torrent().lifetime.copy(uploadedPayloadBytes = "2048", shareRatioHundredths = "150"),
        )
        var state by mutableStateOf(ProductState(
            ready = true,
            storageRootReady = true,
            storageRootChecking = false,
            torrents = mapOf(seed.torrentId to seed),
        ))
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = state,
            )
        }
        compose.onNodeWithText("Uploaded 2.0 KB").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Ratio 1.50").assertIsDisplayed()
        compose.onAllNodesWithText("ETA", substring = true).assertCountEquals(0)
        compose.onAllNodesWithText("↓", substring = true).assertCountEquals(0)
        compose.onNodeWithText("Seeding 1 torrent").assertIsDisplayed()
        compose.runOnIdle {
            val metadata = torrent().copy(
                displayName = "Pending metadata",
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
            state = state.copy(torrents = mapOf(metadata.torrentId to metadata))
        }
        compose.onAllNodesWithText("Getting torrent info").assertCountEquals(2)
        compose.onAllNodesWithText("Queue 1", substring = true).assertCountEquals(0)
        compose.onNodeWithText("↓ 4.0 KB/s").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("ETA 12 s").assertIsDisplayed()
    }

    @Test
    fun libraryReachesSettingsHierarchyAndAddIntake() {
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
            )
        }

        compose
            .onNodeWithContentDescription("Add torrent")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Browse .torrent files").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performSemanticsAction(SemanticsActions.OnClick)

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Storage").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Add download folder").assertIsDisplayed()
    }

    @Test
    fun advancedSettingsFeedbackInvokesOneInjectedCallback() {
        var feedbackCalls = 0
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                onOpenFeedback = { _, _ -> feedbackCalls += 1 },
                onPreviewFeedback = {
                    org.rstorrent.session.uniffi.ProductFeedbackPreview(
                        destination = "https://jstorrent.com/feedback.html",
                        url = "https://jstorrent.com/feedback.html?platform=android&v=0.1",
                        fields =
                            listOf(
                                org.rstorrent.session.uniffi.ProductFeedbackField(
                                    "platform",
                                    "android",
                                    false,
                                ),
                                org.rstorrent.session.uniffi.ProductFeedbackField("v", "0.1", false),
                            ),
                        statisticsAvailable = false,
                        statisticsIncluded = false,
                        hostedContextReady = false,
                    )
                },
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
            )
        }

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Advanced")
            .performScrollTo()
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Help us improve JSTorrent").performScrollTo().assertIsDisplayed()
        compose
            .onNodeWithText("Report Bug / Send Feedback")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Review what will be sent").assertIsDisplayed()
        compose.onNodeWithText("Open feedback page").performSemanticsAction(SemanticsActions.OnClick)

        compose.runOnIdle { assertEquals(1, feedbackCalls) }
    }

    @Test
    fun feedbackStatisticsCheckboxCanBeCheckedAndUnchecked() {
        val requests = mutableListOf<Boolean>()
        val opened = mutableListOf<Pair<Boolean, String>>()
        val baseUrl = "https://jstorrent.com/feedback.html?platform=android&v=1.0.29"
        val includedUrl = "$baseUrl&sessions=1"
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                onOpenFeedback = { include, url -> opened += include to url },
                onPreviewFeedback = { include ->
                    requests += include
                    org.rstorrent.session.uniffi.ProductFeedbackPreview(
                        destination = "https://jstorrent.com/feedback.html",
                        url = if (include) includedUrl else baseUrl,
                        fields =
                            if (include) {
                                listOf(org.rstorrent.session.uniffi.ProductFeedbackField("sessions", "1", true))
                            } else {
                                emptyList()
                            },
                        statisticsAvailable = true,
                        statisticsIncluded = include,
                        hostedContextReady = true,
                    )
                },
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
            )
        }
        compose.onNodeWithContentDescription("More options").performClick()
        compose.onNodeWithText("Settings").performClick()
        compose.onNodeWithText("Advanced").performScrollTo().performClick()
        compose.onNodeWithText("Report Bug / Send Feedback").performScrollTo().performClick()
        val checkbox = compose.onNodeWithText("Include pseudonymous usage statistics for this report")
        checkbox.assertIsEnabled().assertIsOff().performClick()
        checkbox.assertIsOn()
        compose.onNodeWithText("sessions: 1").assertIsDisplayed()
        checkbox.performClick().assertIsOff()
        compose.onNodeWithText("sessions: 1").assertDoesNotExist()
        checkbox.performClick().assertIsOn()
        compose.onNodeWithText("Open feedback page").performClick()
        compose.runOnIdle {
            assertEquals(listOf(false, true, false, true), requests)
            assertEquals(listOf(true to includedUrl), opened)
        }
    }

    @Test
    fun advancedResetAndClearRequireExplicitNonStickyConfirmations() {
        var resetCalls = 0
        val clearCalls = mutableListOf<Boolean>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                onResetClientSettings = { resetCalls += 1 },
                onClearAllData = { clearCalls += it },
            )
        }

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performClick()
        compose.onNodeWithText("Advanced").performScrollTo().performClick()

        compose.onNodeWithText("Reset settings").performScrollTo()
        compose.onNode(hasText("Reset") and hasClickAction()).performClick()
        compose.onNodeWithText("Reset settings?").assertIsDisplayed()
        compose.onNode(hasText("Reset") and hasAnyAncestor(isDialog())).performClick()
        compose.runOnIdle { assertEquals(1, resetCalls) }

        compose.onNodeWithText("Clear all data").performScrollTo()
        compose.onNodeWithText("Clear").performClick()
        compose
            .onNode(isToggleable() and hasAnyAncestor(isDialog()))
            .assertIsOff()
            .performClick()
        compose.onNode(hasText("Clear all data") and hasAnyAncestor(isDialog())).performClick()
        compose.runOnIdle { assertEquals(listOf(true), clearCalls) }

        compose.onNodeWithText("Clear").performClick()
        compose.onNode(isToggleable() and hasAnyAncestor(isDialog())).assertIsOff()
        compose.onNode(hasText("Cancel") and hasAnyAncestor(isDialog())).performClick()
        compose.runOnIdle { assertEquals(listOf(true), clearCalls) }
    }

    @Test
    fun clearProgressFailureDowngradeAndSuccessFollowServiceState() {
        var retries = 0
        var keepRemaining = 0
        var completions = 0
        var state by
            mutableStateOf(
                ProductState(
                    dataReset =
                        ProductDataResetState(
                            operationId = "operation",
                            phase = ProductDataResetPhase.REMOVING_TORRENTS,
                            completedTorrents = 2,
                            totalTorrents = 5,
                            deleteDataRequested = true,
                            downgradedToKeep = false,
                        ),
                ),
            )
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = state,
                onRetryDataReset = { retries += 1 },
                onFinishDataResetKeepingFiles = { keepRemaining += 1 },
                onDismissCompletedDataReset = { completions += 1 },
            )
        }

        compose.onNodeWithText("Clearing data").assertIsDisplayed()
        compose.onNodeWithText("2 of 5 torrents removed").assertIsDisplayed()
        compose.runOnIdle {
            state =
                state.copy(
                    dataReset =
                        requireNotNull(state.dataReset).copy(
                            failure =
                                ProductDataResetFailureState(
                                    "provider_refused",
                                    "the provider refused deletion",
                                ),
                        ),
                )
        }
        compose.onNodeWithText("Couldn’t finish clearing data").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        compose.onNodeWithText("Finish without deleting remaining files").performClick()
        compose.onNodeWithText("Keep the remaining files?").assertIsDisplayed()
        compose
            .onAllNodesWithText("Finish without deleting remaining files")[1]
            .performClick()
        compose.runOnIdle {
            assertEquals(1, retries)
            assertEquals(1, keepRemaining)
            state =
                state.copy(
                    dataReset =
                        requireNotNull(state.dataReset).copy(
                            completedTorrents = 5,
                            downgradedToKeep = true,
                            failure = null,
                            complete = true,
                        ),
                )
        }
        compose.onNodeWithText("Data cleared").assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        compose.runOnIdle { assertEquals(1, completions) }
    }

    @Test
    fun liveTorrentReachesAllDetailAndGlobalRoutes() {
        val torrent = torrent()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.DARK,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        storageRootReady = true,
                        storageRootChecking = false,
                        torrents = mapOf(torrent.torrentId to torrent),
                    ),
            )
        }

        compose.onNodeWithText("Fixture torrent").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Info hash (v1)").performScrollTo()
        awaitDisplayed("Info hash (v1)")
        compose.onNodeWithText("Info hash (v2)").performScrollTo()
        awaitDisplayed("Info hash (v2)")
        listOf("Details", "Status", "Files", "Trackers", "Peers", "Pieces").forEach {
            compose
                .onNodeWithText(it)
                .performScrollTo()
                .assertIsDisplayed()
                .performSemanticsAction(SemanticsActions.OnClick)
        }
        compose
            .onNodeWithContentDescription("Back")
            .performSemanticsAction(SemanticsActions.OnClick)

        listOf("Speed", "DHT Info", "Logs").forEach { route ->
            compose
                .onNodeWithContentDescription("More options")
                .performSemanticsAction(SemanticsActions.OnClick)
            compose.onNodeWithText(route).performSemanticsAction(SemanticsActions.OnClick)
            compose.onNodeWithText(route).assertIsDisplayed()
            compose
                .onNodeWithContentDescription("Back")
                .performSemanticsAction(SemanticsActions.OnClick)
        }
    }

    @Test
    fun confirmingRemovalFromDetailReturnsToLibrary() {
        val torrent = torrent()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        storageRootReady = true,
                        storageRootChecking = false,
                        torrents = mapOf(torrent.torrentId to torrent),
                    ),
            )
        }

        compose.onNodeWithText("Fixture torrent").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Info hash (v1)")
        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Remove").performSemanticsAction(SemanticsActions.OnClick)
        // Cancelling keeps the detail; only a confirmed removal leaves it.
        compose.onNodeWithText("Cancel").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Info hash (v1)").assertIsDisplayed()
        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Remove").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Keep data").performSemanticsAction(SemanticsActions.OnClick)

        // The fixture has no service, so the torrent is still listed.
        awaitLibrary()
        compose.onNodeWithText("Fixture torrent").assertIsDisplayed()
    }

    @Test
    fun detailLeavesWhenItsTorrentDisappearsFromALoadedLibrary() {
        val torrent = torrent()
        val loaded =
            ProductState(
                ready = true,
                storageRootReady = true,
                storageRootChecking = false,
                torrents = mapOf(torrent.torrentId to torrent),
            )
        var state by mutableStateOf(loaded)
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = state,
            )
        }

        compose.onNodeWithText("Fixture torrent").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Info hash (v1)")

        // A reconnecting service has no torrents yet; that is not a removal.
        state = loaded.copy(ready = false, torrents = emptyMap())
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Back").assertIsDisplayed()

        state = loaded.copy(torrents = emptyMap())
        awaitLibrary()
        compose.onNodeWithText("No torrents yet").assertIsDisplayed()
    }

    @Test
    fun streamableVideoExposesPlayButKeepsCompletedOpenDisabled() {
        val file = mediaFile(MediaFileAvailability.STREAMABLE, verifiedBytes = "32768")
        val played = mutableListOf<FileView>()
        compose.setContent {
            RstorrentTheme(ProductThemeMode.LIGHT, dynamicColor = false) {
                FilesScreen(
                    catalog = fileCatalog(file),
                    onSetPriority = { _, _ -> },
                    onDownloadNow = {},
                    onPlay = { played += it },
                    onOpen = {},
                    mediaLaunchPending = false,
                    onPage = {},
                )
            }
        }

        compose
            .onNodeWithTag("play-media-file")
            .assertIsEnabled()
            .performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(listOf(file), played)
        compose.onNodeWithTag("more-media-file").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("sheet-play-media-file").assertIsEnabled()
        compose.onNodeWithTag("sheet-open-media-file").assertIsNotEnabled()
        compose.onNodeWithTag("sheet-download-media-file").assertIsEnabled()
    }

    @Test
    fun completedVideoRetainsOpenAndPendingLaunchDisablesPlay() {
        val file = mediaFile(MediaFileAvailability.AVAILABLE, verifiedBytes = "65536")
        val opened = mutableListOf<FileView>()
        compose.setContent {
            RstorrentTheme(ProductThemeMode.LIGHT, dynamicColor = false) {
                FilesScreen(
                    catalog = fileCatalog(file),
                    onSetPriority = { _, _ -> },
                    onDownloadNow = {},
                    onPlay = {},
                    onOpen = { opened += it },
                    mediaLaunchPending = true,
                    onPage = {},
                )
            }
        }

        compose.onNodeWithTag("play-media-file").assertIsNotEnabled()
        compose.onNodeWithTag("more-media-file").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("sheet-play-media-file").assertIsNotEnabled()
        compose.onNodeWithTag("sheet-download-media-file").assertIsNotEnabled()
        compose
            .onNodeWithTag("sheet-open-media-file")
            .assertIsEnabled()
            .performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(listOf(file), opened)
    }

    @Test
    fun filePrioritySheetOffersThreeExplicitChoices() {
        val file = mediaFile(MediaFileAvailability.STREAMABLE, verifiedBytes = "32768")
        val changes = mutableListOf<Pair<List<FileView>, FilePriority>>()
        compose.setContent {
            RstorrentTheme(ProductThemeMode.LIGHT, dynamicColor = false) {
                FilesScreen(
                    catalog = fileCatalog(file),
                    onSetPriority = { files, priority -> changes += files to priority },
                    onDownloadNow = {},
                    onPlay = {},
                    onOpen = {},
                    mediaLaunchPending = false,
                    onPage = {},
                )
            }
        }

        compose.onNodeWithTag("file-media-file").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("priority-normal").assertIsSelected()
        compose.onNodeWithTag("priority-skip").assertIsNotSelected()
        compose.onNodeWithTag("priority-high").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("priority-skip").performSemanticsAction(SemanticsActions.OnClick)
        // The current value is not re-sent.
        compose.onNodeWithTag("priority-normal").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(
            listOf(listOf(file) to FilePriority.HIGH, listOf(file) to FilePriority.SKIP),
            changes,
        )
    }

    @Test
    fun fileSelectionReplacesDetailBarWithLibrarySelectionMechanics() {
        val torrent = torrent()
        val files = selectionFiles()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.DARK,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        storageRootReady = true,
                        storageRootChecking = false,
                        torrents = mapOf(torrent.torrentId to torrent),
                        files =
                            mapOf(
                                torrent.torrentId to
                                    FileCatalogViewState(
                                        state = FileCatalogState.AVAILABLE,
                                        filesystemContentBase = null,
                                        page = CatalogPageView(0U, 3U, 3U, null),
                                        files = files.associateBy(FileView::fileId),
                                    ),
                            ),
                    ),
            )
        }

        compose.onNodeWithText("Fixture torrent").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Files").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("1 skipped")
        compose.onNodeWithTag("open-cover-file").assertIsEnabled()
        compose.onAllNodesWithTag("open-notes-file").assertCountEquals(0)

        // Long-press enters selection: the selection bar replaces the detail bar.
        compose.onNodeWithTag("file-media-file").performSemanticsAction(SemanticsActions.OnLongClick)
        compose.onNodeWithText("1 selected").assertIsDisplayed()
        compose.onNodeWithContentDescription("Clear selection").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Back").assertCountEquals(0)
        compose.onNodeWithTag("play-media-file").assertIsNotEnabled()
        // Tap toggles while any file is selected instead of opening the sheet.
        compose.onNodeWithTag("file-notes-file").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("2 selected").assertIsDisplayed()
        compose.onAllNodesWithTag("priority-normal").assertCountEquals(0)

        // The toggle selects every file, then offers to deselect them all.
        compose.onNodeWithContentDescription("Select all").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("3 selected").assertIsDisplayed()
        compose.onNodeWithContentDescription("Deselect all").performSemanticsAction(SemanticsActions.OnClick)
        compose.onAllNodesWithContentDescription("Clear selection").assertCountEquals(0)
        compose.onNodeWithContentDescription("Back").assertIsDisplayed()

        // Leaving the Files tab clears the selection, as changing Library tabs does.
        compose.onNodeWithTag("file-media-file").performSemanticsAction(SemanticsActions.OnLongClick)
        compose.onNodeWithText("1 selected").assertIsDisplayed()
        compose.onNodeWithText("Trackers").performSemanticsAction(SemanticsActions.OnClick)
        compose.waitUntil(5_000) {
            compose.onAllNodesWithContentDescription("Clear selection").fetchSemanticsNodes().isEmpty()
        }
        compose.onNodeWithText("Files").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("play-media-file").assertIsEnabled()

        compose.onNodeWithTag("file-media-file").performSemanticsAction(SemanticsActions.OnLongClick)
        compose.onNodeWithContentDescription("Clear selection").performSemanticsAction(SemanticsActions.OnClick)
        compose.onAllNodesWithText("1 selected").assertCountEquals(0)
    }

    @Test
    fun fileSelectionBarBatchesCommandsForEligibleFiles() {
        val (first, second, third) = selectionFiles()
        var archived by mutableStateOf(false)
        val priorities = mutableListOf<Pair<List<FileView>, FilePriority>>()
        val downloads = mutableListOf<List<FileView>>()
        val shares = mutableListOf<List<FileView>>()
        compose.setContent {
            RstorrentTheme(ProductThemeMode.LIGHT, dynamicColor = false) {
                FileSelectionBottomBar(
                    selected = listOf(first, second, third),
                    archived = archived,
                    onSetPriority = { files, priority -> priorities += files to priority },
                    onDownloadNow = { downloads += it },
                    onShare = { shares += it },
                )
            }
        }

        compose.onNodeWithText("High").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Skip").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(
            listOf(
                listOf(first, second, third) to FilePriority.HIGH,
                listOf(first, second, third) to FilePriority.SKIP,
            ),
            priorities,
        )
        // Download now targets only wanted, incomplete files.
        compose.onNodeWithText("Download now").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(listOf(listOf(first)), downloads)
        // Share links name every selected file.
        compose.onNodeWithText("Share files").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(listOf(listOf(first, second, third)), shares)

        // An archived torrent cannot start, but its priorities stay editable.
        archived = true
        compose.onNodeWithText("Download now").assertIsNotEnabled()
        compose.onNodeWithText("Normal").assertIsEnabled()
    }

    @Test
    fun torrentRateEditorSurvivesFreshActiveRowsAndEmitsOneDirection() {
        val initial =
            torrent().copy(
                transferLimits =
                    TorrentTransferLimits(
                        TransferRateLimit.Limited(128U * 1_024U),
                        TransferRateLimit.Limited(256U * 1_024U),
                    ),
            )
        var state by
            mutableStateOf(
                ProductState(
                    ready = true,
                    storageRootReady = true,
                    storageRootChecking = false,
                    torrents = mapOf(initial.torrentId to initial),
                ),
            )
        val patches = mutableListOf<TorrentSettingsPatch>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = state,
                onUpdateTorrentSettings = { _, patch -> patches += patch },
            )
        }

        compose.onNodeWithText("Fixture torrent").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("torrent-details").performScrollToNode(hasText("Download limit"))
        compose
            .onNodeWithText("Download limit")
            .performSemanticsAction(SemanticsActions.OnClick)
        val unlimited = compose.onNode(hasText("Unlimited") and hasAnyAncestor(isDialog()))
        unlimited.performSemanticsAction(SemanticsActions.OnClick).assertIsSelected()
        repeat(24) { index ->
            compose.runOnIdle {
                val fresh =
                    initial.copy(
                        transferLimits =
                            TorrentTransferLimits(
                                TransferRateLimit.Limited(128U * 1_024U),
                                TransferRateLimit.Limited(256U * 1_024U),
                            ),
                        receivedBytes = (8_192 + index).toString(),
                    )
                state = state.copy(torrents = mapOf(fresh.torrentId to fresh))
            }
        }
        unlimited.assertIsSelected()
        compose.onNodeWithText("Apply").performSemanticsAction(SemanticsActions.OnClick)

        assertEquals(1, patches.size)
        assertNull(patches.single().uploadRateLimit)
        assertEquals(TransferRateLimit.Unlimited, patches.single().downloadRateLimit)
    }

    @Test
    fun globalRateEditorEmitsOneTypedProperty() {
        val patches = mutableListOf<ClientSettingsPatch>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        storageRootReady = true,
                        clientSettings = clientSettings(),
                    ),
                onUpdateClientSettings = { patches += it },
            )
        }

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Speed & Limits")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("256 KB/s").assertIsDisplayed()
        compose
            .onNodeWithText("Download")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNode(hasText("Unlimited") and hasAnyAncestor(isDialog()))
            .performSemanticsAction(SemanticsActions.OnClick)
            .assertIsSelected()
        compose.onNodeWithText("Apply").performSemanticsAction(SemanticsActions.OnClick)

        assertEquals(1, patches.size)
        assertEquals(TransferRateLimit.Unlimited, patches.single().downloadRateLimit)
        assertNull(patches.single().uploadRateLimit)
        assertNull(patches.single().peerConnectionLimit)
    }

    @Test
    fun speedSettingsEditActiveSeedsWithoutSeedingGoals() {
        val patches = mutableListOf<ClientSettingsPatch>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        storageRootReady = true,
                        clientSettings = clientSettings(),
                    ),
                onUpdateClientSettings = { patches += it },
            )
        }

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Speed & Limits")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onAllNodesWithText("goal", substring = true).assertCountEquals(0)
        compose.onAllNodesWithText("Effective", substring = true).assertCountEquals(0)
        compose
            .onNodeWithText("Max active seeds")
            .performScrollTo()
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNode(isToggleable())
            .performSemanticsAction(SemanticsActions.OnClick)
            .assertIsOn()
        compose.onNodeWithText("Apply").performSemanticsAction(SemanticsActions.OnClick)

        assertEquals(1, patches.size)
        assertEquals(ActiveSeedLimit.Unlimited, patches.single().activeSeeds)
        assertNull(patches.single().shareRatioLimitPercent)
        assertNull(patches.single().finishedTimeLimitSeconds)
    }

    @Test
    fun networkSettingsEmitIndependentDhtAndPeerExchangePatches() {
        val patches = mutableListOf<ClientSettingsPatch>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        storageRootReady = true,
                        clientSettings = clientSettings(),
                    ),
                onUpdateClientSettings = { patches += it },
            )
        }

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Network & Privacy")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithContentDescription("DHT")
            .assertIsOn()
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithContentDescription("Peer exchange (PEX)")
            .assertIsOn()
            .performSemanticsAction(SemanticsActions.OnClick)

        assertEquals(2, patches.size)
        assertEquals(false, patches[0].dhtEnabled)
        assertNull(patches[0].peerExchangeEnabled)
        assertNull(patches[1].dhtEnabled)
        assertEquals(false, patches[1].peerExchangeEnabled)
    }

    @Test
    fun networkStatusUsesPlainProductCopy() {
        var settings by mutableStateOf(clientSettings())
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        storageRootReady = true,
                        clientSettings = settings,
                    ),
            )
        }
        compose.onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Network & Privacy")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Incoming connections").assertIsDisplayed()
        compose.onAllNodesWithText("Port", substring = true).assertCountEquals(0)
        compose.onAllNodesWithText("Applied", substring = true).assertCountEquals(0)
        compose.onAllNodesWithText("org.rstorrent", substring = true).assertCountEquals(0)

        compose.runOnIdle {
            settings = settings.copy(
                listenerStatus = ListenerStatus.Listening("::1", 6881u),
                portMappingStatus = PortMappingStatus.CleanupFailed(
                    "203.0.113.9", 4567u, 120u, "Router refused deletion",
                ),
            )
        }
        compose.onNodeWithText("Port 6881").assertIsDisplayed()
        compose.onNodeWithText("The router may keep port 4567 open").assertIsDisplayed()
        compose.onAllNodesWithText("Router refused deletion", substring = true).assertCountEquals(0)
        compose.runOnIdle {
            settings = settings.copy(
                listenerStatus = ListenerStatus.BindFailed(
                    ListenerBindFailureReason.ADDRESS_IN_USE, "Port 6881 is occupied",
                ),
            )
        }
        compose.onNodeWithText("Port already in use").assertIsDisplayed()
        compose.onAllNodesWithText("Port 6881 is occupied").assertCountEquals(0)
        compose.onAllNodesWithText("org.rstorrent", substring = true).assertCountEquals(0)
    }

    @Test
    fun externalMagnetUsesGenericConfirmationBeforeFileSelection() {
        val confirmations = mutableListOf<Long>()
        val choices = mutableListOf<Long>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        storageRootReady = true,
                        externalIntake =
                            ExternalIntakePresentation(
                                41,
                                ExternalIntakeKind.MAGNET,
                                ExternalIntakePhase.PRESENTED,
                                null,
                                true,
                            ),
                    ),
                onConfirmExternalIntake = { confirmations += it },
                onChooseExternalFiles = { choices += it },
            )
        }

        compose.onNodeWithText("Add torrent").assertIsDisplayed()
        compose.onNodeWithText("Download folder:", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Choose files…").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(listOf(41L), choices)
        compose.onNodeWithText("Download all").performSemanticsAction(SemanticsActions.OnClick)
        compose.onAllNodesWithText("secret.invalid", substring = true).assertCountEquals(0)
        assertEquals(listOf(41L), confirmations)
    }

    @Test
    fun pendingFileSelectionUsesNormalSkipAndExplicitConfirmation() {
        val file = mediaFile(MediaFileAvailability.UNVERIFIED, "0")
        val pending =
            torrent().copy(
                awaitingFileSelection = true,
                pendingFileSelectionPosition = 0U,
                fileCatalogId = "a".repeat(64),
                selectableFileCount = 1U,
                selectedFileCount = 1U,
                selectableFileBytes = file.lengthBytes,
                selectedFileBytes = file.lengthBytes,
            )
        var confirmed: PendingFileSelectionDraft? = null
        var disableFuture = false
        compose.setContent {
            RstorrentTheme(ProductThemeMode.LIGHT, false) {
                PendingFileSelectionDialog(
                    torrent = pending,
                    files = fileCatalog(file),
                    rootLabel = "Downloads",
                    rootReady = true,
                    queuedCount = 2,
                    error = null,
                    onPage = {},
                    onRepairRoot = {},
                    onConfirm = { draft, disable ->
                        confirmed = draft
                        disableFuture = disable
                    },
                    onCancel = {},
                    onDownloadAll = {},
                )
            }
        }

        compose.onNodeWithText("2 more pending", substring = true).assertIsDisplayed()
        compose.onNodeWithText("None").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("0 of 1 selected", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Add").assertIsEnabled()
        compose
            .onNodeWithText("Fixture/clip.mp4")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("1 of 1 selected", substring = true).assertIsDisplayed()
        compose
            .onNodeWithText("Don’t show file selection again")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Download").performSemanticsAction(SemanticsActions.OnClick)

        assertEquals(PendingFileSelectionBase.NONE, confirmed?.base)
        assertEquals(true, confirmed?.compactOverrides()?.single()?.selected)
        assertEquals(true, disableFuture)
    }

    @Test
    fun pendingMagnetCanDownloadAllBeforeFileListArrives() {
        val downloads = mutableListOf<Boolean>()
        var confirmations = 0
        compose.setContent {
            RstorrentTheme(ProductThemeMode.LIGHT, false) {
                PendingFileSelectionDialog(
                    torrent = torrent().copy(awaitingFileSelection = true, fileCatalogId = null),
                    files = null,
                    rootLabel = "Downloads",
                    rootReady = true,
                    queuedCount = 0,
                    error = null,
                    onPage = {},
                    onRepairRoot = {},
                    onConfirm = { _, _ -> confirmations++ },
                    onCancel = {},
                    onDownloadAll = { downloads += it },
                )
            }
        }
        compose.onNodeWithText("Loading file list…").assertIsDisplayed()
        compose.onNodeWithText("Download all").assertIsEnabled()
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Don’t show file selection again")
            .assertIsDisplayed()
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Download all").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(listOf(false, true), downloads)
        assertEquals(0, confirmations)
    }

    @Test
    fun pendingFileSelectionKeepsSkipChoiceWhenFileListArrives() {
        val file = mediaFile(MediaFileAvailability.UNVERIFIED, "0")
        val pending =
            torrent().copy(
                awaitingFileSelection = true,
                pendingFileSelectionPosition = 0U,
                fileCatalogId = null,
                selectableFileCount = 1U,
                selectedFileCount = 1U,
                selectableFileBytes = file.lengthBytes,
                selectedFileBytes = file.lengthBytes,
            )
        var metadataReady by mutableStateOf(false)
        var disableFuture: Boolean? = null
        compose.setContent {
            RstorrentTheme(ProductThemeMode.LIGHT, false) {
                PendingFileSelectionDialog(
                    torrent =
                        if (metadataReady) pending.copy(fileCatalogId = "a".repeat(64)) else pending,
                    files = if (metadataReady) fileCatalog(file) else null,
                    rootLabel = "Downloads",
                    rootReady = true,
                    queuedCount = 0,
                    error = null,
                    onPage = {},
                    onRepairRoot = {},
                    onConfirm = { _, disable -> disableFuture = disable },
                    onCancel = {},
                    onDownloadAll = {},
                )
            }
        }
        compose
            .onNodeWithText("Don’t show file selection again")
            .performSemanticsAction(SemanticsActions.OnClick)
        metadataReady = true
        compose.onNodeWithText("Fixture/clip.mp4").assertIsDisplayed()
        compose.onNodeWithText("Download").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(true, disableFuture)
    }

    @Test
    fun externalTorrentWaitsForRootAndOffersCancel() {
        val selections = mutableListOf<Unit>()
        val cancellations = mutableListOf<Long>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = { selections += Unit },
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        externalIntake =
                            ExternalIntakePresentation(
                                42,
                                ExternalIntakeKind.TORRENT_FILE,
                                ExternalIntakePhase.AWAITING_ROOT,
                                "safe.torrent",
                                true,
                            ),
                    ),
                onCancelExternalIntake = { cancellations += it },
            )
        }

        compose.onNodeWithText("Add torrent").assertIsDisplayed()
        compose.onNodeWithText("safe.torrent").assertIsDisplayed()
        compose.onNodeWithText("Choose a download folder first. Downloads are saved there.")
            .assertIsDisplayed()
        compose.onAllNodesWithText("Download all").assertCountEquals(0)
        compose.onNode(
            hasText("Select folder") and hasAnyAncestor(isDialog()),
        ).performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Cancel").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(1, selections.size)
        assertEquals(listOf(42L), cancellations)
    }

    @Test
    fun externalRetryIsExplicitAndBoundedByServiceState() {
        val retries = mutableListOf<Long>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        storageRootReady = true,
                        externalIntake =
                            ExternalIntakePresentation(
                                43,
                                ExternalIntakeKind.TORRENT_FILE,
                                ExternalIntakePhase.RETRYABLE_FAILURE,
                                null,
                                true,
                            ),
                    ),
                onRetryExternalIntake = { retries += it },
            )
        }

        compose.onNodeWithText("The source could not be read. You can retry once.")
            .assertIsDisplayed()
        compose.onNodeWithText("Retry").performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(listOf(43L), retries)
    }

    @Test
    fun libraryOffersFolderThenBackgroundEvenWithNotificationsGranted() {
        var state by mutableStateOf(ProductState(ready = true, storageRootChecking = false))
        val backgroundChanges = mutableListOf<Boolean>()
        var permissionOnlyCalls = 0
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = { state = state.copy(storageRootReady = true) },
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = { permissionOnlyCalls += 1 },
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = state,
                onBackgroundDownloads = { enabled ->
                    backgroundChanges += enabled
                    state = state.copy(
                        lifecycle = state.lifecycle.copy(
                            backgroundDownloadsEnabled = enabled,
                            effectiveBackgroundDownloads = enabled,
                        ),
                    )
                },
            )
        }
        compose.onNodeWithText("Select folder").assertIsDisplayed()
        compose.onAllNodesWithText("Keep downloading when you leave JSTorrent?").assertCountEquals(0)
        compose.onNodeWithText("Select folder").performClick()
        compose.onNodeWithText("Keep downloading when you leave JSTorrent?").assertIsDisplayed()
        compose.onNodeWithText("Enable").performClick()
        compose.onAllNodesWithText("Keep downloading when you leave JSTorrent?").assertCountEquals(0)
        assertEquals(listOf(true), backgroundChanges)
        assertEquals(0, permissionOnlyCalls)
        assertEquals(false, state.lifecycle.keepSeedingEnabled)
    }

    @Test
    fun libraryBackgroundOfferRemainsAfterDenialAndCanBeDeferred() {
        val backgroundChanges = mutableListOf<Boolean>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = false,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = ProductState(ready = true, storageRootReady = true, storageRootChecking = false),
                onBackgroundDownloads = { backgroundChanges += it },
            )
        }
        compose.onNodeWithText("Enable").performClick()
        compose.onNodeWithText(
            "Allow notifications to keep downloads running after you leave JSTorrent. Stops when downloads finish.",
        ).assertIsDisplayed()
        compose.onNodeWithText("Not now").performClick()
        compose.onAllNodesWithText("Keep downloading when you leave JSTorrent?").assertCountEquals(0)
        compose.onNodeWithContentDescription("Add torrent").assertIsDisplayed()
        assertEquals(listOf(true), backgroundChanges)
    }

    @Test
    fun libraryOffersRecoveryForConfiguredButBlockedBackground() {
        val backgroundChanges = mutableListOf<Boolean>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = ProductState(
                    ready = true,
                    storageRootReady = true,
                    storageRootChecking = false,
                    lifecycle = ProductLifecycleState(backgroundDownloadsEnabled = true),
                    notifications = ProductNotificationState(backgroundChannelEnabled = false),
                ),
                onBackgroundDownloads = { backgroundChanges += it },
            )
        }
        compose.onNodeWithText("Keep downloading when you leave JSTorrent?").assertIsDisplayed()
        compose.onNodeWithText("Enable").performClick()
        assertEquals(listOf(true), backgroundChanges)
    }

    @Test
    fun notificationSettingsExposePermissionChannelsAndDurableChoices() {
        val changes = mutableListOf<Pair<ProductNotificationPreference, Boolean>>()
        var permissionGranted by mutableStateOf(true)
        var systemSettingsCalls = 0
        var permissionRequests = 0
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = permissionGranted,
                onRequestNotifications = { permissionRequests++ },
                onOpenNotificationSettings = { systemSettingsCalls++ },
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        notifications =
                            ProductNotificationState(
                                permissionGranted = permissionGranted,
                                completionChannelEnabled = false,
                            ),
                    ),
                onUpdateNotificationPreference = { preference, enabled ->
                    changes += preference to enabled
                },
            )
        }

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Notifications").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Notifications allowed").assertIsDisplayed()
        compose.onNodeWithText("Blocked in Android settings").assertIsDisplayed()
        compose
            .onNodeWithText("Download complete")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Needs attention")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onAllNodesWithText("Manage").assertCountEquals(1)
        compose.onAllNodesWithText("Open").assertCountEquals(0)
        compose.onNodeWithText("Manage").performClick()
        compose.runOnIdle { permissionGranted = false }
        compose.onNodeWithText("Notifications off").assertIsDisplayed()
        compose.onAllNodesWithText("Manage").assertCountEquals(0)
        compose.onAllNodesWithText("Enable").assertCountEquals(1)
        compose.onNodeWithText("Enable").performClick()
        compose.runOnIdle {
            assertEquals(2, systemSettingsCalls)
            assertEquals(0, permissionRequests)
        }
        assertEquals(
            listOf(
                ProductNotificationPreference.DOWNLOAD_COMPLETE to false,
                ProductNotificationPreference.NEEDS_ATTENTION to false,
            ),
            changes,
        )
    }

    @Test
    fun blockedBackgroundChannelExplainsVisibleOnlyOperation() {
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        notifications =
                            ProductNotificationState(
                                permissionGranted = true,
                                backgroundChannelEnabled = false,
                            ),
                    ),
            )
        }

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Notifications").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Background notifications blocked").assertIsDisplayed()
        compose.onNodeWithText("Required for background downloads").assertIsDisplayed()
    }

    @Test
    fun powerSettingsExposeBackgroundPolicyAndSeedingWarning() {
        val backgroundChanges = mutableListOf<Boolean>()
        val seedingChanges = mutableListOf<Boolean>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        lifecycle =
                            ProductLifecycleState(
                                backgroundDownloadsEnabled = true,
                                effectiveBackgroundDownloads = true,
                            ),
                    ),
                onBackgroundDownloads = { backgroundChanges += it },
                onKeepSeedingInBackground = { seedingChanges += it },
            )
        }

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Power Management")
            .performScrollTo()
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Android may stop long background sessions. Open JSTorrent to resume.")
            .performScrollTo()
            .assertIsDisplayed()
        compose.onAllNodesWithText("Not available", substring = true).assertCountEquals(0)
        compose
            .onNodeWithContentDescription("Download in background")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithContentDescription("Keep seeding when done")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Keep seeding when done?").assertIsDisplayed()
        compose.onNodeWithText("Keep seeding").performSemanticsAction(SemanticsActions.OnClick)

        assertEquals(listOf(false), backgroundChanges)
        assertEquals(listOf(true), seedingChanges)
    }

    @Test
    fun notificationNavigationSelectsExactTorrentAndConsumesOnce() {
        val consumed = mutableListOf<Long>()
        val torrent = torrent()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    ProductState(
                        ready = true,
                        torrents = mapOf(torrent.torrentId to torrent),
                    ),
                notificationNavigation =
                    ProductNotificationNavigation.Torrent(7L, torrent.torrentId),
                onNotificationNavigationConsumed = { consumed += it },
            )
        }

        compose.onNodeWithText("Info hash (v1)").assertIsDisplayed()
        assertEquals(listOf(7L), consumed)
    }

    @Test
    fun staleNotificationTargetFallsBackToLibrary() {
        val consumed = mutableListOf<Long>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = ProductState(ready = true),
                notificationNavigation =
                    ProductNotificationNavigation.Torrent(
                        8L,
                        "t1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    ),
                onNotificationNavigationConsumed = { consumed += it },
            )
        }

        compose.onNodeWithText("That torrent is no longer available.").assertIsDisplayed()
        assertEquals(listOf(8L), consumed)
    }

    @Test
    fun libraryRepairTargetsRetainedDefaultRoot() {
        checkLibraryStorageAction(repair = true)
    }

    @Test
    fun emptyLibraryFiltersReturnToAllAndRevealItsTab() {
        showNarrowLibrary(listOf(torrent().copy(operationalState = TorrentOperationalState.PAUSED)))

        for (tab in listOf("Active", "Queued", "Finished", "Archived")) {
            compose.onNodeWithText(tab).performScrollTo().performClick()
            compose.onNodeWithText("View all torrents").performScrollTo().assertIsEnabled().performClick()
            compose.onNodeWithText("All").assertIsSelected().assertIsDisplayed()
            compose.onNodeWithText("Fixture torrent").performScrollTo().assertIsDisplayed()
            compose.onAllNodesWithText("View all torrents").assertCountEquals(0)
        }
    }

    @Test
    fun emptyLibraryShowsAddGuidanceOnFilteredTab() {
        showNarrowLibrary(emptyList())
        compose.onNodeWithText("Archived").performScrollTo().performClick()
        compose.onNodeWithText("No torrents yet").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Tap Add to paste a magnet or choose a .torrent file.")
            .performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("View all torrents").assertCountEquals(0)
    }

    @Test
    fun archiveOnlyLibraryDoesNotOfferAnEmptyAllView() {
        showNarrowLibrary(listOf(torrent().copy(archived = true, operationalState = TorrentOperationalState.PAUSED)))
        compose.onNodeWithText("Active").performScrollTo().performClick()
        compose.onNodeWithText("Try another filter.").performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("View all torrents").assertCountEquals(0)
        compose.onNodeWithText("Archived").performScrollTo().performClick()
        compose.onNodeWithText("Fixture torrent").performScrollTo().assertIsDisplayed()
    }

    private fun showNarrowLibrary(torrents: List<TorrentView>) {
        compose.setContent {
            Box(Modifier.width(360.dp)) {
                ProductApp(
                    service = null,
                    onSelectStorage = {},
                    onBrowseTorrent = {},
                    notificationsGranted = true,
                    onRequestNotifications = {},
                    onOpenNotificationSettings = {},
                    themeMode = ProductThemeMode.LIGHT,
                    dynamicColor = false,
                    onThemeMode = {},
                    onDynamicColor = {},
                    stateOverride = ProductState(
                        ready = true,
                        storageRootReady = true,
                        storageRootChecking = false,
                        lifecycle = ProductLifecycleState(effectiveBackgroundDownloads = true),
                        torrents = torrents.associateBy(TorrentView::torrentId),
                    ),
                )
            }
        }
    }

    @Test
    fun libraryFirstFolderUsesSelection() {
        checkLibraryStorageAction(repair = false)
    }

    @Test
    fun libraryMenuCanChooseAnotherFolderWhileRepairIsNeeded() {
        checkLibraryStorageAction(repair = true, chooseFromMenu = true)
    }

    private fun checkLibraryStorageAction(repair: Boolean, chooseFromMenu: Boolean = false) {
        var selections = 0
        val repairs = mutableListOf<String>()
        val roots = if (repair) listOf(
            StorageRootSnapshot("other", "Other folder", null, StorageRootAvailability.AVAILABLE),
            StorageRootSnapshot("retained", "Saved folder", null, StorageRootAvailability.UNAVAILABLE),
        ) else emptyList()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = { selections += 1 },
                onRepairStorage = { repairs += it },
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = ProductState(
                    ready = true,
                    storageRootChecking = false,
                    storageRootLabel = if (repair) "Saved folder" else null,
                    storage = StorageSettingsSnapshot(roots, if (repair) "retained" else null, false, true),
                ),
            )
        }
        compose.onNodeWithText(if (repair) "Selected download folder is unavailable." else "Choose a download folder")
            .performScrollTo().assertIsDisplayed()
        if (chooseFromMenu) {
            compose.onNodeWithContentDescription("More options").performClick()
            compose.onNodeWithText("Choose a download folder").performClick()
        } else {
            compose.onNodeWithText(if (repair) "Repair" else "Select folder").performScrollTo().performClick()
        }
        compose.runOnIdle {
            assertEquals(if (repair && !chooseFromMenu) 0 else 1, selections)
            assertEquals(if (repair && !chooseFromMenu) listOf("retained") else emptyList<String>(), repairs)
        }
    }

    @Test
    fun primaryNavigationSwitchesDestinationsAndHidesDuringSelection() {
        val torrent = torrent()
        val destinations = mutableListOf<PrimaryDestination>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    libraryState(torrent).copy(
                        libraryMedia = libraryPage(LibraryBrowseState(), listOf(libraryItem(0U))),
                    ),
                onPrimaryDestination = { destinations += it },
            )
        }

        awaitDisplayed("Fixture torrent")
        compose.onNodeWithText("Library").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Episode 1")
        compose.onNodeWithContentDescription("Add torrent").assertIsDisplayed()
        compose.onNodeWithText("Torrents").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Fixture torrent")

        // The selection bar replaces the primary navigation while it is shown.
        compose.onNodeWithText("Fixture torrent").performSemanticsAction(SemanticsActions.OnLongClick)
        compose.onNodeWithText("1 selected").assertIsDisplayed()
        compose.onAllNodesWithText("Library").assertCountEquals(0)
        compose.onNodeWithContentDescription("Clear selection")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Library").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(
                listOf(
                    PrimaryDestination.TORRENTS,
                    PrimaryDestination.LIBRARY,
                    PrimaryDestination.TORRENTS,
                ),
                destinations,
            )
        }
    }

    @Test
    fun libraryOpensShowsInPlaceAndReachesTheSourceTorrent() {
        val torrent = torrent()
        val episodes = listOf(libraryItem(0U), libraryItem(1U))
        val files = selectionFiles()
        var state by mutableStateOf(
            libraryState(torrent).copy(
                libraryMedia = libraryPage(LibraryBrowseState(), episodes),
                files =
                    mapOf(
                        torrent.torrentId to
                            FileCatalogViewState(
                                state = FileCatalogState.AVAILABLE,
                                filesystemContentBase = null,
                                page = CatalogPageView(0U, 3U, 3U, null),
                                files = files.associateBy(FileView::fileId),
                            ),
                    ),
            ),
        )
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = state,
                startDestination = PrimaryDestination.LIBRARY,
            )
        }

        awaitDisplayed("Episode 1")
        compose.onNodeWithText("S01E02 · Show Name").assertIsDisplayed()

        // A page answering another request is never shown as the current one.
        compose.onNodeWithText("TV shows").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("library-loading").assertIsDisplayed()
        compose.onAllNodesWithText("Episode 1").assertCountEquals(0)
        val shows = LibraryBrowseState(preset = LibraryPreset.SHOWS)
        val show = LibraryGroupView("series:show name", "Show Name", 2U, 0U, "2048", 1U, 1U, null)
        compose.runOnIdle {
            state = state.copy(libraryMedia = libraryPage(shows, groups = listOf(show)))
        }
        awaitDisplayed("2 episodes · 1 season · 2.0 KB")
        compose.onNodeWithText("Shows").assertIsDisplayed()
        compose.onNodeWithText("Episodes").assertIsDisplayed()

        val opened = shows.copy(group = LibraryGroupSelection(show.groupId, show.title))
        compose.onNodeWithTag("library-group-series:show name")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.runOnIdle { state = state.copy(libraryMedia = libraryPage(opened, episodes)) }
        awaitDisplayed("Episode 2")
        compose.onAllNodesWithText("TV shows").assertCountEquals(0)

        // Back closes the show in place.
        compose.onNodeWithContentDescription("Back").performSemanticsAction(SemanticsActions.OnClick)
        compose.runOnIdle {
            state = state.copy(libraryMedia = libraryPage(shows, groups = listOf(show)))
        }
        awaitDisplayed("2 episodes · 1 season · 2.0 KB")

        // An item's actions show it in its torrent's Files tab, and Back
        // returns to the open show.
        compose.onNodeWithTag("library-group-series:show name")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.runOnIdle { state = state.copy(libraryMedia = libraryPage(opened, episodes)) }
        awaitDisplayed("Episode 1")
        compose.onNodeWithTag("library-more-t1-0123456789abcdef0123456789abcdef:1")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("library-sheet-play").assertIsNotEnabled()
        compose.onNodeWithTag("library-sheet-open-with").assertIsNotEnabled()
        compose.onNodeWithTag("library-sheet-folder").assertIsEnabled()
        compose.onNodeWithText("Show in torrent").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Fixture torrent")
        compose.onNodeWithTag("file-notes-file").assertIsDisplayed()
        compose.onAllNodesWithText("Library").assertCountEquals(0)
        compose.onNodeWithContentDescription("Back").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Episode 2")
        compose.onNodeWithText("Library").assertIsDisplayed()
    }

    @Test
    fun libraryOffersPlayPagesSearchAndEmptyStates() {
        val streamable = libraryItem(0U, availability = MediaFileAvailability.STREAMABLE)
        val incomplete =
            libraryItem(1U, availability = MediaFileAvailability.INCOMPLETE).copy(verifiedBytes = "512")
        val track =
            libraryItem(2U, availability = MediaFileAvailability.AVAILABLE).copy(
                title = "Opening Theme",
                fileName = "01 Opening Theme.flac",
                extension = "flac",
                kind = LibraryMediaKind.AUDIO,
                role = LibraryMediaRole.TRACK,
                albumTitle = "Soundtrack",
                trackNumber = 1U.toUShort(),
                verifiedBytes = "1024",
                offline = true,
            )
        var state by mutableStateOf(
            libraryState(torrent()).copy(
                libraryMedia =
                    libraryPage(
                        LibraryBrowseState(),
                        listOf(streamable, incomplete, track),
                        total = 250U,
                        nextOffset = 100U,
                    ),
            ),
        )
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = state,
                startDestination = PrimaryDestination.LIBRARY,
            )
        }

        awaitDisplayed("Opening Theme")
        compose.onNodeWithText("Soundtrack · Track 1").assertIsDisplayed()
        compose.onNodeWithText("50.0% · 512 B of 1.0 KB").assertIsDisplayed()
        // Video rows offer Play when the file can stream; audio has no player yet.
        val play = compose.onAllNodesWithContentDescription("Play")
        play.assertCountEquals(2)
        play[0].assertIsEnabled()
        play[1].assertIsNotEnabled()
        // Every row, audio included, has the actions menu.
        compose.onAllNodesWithContentDescription("File actions").assertCountEquals(3)
        compose.onNodeWithTag("library-more-t1-0123456789abcdef0123456789abcdef:2")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onAllNodesWithTag("library-sheet-play").assertCountEquals(0)
        compose.onNodeWithTag("library-sheet-open-with").assertIsEnabled()
        compose.onNodeWithTag("library-sheet-folder").performSemanticsAction(SemanticsActions.OnClick)
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("library-sheet-torrent").fetchSemanticsNodes().isEmpty()
        }

        compose.onNodeWithText("1–100").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Next").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("library-loading").assertIsDisplayed()
        compose.runOnIdle {
            state =
                state.copy(
                    libraryMedia =
                        libraryPage(
                            LibraryBrowseState(page = 1),
                            listOf(libraryItem(3U)),
                            offset = 100U,
                            total = 250U,
                            nextOffset = 200U,
                        ),
                )
        }
        awaitDisplayed("Episode 4")

        // Search is debounced into the request and starts at the first page.
        compose.onNodeWithContentDescription("Search library")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithTag("library-search").performTextInput("nothing")
        compose.waitUntil(5_000) {
            compose.onAllNodesWithTag("library-loading").fetchSemanticsNodes().isNotEmpty()
        }
        compose.runOnIdle {
            state =
                state.copy(
                    libraryMedia =
                        libraryPage(
                            LibraryBrowseState(text = "nothing"),
                            emptyList(),
                            facets = libraryFacets(items = 1U, pending = 0U),
                        ),
                )
        }
        awaitDisplayed("Nothing matches this search and these filters")
        compose.onNodeWithText("Show all media").performSemanticsAction(SemanticsActions.OnClick)
        compose.runOnIdle {
            state =
                state.copy(
                    libraryMedia =
                        libraryPage(
                            LibraryBrowseState(),
                            emptyList(),
                            facets = libraryFacets(items = 0U, pending = 1U),
                        ),
                )
        }
        awaitDisplayed("Your library has no video or music yet")
        compose.onNodeWithText("1 torrent is still getting file details from peers.")
            .assertIsDisplayed()
    }

    @Test
    fun externalIntakeLandsOnTorrentsFromTheLibrary() {
        val destinations = mutableListOf<PrimaryDestination>()
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride =
                    libraryState(torrent()).copy(
                        externalIntake =
                            ExternalIntakePresentation(
                                42,
                                ExternalIntakeKind.MAGNET,
                                ExternalIntakePhase.PRESENTED,
                                null,
                                true,
                            ),
                    ),
                startDestination = PrimaryDestination.LIBRARY,
                onPrimaryDestination = { destinations += it },
            )
        }

        compose.onNodeWithText("Add torrent").assertIsDisplayed()
        compose.waitUntil(5_000) { destinations.lastOrNull() == PrimaryDestination.TORRENTS }
    }

    @Test
    fun libraryOpensAgainAfterAnExternalAddReturnsToTorrents() {
        val torrent = torrent()
        val base =
            libraryState(torrent).copy(
                libraryMedia = libraryPage(LibraryBrowseState(), listOf(libraryItem(0U))),
            )
        var state by mutableStateOf(base)
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = state,
            )
        }

        awaitDisplayed("Fixture torrent")
        // Switch back and forth first so each destination has saved state.
        compose.onNodeWithText("Library").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Episode 1")
        compose.onNodeWithText("Torrents").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Fixture torrent")
        compose.onNodeWithText("Library").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Episode 1")

        // A magnet from another app lands on Torrents.
        compose.runOnIdle {
            state =
                base.copy(
                    externalIntake =
                        ExternalIntakePresentation(
                            43,
                            ExternalIntakeKind.MAGNET,
                            ExternalIntakePhase.PRESENTED,
                            null,
                            true,
                        ),
                )
        }
        compose.onNodeWithText("Add torrent").assertIsDisplayed()
        compose.runOnIdle { state = base }
        awaitDisplayed("Fixture torrent")

        compose.onNodeWithText("Library").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Episode 1")
        compose.onNodeWithText("Torrents").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Fixture torrent")
        compose.onNodeWithText("Library").performSemanticsAction(SemanticsActions.OnClick)
        awaitDisplayed("Episode 1")
    }

    @Test
    fun rememberedLibraryOpensAgainAfterAnExternalAddLandsOnTorrents() {
        val torrent = torrent()
        val base =
            libraryState(torrent).copy(
                libraryMedia = libraryPage(LibraryBrowseState(), listOf(libraryItem(0U))),
            )
        var state by mutableStateOf(base)
        compose.setContent {
            ProductApp(
                service = null,
                onSelectStorage = {},
                onBrowseTorrent = {},
                notificationsGranted = true,
                onRequestNotifications = {},
                onOpenNotificationSettings = {},
                themeMode = ProductThemeMode.LIGHT,
                dynamicColor = false,
                onThemeMode = {},
                onDynamicColor = {},
                stateOverride = state,
                startDestination = PrimaryDestination.LIBRARY,
            )
        }

        // The app reopens on the remembered Library, then a magnet from
        // another app lands on Torrents before any tab switch.
        awaitDisplayed("Episode 1")
        compose.runOnIdle {
            state =
                base.copy(
                    externalIntake =
                        ExternalIntakePresentation(
                            44,
                            ExternalIntakeKind.MAGNET,
                            ExternalIntakePhase.PRESENTED,
                            null,
                            true,
                        ),
                )
        }
        compose.onNodeWithText("Add torrent").assertIsDisplayed()
        compose.runOnIdle { state = base }
        awaitDisplayed("Fixture torrent")

        repeat(3) {
            compose.onNodeWithText("Library").performSemanticsAction(SemanticsActions.OnClick)
            awaitDisplayed("Episode 1")
            compose.onAllNodesWithText("Fixture torrent").assertCountEquals(0)
            compose.onNodeWithText("Torrents").performSemanticsAction(SemanticsActions.OnClick)
            awaitDisplayed("Fixture torrent")
            compose.onAllNodesWithText("Episode 1").assertCountEquals(0)
        }
    }

    private fun libraryState(torrent: TorrentView) =
        ProductState(
            ready = true,
            storageRootReady = true,
            storageRootChecking = false,
            torrents = mapOf(torrent.torrentId to torrent),
        )

    private fun libraryPage(
        browse: LibraryBrowseState,
        items: List<LibraryMediaItemView> = emptyList(),
        groups: List<LibraryGroupView> = emptyList(),
        offset: UInt = 0U,
        total: UInt = (items.size + groups.size).toUInt(),
        nextOffset: UInt? = null,
        facets: LibraryFacetsView = libraryFacets(items = total, pending = 0U),
    ) = LibraryMediaViewState(
        CatalogPageView(offset, 100U, total, nextOffset),
        facets,
        items,
        groups,
        libraryMediaRequest(browse),
    )

    private fun libraryFacets(
        items: UInt,
        pending: UInt,
    ) = LibraryFacetsView(
        items = items,
        video = items,
        audio = 0U,
        episodes = items,
        movies = 0U,
        otherVideos = 0U,
        tracks = 0U,
        offline = 0U,
        incomplete = items,
        series = 1U,
        albums = 0U,
        torrents = 1U,
        metadataPending = pending,
    )

    private fun libraryItem(
        index: UInt,
        availability: MediaFileAvailability = MediaFileAvailability.UNVERIFIED,
    ) = LibraryMediaItemView(
        itemId = "t1-0123456789abcdef0123456789abcdef:$index",
        torrentId = "t1-0123456789abcdef0123456789abcdef",
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
        verifiedBytes = "0",
        offline = false,
        archived = false,
        mediaAvailability = availability,
    )

    private fun torrent(): TorrentView =
        TorrentView(
            safetySummary = null,
            torrentId = "t1-0123456789abcdef0123456789abcdef",
            protocolIdentities =
                TorrentProtocolIdentities(
                    v1 = "0123456789abcdef0123456789abcdef01234567",
                    v2 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                ),
            displayName = "Fixture torrent",
            sourceDisplayName = null,
            sourceSizeBytes = null,
            state = TorrentState.DOWNLOADING,
            operationalState = TorrentOperationalState.DOWNLOADING,
            downloadQueuePosition = 1U,
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
            pieceCount = 4U,
            totalSizeBytes = "65536",
            verifiedPieceCount = 1U,
            requestedBytes = "16384",
            receivedBytes = "8192",
            storedBytes = "4096",
            activePeerConnections = 1U,
            configuredTrackerCount = 1U,
            payloadDownloadRateBytes = "4096",
            requiredPayloadBytes = "65536",
            remainingPayloadBytes = "49152",
            etaPayloadDownloadRateBytes = "4096",
            eta = TorrentEtaView.Estimate("12"),
            lifetime = TorrentLifetimeView("0", "8192", "0", "0", "0", "0"),
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

    private fun mediaFile(
        availability: MediaFileAvailability,
        verifiedBytes: String,
    ): FileView =
        FileView(
            safety = null,
            fileId = "media-file",
            fileIndex = 0U,
            path = listOf("Fixture", "clip.mp4"),
            lengthBytes = "65536",
            torrentOffsetBytes = "0",
            firstPiece = 0U,
            lastPiece = 0U,
            selection = FileSelectionView.NORMAL,
            padding = false,
            doneBytes = verifiedBytes,
            verifiedBytes = verifiedBytes,
            mediaAvailability = availability,
        )

    /** A streamable video, a skipped empty file and a completed image. */
    private fun selectionFiles(): List<FileView> {
        val first = mediaFile(MediaFileAvailability.STREAMABLE, verifiedBytes = "32768")
        return listOf(
            first,
            first.copy(
                fileId = "notes-file",
                fileIndex = 1U,
                path = listOf("Fixture", "notes.txt"),
                selection = FileSelectionView.SKIPPED,
                verifiedBytes = "0",
                doneBytes = "0",
            ),
            first.copy(
                fileId = "cover-file",
                fileIndex = 2U,
                path = listOf("Fixture", "cover.jpg"),
                verifiedBytes = "65536",
                doneBytes = "65536",
            ),
        )
    }

    private fun fileCatalog(file: FileView): FileCatalogViewState =
        FileCatalogViewState(
            state = FileCatalogState.AVAILABLE,
            filesystemContentBase = null,
            page = CatalogPageView(0U, 1U, 1U, null),
            files = mapOf(file.fileId to file),
        )

    private fun clientSettings(): ClientSettingsRuntimeView {
        val configured =
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
                uploadRateLimit = TransferRateLimit.Limited(128U * 1_024U),
                downloadRateLimit = TransferRateLimit.Limited(256U * 1_024U),
                encryption = EncryptionPolicy.ALLOW,
                ipv6Enabled = true,
                dhtEnabled = true,
                peerExchangeEnabled = true,
                trackerHttpsServerAuthentication =
                    HttpsServerAuthenticationPolicy.SYSTEM_TRUST,
            )
        return ClientSettingsRuntimeView(
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
            effectiveActiveDownloads = 3U.toUShort(),
            effectiveActiveSeeds = configured.activeSeeds,
            effectiveUploadRateLimit = configured.uploadRateLimit,
            effectiveDownloadRateLimit = configured.downloadRateLimit,
            activeDownloadsClampReason = null,
            activeDownloadCount = 0U.toUShort(),
            checkingCount = 0U.toUShort(),
            activeSeedCount = 0U.toUShort(),
            inactiveSeedCount = 0U.toUShort(),
            effectiveEncryption = EncryptionPolicy.ALLOW,
            effectiveIpv6Enabled = true,
            effectiveDhtEnabled = true,
            effectivePeerExchangeEnabled = true,
            effectiveTrackerHttpsServerAuthentication =
                HttpsServerAuthenticationPolicy.SYSTEM_TRUST,
            transportApplication = ClientSettingsApplicationState.Applied,
            portMappingApplication = ClientSettingsApplicationState.Applied,
            peerConnectionsApplication = ClientSettingsApplicationState.Applied,
            uploadSlotsApplication = ClientSettingsApplicationState.Applied,
            bandwidthApplication = ClientSettingsApplicationState.Applied,
            bandwidth = BandwidthRuntimeView(bandwidthDirection(), bandwidthDirection()),
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
    }

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

    /** The library is the only screen here without a Back button. */
    private fun awaitLibrary() {
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithContentDescription("Back").fetchSemanticsNodes().isEmpty()
        }
    }

    private fun awaitDisplayed(text: String) {
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onNodeWithText(text).isDisplayed()
        }
        compose.onNodeWithText(text).assertIsDisplayed()
    }
}
