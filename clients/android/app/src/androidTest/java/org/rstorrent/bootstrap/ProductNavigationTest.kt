package org.rstorrent.bootstrap

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.rstorrent.bootstrap.ui.ProductApp
import org.rstorrent.bootstrap.ui.PendingFileSelectionDialog
import org.rstorrent.bootstrap.ui.ProductThemeMode
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
        compose.onNodeWithText("Browse .torrent file").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performSemanticsAction(SemanticsActions.OnClick)

        compose
            .onNodeWithContentDescription("More options")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Settings").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Storage").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Download folder").assertIsDisplayed()
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
        compose.onNodeWithText("Review feedback context").assertIsDisplayed()
        compose.onNodeWithText("Open feedback page").performSemanticsAction(SemanticsActions.OnClick)

        compose.runOnIdle { assertEquals(1, feedbackCalls) }
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

        compose.onNodeWithText("Reset engine settings").performScrollTo()
        compose.onNodeWithText("Reset").performClick()
        compose.onNodeWithText("Reset all engine settings?").assertIsDisplayed()
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

        compose.onNodeWithText("Clearing app data").assertIsDisplayed()
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
        compose.onNodeWithText("Keep every remaining downloaded file?").assertIsDisplayed()
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
        compose.onNodeWithText("App data cleared").assertIsDisplayed()
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
        compose.onNodeWithTag("open-media-file").assertIsNotEnabled()
        assertEquals(listOf(file), played)
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
        compose
            .onNodeWithTag("open-media-file")
            .assertIsEnabled()
            .performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(listOf(file), opened)
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
        compose.onNodeWithTag("torrent-details").performScrollToIndex(13)
        compose
            .onNodeWithText("Torrent download limit")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNode(isToggleable())
            .performSemanticsAction(SemanticsActions.OnClick)
            .assertIsOn()
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
        compose.onNode(isToggleable()).assertIsOn()
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
            .onNodeWithText("Speed & Connection Limits")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("All torrents download limit")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNode(isToggleable())
            .performSemanticsAction(SemanticsActions.OnClick)
            .assertIsOn()
        compose.onNodeWithText("Apply").performSemanticsAction(SemanticsActions.OnClick)

        assertEquals(1, patches.size)
        assertEquals(TransferRateLimit.Unlimited, patches.single().downloadRateLimit)
        assertNull(patches.single().uploadRateLimit)
        assertNull(patches.single().peerConnectionLimit)
    }

    @Test
    fun speedSettingsExposeSeedCapacityAndPriorityGoals() {
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
            .onNodeWithText("Speed & Connection Limits")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Active seeds")
            .performScrollTo()
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("The fixed shared 500-torrent ceiling remains")
            .assertIsDisplayed()
        compose
            .onNode(isToggleable())
            .performSemanticsAction(SemanticsActions.OnClick)
            .assertIsOn()
        compose.onNodeWithText("Apply").performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Share-ratio priority goal (%)")
            .performScrollTo()
            .assertIsDisplayed()
        compose
            .onNodeWithText("A goal-met torrent may continue seeding while capacity is available")
            .performScrollTo()
            .assertIsDisplayed()

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
            .onNodeWithContentDescription("Peer exchange")
            .assertIsOn()
            .performSemanticsAction(SemanticsActions.OnClick)

        assertEquals(2, patches.size)
        assertEquals(false, patches[0].dhtEnabled)
        assertNull(patches[0].peerExchangeEnabled)
        assertNull(patches[1].dhtEnabled)
        assertEquals(false, patches[1].peerExchangeEnabled)
    }

    @Test
    fun networkStatusUsesProductCopyAndPreservesFailureAndLeaseFacts() {
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
        compose.onNodeWithText("Incoming connections are disabled.").assertIsDisplayed()
        compose.onNodeWithText("Port mapping is disabled.").assertIsDisplayed()
        compose.onAllNodesWithText("org.rstorrent", substring = true).assertCountEquals(0)

        compose.runOnIdle {
            settings = settings.copy(
                listenerStatus = ListenerStatus.Listening("::1", 6881u),
                portMappingStatus = PortMappingStatus.CleanupFailed(
                    "203.0.113.9", 4567u, 120u, "Router refused deletion",
                ),
            )
        }
        compose.onNodeWithText("Listening on ::1, port 6881").assertIsDisplayed()
        compose.onNodeWithText(
            "Router address 203.0.113.9, port 4567 may remain open for 120 seconds. " +
                "Cleanup failed: Router refused deletion",
        ).assertIsDisplayed()
        compose.runOnIdle {
            settings = settings.copy(
                listenerStatus = ListenerStatus.BindFailed(
                    ListenerBindFailureReason.ADDRESS_IN_USE, "Port 6881 is occupied",
                ),
            )
        }
        compose.onNodeWithText("The incoming port is already in use: Port 6881 is occupied")
            .assertIsDisplayed()
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
        var downloads = 0
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
                    onDownloadAll = { downloads++ },
                )
            }
        }
        compose.onNodeWithText("Loading file list…").assertIsDisplayed()
        compose.onNodeWithText("Download all").assertIsEnabled()
            .performSemanticsAction(SemanticsActions.OnClick)
        assertEquals(1, downloads)
        assertEquals(0, confirmations)
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
        compose.onNodeWithText("Download all").assertIsNotEnabled()
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
    fun notificationSettingsExposePermissionChannelsAndDurableChoices() {
        val changes = mutableListOf<Pair<ProductNotificationPreference, Boolean>>()
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
        compose.onNodeWithText("Notifications enabled").assertIsDisplayed()
        compose.onNodeWithText("Blocked in Android system settings.").assertIsDisplayed()
        compose
            .onNodeWithText("Download completed")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithText("Needs attention")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Manage system notification settings").assertIsDisplayed()
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
        compose.onNodeWithText("Background activity blocked").assertIsDisplayed()
        compose.onNodeWithText(
            "JSTorrent works while Android is visible. Leaving Android stops background work.",
        ).assertIsDisplayed()
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
        compose.onNodeWithText("Android background limits").performScrollTo().assertIsDisplayed()
        compose
            .onNodeWithContentDescription("Continue downloads in background")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose
            .onNodeWithContentDescription("Keep seeding in background")
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("Keep seeding in background?").assertIsDisplayed()
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

    private fun torrent(): TorrentView =
        TorrentView(
            torrentId = "t1-0123456789abcdef0123456789abcdef",
            protocolIdentities =
                TorrentProtocolIdentities(
                    v1 = "0123456789abcdef0123456789abcdef01234567",
                    v2 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                ),
            displayName = "Fixture torrent",
            sourceDisplayName = null,
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
            seeding = TorrentSeedingView(SeedAdmissionView.INELIGIBLE, null),
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

    private fun awaitDisplayed(text: String) {
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onNodeWithText(text).isDisplayed()
        }
        compose.onNodeWithText(text).assertIsDisplayed()
    }
}
