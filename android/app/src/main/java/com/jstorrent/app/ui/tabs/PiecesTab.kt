package com.jstorrent.app.ui.tabs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.components.PieceBar
import com.jstorrent.app.ui.components.PieceMap
import com.jstorrent.app.ui.components.StatRowPair
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.util.Formatters
import java.util.BitSet

/**
 * Pieces tab showing piece completion status and visual map.
 */
@Composable
fun PiecesTab(
    piecesCompleted: Int?,
    piecesTotal: Int?,
    pieceSize: Long?,
    bitfield: BitSet?,
    modifier: Modifier = Modifier
) {
    if (piecesTotal == null || piecesTotal == 0) {
        NoPiecesState(modifier = modifier)
    } else {
        Column(
            modifier = modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Statistics
            StatRowPair(
                leftLabel = "Pieces",
                leftValue = "${Formatters.formatNumber(piecesCompleted ?: 0)} / ${Formatters.formatNumber(piecesTotal)}",
                rightLabel = "Piece Size",
                rightValue = pieceSize?.let { Formatters.formatBytes(it) } ?: "Unknown"
            )

            // Progress bar (single line, aggregated view)
            Text(
                text = "PROGRESS",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            PieceBar(
                piecesTotal = piecesTotal,
                bitfield = bitfield,
                piecesCompleted = piecesCompleted ?: 0,
                modifier = Modifier.padding(top = 4.dp)
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Piece map (grid view)
            Text(
                text = "PIECE MAP",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            PieceMap(
                piecesTotal = piecesTotal,
                bitfield = bitfield,
                piecesCompleted = piecesCompleted ?: 0,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

/**
 * State shown when no piece info available.
 */
@Composable
private fun NoPiecesState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp)
        ) {
            Text(
                text = "No piece information",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "Piece data not yet available",
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
private fun PiecesTabPreview() {
    // Create a scattered bitfield for preview
    val bitfield = BitSet(8152).apply {
        for (i in 0 until 500) set(i * 16)
    }
    JSTorrentTheme {
        PiecesTab(
            piecesCompleted = 500,
            piecesTotal = 8152,
            pieceSize = 262144,
            bitfield = bitfield
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PiecesTabCompletePreview() {
    val bitfield = BitSet(8152).apply {
        set(0, 8152)
    }
    JSTorrentTheme {
        PiecesTab(
            piecesCompleted = 8152,
            piecesTotal = 8152,
            pieceSize = 262144,
            bitfield = bitfield
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PiecesTabNoDataPreview() {
    JSTorrentTheme {
        PiecesTab(
            piecesCompleted = null,
            piecesTotal = null,
            pieceSize = null,
            bitfield = null
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PiecesTabSmallTorrentPreview() {
    // Small torrent with 10 pieces
    val bitfield = BitSet(10).apply {
        set(0); set(2); set(5); set(7)
    }
    JSTorrentTheme {
        PiecesTab(
            piecesCompleted = 4,
            piecesTotal = 10,
            pieceSize = 16384,
            bitfield = bitfield
        )
    }
}
