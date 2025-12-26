package com.jstorrent.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme

/**
 * Circular play/pause button for torrent control.
 * Matches Flud's design with teal background and white icon.
 *
 * @param isPaused Whether the torrent is currently paused
 * @param onToggle Callback when button is clicked
 * @param modifier Optional modifier
 * @param size Button size (default 40.dp)
 * @param backgroundColor Background color (defaults to primary/teal)
 * @param iconColor Icon color (defaults to onPrimary/white)
 * @param enabled Whether the button is enabled
 */
@Composable
fun PlayPauseButton(
    isPaused: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    backgroundColor: Color = MaterialTheme.colorScheme.primary,
    iconColor: Color = MaterialTheme.colorScheme.onPrimary,
    enabled: Boolean = true
) {
    val icon = if (isPaused) Icons.Default.PlayArrow else Icons.Default.Pause
    val description = if (isPaused) "Resume torrent" else "Pause torrent"

    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(
                if (enabled) backgroundColor else backgroundColor.copy(alpha = 0.5f)
            )
            .clickable(enabled = enabled, onClick = onToggle)
            .semantics {
                role = Role.Button
                contentDescription = description
            },
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null, // Handled by parent semantics
            tint = if (enabled) iconColor else iconColor.copy(alpha = 0.5f),
            modifier = Modifier.size(size * 0.6f)
        )
    }
}

/**
 * Larger play/pause button for prominent placement.
 * Used in torrent detail screen app bar.
 */
@Composable
fun LargePlayPauseButton(
    isPaused: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    PlayPauseButton(
        isPaused = isPaused,
        onToggle = onToggle,
        modifier = modifier,
        size = 48.dp,
        enabled = enabled
    )
}

/**
 * Compact play/pause button for torrent list cards.
 */
@Composable
fun CompactPlayPauseButton(
    isPaused: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true
) {
    PlayPauseButton(
        isPaused = isPaused,
        onToggle = onToggle,
        modifier = modifier,
        size = 36.dp,
        enabled = enabled
    )
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun PlayPauseButtonPausedPreview() {
    JSTorrentTheme {
        PlayPauseButton(
            isPaused = true,
            onToggle = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PlayPauseButtonPlayingPreview() {
    JSTorrentTheme {
        PlayPauseButton(
            isPaused = false,
            onToggle = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PlayPauseButtonDisabledPreview() {
    JSTorrentTheme {
        PlayPauseButton(
            isPaused = true,
            onToggle = {},
            enabled = false
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun LargePlayPauseButtonPreview() {
    JSTorrentTheme {
        LargePlayPauseButton(
            isPaused = true,
            onToggle = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun CompactPlayPauseButtonPreview() {
    JSTorrentTheme {
        CompactPlayPauseButton(
            isPaused = false,
            onToggle = {}
        )
    }
}
