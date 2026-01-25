package com.jstorrent.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.util.Formatters

/**
 * Status badge showing torrent state with appropriate color.
 * Examples: "Downloading" (teal), "Paused" (gray), "Error" (red)
 *
 * @param status Raw status string from engine (e.g., "downloading", "stopped")
 * @param modifier Optional modifier
 * @param showBackground Whether to show colored background (badge style)
 * @param suffix Optional suffix to append (e.g., " (partial)")
 */
@Composable
fun StatusBadge(
    status: String,
    modifier: Modifier = Modifier,
    showBackground: Boolean = false,
    style: TextStyle = MaterialTheme.typography.labelMedium,
    suffix: String? = null
) {
    val displayText = Formatters.formatStatus(status) + (suffix ?: "")
    val color = statusColor(status)

    if (showBackground) {
        Box(
            modifier = modifier
                .clip(RoundedCornerShape(4.dp))
                .background(color.copy(alpha = 0.2f))
                .padding(horizontal = 8.dp, vertical = 4.dp)
        ) {
            Text(
                text = displayText,
                style = style,
                color = color
            )
        }
    } else {
        Text(
            text = displayText,
            style = style,
            color = color,
            modifier = modifier
        )
    }
}

/**
 * Get the appropriate color for a torrent status.
 */
@Composable
fun statusColor(status: String): Color = when (status) {
    "downloading" -> MaterialTheme.colorScheme.primary
    "downloading_metadata" -> MaterialTheme.colorScheme.primary
    "seeding" -> MaterialTheme.colorScheme.tertiary
    "stopped" -> MaterialTheme.colorScheme.outline
    "checking" -> MaterialTheme.colorScheme.secondary
    "queued" -> MaterialTheme.colorScheme.secondary
    "error" -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurface
}

/**
 * Whether the status represents an active download/upload.
 */
fun isActiveStatus(status: String): Boolean = when (status) {
    "downloading", "downloading_metadata", "seeding" -> true
    else -> false
}

/**
 * Whether the status represents a completed torrent.
 */
fun isCompletedStatus(status: String): Boolean = when (status) {
    "seeding" -> true
    else -> false
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun StatusBadgeDownloadingPreview() {
    JSTorrentTheme {
        StatusBadge(
            status = "downloading",
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StatusBadgeSeedingPreview() {
    JSTorrentTheme {
        StatusBadge(
            status = "seeding",
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StatusBadgePausedPreview() {
    JSTorrentTheme {
        StatusBadge(
            status = "stopped",
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StatusBadgeErrorPreview() {
    JSTorrentTheme {
        StatusBadge(
            status = "error",
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StatusBadgeWithBackgroundPreview() {
    JSTorrentTheme {
        StatusBadge(
            status = "downloading",
            showBackground = true,
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StatusBadgeMetadataPreview() {
    JSTorrentTheme {
        StatusBadge(
            status = "downloading_metadata",
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StatusBadgeCheckingPreview() {
    JSTorrentTheme {
        StatusBadge(
            status = "checking",
            showBackground = true,
            modifier = Modifier.padding(8.dp)
        )
    }
}
