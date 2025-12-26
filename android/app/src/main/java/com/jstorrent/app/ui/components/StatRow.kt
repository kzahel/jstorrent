package com.jstorrent.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme

/**
 * A label + value pair for displaying statistics.
 * Used in torrent detail screens for metrics like "Downloaded: 500 MB".
 *
 * @param label The label text (e.g., "Downloaded")
 * @param value The value text (e.g., "500 MB")
 * @param modifier Optional modifier
 * @param labelStyle Style for the label
 * @param valueStyle Style for the value
 * @param labelColor Color for the label
 * @param valueColor Color for the value
 */
@Composable
fun StatRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    labelStyle: TextStyle = MaterialTheme.typography.bodySmall,
    valueStyle: TextStyle = MaterialTheme.typography.bodyMedium,
    labelColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    valueColor: Color = MaterialTheme.colorScheme.onSurface
) {
    Column(modifier = modifier) {
        Text(
            text = label.uppercase(),
            style = labelStyle,
            color = labelColor,
            fontWeight = FontWeight.Medium
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = value,
            style = valueStyle,
            color = valueColor
        )
    }
}

/**
 * A horizontal pair of StatRows for side-by-side display.
 * Used in status tab for metrics like "Download: X | Upload: Y"
 */
@Composable
fun StatRowPair(
    leftLabel: String,
    leftValue: String,
    rightLabel: String,
    rightValue: String,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        StatRow(
            label = leftLabel,
            value = leftValue,
            modifier = Modifier.weight(1f)
        )
        StatRow(
            label = rightLabel,
            value = rightValue,
            modifier = Modifier.weight(1f)
        )
    }
}

/**
 * An inline stat row with label and value on same line.
 * More compact than vertical StatRow.
 */
@Composable
fun InlineStatRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    labelStyle: TextStyle = MaterialTheme.typography.bodySmall,
    valueStyle: TextStyle = MaterialTheme.typography.bodySmall,
    labelColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    valueColor: Color = MaterialTheme.colorScheme.onSurface
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "$label: ",
            style = labelStyle,
            color = labelColor
        )
        Text(
            text = value,
            style = valueStyle,
            color = valueColor
        )
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun StatRowPreview() {
    JSTorrentTheme {
        StatRow(
            label = "Downloaded",
            value = "500.0 MB / 2.0 GB",
            modifier = Modifier.padding(16.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StatRowPairPreview() {
    JSTorrentTheme {
        StatRowPair(
            leftLabel = "Download",
            leftValue = "1.2 MB/s",
            rightLabel = "Upload",
            rightValue = "256 KB/s",
            modifier = Modifier.padding(16.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun InlineStatRowPreview() {
    JSTorrentTheme {
        InlineStatRow(
            label = "Seeds",
            value = "5 (1,341)",
            modifier = Modifier.padding(16.dp)
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun MultipleStatsPreview() {
    JSTorrentTheme {
        Column(modifier = Modifier.padding(16.dp)) {
            StatRowPair(
                leftLabel = "Downloaded",
                leftValue = "500.0 MB / 2.0 GB",
                rightLabel = "ETA",
                rightValue = "2h 30m"
            )
            Spacer(modifier = Modifier.height(16.dp))
            StatRowPair(
                leftLabel = "Seeders",
                leftValue = "5 (1,341)",
                rightLabel = "Leechers",
                rightValue = "2 (31)"
            )
            Spacer(modifier = Modifier.height(16.dp))
            StatRowPair(
                leftLabel = "Uploaded",
                leftValue = "100 MB",
                rightLabel = "Share Ratio",
                rightValue = "0.050"
            )
        }
    }
}
