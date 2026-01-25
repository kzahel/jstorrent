package com.jstorrent.app.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.util.Formatters
import com.jstorrent.quickjs.model.TorrentSummary

/**
 * Torrent card for the main list screen.
 * Displays torrent info with play/pause control, progress, and stats.
 * Supports multi-select mode with long-press.
 *
 * @param torrent The torrent summary data
 * @param onPause Callback when pause is requested
 * @param onResume Callback when resume is requested
 * @param onClick Callback when card is clicked (navigate to detail or toggle selection)
 * @param onLongClick Callback when card is long-pressed (enter selection mode)
 * @param isSelectionMode Whether multi-select mode is active
 * @param isSelected Whether this card is currently selected
 * @param modifier Optional modifier
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TorrentCard(
    torrent: TorrentSummary,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onClick: () -> Unit = {},
    onLongClick: () -> Unit = {},
    isSelectionMode: Boolean = false,
    isSelected: Boolean = false,
    modifier: Modifier = Modifier
) {
    val isPaused = torrent.status == "stopped"

    Card(
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            ),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) {
                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
            } else {
                MaterialTheme.colorScheme.surface
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 0.dp, top = 12.dp, bottom = 12.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Selection checkbox OR Play/Pause button on left
            if (isSelectionMode) {
                Checkbox(
                    checked = isSelected,
                    onCheckedChange = null, // Click handled by card
                    modifier = Modifier.size(44.dp)
                )
            } else {
                CompactPlayPauseButton(
                    isPaused = isPaused,
                    onToggle = if (isPaused) onResume else onPause
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Torrent info
            Column(modifier = Modifier.weight(1f)) {
                // Torrent name
                Text(
                    text = torrent.name.ifEmpty { "Unknown" },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(4.dp))

                // Status line: "Downloading • 45%"
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    StatusBadge(status = torrent.status)
                    Text(
                        text = " • ",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = Formatters.formatPercent(torrent.progress),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Progress bar
                TorrentProgressBar(
                    progress = torrent.progress.toFloat()
                )

                Spacer(modifier = Modifier.height(4.dp))

                // Speed line
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    // Download speed
                    if (torrent.downloadSpeed > 0) {
                        SpeedIndicator(
                            bytesPerSecond = torrent.downloadSpeed,
                            direction = SpeedDirection.DOWN
                        )
                    }
                    // Upload speed
                    if (torrent.uploadSpeed > 0) {
                        SpeedIndicator(
                            bytesPerSecond = torrent.uploadSpeed,
                            direction = SpeedDirection.UP
                        )
                    }
                }
            }
        }
    }
}

/**
 * Simplified torrent card without play/pause button.
 * Used in contexts where controls are elsewhere.
 */
@Composable
fun SimpleTorrentCard(
    torrent: TorrentSummary,
    onClick: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
        ) {
            // Torrent name
            Text(
                text = torrent.name.ifEmpty { "Unknown" },
                style = MaterialTheme.typography.titleSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(4.dp))

            // Status and progress
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                StatusBadge(status = torrent.status)
                Text(
                    text = Formatters.formatPercent(torrent.progress),
                    style = MaterialTheme.typography.bodySmall
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Progress bar
            TorrentProgressBar(progress = torrent.progress.toFloat())
        }
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun TorrentCardDownloadingPreview() {
    JSTorrentTheme {
        TorrentCard(
            torrent = TorrentSummary(
                infoHash = "abc123",
                name = "Ubuntu 22.04 Desktop AMD64 ISO",
                progress = 0.45,
                downloadSpeed = 2_500_000,
                uploadSpeed = 150_000,
                status = "downloading"
            ),
            onPause = {},
            onResume = {},
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun TorrentCardPausedPreview() {
    JSTorrentTheme {
        TorrentCard(
            torrent = TorrentSummary(
                infoHash = "def456",
                name = "Big Buck Bunny 1080p",
                progress = 0.75,
                downloadSpeed = 0,
                uploadSpeed = 0,
                status = "stopped"
            ),
            onPause = {},
            onResume = {},
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun TorrentCardSeedingPreview() {
    JSTorrentTheme {
        TorrentCard(
            torrent = TorrentSummary(
                infoHash = "ghi789",
                name = "Sintel 4K",
                progress = 1.0,
                downloadSpeed = 0,
                uploadSpeed = 500_000,
                status = "seeding"
            ),
            onPause = {},
            onResume = {},
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun TorrentCardMetadataPreview() {
    JSTorrentTheme {
        TorrentCard(
            torrent = TorrentSummary(
                infoHash = "jkl012",
                name = "",
                progress = 0.0,
                downloadSpeed = 0,
                uploadSpeed = 0,
                status = "downloading_metadata"
            ),
            onPause = {},
            onResume = {},
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun TorrentCardLongNamePreview() {
    JSTorrentTheme {
        TorrentCard(
            torrent = TorrentSummary(
                infoHash = "mno345",
                name = "This is a very long torrent name that should be truncated with ellipsis because it exceeds the available space in the card layout",
                progress = 0.25,
                downloadSpeed = 1_000_000,
                uploadSpeed = 50_000,
                status = "downloading"
            ),
            onPause = {},
            onResume = {},
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SimpleTorrentCardPreview() {
    JSTorrentTheme {
        SimpleTorrentCard(
            torrent = TorrentSummary(
                infoHash = "pqr678",
                name = "Sample Torrent",
                progress = 0.6,
                downloadSpeed = 0,
                uploadSpeed = 0,
                status = "stopped"
            ),
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun TorrentCardSelectedPreview() {
    JSTorrentTheme {
        TorrentCard(
            torrent = TorrentSummary(
                infoHash = "sel123",
                name = "Selected Torrent",
                progress = 0.5,
                downloadSpeed = 1_500_000,
                uploadSpeed = 100_000,
                status = "downloading"
            ),
            onPause = {},
            onResume = {},
            isSelectionMode = true,
            isSelected = true,
            modifier = Modifier.padding(8.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun TorrentCardUnselectedPreview() {
    JSTorrentTheme {
        TorrentCard(
            torrent = TorrentSummary(
                infoHash = "unsel456",
                name = "Unselected Torrent",
                progress = 0.75,
                downloadSpeed = 500_000,
                uploadSpeed = 50_000,
                status = "downloading"
            ),
            onPause = {},
            onResume = {},
            isSelectionMode = true,
            isSelected = false,
            modifier = Modifier.padding(8.dp)
        )
    }
}
