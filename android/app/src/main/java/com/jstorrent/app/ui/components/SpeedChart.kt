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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.quickjs.model.SpeedSample
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sin

/**
 * Colors for the speed chart - matching the extension's colors.
 */
private val DownloadColor = Color(0xFF22C55E) // Green
private val UploadColor = Color(0xFF3B82F6)   // Blue
private val DiskWriteColor = Color(0xFFF59E0B) // Amber/orange
private val GridColor = Color(0x33888888)     // Light gray with alpha

/**
 * Canvas-based speed chart showing download, upload, and disk write speeds over time.
 * Displays three filled area series with time and speed axes.
 *
 * @param downloadSamples Download speed samples (time in ms, value in bytes/sec)
 * @param uploadSamples Upload speed samples (time in ms, value in bytes/sec)
 * @param diskWriteSamples Disk write speed samples (time in ms, value in bytes/sec)
 * @param bucketMs Resolution of each sample in milliseconds
 * @param timeWindowMs Time window to display (e.g., 60000 for 1 minute)
 * @param modifier Optional modifier
 */
@Composable
fun SpeedChart(
    downloadSamples: List<SpeedSample>,
    uploadSamples: List<SpeedSample>,
    diskWriteSamples: List<SpeedSample> = emptyList(),
    bucketMs: Long,
    timeWindowMs: Long,
    nowMs: Long = System.currentTimeMillis(),
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current
    val textColor = MaterialTheme.colorScheme.onSurface
    val surfaceVariant = MaterialTheme.colorScheme.surfaceVariant

    // Calculate chart margins (in dp)
    val leftMargin = 56.dp  // Space for Y-axis labels
    val bottomMargin = 24.dp // Space for X-axis labels
    val topMargin = 8.dp
    val rightMargin = 8.dp

    // Convert margins to pixels
    val leftMarginPx = with(density) { leftMargin.toPx() }
    val bottomMarginPx = with(density) { bottomMargin.toPx() }
    val topMarginPx = with(density) { topMargin.toPx() }
    val rightMarginPx = with(density) { rightMargin.toPx() }

    // Calculate max value for Y-axis scaling
    val maxValue = remember(downloadSamples, uploadSamples, diskWriteSamples) {
        val maxDownload = downloadSamples.maxOfOrNull { it.value } ?: 0f
        val maxUpload = uploadSamples.maxOfOrNull { it.value } ?: 0f
        val maxDiskWrite = diskWriteSamples.maxOfOrNull { it.value } ?: 0f
        maxOf(maxDownload, maxUpload, maxDiskWrite).coerceAtLeast(1024f) // Minimum 1 KB/s scale
    }

    // Calculate nice Y-axis scale
    val (yAxisMax, yAxisStep) = remember(maxValue) {
        calculateYAxisScale(maxValue)
    }

    // Text paint for labels
    val textPaint = remember(textColor) {
        android.graphics.Paint().apply {
            color = android.graphics.Color.argb(
                (textColor.alpha * 255).toInt(),
                (textColor.red * 255).toInt(),
                (textColor.green * 255).toInt(),
                (textColor.blue * 255).toInt()
            )
            textSize = 28f // Will be scaled by density
            isAntiAlias = true
        }
    }

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(200.dp)
    ) {
        val chartWidth = size.width - leftMarginPx - rightMarginPx
        val chartHeight = size.height - topMarginPx - bottomMarginPx
        val chartLeft = leftMarginPx
        val chartTop = topMarginPx
        val chartBottom = size.height - bottomMarginPx

        // Draw background
        drawRect(
            color = surfaceVariant.copy(alpha = 0.3f),
            topLeft = Offset(chartLeft, chartTop),
            size = androidx.compose.ui.geometry.Size(chartWidth, chartHeight)
        )

        // Draw horizontal grid lines and Y-axis labels
        val gridLineCount = (yAxisMax / yAxisStep).toInt()
        for (i in 0..gridLineCount) {
            val value = i * yAxisStep
            val y = chartBottom - (value / yAxisMax) * chartHeight

            // Grid line
            drawLine(
                color = GridColor,
                start = Offset(chartLeft, y),
                end = Offset(chartLeft + chartWidth, y),
                strokeWidth = 1f
            )

            // Y-axis label
            val label = formatSpeedLabel(value)
            drawContext.canvas.nativeCanvas.drawText(
                label,
                4f,
                y + textPaint.textSize / 3,
                textPaint
            )
        }

        // Draw time axis labels
        drawTimeAxisLabels(
            timeWindowMs = timeWindowMs,
            chartLeft = chartLeft,
            chartWidth = chartWidth,
            chartBottom = chartBottom,
            textPaint = textPaint
        )

        // Draw upload area (behind others)
        if (uploadSamples.isNotEmpty()) {
            drawSpeedArea(
                samples = uploadSamples,
                color = UploadColor.copy(alpha = 0.5f),
                nowMs = nowMs,
                timeWindowMs = timeWindowMs,
                yAxisMax = yAxisMax,
                chartLeft = chartLeft,
                chartWidth = chartWidth,
                chartTop = chartTop,
                chartHeight = chartHeight
            )
        }

        // Draw disk write area (middle layer)
        if (diskWriteSamples.isNotEmpty()) {
            drawSpeedArea(
                samples = diskWriteSamples,
                color = DiskWriteColor.copy(alpha = 0.55f),
                nowMs = nowMs,
                timeWindowMs = timeWindowMs,
                yAxisMax = yAxisMax,
                chartLeft = chartLeft,
                chartWidth = chartWidth,
                chartTop = chartTop,
                chartHeight = chartHeight
            )
        }

        // Draw download area (in front)
        if (downloadSamples.isNotEmpty()) {
            drawSpeedArea(
                samples = downloadSamples,
                color = DownloadColor.copy(alpha = 0.6f),
                nowMs = nowMs,
                timeWindowMs = timeWindowMs,
                yAxisMax = yAxisMax,
                chartLeft = chartLeft,
                chartWidth = chartWidth,
                chartTop = chartTop,
                chartHeight = chartHeight
            )
        }

        // Draw chart border
        drawRect(
            color = GridColor,
            topLeft = Offset(chartLeft, chartTop),
            size = androidx.compose.ui.geometry.Size(chartWidth, chartHeight),
            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1f)
        )
    }
}

