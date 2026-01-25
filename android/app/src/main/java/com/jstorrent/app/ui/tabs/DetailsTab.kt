package com.jstorrent.app.ui.tabs

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.model.TorrentDetailUi
import com.jstorrent.app.ui.components.StatRow
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.util.Formatters

/**
 * Details tab showing torrent metadata.
 * Displays info hash, dates, sizes, and copy buttons.
 */
@Composable
fun DetailsTab(
    torrent: TorrentDetailUi,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Info Hash section with copy button
        InfoHashSection(
            infoHash = torrent.infoHash,
            onCopy = { copyToClipboard(context, "Info Hash", torrent.infoHash) }
        )

        HorizontalDivider()

        // Dates section
        DatesSection(
            addedAt = torrent.addedAt,
            completedAt = torrent.completedAt,
            progress = torrent.progress
        )

        HorizontalDivider()

        // Size section
        SizeSection(
            totalSize = torrent.size,
            pieceSize = torrent.pieceSize,
            pieceCount = torrent.piecesTotal
        )

        HorizontalDivider()

        // Copy Magnet URL button
        MagnetSection(
            magnetUrl = torrent.magnetUrl,
            onCopy = { url -> copyToClipboard(context, "Magnet URL", url) }
        )
    }
}

@Composable
private fun InfoHashSection(
    infoHash: String,
    onCopy: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "INFO HASH",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(4.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Display hash in monospace, break in middle for readability
            Text(
                text = infoHash.chunked(20).joinToString("\n"),
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.weight(1f)
            )
            IconButton(onClick = onCopy) {
                Icon(
                    imageVector = Icons.Default.ContentCopy,
                    contentDescription = "Copy Info Hash",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

@Composable
private fun DatesSection(
    addedAt: Long?,
    completedAt: Long?,
    progress: Double,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        StatRow(
            label = "Date Added",
            value = addedAt?.let { Formatters.formatDateTime(it) } ?: "Unknown"
        )
        Spacer(modifier = Modifier.height(12.dp))
        StatRow(
            label = "Date Finished",
            value = when {
                completedAt != null -> Formatters.formatDateTime(completedAt)
                progress >= 0.999 -> "Complete"
                else -> "In Progress"
            }
        )
    }
}

@Composable
private fun SizeSection(
    totalSize: Long,
    pieceSize: Long?,
    pieceCount: Int?,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        StatRow(
            label = "Total Size",
            value = Formatters.formatBytes(totalSize)
        )
        Spacer(modifier = Modifier.height(12.dp))
        StatRow(
            label = "Piece Size",
            value = pieceSize?.let { Formatters.formatBytes(it) } ?: "Unknown"
        )
        Spacer(modifier = Modifier.height(12.dp))
        StatRow(
            label = "Piece Count",
            value = pieceCount?.let { Formatters.formatNumber(it) } ?: "Unknown"
        )
    }
}

@Composable
private fun MagnetSection(
    magnetUrl: String?,
    onCopy: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Button(
            onClick = { magnetUrl?.let { onCopy(it) } },
            enabled = magnetUrl != null,
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(
                imageVector = Icons.Default.ContentCopy,
                contentDescription = null,
                modifier = Modifier.size(18.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text("Copy Magnet URL")
        }
    }
}

private fun copyToClipboard(context: Context, label: String, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    val clip = ClipData.newPlainText(label, text)
    clipboard.setPrimaryClip(clip)
    Toast.makeText(context, "$label copied", Toast.LENGTH_SHORT).show()
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun DetailsTabPreview() {
    JSTorrentTheme {
        DetailsTab(
            torrent = TorrentDetailUi(
                infoHash = "95c6c298c84fee2eee10c044d673537da158f0f8",
                name = "ubuntu-22.04.3-desktop-amd64.iso",
                status = "seeding",
                progress = 1.0,
                downloadSpeed = 0,
                uploadSpeed = 256_000,
                downloaded = 3_300_000_000,
                uploaded = 100_000_000,
                size = 3_300_000_000,
                peersConnected = 5,
                peersTotal = null,
                seedersConnected = null,
                seedersTotal = null,
                leechersConnected = null,
                leechersTotal = null,
                eta = null,
                shareRatio = 0.03,
                piecesCompleted = 8152,
                piecesTotal = 8152,
                pieceSize = 262144,
                pieceBitfield = null,
                files = emptyList(),
                trackers = emptyList(),
                peers = emptyList(),
                addedAt = 1735045203000,  // Dec 24, 2024 5:20:03 AM
                completedAt = 1735074809000,  // Dec 24, 2024 1:33:29 PM
                magnetUrl = "magnet:?xt=urn:btih:95c6c298c84fee2eee10c044d673537da158f0f8&dn=ubuntu-22.04.3-desktop-amd64.iso"
            )
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun DetailsTabInProgressPreview() {
    JSTorrentTheme {
        DetailsTab(
            torrent = TorrentDetailUi(
                infoHash = "abc123def456789012345678901234567890abcd",
                name = "In Progress Torrent",
                status = "downloading",
                progress = 0.45,
                downloadSpeed = 1_500_000,
                uploadSpeed = 50_000,
                downloaded = 1_500_000_000,
                uploaded = 75_000_000,
                size = 3_300_000_000,
                peersConnected = 7,
                peersTotal = null,
                seedersConnected = null,
                seedersTotal = null,
                leechersConnected = null,
                leechersTotal = null,
                eta = 1200,
                shareRatio = 0.05,
                piecesCompleted = 3668,
                piecesTotal = 8152,
                pieceSize = 262144,
                pieceBitfield = null,
                files = emptyList(),
                trackers = emptyList(),
                peers = emptyList(),
                addedAt = 1735045203000,
                completedAt = null,
                magnetUrl = "magnet:?xt=urn:btih:abc123def456789012345678901234567890abcd"
            )
        )
    }
}
