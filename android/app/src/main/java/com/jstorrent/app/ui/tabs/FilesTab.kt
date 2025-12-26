package com.jstorrent.app.ui.tabs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.model.TorrentFileUi
import com.jstorrent.app.ui.components.FileTreeItem
import com.jstorrent.app.ui.theme.JSTorrentTheme

/**
 * Files tab showing the list of files in the torrent.
 * Allows selecting/deselecting files for download.
 */
@Composable
fun FilesTab(
    files: List<TorrentFileUi>,
    onToggleFileSelection: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    if (files.isEmpty()) {
        EmptyFilesState(modifier = modifier)
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            items(files, key = { it.index }) { file ->
                FileTreeItem(
                    file = file,
                    onToggleSelection = { onToggleFileSelection(file.index) }
                )
            }
        }
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
            onToggleFileSelection = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun FilesTabEmptyPreview() {
    JSTorrentTheme {
        FilesTab(
            files = emptyList(),
            onToggleFileSelection = {}
        )
    }
}