/**
 * Draws a filled area for speed samples.
 * Uses nowMs as the right edge of the time window (actual wall-clock time).
 */
private fun DrawScope.drawSpeedArea(
    samples: List<SpeedSample>,
    color: Color,
    nowMs: Long,
    timeWindowMs: Long,
    yAxisMax: Float,
    chartLeft: Float,
    chartWidth: Float,
    chartTop: Float,
    chartHeight: Float
) {
    if (samples.isEmpty()) return

    val windowStart = nowMs - timeWindowMs
    val chartBottom = chartTop + chartHeight

    // Filter samples in time window and sort by time
    val visibleSamples = samples
        .filter { it.time >= windowStart }
        .sortedBy { it.time }

    if (visibleSamples.isEmpty()) return

    val path = Path()

    // Start at bottom-left
    val firstX = timeToX(visibleSamples.first().time, windowStart, nowMs, chartLeft, chartWidth)
    path.moveTo(firstX, chartBottom)

    // Draw line through all points
    for (sample in visibleSamples) {
        val x = timeToX(sample.time, windowStart, nowMs, chartLeft, chartWidth)
        val y = valueToY(sample.value, yAxisMax, chartTop, chartHeight)
        path.lineTo(x, y)
    }

    // Close path at bottom-right (extend to last sample, not to nowMs - avoids misleading flat line to present)
    val lastX = timeToX(visibleSamples.last().time, windowStart, nowMs, chartLeft, chartWidth)
    path.lineTo(lastX, chartBottom)
    path.close()

    drawPath(path = path, color = color, style = Fill)
}

/**
 * Draws time axis labels at regular intervals.
 */
