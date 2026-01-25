package com.jstorrent.app.ui.screens

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import com.jstorrent.app.storage.DownloadRoot
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.SettingsUiState
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented tests for SettingsScreen.
 *
 * Run with:
 * ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.ui.screens.SettingsScreenTest
 */
class SettingsScreenTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    // =========================================================================
    // Download Locations Tests
    // =========================================================================

    @Test
    fun emptyState_showsNoFolderMessage() {
        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(downloadRoots = emptyList()),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("No download folder configured").assertIsDisplayed()
    }

    @Test
    fun downloadRoots_showsFolderList() {
        val roots = listOf(
            createTestRoot("key1", "Download/JSTorrent", isDefault = true),
            createTestRoot("key2", "Movies", isDefault = false)
        )

        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        downloadRoots = roots,
                        defaultRootKey = "key1"
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Download/JSTorrent").assertIsDisplayed()
        composeTestRule.onNodeWithText("Movies").assertIsDisplayed()
    }

    @Test
    fun defaultFolder_showsStarIcon() {
        val roots = listOf(
            createTestRoot("key1", "Download", isDefault = true)
        )

        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        downloadRoots = roots,
                        defaultRootKey = "key1"
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        // Default folder should show "Default" text
        composeTestRule.onNodeWithText("Default").assertIsDisplayed()
        // And the star icon
        composeTestRule.onNodeWithContentDescription("Default folder").assertIsDisplayed()
    }

    @Test
    fun removeFolder_triggersCallback() {
        var removedKey: String? = null
        val roots = listOf(
            createTestRoot("key1", "Download", isDefault = false)
        )

        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(downloadRoots = roots),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = { removedKey = it },
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithContentDescription("Remove folder").performClick()
        assert(removedKey == "key1") { "Expected key1, got $removedKey" }
    }

    @Test
    fun setDefaultFolder_triggersCallback() {
        var setDefaultKey: String? = null
        val roots = listOf(
            createTestRoot("key1", "Download", isDefault = false),
            createTestRoot("key2", "Movies", isDefault = false)
        )

        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        downloadRoots = roots,
                        defaultRootKey = null
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = { setDefaultKey = it },
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        // Find the first "Set as default" button and click it
        composeTestRule.onAllNodesWithContentDescription("Set as default")[0].performClick()
        assert(setDefaultKey == "key1") { "Expected key1, got $setDefaultKey" }
    }

    // =========================================================================
    // Bandwidth Section Tests
    // =========================================================================

    @Test
    fun bandwidthSection_showsSpeedLabels() {
        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Bandwidth").assertIsDisplayed()
        composeTestRule.onNodeWithText("Max download speed").assertIsDisplayed()
        composeTestRule.onNodeWithText("Max upload speed").assertIsDisplayed()
    }

    @Test
    fun bandwidthDropdown_showsPresets() {
        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        downloadSpeedUnlimited = false,
                        downloadSpeedLimit = 1048576
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        // Download limit is set to 1 MB/s
        composeTestRule.onNodeWithText("1 MB/s").assertIsDisplayed()
    }

    // =========================================================================
    // When Downloads Complete Tests
    // =========================================================================

    @Test
    fun whenDownloadsComplete_showsOptions() {
        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(whenDownloadsComplete = "stop_and_close"),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Stop and close app").assertIsDisplayed()
        composeTestRule.onNodeWithText("Keep seeding in background").assertIsDisplayed()
    }

    @Test
    fun whenDownloadsComplete_clickChangesSelection() {
        var selectedOption: String? = null

        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(whenDownloadsComplete = "stop_and_close"),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = { selectedOption = it },
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Keep seeding in background").performClick()
        assert(selectedOption == "keep_seeding") { "Expected keep_seeding, got $selectedOption" }
    }

    // =========================================================================
    // Network Section Tests
    // =========================================================================

    @Test
    fun networkSection_showsHeader() {
        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        wifiOnlyEnabled = false,
                        dhtEnabled = true,
                        pexEnabled = true,
                        encryptionPolicy = "allow"
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        // Scroll the LazyColumn to find and display the Network section
        composeTestRule.onNode(hasScrollAction())
            .performScrollToNode(hasText("Network"))
        composeTestRule.onNodeWithText("Network").assertIsDisplayed()
    }

    // =========================================================================
    // Notification Section Tests
    // =========================================================================

    @Test
    fun notificationSection_showsEnabledStatus() {
        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(notificationPermissionGranted = true),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Enabled").assertIsDisplayed()
    }

    @Test
    fun notificationSection_showsDisabledWithEnableButton() {
        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        notificationPermissionGranted = false,
                        canRequestNotificationPermission = true
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Disabled").assertIsDisplayed()
        composeTestRule.onNodeWithText("Enable").assertIsDisplayed()
    }

    @Test
    fun notificationSection_showsSettingsButtonWhenCantRequestInline() {
        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        notificationPermissionGranted = false,
                        canRequestNotificationPermission = false
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Disabled").assertIsDisplayed()
        // Use hasClickAction to match the button, not the page title
        composeTestRule.onNode(hasText("Settings") and hasClickAction()).assertIsDisplayed()
    }

    @Test
    fun notificationSection_enableButtonTriggersCallback() {
        var requestCalled = false

        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        notificationPermissionGranted = false,
                        canRequestNotificationPermission = true
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = { requestCalled = true },
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Enable").performClick()
        assert(requestCalled) { "Expected onRequestNotificationPermission to be called" }
    }

    @Test
    fun notificationSection_settingsButtonTriggersCallback() {
        var settingsCalled = false

        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        notificationPermissionGranted = false,
                        canRequestNotificationPermission = false
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = { settingsCalled = true }
                )
            }
        }

        // Use hasClickAction to match the button, not the page title
        composeTestRule.onNode(hasText("Settings") and hasClickAction()).performClick()
        assert(settingsCalled) { "Expected onOpenNotificationSettings to be called" }
    }

    // =========================================================================
    // Clear Settings Tests
    // =========================================================================

    @Test
    fun clearSettings_showsConfirmationDialog() {
        composeTestRule.setContent {
            JSTorrentTheme {
                SettingsScreenContent(
                    uiState = SettingsUiState(
                        downloadRoots = listOf(createTestRoot("key1", "Download", false)),
                        showClearConfirmation = true
                    ),
                    onNavigateBack = {},
                    onAddRootClick = {},
                    onSetDefaultRoot = {},
                    onRemoveRoot = {},
                    onShowClearConfirmation = {},
                    onDismissClearConfirmation = {},
                    onClearAll = {},
                    onDownloadSpeedUnlimitedChange = {},
                    onDownloadSpeedLimitChange = {},
                    onUploadSpeedUnlimitedChange = {},
                    onUploadSpeedLimitChange = {},
                    onWhenDownloadsCompleteChange = {},
                    onWifiOnlyChange = {},
                    onDhtEnabledChange = {},
                    onPexEnabledChange = {},
                    onUpnpEnabledChange = {},
                    onEncryptionPolicyChange = {},
                    onBackgroundDownloadsChange = {},
                    onDismissNotificationRequiredDialog = {},
                    onRequestNotificationPermission = {},
                    onOpenNotificationSettings = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Clear all settings?").assertIsDisplayed()
        composeTestRule.onNodeWithText("Cancel").assertIsDisplayed()
        composeTestRule.onNodeWithText("Clear").assertIsDisplayed()
    }

    // =========================================================================
    // Helper Functions
    // =========================================================================

    private fun createTestRoot(
        key: String,
        displayName: String,
        isDefault: Boolean
    ) = DownloadRoot(
        key = key,
        uri = "content://test/$key",
        displayName = displayName,
        removable = false,
        lastStatOk = true,
        lastChecked = System.currentTimeMillis()
    )
}
