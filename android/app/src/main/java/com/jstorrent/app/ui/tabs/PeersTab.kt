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
import com.jstorrent.app.model.PeerUi
import com.jstorrent.app.ui.components.PeerItem
import com.jstorrent.app.ui.theme.JSTorrentTheme

/**
 * Peers tab showing connected peers.
 */
@Composable
fun PeersTab(
    peers: List<PeerUi>,
    modifier: Modifier = Modifier
) {
    if (peers.isEmpty()) {
        EmptyPeersState(modifier = modifier)
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
            contentPadding = PaddingValues(vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            items(peers, key = { it.address }) { peer ->
                PeerItem(peer = peer)
            }
        }
    }
}

/**
 * Empty state when no peers connected.
 */
@Composable
private fun EmptyPeersState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp)
        ) {
            Text(
                text = "No peers connected",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "Peers will appear here when connected",
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
private fun PeersTabPreview() {
    JSTorrentTheme {
        PeersTab(
            peers = listOf(
                PeerUi(
                    address = "192.168.1.100:51413",
                    client = "qBittorrent 4.5.2",
                    downloadSpeed = 1_500_000,
                    uploadSpeed = 256_000,
                    progress = 0.85,
                    flags = "uH"
                ),
                PeerUi(
                    address = "10.0.0.50:6881",
                    client = "Transmission 3.0",
                    downloadSpeed = 500_000,
                    uploadSpeed = 100_000,
                    progress = 1.0,
                    flags = "D"
                ),
                PeerUi(
                    address = "172.16.0.25:55000",
                    client = null,
                    downloadSpeed = 0,
                    uploadSpeed = 50_000,
                    progress = 0.15,
                    flags = "U"
                )
            )
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PeersTabEmptyPreview() {
    JSTorrentTheme {
        PeersTab(peers = emptyList())
    }
}
