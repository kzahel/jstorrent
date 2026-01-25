package com.jstorrent.app.ui.tabs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.model.FilePriority
import com.jstorrent.app.model.TorrentFileUi
import com.jstorrent.app.ui.components.FileTreeItem
import com.jstorrent.app.ui.theme.JSTorrentTheme

/**
 * Files tab showing the list of files in the torrent.
 * Allows selecting/deselecting files for download with batched changes.
 *
 * Features:
 * - Select All / Select None header
 * - Tap checkbox to toggle selection (batched)
 * - Tap file name to open file
 * - Long press for priority menu
 * - Pending changes snackbar with Cancel/Apply
 */
@Composable
fun FilesTab(
    files: List<TorrentFileUi>,
    hasPendingChanges: Boolean,
    onToggleFileSelection: (Int) -> Unit,
    onOpenFile: (Int) -> Unit,
    onSetFilePriority: (Int, FilePriority) -> Unit,
    onSelectAll: () -> Unit,
    onSelectNone: () -> Unit,
    onApplyChanges: () -> Unit,
    onCancelChanges: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (files.isEmpty()) {
        EmptyFilesState(modifier = modifier)
    } else {
        Box(modifier = modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Select All / Select None header
                SelectionHeader(
                    onSelectAll = onSelectAll,
                    onSelectNone = onSelectNone,
                    modifier = Modifier.fillMaxWidth()
                )

                HorizontalDivider()

                // File list
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .weight(1f),
                    contentPadding = PaddingValues(vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(0.dp)
                ) {
                    items(files, key = { it.index }) { file ->
                        FileTreeItem(
                            file = file,
                            onToggleSelection = { onToggleFileSelection(file.index) },
                            onOpenFile = { onOpenFile(file.index) },
                            onSetPriority = { priority -> onSetFilePriority(file.index, priority) }
                        )
                    }
                }
            }

            // Pending changes snackbar
            if (hasPendingChanges) {
                PendingChangesSnackbar(
                    onCancel = onCancelChanges,
                    onApply = onApplyChanges,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp)
                )
            }
        }
    }
}

/**
 * Header with Select All / Select None buttons.
 */
@Composable
private fun SelectionHeader(
    onSelectAll: () -> Unit,
    onSelectNone: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically
    ) {
        TextButton(onClick = onSelectAll) {
            Text("Select All")
        }
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = "|",
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.width(8.dp))
        TextButton(onClick = onSelectNone) {
            Text("Select None")
        }
    }
}

/**
 * Snackbar showing pending changes with Cancel/Apply actions.
 */
@Composable
private fun PendingChangesSnackbar(
    onCancel: () -> Unit,
    onApply: () -> Unit,
    modifier: Modifier = Modifier
) {
    Snackbar(
        modifier = modifier,
        action = {
            Row {
                TextButton(
                    onClick = onCancel,
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.inversePrimary
                    )
                ) {
                    Text("Cancel")
                }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = onApply,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.inversePrimary,
                        contentColor = MaterialTheme.colorScheme.inverseOnSurface
                    )
                ) {
                    Text("Apply")
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.inverseSurface,
        contentColor = MaterialTheme.colorScheme.inverseOnSurface
    ) {
        Text("File selection changed")
    }
}

/**
 * Empty state when no files available.
 */
@Composable
private fun EmptyFilesState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp)
        ) {
            Text(
                text = "No files",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "File information not yet available",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun FilesTabPreview() {
    JSTorrentTheme {
        FilesTab(
            files = listOf(
                TorrentFileUi(
                    index = 0,
                    path = "Ubuntu/ubuntu-22.04.iso",
                    name = "ubuntu-22.04.iso",
                    size = 3_300_000_000,
                    downloaded = 1_500_000_000,
                    progress = 0.45,
                    isSelected = true
                ),
                TorrentFileUi(
                    index = 1,
                    path = "Ubuntu/README.txt",
                    name = "README.txt",
                    size = 5000,
                    downloaded = 5000,
                    progress = 1.0,
                    isSelected = true
                ),
                TorrentFileUi(
                    index = 2,
                    path = "Ubuntu/SHA256SUMS",
                    name = "SHA256SUMS",
                    size = 200,
                    downloaded = 0,
                    progress = 0.0,
                    isSelected = false
                )
            ),
            hasPendingChanges = false,
            onToggleFileSelection = {},
            onOpenFile = {},
            onSetFilePriority = { _, _ -> },
            onSelectAll = {},
            onSelectNone = {},
            onApplyChanges = {},
            onCancelChanges = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun FilesTabWithPendingChangesPreview() {
    JSTorrentTheme {
        FilesTab(
            files = listOf(
                TorrentFileUi(
                    index = 0,
                    path = "movie.mp4",
                    name = "movie.mp4",
                    size = 2_500_000_000,
                    downloaded = 1_250_000_000,
                    progress = 0.5,
                    isSelected = true
                )
            ),
            hasPendingChanges = true,
            onToggleFileSelection = {},
            onOpenFile = {},
            onSetFilePriority = { _, _ -> },
            onSelectAll = {},
            onSelectNone = {},
            onApplyChanges = {},
            onCancelChanges = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun FilesTabEmptyPreview() {
    JSTorrentTheme {
        FilesTab(
            files = emptyList(),
            hasPendingChanges = false,
            onToggleFileSelection = {},
            onOpenFile = {},
            onSetFilePriority = { _, _ -> },
            onSelectAll = {},
            onSelectNone = {},
            onApplyChanges = {},
            onCancelChanges = {}
        )
    }
}
