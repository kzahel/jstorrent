package org.rstorrent.bootstrap

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.rstorrent.bootstrap.ProductChromeExtensionSetup.NotificationAction
import org.rstorrent.bootstrap.ui.ChromeExtensionSetupDialog

class ChromeExtensionSetupDialogTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun deniedNotificationsCannotNavigateUntilEligibilityIsRestored() {
        val action = mutableStateOf(NotificationAction.REQUEST_PERMISSION)
        var requests = 0
        var opens = 0
        compose.setContent {
            ChromeExtensionSetupDialog(
                ready = true, busy = false, failed = false,
                notificationAction = action.value,
                onAllowNotifications = { requests += 1 },
                onOpenChrome = { opens += 1 },
                onDismiss = {},
            )
        }
        compose.onNodeWithText("Open Chrome library").assertDoesNotExist()
        compose.onNodeWithText("Allow notifications").performClick()
        assertEquals(1, requests)
        assertEquals(0, opens)
        compose.onNodeWithText("Open Chrome library").assertDoesNotExist()
        compose.runOnIdle { action.value = NotificationAction.NONE }
        compose.onNodeWithText("Open Chrome library").assertIsEnabled().performClick()
        assertEquals(1, opens)
    }

    @Test
    fun blockedChannelOffersSettingsAndCancelWithoutOpeningChrome() {
        var settings = 0
        var cancels = 0
        var opens = 0
        compose.setContent {
            ChromeExtensionSetupDialog(
                ready = true, busy = false, failed = false,
                notificationAction = NotificationAction.OPEN_SETTINGS,
                onOpenNotificationSettings = { settings += 1 },
                onOpenChrome = { opens += 1 },
                onDismiss = { cancels += 1 },
            )
        }
        compose.onNodeWithText("Open Chrome library").assertDoesNotExist()
        compose.onNodeWithText("Open notification settings").performClick()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(1, settings)
        assertEquals(1, cancels)
        assertEquals(0, opens)
    }
}
