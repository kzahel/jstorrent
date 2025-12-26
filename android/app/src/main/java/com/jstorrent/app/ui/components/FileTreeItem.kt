package com.jstorrent.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.VideoFile
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.model.TorrentFileUi
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.util.Formatters

/**
 * Individual file item in the files tab.
 * Shows file icon, name, size, progress, and selection checkbox.
 */
@Composable
fun FileTreeItem(
    file: TorrentFileUi,
    onToggleSelection: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onToggleSelection)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Checkbox
        Checkbox(
            checked = file.isSelected,
            onCheckedChange = { onToggleSelection() }
        )

        Spacer(modifier = Modifier.width(8.dp))

        // File icon
        Icon(
            imageVector = getFileIcon(file.name),
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = getIconTint(file)
        )

        Spacer(modifier = Modifier.width(12.dp))

        // File info
        Column(modifier = Modifier.weight(1f)) {
            // File name
            Text(
                text = file.name,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = if (file.isSelected) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }
            )

            Spacer(modifier = Modifier.height(4.dp))

            // Progress bar (thin)
            if (file.isSelected) {
                TorrentProgressBar(
                    progress = file.progress.toFloat(),
                    modifier = Modifier.fillMaxWidth(),
                    height = 3.dp
                )
                Spacer(modifier = Modifier.height(4.dp))
            }

            // Size and status
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = formatFileStatus(file),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * Get appropriate icon for file type based on extension.
 */
private fun getFileIcon(fileName: String): ImageVector {
    val extension = fileName.substringAfterLast('.', "").lowercase()
    return when (extension) {
        // Video
        "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v" -> Icons.Default.VideoFile
        // Audio
        "mp3", "flac", "wav", "aac", "ogg", "m4a", "wma" -> Icons.Default.AudioFile
        // Images
        "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg" -> Icons.Default.Image
        // Documents
        "pdf", "doc", "docx", "txt", "rtf", "odt" -> Icons.Default.Description
        // Default
        else -> Icons.Default.InsertDriveFile
    }
}

/**
 * Get icon tint based on file state.
 */
@Composable
private fun getIconTint(file: TorrentFileUi) = when {
    !file.isSelected -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
    file.progress >= 0.999 -> MaterialTheme.colorScheme.primary
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

/**
 * Format file status text.
 */
private fun formatFileStatus(file: TorrentFileUi): String {
    val sizeText = if (file.downloaded > 0 && file.downloaded < file.size) {
        "${Formatters.formatBytes(file.downloaded)} / ${Formatters.formatBytes(file.size)}"
    } else {
        Formatters.formatBytes(file.size)
    }

    val statusText = when {
        !file.isSelected -> "Skipped"
        file.progress >= 0.999 -> "Complete"
        file.progress > 0 -> "Downloading"
        else -> "Pending"
    }

    return "$sizeText - $statusText"
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun FileTreeItemSelectedPreview() {
    JSTorrentTheme {
        FileTreeItem(
            file = TorrentFileUi(
                index = 0,
                path = "movie.mp4",
                name = "movie.mp4",
                size = 2_500_000_000,
                downloaded = 1_250_000_000,
                progress = 0.5,
                isSelected = true
            ),
            onToggleSelection = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun FileTreeItemCompletePreview() {
    JSTorrentTheme {
        FileTreeItem(
            file = TorrentFileUi(
                index = 1,
                path = "README.txt",
                name = "README.txt",
                size = 5000,
                downloaded = 5000,
                progress = 1.0,
                isSelected = true
            ),
            onToggleSelection = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun FileTreeItemSkippedPreview() {
    JSTorrentTheme {
        FileTreeItem(
            file = TorrentFileUi(
                index = 2,
                path = "unwanted.nfo",
                name = "unwanted.nfo",
                size = 1000,
                downloaded = 0,
                progress = 0.0,
                isSelected = false
            ),
            onToggleSelection = {}
        )
    }
}
