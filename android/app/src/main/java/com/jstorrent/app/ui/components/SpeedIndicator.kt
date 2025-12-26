package com.jstorrent.app.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.util.Formatters

/**
 * Direction indicator for speed.
 */
enum class SpeedDirection {
    /** Download speed (↓) */
    DOWN,
    /** Upload speed (↑) */
    UP
}

/**
 * Speed indicator with formatted speed and direction arrow.
 * Examples: "1.2 MB/s ↓", "256 KB/s ↑"
 *
 * @param bytesPerSecond Speed in bytes per second
 * @param direction Download or upload direction
 * @param modifier Optional modifier
 * @param style Text style (defaults to bodySmall)
 * @param color Text color (defaults to onSurface)
 * @param showZero Whether to show "0 B/s" for zero speed (default false - shows empty)
 */
@Composable
fun SpeedIndicator(
    bytesPerSecond: Long,
    direction: SpeedDirection,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodySmall,
    color: Color = MaterialTheme.colorScheme.onSurface,
    showZero: Boolean = false
) {
    if (bytesPerSecond <= 0 && !showZero) {
        // Show nothing for zero speed by default
        return
    }

    val speedText = if (bytesPerSecond <= 0) {
        "0 B/s"
    } else {
        Formatters.formatSpeed(bytesPerSecond)
    }

    val arrow = when (direction) {
        SpeedDirection.DOWN -> "↓"
        SpeedDirection.UP -> "↑"
    }

    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = speedText,
            style = style,
            color = color
        )
        Spacer(modifier = Modifier.width(2.dp))
        Text(
            text = arrow,
            style = style,
            color = color
        )
    }
}

/**
 * Combined download and upload speed indicator.
 * Shows both speeds separated by a bullet.
 *
 * @param downloadSpeed Download speed in bytes per second
 * @param uploadSpeed Upload speed in bytes per second
 */
@Composable
fun CombinedSpeedIndicator(
    downloadSpeed: Long,
    uploadSpeed: Long,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodySmall,
    color: Color = MaterialTheme.colorScheme.onSurface
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically
    ) {
        SpeedIndicator(
            bytesPerSecond = downloadSpeed,
            direction = SpeedDirection.DOWN,
            style = style,
            color = color,
            showZero = true
        )
        Spacer(modifier = Modifier.width(8.dp))
        SpeedIndicator(
            bytesPerSecond = uploadSpeed,
            direction = SpeedDirection.UP,
            style = style,
            color = color,
            showZero = true
        )
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun SpeedIndicatorDownloadPreview() {
    JSTorrentTheme {
        SpeedIndicator(
            bytesPerSecond = 1_500_000,
            direction = SpeedDirection.DOWN
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SpeedIndicatorUploadPreview() {
    JSTorrentTheme {
        SpeedIndicator(
            bytesPerSecond = 256_000,
            direction = SpeedDirection.UP
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun SpeedIndicatorZeroPreview() {
    JSTorrentTheme {
        SpeedIndicator(
            bytesPerSecond = 0,
            direction = SpeedDirection.DOWN,
            showZero = true
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun CombinedSpeedIndicatorPreview() {
    JSTorrentTheme {
        CombinedSpeedIndicator(
            downloadSpeed = 2_500_000,
            uploadSpeed = 500_000
        )
    }
}
