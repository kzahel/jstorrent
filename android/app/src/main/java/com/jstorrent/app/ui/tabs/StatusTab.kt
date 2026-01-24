package com.jstorrent.app.ui.tabs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.model.TorrentDetailUi
import com.jstorrent.app.ui.components.SpeedDirection
import com.jstorrent.app.ui.components.SpeedIndicator
import com.jstorrent.app.ui.components.StatRow
import com.jstorrent.app.ui.components.StatRowPair
import com.jstorrent.app.ui.components.StatusBadge
import com.jstorrent.app.ui.components.TorrentProgressBar
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.util.Formatters

/**
 * Status tab showing torrent download statistics.
 * Displays progress, speeds, ETA, and peer information.
 */
@Composable
fun StatusTab(
    torrent: TorrentDetailUi,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Progress section
        ProgressSection(torrent = torrent)

        HorizontalDivider()

        // Speed section
        SpeedSection(torrent = torrent)

        HorizontalDivider()

        // Peers section
        PeersSection(torrent = torrent)

        HorizontalDivider()

        // Data section
        DataSection(torrent = torrent)

        if (torrent.piecesTotal != null && torrent.piecesTotal > 0) {
            HorizontalDivider()
            PiecesSection(torrent = torrent)
        }
    }
}

/**
 * Progress section with progress bar, status, and percentage.
 */
@Composable
private fun ProgressSection(
    torrent: TorrentDetailUi,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        // Status row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            StatusBadge(status = torrent.status)
            Text(
                text = Formatters.formatPercent(torrent.progress),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.primary
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Progress bar
        TorrentProgressBar(
            progress = torrent.progress.toFloat(),
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(12.dp))

        // Downloaded / Total
        Text(
            text = Formatters.formatProgress(torrent.downloaded, torrent.size),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * Speed section with download/upload speeds and ETA.
 */
@Composable
private fun SpeedSection(
    torrent: TorrentDetailUi,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            // Download speed
            Column {
                Text(
                    text = "DOWNLOAD",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(4.dp))
                SpeedIndicator(
                    bytesPerSecond = torrent.downloadSpeed,
                    direction = SpeedDirection.DOWN,
                    showZero = true
                )
            }

            // Upload speed
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = "UPLOAD",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(4.dp))
                SpeedIndicator(
                    bytesPerSecond = torrent.uploadSpeed,
                    direction = SpeedDirection.UP,
                    showZero = true
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // ETA
        StatRow(
            label = "ETA",
            value = if (torrent.progress >= 0.999) {
                "Complete"
            } else {
                torrent.eta?.let { Formatters.formatEta(it) } ?: "\u221e"
            }
        )
    }
}

/**
 * Peers section with seeder/leecher counts.
 */
@Composable
private fun PeersSection(
    torrent: TorrentDetailUi,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        StatRowPair(
            leftLabel = "Seeders",
            leftValue = formatPeerCount(
                torrent.seedersConnected,
                torrent.seedersTotal
            ),
            rightLabel = "Leechers",
            rightValue = formatPeerCount(
                torrent.leechersConnected,
                torrent.leechersTotal
            )
        )
    }
}

/**
 * Data section with uploaded amount and share ratio.
 */
@Composable
private fun DataSection(
    torrent: TorrentDetailUi,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        StatRowPair(
            leftLabel = "Uploaded",
            leftValue = Formatters.formatBytes(torrent.uploaded),
            rightLabel = "Share Ratio",
            rightValue = Formatters.formatRatio(torrent.shareRatio)
        )
    }
}

/**
 * Pieces section showing piece progress.
 */
@Composable
private fun PiecesSection(
    torrent: TorrentDetailUi,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        StatRow(
            label = "Pieces",
            value = Formatters.formatPieces(
                torrent.piecesCompleted ?: 0,
                torrent.piecesTotal ?: 0,
                torrent.pieceSize ?: 0
            )
        )
    }
}

/**
 * Format peer count with optional total.
 */
private fun formatPeerCount(connected: Int?, total: Int?): String {
    return when {
        connected == null -> "-"
        total != null && total > connected -> "$connected ($total)"
        else -> "$connected"
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun StatusTabPreview() {
    JSTorrentTheme {
        StatusTab(
            torrent = TorrentDetailUi(
                infoHash = "abc123",
                name = "ubuntu-22.04.3-desktop-amd64.iso",
                status = "downloading",
                progress = 0.45,
                downloadSpeed = 1_500_000,
                uploadSpeed = 256_000,
                downloaded = 1_500_000_000,
                uploaded = 100_000_000,
                size = 3_300_000_000,
                peersConnected = 7,
                peersTotal = 150,
                seedersConnected = 5,
                seedersTotal = 1341,
                leechersConnected = 2,
                leechersTotal = 31,
                eta = 1800,
                shareRatio = 0.066,
                piecesCompleted = 500,
                piecesTotal = 8152,
                pieceSize = 262144,
                pieceBitfield = null,
                files = emptyList(),
                trackers = emptyList(),
                peers = emptyList()
            )
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StatusTabPausedPreview() {
    JSTorrentTheme {
        StatusTab(
            torrent = TorrentDetailUi(
                infoHash = "abc123",
                name = "Paused torrent",
                status = "stopped",
                progress = 0.75,
                downloadSpeed = 0,
                uploadSpeed = 0,
                downloaded = 2_500_000_000,
                uploaded = 500_000_000,
                size = 3_300_000_000,
                peersConnected = 0,
                peersTotal = null,
                seedersConnected = null,
                seedersTotal = null,
                leechersConnected = null,
                leechersTotal = null,
                eta = null,
                shareRatio = 0.2,
                piecesCompleted = 6114,
                piecesTotal = 8152,
                pieceSize = 262144,
                pieceBitfield = null,
                files = emptyList(),
                trackers = emptyList(),
                peers = emptyList()
            )
        )
    }
}
