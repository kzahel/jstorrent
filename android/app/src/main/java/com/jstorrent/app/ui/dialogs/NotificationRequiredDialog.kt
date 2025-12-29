package com.jstorrent.app.ui.dialogs

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.jstorrent.app.ui.theme.JSTorrentTheme

/**
 * Dialog shown when user tries to enable background downloads without notification permission.
 * Explains why permission is required and offers to open system settings.
 */
@Composable
fun NotificationRequiredDialog(
    onOpenSettings: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = modifier,
        icon = {
            Icon(
                imageVector = Icons.Default.Notifications,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        },
        title = { Text("Notification Permission Required") },
        text = {
            Text(
                "Background downloads require notifications so you can see " +
                    "download progress and know when the app is using battery.\n\n" +
                    "Please enable notifications in app settings."
            )
        },
        confirmButton = {
            TextButton(onClick = onOpenSettings) {
                Text("Open Settings")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun NotificationRequiredDialogPreview() {
    JSTorrentTheme {
        NotificationRequiredDialog(
            onOpenSettings = {},
            onDismiss = {}
        )
    }
}