private fun DrawScope.drawTimeAxisLabels(
    timeWindowMs: Long,
    chartLeft: Float,
    chartWidth: Float,
    chartBottom: Float,
    textPaint: android.graphics.Paint
) {
    // Determine appropriate label intervals based on time window
    val labelIntervals = when {
        timeWindowMs <= 60_000 -> listOf(0L, 15_000L, 30_000L, 45_000L, 60_000L)
        timeWindowMs <= 600_000 -> listOf(0L, 120_000L, 300_000L, 480_000L, 600_000L)
        else -> listOf(0L, 600_000L, 1200_000L, 1800_000L)
    }

    for (interval in labelIntervals) {
        if (interval > timeWindowMs) continue

        val x = chartLeft + chartWidth * (1f - interval.toFloat() / timeWindowMs)
        val label = formatTimeLabel(interval)

        // Center the label
        val textWidth = textPaint.measureText(label)
        val labelX = (x - textWidth / 2).coerceIn(chartLeft, chartLeft + chartWidth - textWidth)

        drawContext.canvas.nativeCanvas.drawText(
            label,
            labelX,
            chartBottom + textPaint.textSize + 4f,
            textPaint
        )
    }
}

/**
 * Converts a timestamp to X coordinate.
 */
private fun timeToX(
    time: Long,
    windowStart: Long,
    windowEnd: Long,
    chartLeft: Float,
    chartWidth: Float
): Float {
    val fraction = (time - windowStart).toFloat() / (windowEnd - windowStart)
    return chartLeft + fraction * chartWidth
}

/**
 * Converts a speed value to Y coordinate.
 */
private fun valueToY(
    value: Float,
    yAxisMax: Float,
    chartTop: Float,
    chartHeight: Float
): Float {
    val fraction = value / yAxisMax
    return chartTop + chartHeight * (1f - fraction)
}

/**
 * Calculates a nice Y-axis scale with appropriate step size.
 * Returns (maxValue, stepSize).
 */
private fun calculateYAxisScale(maxValue: Float): Pair<Float, Float> {
    // Scale factors for byte units
    val kb = 1024f
    val mb = kb * 1024f
    val gb = mb * 1024f

    // Find appropriate scale and nice round numbers
    val (unit, unitValue) = when {
        maxValue >= gb -> "GB" to gb
        maxValue >= mb -> "MB" to mb
        maxValue >= kb -> "KB" to kb
        else -> "B" to 1f
    }

    val valueInUnit = maxValue / unitValue

    // Find nice step size (1, 2, 5, 10, 20, 50, etc.)
    val magnitude = Math.pow(10.0, floor(log10(valueInUnit.toDouble()))).toFloat()
    val normalized = valueInUnit / magnitude

    val niceStep = when {
        normalized <= 1f -> 0.2f * magnitude
        normalized <= 2f -> 0.5f * magnitude
        normalized <= 5f -> 1f * magnitude
        else -> 2f * magnitude
    }

    // Calculate max to be a nice multiple of step
    val niceMax = ceil(valueInUnit / niceStep) * niceStep

    return Pair(niceMax * unitValue, niceStep * unitValue)
}

/**
 * Formats a speed value for Y-axis labels.
 */
private fun formatSpeedLabel(bytesPerSec: Float): String {
    val kb = 1024f
    val mb = kb * 1024f
    val gb = mb * 1024f

    return when {
        bytesPerSec >= gb -> String.format("%.0f GB/s", bytesPerSec / gb)
        bytesPerSec >= mb -> String.format("%.0f MB/s", bytesPerSec / mb)
        bytesPerSec >= kb -> String.format("%.0f KB/s", bytesPerSec / kb)
        bytesPerSec > 0 -> String.format("%.0f B/s", bytesPerSec)
        else -> "0"
    }
}

/**
 * Formats a time offset for X-axis labels.
 * @param offsetMs Milliseconds ago (0 = now, 60000 = 1 minute ago)
 */
