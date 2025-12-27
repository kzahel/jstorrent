package com.jstorrent.app.ui.dialogs

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.jstorrent.app.ui.theme.JSTorrentTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented tests for NotificationPermissionDialog.
 *
 * Run with:
 * ./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.ui.dialogs.NotificationPermissionDialogTest
 */
class NotificationPermissionDialogTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun dialog_showsRationale() {
        composeTestRule.setContent {
            JSTorrentTheme {
                NotificationPermissionDialog(
                    onEnable = {},
                    onNotNow = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Enable Notifications?").assertIsDisplayed()
        composeTestRule.onNodeWithText("Download files in the background", substring = true)
            .assertIsDisplayed()
        composeTestRule.onNodeWithText("Alert you when downloads complete", substring = true)
            .assertIsDisplayed()
    }

    @Test
    fun dialog_showsButtons() {
        composeTestRule.setContent {
            JSTorrentTheme {
                NotificationPermissionDialog(
                    onEnable = {},
                    onNotNow = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Enable").assertIsDisplayed()
        composeTestRule.onNodeWithText("Not Now").assertIsDisplayed()
    }

    @Test
    fun enableButton_triggersCallback() {
        var enableCalled = false

        composeTestRule.setContent {
            JSTorrentTheme {
                NotificationPermissionDialog(
                    onEnable = { enableCalled = true },
                    onNotNow = {}
                )
            }
        }

        composeTestRule.onNodeWithText("Enable").performClick()
        assert(enableCalled) { "Expected onEnable to be called" }
    }

    @Test
    fun notNowButton_triggersCallback() {
        var notNowCalled = false

        composeTestRule.setContent {
            JSTorrentTheme {
                NotificationPermissionDialog(
                    onEnable = {},
                    onNotNow = { notNowCalled = true }
                )
            }
        }

        composeTestRule.onNodeWithText("Not Now").performClick()
        assert(notNowCalled) { "Expected onNotNow to be called" }
    }
}
