package com.jstorrent.app.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme

/**
 * Thin teal progress bar for torrent download progress.
 * Stateless composable - receives all state as parameters.
 *
 * @param progress Progress value between 0.0 and 1.0
 * @param modifier Optional modifier
 * @param height Height of the progress bar (default 4.dp for thin bar)
 * @param color Progress bar color (defaults to primary/teal)
 * @param trackColor Background track color
 */
@Composable
fun TorrentProgressBar(
    progress: Float,
    modifier: Modifier = Modifier,
    height: Dp = 4.dp,
    color: Color = MaterialTheme.colorScheme.primary,
    trackColor: Color = MaterialTheme.colorScheme.surfaceVariant
) {
    LinearProgressIndicator(
        progress = { progress.coerceIn(0f, 1f) },
        modifier = modifier
            .fillMaxWidth()
            .height(height),
        color = color,
        trackColor = trackColor
    )
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun TorrentProgressBarEmptyPreview() {
    JSTorrentTheme {
        TorrentProgressBar(progress = 0f)
    }
}

@Preview(showBackground = true)
@Composable
private fun TorrentProgressBarHalfPreview() {
    JSTorrentTheme {
        TorrentProgressBar(progress = 0.5f)
    }
}

@Preview(showBackground = true)
@Composable
private fun TorrentProgressBarFullPreview() {
    JSTorrentTheme {
        TorrentProgressBar(progress = 1f)
    }
}

@Preview(showBackground = true)
@Composable
private fun TorrentProgressBarThickPreview() {
    JSTorrentTheme {
        TorrentProgressBar(
            progress = 0.75f,
            height = 8.dp
        )
    }
}