private fun formatTimeLabel(offsetMs: Long): String {
    return when {
        offsetMs == 0L -> "now"
        offsetMs < 60_000 -> "-${offsetMs / 1000}s"
        offsetMs < 3600_000 -> "-${offsetMs / 60_000}m"
        else -> "-${offsetMs / 3600_000}h"
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun SpeedChartEmptyPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(8.dp)) {
            SpeedChart(
                downloadSamples = emptyList(),
                uploadSamples = emptyList(),
                bucketMs = 500,
                timeWindowMs = 60_000
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun SpeedChartWithDataPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(8.dp)) {
            val now = System.currentTimeMillis()
            val downloadSamples = (0 until 60).map { i ->
                SpeedSample(
                    time = now - (60 - i) * 1000L,
                    value = (1_500_000f + 500_000f * sin(i * 0.2)).toFloat()
                )
            }
            val uploadSamples = (0 until 60).map { i ->
                SpeedSample(
                    time = now - (60 - i) * 1000L,
                    value = (300_000f + 100_000f * cos(i * 0.3)).toFloat()
                )
            }
            SpeedChart(
                downloadSamples = downloadSamples,
                uploadSamples = uploadSamples,
                bucketMs = 1000,
                timeWindowMs = 60_000
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun SpeedChartHighSpeedPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(8.dp)) {
            val now = System.currentTimeMillis()
            val downloadSamples = (0 until 60).map { i ->
                SpeedSample(
                    time = now - (60 - i) * 1000L,
                    value = (50_000_000f + 20_000_000f * sin(i * 0.1)).toFloat()
                )
            }
            val uploadSamples = (0 until 60).map { i ->
                SpeedSample(
                    time = now - (60 - i) * 1000L,
                    value = (10_000_000f + 5_000_000f * cos(i * 0.15)).toFloat()
                )
            }
            SpeedChart(
                downloadSamples = downloadSamples,
                uploadSamples = uploadSamples,
                bucketMs = 1000,
                timeWindowMs = 60_000
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun SpeedChartSparseDataPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(8.dp)) {
            val now = System.currentTimeMillis()
            // Only a few data points
            val downloadSamples = listOf(
                SpeedSample(time = now - 50_000, value = 500_000f),
                SpeedSample(time = now - 40_000, value = 1_200_000f),
                SpeedSample(time = now - 30_000, value = 800_000f),
                SpeedSample(time = now - 20_000, value = 2_000_000f),
                SpeedSample(time = now - 10_000, value = 1_500_000f),
                SpeedSample(time = now, value = 1_800_000f)
            )
            val uploadSamples = listOf(
                SpeedSample(time = now - 45_000, value = 100_000f),
                SpeedSample(time = now - 25_000, value = 250_000f),
                SpeedSample(time = now - 5_000, value = 150_000f)
            )
            SpeedChart(
                downloadSamples = downloadSamples,
                uploadSamples = uploadSamples,
                bucketMs = 5000,
                timeWindowMs = 60_000
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun SpeedChartLongWindowPreview() {
    JSTorrentTheme {
        Box(modifier = Modifier.padding(8.dp)) {
            val now = System.currentTimeMillis()
            // 10 minute window
            val downloadSamples = (0 until 120).map { i ->
                SpeedSample(
                    time = now - (120 - i) * 5000L,
                    value = (2_000_000f + 1_000_000f * sin(i * 0.1)).toFloat()
                )
            }
            SpeedChart(
                downloadSamples = downloadSamples,
                uploadSamples = emptyList(),
                bucketMs = 5000,
                timeWindowMs = 600_000 // 10 minutes
            )
        }
    }
}

@Preview(showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun SpeedChartDarkModePreview() {
    JSTorrentTheme(darkTheme = true) {
        Box(modifier = Modifier.padding(8.dp)) {
            val now = System.currentTimeMillis()
            val downloadSamples = (0 until 60).map { i ->
                SpeedSample(
                    time = now - (60 - i) * 1000L,
                    value = (1_500_000f + 500_000f * sin(i * 0.2)).toFloat()
                )
            }
            val uploadSamples = (0 until 60).map { i ->
                SpeedSample(
                    time = now - (60 - i) * 1000L,
                    value = (300_000f + 100_000f * cos(i * 0.3)).toFloat()
                )
            }
            SpeedChart(
                downloadSamples = downloadSamples,
                uploadSamples = uploadSamples,
                bucketMs = 1000,
                timeWindowMs = 60_000
            )
        }
    }
}
