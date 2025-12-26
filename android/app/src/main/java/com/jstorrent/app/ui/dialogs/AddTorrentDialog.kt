package com.jstorrent.app.ui.dialogs

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme
import kotlinx.coroutines.launch

/**
 * Bottom sheet dialog for adding a torrent via magnet link.
 *
 * @param onDismiss Called when the dialog is dismissed
 * @param onAddTorrent Called with the magnet link when user taps Add
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddTorrentDialog(
    onDismiss: () -> Unit,
    onAddTorrent: (String) -> Unit,
    sheetState: SheetState = rememberModalBottomSheetState()
) {
    var magnetLink by remember { mutableStateOf("") }
    val clipboardManager = LocalClipboardManager.current
    val scope = rememberCoroutineScope()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        AddTorrentContent(
            magnetLink = magnetLink,
            onMagnetLinkChange = { magnetLink = it },
            onPasteFromClipboard = {
                clipboardManager.getText()?.text?.let { text ->
                    magnetLink = text
                }
            },
            onAddTorrent = {
                if (magnetLink.isNotBlank()) {
                    onAddTorrent(magnetLink)
                    scope.launch {
                        sheetState.hide()
                        onDismiss()
                    }
                }
            },
            onCancel = {
                scope.launch {
                    sheetState.hide()
                    onDismiss()
                }
            },
            isAddEnabled = magnetLink.isNotBlank()
        )
    }
}

/**
 * Content for the add torrent dialog.
 * Extracted for easier testing and previews.
 */
@Composable
fun AddTorrentContent(
    magnetLink: String,
    onMagnetLinkChange: (String) -> Unit,
    onPasteFromClipboard: () -> Unit,
    onAddTorrent: () -> Unit,
    onCancel: () -> Unit,
    isAddEnabled: Boolean,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp)
            .padding(bottom = 32.dp)
    ) {
        // Title
        Text(
            text = "Add Torrent",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        // Magnet link input with paste button
        OutlinedTextField(
            value = magnetLink,
            onValueChange = onMagnetLinkChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Magnet link") },
            placeholder = { Text("magnet:?xt=urn:btih:...") },
            singleLine = false,
            maxLines = 3,
            trailingIcon = {
                IconButton(onClick = onPasteFromClipboard) {
                    Icon(
                        imageVector = Icons.Default.ContentPaste,
                        contentDescription = "Paste from clipboard"
                    )
                }
            }
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Action buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedButton(
                onClick = onCancel,
                modifier = Modifier.weight(1f)
            ) {
                Text("Cancel")
            }

            Spacer(modifier = Modifier.width(16.dp))

            Button(
                onClick = onAddTorrent,
                modifier = Modifier.weight(1f),
                enabled = isAddEnabled
            ) {
                Text("Add")
            }
        }
    }
}

/**
 * Validates if a string looks like a magnet link.
 */
fun isValidMagnetLink(input: String): Boolean {
    return input.trim().startsWith("magnet:?xt=urn:btih:", ignoreCase = true)
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun AddTorrentContentEmptyPreview() {
    JSTorrentTheme {
        AddTorrentContent(
            magnetLink = "",
            onMagnetLinkChange = {},
            onPasteFromClipboard = {},
            onAddTorrent = {},
            onCancel = {},
            isAddEnabled = false
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun AddTorrentContentWithLinkPreview() {
    JSTorrentTheme {
        AddTorrentContent(
            magnetLink = "magnet:?xt=urn:btih:abc123",
            onMagnetLinkChange = {},
            onPasteFromClipboard = {},
            onAddTorrent = {},
            onCancel = {},
            isAddEnabled = true
        )
    }
}
