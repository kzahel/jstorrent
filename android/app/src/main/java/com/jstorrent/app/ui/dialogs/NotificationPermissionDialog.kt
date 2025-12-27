package com.jstorrent.app.ui.dialogs

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.window.DialogProperties
import com.jstorrent.app.ui.theme.JSTorrentTheme

/**
 * Dialog explaining why notification permission is needed.
 * Shown once on first launch when permission is not granted.
 */
@Composable
fun NotificationPermissionDialog(
    onEnable: () -> Unit,
    onNotNow: () -> Unit,
    modifier: Modifier = Modifier
) {
    AlertDialog(
        onDismissRequest = { /* Require explicit button press */ },
        modifier = modifier,
        properties = DialogProperties(
            dismissOnBackPress = false,
            dismissOnClickOutside = false
        ),
        icon = {
            Icon(
                imageVector = Icons.Default.Notifications,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        },
        title = { Text("Enable Notifications?") },
        text = {
            Text(
                "JSTorrent needs notification permission to:\n\n" +
                    "\u2022 Download files in the background\n" +
                    "\u2022 Alert you when downloads complete"
            )
        },
        confirmButton = {
            Button(onClick = onEnable) {
                Text("Enable")
            }
        },
        dismissButton = {
            TextButton(onClick = onNotNow) {
                Text("Not Now")
            }
        }
    )
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun NotificationPermissionDialogPreview() {
    JSTorrentTheme {
        NotificationPermissionDialog(
            onEnable = {},
            onNotNow = {}
        )
    }
}
