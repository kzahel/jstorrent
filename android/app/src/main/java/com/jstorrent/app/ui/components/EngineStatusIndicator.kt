package com.jstorrent.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme

/**
 * Small status indicator showing whether the engine is running (live) or not (cached).
 *
 * - Green filled dot = engine running, data is live
 * - Gray hollow dot = engine not running, showing cached data
 *
 * Useful for development debugging; may be removed or made more subtle later.
 *
 * @param isLive True when engine is running and data is live
 * @param showLabel Whether to show "Live"/"Cached" label next to the dot
 * @param modifier Optional modifier
 */
@Composable
fun EngineStatusIndicator(
    isLive: Boolean,
    showLabel: Boolean = false,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .then(
                    if (isLive) {
                        Modifier.background(
                            color = Color(0xFF4CAF50), // Material Green 500
                            shape = CircleShape
                        )
                    } else {
                        Modifier.border(
                            width = 1.5.dp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                            shape = CircleShape
                        )
                    }
                )
        )
        if (showLabel) {
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = if (isLive) "Live" else "Cached",
                style = MaterialTheme.typography.labelSmall,
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
private fun EngineStatusLivePreview() {
    JSTorrentTheme {
        EngineStatusIndicator(isLive = true)
    }
}

@Preview(showBackground = true)
@Composable
private fun EngineStatusCachedPreview() {
    JSTorrentTheme {
        EngineStatusIndicator(isLive = false)
    }
}

@Preview(showBackground = true)
@Composable
private fun EngineStatusLiveWithLabelPreview() {
    JSTorrentTheme {
        EngineStatusIndicator(isLive = true, showLabel = true)
    }
}

@Preview(showBackground = true)
@Composable
private fun EngineStatusCachedWithLabelPreview() {
    JSTorrentTheme {
        EngineStatusIndicator(isLive = false, showLabel = true)
    }
}
