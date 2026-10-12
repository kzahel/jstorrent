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

@Composable
fun ChromeExtensionSetupDialog(
    ready: Boolean,
    busy: Boolean,
    failed: Boolean,
    onOpenChrome: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.chrome_extension_setup_title)) },
        text = {
            Column {
                Text(stringResource(R.string.chrome_extension_setup_detail))
                Spacer(Modifier.height(12.dp))
                Text(stringResource(R.string.chrome_extension_setup_manual))
                if (failed) {
                    Spacer(Modifier.height(12.dp))
                    Text(stringResource(R.string.chrome_extension_setup_failed))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onOpenChrome, enabled = ready && !busy) {
                Text(stringResource(if (busy) R.string.chrome_extension_setup_opening else R.string.chrome_extension_setup_open))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}
