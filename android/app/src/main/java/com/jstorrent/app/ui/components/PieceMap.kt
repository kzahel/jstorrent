package com.jstorrent.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme
import java.util.BitSet
import kotlin.math.ceil
import kotlin.math.min

/**
 * Visual piece map showing download progress as a grid.
 * Dynamically adjusts grid size based on piece count:
 * - Small (< 100): Large squares, one row if possible
 * - Medium (100-1000): Medium squares, multiple rows
 * - Large (> 1000): Small squares, many rows
 *
 * Uses BitSet for accurate piece-by-piece visualization.
 */
@Composable
fun PieceMap(
    piecesTotal: Int,
    bitfield: BitSet?,
    modifier: Modifier = Modifier,
    piecesCompleted: Int = bitfield?.cardinality() ?: 0
) {
    val primaryColor = MaterialTheme.colorScheme.primary
    val emptyColor = MaterialTheme.colorScheme.surfaceVariant

    // Dynamic grid sizing based on piece count
    val (columns, cellSizeDp) = remember(piecesTotal) {
        when {
            piecesTotal <= 10 -> piecesTotal to 24.dp
            piecesTotal <= 50 -> min(piecesTotal, 25) to 16.dp
            piecesTotal <= 200 -> min(piecesTotal, 40) to 10.dp
            piecesTotal <= 1000 -> 50 to 6.dp
            piecesTotal <= 5000 -> 80 to 4.dp
            else -> 100 to 3.dp
        }
    }
    val rows = if (columns > 0) ceil(piecesTotal.toDouble() / columns).toInt() else 0
    val density = LocalDensity.current
    val cellSizePx = with(density) { cellSizeDp.toPx() }
    val gap = 1f
    val totalHeight = (rows * cellSizePx / density.density + 8).dp

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(totalHeight)
            .padding(4.dp)
    ) {
        if (piecesTotal == 0 || columns == 0) return@Canvas

        // Use actual cell size based on available width
        val actualCellWidth = size.width / columns
        val actualCellHeight = actualCellWidth

        for (i in 0 until piecesTotal) {
            val col = i % columns
            val row = i / columns

            // Check if piece is complete using bitfield or fallback to count
            val isComplete = if (bitfield != null) {
                bitfield.get(i)
            } else {
                i < piecesCompleted
            }
            val color = if (isComplete) primaryColor else emptyColor

            val x = col * actualCellWidth + gap
            val y = row * actualCellHeight + gap

            drawRect(
                color = color,
                topLeft = Offset(x, y),
                size = Size(actualCellWidth - gap * 2, actualCellHeight - gap * 2)
            )
        }
    }
}

/**
 * Single-line piece bar showing download progress.
 * Aggregates pieces into segments for large torrents.
 * Uses BitSet for accurate piece-by-piece visualization.
 */
@Composable
fun PieceBar(
    piecesTotal: Int,
    bitfield: BitSet?,
    modifier: Modifier = Modifier,
    piecesCompleted: Int = bitfield?.cardinality() ?: 0,
    height: Dp = 12.dp,
    maxSegments: Int = 200
) {
    val primaryColor = MaterialTheme.colorScheme.primary
    val emptyColor = MaterialTheme.colorScheme.surfaceVariant

    // Pre-compute segment completion percentages
    val displaySegments = min(piecesTotal, maxSegments)
    val segmentCompletions = remember(bitfield, piecesTotal, piecesCompleted) {
        if (displaySegments == 0) return@remember floatArrayOf()

        val piecesPerSegment = piecesTotal.toFloat() / displaySegments
        FloatArray(displaySegments) { segmentIndex ->
            val startPiece = (segmentIndex * piecesPerSegment).toInt()
            val endPiece = min(((segmentIndex + 1) * piecesPerSegment).toInt(), piecesTotal)
            val segmentSize = endPiece - startPiece
            if (segmentSize == 0) return@FloatArray 0f

            if (bitfield != null) {
                // Count actual completed pieces in this segment
                var completed = 0
                for (i in startPiece until endPiece) {
                    if (bitfield.get(i)) completed++
                }
                completed.toFloat() / segmentSize
            } else {
                // Fallback: use sequential completion assumption
                val completedInSegment = (piecesCompleted - startPiece).coerceIn(0, segmentSize)
                completedInSegment.toFloat() / segmentSize
            }
        }
    }

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
    ) {
        if (piecesTotal == 0 || displaySegments == 0) return@Canvas

        val segmentWidth = size.width / displaySegments
        val gap = if (displaySegments <= 50) 1f else 0.5f

        for (i in 0 until displaySegments) {
            val completion = segmentCompletions[i]
            val x = i * segmentWidth

            // Draw background (empty)
            drawRect(
                color = emptyColor,
                topLeft = Offset(x + gap, 0f),
                size = Size(segmentWidth - gap * 2, size.height)
            )

            // Draw completion overlay with alpha based on completion %
            if (completion > 0f) {
                drawRect(
                    color = primaryColor.copy(alpha = 0.3f + completion * 0.7f),
                    topLeft = Offset(x + gap, 0f),
                    size = Size(segmentWidth - gap * 2, size.height)
                )
            }
        }
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun PieceMapSmallPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            // 10 pieces, 5 complete (scattered)
            val bitfield = BitSet(10).apply {
                set(0); set(2); set(4); set(7); set(9)
            }
            PieceMap(
                piecesTotal = 10,
                bitfield = bitfield
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PieceMapMediumPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            // 100 pieces, 50% complete (scattered)
            val bitfield = BitSet(100).apply {
                for (i in 0 until 100 step 2) set(i)
            }
            PieceMap(
                piecesTotal = 100,
                bitfield = bitfield
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PieceMapLargePreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            // 1000 pieces, 50% complete
            val bitfield = BitSet(1000).apply {
                for (i in 0 until 500) set(i)
            }
            PieceMap(
                piecesTotal = 1000,
                bitfield = bitfield
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PieceMapVeryLargePreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            // 10000 pieces, scattered completion
            val bitfield = BitSet(10000).apply {
                for (i in 0 until 10000 step 3) set(i)
            }
            PieceMap(
                piecesTotal = 10000,
                bitfield = bitfield
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PieceBarPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            // 1000 pieces, scattered completion
            val bitfield = BitSet(1000).apply {
                for (i in 0 until 1000 step 2) set(i)
            }
            PieceBar(
                piecesTotal = 1000,
                bitfield = bitfield
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PieceBarSmallPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            val bitfield = BitSet(20).apply {
                set(0); set(5); set(10); set(15); set(19)
            }
            PieceBar(
                piecesTotal = 20,
                bitfield = bitfield
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PieceMapNoBitfieldPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            // Fallback mode: no bitfield, use count
            PieceMap(
                piecesTotal = 100,
                bitfield = null,
                piecesCompleted = 50
            )
        }
    }
}
