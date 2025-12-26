package com.jstorrent.app.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme
import kotlin.math.ceil
import kotlin.math.sqrt

/**
 * Visual piece map showing download progress.
 * Displays a grid of small squares representing pieces.
 * Complete pieces are shown in primary color, incomplete pieces in gray.
 */
@Composable
fun PieceMap(
    progress: Double,
    piecesCompleted: Int,
    piecesTotal: Int,
    modifier: Modifier = Modifier
) {
    val primaryColor = MaterialTheme.colorScheme.primary
    val emptyColor = MaterialTheme.colorScheme.surfaceVariant
    val borderColor = MaterialTheme.colorScheme.outlineVariant

    // Calculate grid dimensions
    // Aim for roughly square grid, max 50 columns
    val columns = minOf(
        50,
        maxOf(10, ceil(sqrt(piecesTotal.toDouble())).toInt())
    )
    val rows = ceil(piecesTotal.toDouble() / columns).toInt()

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height((rows * 4 + 8).dp)
            .padding(4.dp)
    ) {
        if (piecesTotal == 0) return@Canvas

        val cellWidth = size.width / columns
        val cellHeight = cellWidth // Square cells
        val gap = 1f

        // Draw grid
        for (i in 0 until piecesTotal) {
            val col = i % columns
            val row = i / columns

            val isComplete = i < piecesCompleted
            val color = if (isComplete) primaryColor else emptyColor

            val x = col * cellWidth + gap
            val y = row * cellHeight + gap

            drawRect(
                color = color,
                topLeft = Offset(x, y),
                size = Size(cellWidth - gap * 2, cellHeight - gap * 2)
            )
        }
    }
}

/**
 * Simplified piece bar for compact display.
 * Shows progress as a single horizontal bar with piece granularity.
 */
@Composable
fun PieceBar(
    progress: Double,
    piecesCompleted: Int,
    piecesTotal: Int,
    modifier: Modifier = Modifier
) {
    val primaryColor = MaterialTheme.colorScheme.primary
    val emptyColor = MaterialTheme.colorScheme.surfaceVariant

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(8.dp)
    ) {
        if (piecesTotal == 0) return@Canvas

        val segmentWidth = size.width / piecesTotal.coerceAtMost(100)
        val displayPieces = piecesTotal.coerceAtMost(100)
        val piecesPerSegment = piecesTotal.toFloat() / displayPieces

        for (i in 0 until displayPieces) {
            val startPiece = (i * piecesPerSegment).toInt()
            val endPiece = ((i + 1) * piecesPerSegment).toInt()
            val isComplete = startPiece < piecesCompleted

            val x = i * segmentWidth
            val color = if (isComplete) primaryColor else emptyColor

            drawRect(
                color = color,
                topLeft = Offset(x, 0f),
                size = Size(segmentWidth - 1f, size.height)
            )
        }
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun PieceMapPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            PieceMap(
                progress = 0.5,
                piecesCompleted = 500,
                piecesTotal = 1000
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PieceMapCompletePreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            PieceMap(
                progress = 1.0,
                piecesCompleted = 1000,
                piecesTotal = 1000
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PieceMapEmptyPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            PieceMap(
                progress = 0.0,
                piecesCompleted = 0,
                piecesTotal = 500
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PieceBarPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(16.dp)) {
            PieceBar(
                progress = 0.5,
                piecesCompleted = 500,
                piecesTotal = 1000
            )
        }
    }
}
