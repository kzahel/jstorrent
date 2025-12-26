package com.jstorrent.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.model.PeerUi
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.util.Formatters

/**
 * Individual peer item showing peer information.
 */
@Composable
fun PeerItem(
    peer: PeerUi,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Peer info (address, client, progress)
        Column(modifier = Modifier.weight(1f)) {
            // Address
            Text(
                text = peer.address,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(2.dp))

            // Client and flags
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (peer.client != null) {
                    Text(
                        text = peer.client,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                }
                if (peer.flags != null) {
                    if (peer.client != null) {
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    Text(
                        text = "[${peer.flags}]",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Progress bar
            TorrentProgressBar(
                progress = peer.progress.toFloat(),
                modifier = Modifier.fillMaxWidth(),
                height = 3.dp
            )
        }

        Spacer(modifier = Modifier.width(16.dp))

        // Speed indicators
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            // Download speed from peer
            if (peer.downloadSpeed > 0) {
                SpeedRow(speed = peer.downloadSpeed, isDownload = true)
            }
            // Upload speed to peer
            if (peer.uploadSpeed > 0) {
                SpeedRow(speed = peer.uploadSpeed, isDownload = false)
            }
            // Show progress if no speed
            if (peer.downloadSpeed == 0L && peer.uploadSpeed == 0L) {
                Text(
                    text = Formatters.formatPercent(peer.progress),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

/**
 * Small speed indicator row.
 */
@Composable
private fun SpeedRow(
    speed: Long,
    isDownload: Boolean,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = if (isDownload) "\u2193" else "\u2191",
            style = MaterialTheme.typography.bodySmall,
            color = if (isDownload) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.tertiary
            }
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = Formatters.formatSpeed(speed),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun PeerItemPreview() {
    JSTorrentTheme {
        PeerItem(
            peer = PeerUi(
                address = "192.168.1.100:51413",
                client = "qBittorrent 4.5.2",
                downloadSpeed = 1_500_000,
                uploadSpeed = 256_000,
                progress = 0.85,
                flags = "uH"
            )
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PeerItemSeederPreview() {
    JSTorrentTheme {
        PeerItem(
            peer = PeerUi(
                address = "10.0.0.50:6881",
                client = "Transmission 3.0",
                downloadSpeed = 500_000,
                uploadSpeed = 0,
                progress = 1.0,
                flags = "D"
            )
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PeerItemNoSpeedPreview() {
    JSTorrentTheme {
        PeerItem(
            peer = PeerUi(
                address = "172.16.0.25:55000",
                client = null,
                downloadSpeed = 0,
                uploadSpeed = 0,
                progress = 0.15,
                flags = null
            )
        )
    }
}
