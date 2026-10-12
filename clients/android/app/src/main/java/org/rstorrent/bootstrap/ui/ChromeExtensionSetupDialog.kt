package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.ProductChromeExtensionSetup.NotificationAction

@Composable
fun ChromeExtensionSetupDialog(
    ready: Boolean,
    busy: Boolean,
    failed: Boolean,
    onOpenChrome: () -> Unit,
    onDismiss: () -> Unit,
    notificationAction: NotificationAction = NotificationAction.NONE,
    onAllowNotifications: () -> Unit = {},
    onOpenNotificationSettings: () -> Unit = {},
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.chrome_extension_setup_title)) },
        text = {
            Column {
                Text(stringResource(R.string.chrome_extension_setup_detail))
                Spacer(Modifier.height(12.dp))
                Text(stringResource(R.string.chrome_extension_setup_manual))
                if (notificationAction != NotificationAction.NONE) {
                    Spacer(Modifier.height(12.dp))
                    Text(stringResource(R.string.chrome_extension_setup_notifications))
                    if (notificationAction == NotificationAction.REQUEST_PERMISSION) {
                        TextButton(onClick = onOpenNotificationSettings) {
                            Text(stringResource(R.string.chrome_extension_setup_notification_settings))
                        }
                    }
                }
                if (failed) {
                    Spacer(Modifier.height(12.dp))
                    Text(stringResource(R.string.chrome_extension_setup_failed))
                }
            }
        },
        confirmButton = {
            if (notificationAction == NotificationAction.REQUEST_PERMISSION) {
                TextButton(onClick = onAllowNotifications, enabled = ready && !busy) {
                    Text(stringResource(R.string.chrome_extension_setup_allow_notifications))
                }
            } else if (notificationAction == NotificationAction.OPEN_SETTINGS) {
                TextButton(onClick = onOpenNotificationSettings, enabled = ready && !busy) {
                    Text(stringResource(R.string.chrome_extension_setup_notification_settings))
                }
            } else {
                TextButton(onClick = onOpenChrome, enabled = ready && !busy) {
                    Text(stringResource(if (busy) R.string.chrome_extension_setup_opening else R.string.chrome_extension_setup_open))
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}
