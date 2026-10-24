@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.FilterChip
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.graphics.drawscope.Stroke
import org.rstorrent.session.uniffi.SpeedMetric
import org.rstorrent.session.uniffi.SpeedRange
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.DhtInspectionView
import org.rstorrent.session.uniffi.SessionCurrentRatesView
import org.rstorrent.session.uniffi.SpeedHistoryView
import org.rstorrent.session.uniffi.SpeedSeriesView

private val UploadColor = Color(0xFFF57C00)

/** Tabular figures keep changing numbers from shifting the layout. */
private val Numeric = TextStyle(fontFeatureSettings = "tnum")

private data class SpeedLine(
    val label: String,
    val color: Color,
    val series: SpeedSeriesView?,
    val currentRate: String?,
)

private data class SpeedRangeOption(
    val range: SpeedRange,
    val short: Int,
    val long: Int,
)

private val SpeedRangeOptions =
    listOf(
        SpeedRangeOption(SpeedRange.SECONDS30, R.string.speed_range_30s, R.string.speed_range_30s_long),
        SpeedRangeOption(SpeedRange.MINUTES2, R.string.speed_range_2m, R.string.speed_range_2m_long),
        SpeedRangeOption(SpeedRange.MINUTES10, R.string.speed_range_10m, R.string.speed_range_10m_long),
        SpeedRangeOption(SpeedRange.HOUR1, R.string.speed_range_1h, R.string.speed_range_1h_long),
        SpeedRangeOption(SpeedRange.HOURS24, R.string.speed_range_24h, R.string.speed_range_24h_long),
        SpeedRangeOption(SpeedRange.DAYS30, R.string.speed_range_30d, R.string.speed_range_30d_long),
    )

@Composable
internal fun SpeedScreen(
    history: SpeedHistoryView?,
    currentRates: SessionCurrentRatesView?,
    range: SpeedRange,
    onRangeChange: (SpeedRange) -> Unit,
    onBack: () -> Unit,
) {
    var showDetails by rememberSaveable { mutableStateOf(false) }
    val rates = currentRates?.rates?.associate { it.metric to it.bytes }.orEmpty()
    val series = history?.series?.associateBy { it.metric }.orEmpty()
    fun line(
        label: String,
        color: Color,
        metric: SpeedMetric,
    ) = SpeedLine(label, color, series[metric], rates[metric])
    val download = MaterialTheme.colorScheme.primary
    val transfer =
        listOf(
            line(stringResource(R.string.speed_download), download, SpeedMetric.PAYLOAD_RECEIVED),
            line(stringResource(R.string.speed_upload), UploadColor, SpeedMetric.PAYLOAD_UPLOADED),
        )
    val disk =
        listOf(
            line(stringResource(R.string.speed_disk_written), download, SpeedMetric.STAGED_WRITE),
            line(stringResource(R.string.speed_disk_verified), UploadColor, SpeedMetric.PAYLOAD_VERIFIED),
        )
    val network =
        listOf(
            line(stringResource(R.string.speed_network_in), download, SpeedMetric.PEER_WIRE_RECEIVED),
            line(stringResource(R.string.speed_network_out), UploadColor, SpeedMetric.PEER_WIRE_SENT),
        )
    val rangeLabel =
        stringResource(SpeedRangeOptions.firstOrNull { it.range == range }?.long ?: R.string.speed_range_2m_long)
    val bucketMillis = history?.bucketMillis?.toULongOrNull()?.takeIf { it > 0UL } ?: 1_000UL

    ProductRouteScaffold(stringResource(R.string.speed_title), onBack) {
        item("headline") {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                transfer.forEach { entry ->
                    RateHeadline(entry, Modifier.weight(1f))
                }
            }
        }
        item("ranges") {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SpeedRangeOptions.forEach { option ->
                    FilterChip(
                        selected = option.range == range,
                        onClick = { onRangeChange(option.range) },
                        label = { Text(stringResource(option.short)) },
                    )
                }
            }
        }
        if (history == null) {
            item("loading") { RouteMessage(stringResource(R.string.speed_loading)) }
            return@ProductRouteScaffold
        }
        item("transfer") {
            SpeedChartCard(null, null, transfer, bucketMillis, rangeLabel, chartHeight = 160.dp)
        }
        item("details-toggle") {
            TextButton(
                onClick = { showDetails = !showDetails },
                modifier = Modifier.padding(horizontal = 8.dp),
            ) {
                Text(stringResource(if (showDetails) R.string.speed_hide_details else R.string.speed_show_details))
                Icon(
                    if (showDetails) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = null,
                )
            }
        }
        if (showDetails) {
            item("disk") {
                SpeedChartCard(
                    stringResource(R.string.speed_disk),
                    stringResource(R.string.speed_disk_help),
                    disk,
                    bucketMillis,
                    rangeLabel,
                    chartHeight = 96.dp,
                )
            }
            item("network") {
                SpeedChartCard(
                    stringResource(R.string.speed_network),
                    stringResource(R.string.speed_network_help),
                    network,
                    bucketMillis,
                    rangeLabel,
                    chartHeight = 96.dp,
                )
            }
        }
        item("bottom") { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun RateHeadline(
    line: SpeedLine,
    modifier: Modifier,
) {
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(8.dp).background(line.color, CircleShape))
            Spacer(Modifier.width(6.dp))
            Text(
                line.label,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            formatRate(line.currentRate),
            style = MaterialTheme.typography.headlineSmall.merge(Numeric),
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            softWrap = false,
        )
    }
}

@Composable
private fun SpeedChartCard(
    title: String?,
    help: String?,
    lines: List<SpeedLine>,
    bucketMillis: ULong,
    rangeLabel: String,
    chartHeight: androidx.compose.ui.unit.Dp,
) {
    val rateLines = lines.map { line -> line to seriesRates(line.series, bucketMillis) }
    val peak = rateLines.flatMap { (_, rates) -> rates.filterNotNull() }.maxOrNull() ?: 0.0
    val axisColor = MaterialTheme.colorScheme.outlineVariant
    val mutedText = MaterialTheme.colorScheme.onSurfaceVariant
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
        Column(Modifier.padding(14.dp)) {
            if (title != null) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                if (help != null) {
                    Text(help, style = MaterialTheme.typography.bodySmall, color = mutedText)
                }
                Spacer(Modifier.height(10.dp))
            }
            Text(
                formatRate(peak.toLong().toString()),
                style = MaterialTheme.typography.labelSmall.merge(Numeric),
                color = mutedText,
                maxLines = 1,
            )
            SpeedChart(
                rateLines.map { (line, rates) -> line.color to rates },
                peak,
                axisColor,
                Modifier.fillMaxWidth().height(chartHeight).padding(vertical = 4.dp),
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    stringResource(R.string.speed_ago, rangeLabel),
                    style = MaterialTheme.typography.labelSmall,
                    color = mutedText,
                )
                Text(stringResource(R.string.speed_now), style = MaterialTheme.typography.labelSmall, color = mutedText)
            }
            Spacer(Modifier.height(12.dp))
            rateLines.forEachIndexed { index, (line, rates) ->
                if (index > 0) HorizontalDivider(Modifier.padding(vertical = 10.dp))
                SpeedLegendRow(line, rates, bucketMillis)
            }
        }
    }
}

@Composable
private fun SpeedLegendRow(
    line: SpeedLine,
    rates: List<Double?>,
    bucketMillis: ULong,
) {
    val covered = rates.filterNotNull()
    val average = if (covered.isEmpty()) 0.0 else covered.average()
    val peak = covered.maxOrNull() ?: 0.0
    val total = covered.sum() * bucketMillis.toDouble() / 1_000.0
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).background(line.color, CircleShape))
            Spacer(Modifier.width(10.dp))
            Text(
                line.label,
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            Text(
                formatRate(line.currentRate),
                style = MaterialTheme.typography.titleSmall.merge(Numeric),
                textAlign = TextAlign.End,
                maxLines = 1,
                softWrap = false,
            )
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth().padding(start = 20.dp)) {
            SpeedStat(stringResource(R.string.speed_average), formatRate(average.toLong().toString()), Modifier.weight(1f))
            SpeedStat(stringResource(R.string.speed_peak), formatRate(peak.toLong().toString()), Modifier.weight(1f))
            SpeedStat(stringResource(R.string.speed_total), formatBytes(total.toLong().toString()), Modifier.weight(1f))
        }
    }
}

@Composable
private fun SpeedStat(
    label: String,
    value: String,
    modifier: Modifier,
) {
    Column(modifier) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium.merge(Numeric),
            maxLines = 1,
            softWrap = false,
        )
    }
}

/** Converts per-bucket byte counts to bytes per second; null marks an uncovered bucket. */
private fun seriesRates(
    series: SpeedSeriesView?,
    bucketMillis: ULong,
): List<Double?> =
    series?.values?.map { value ->
        value?.toULongOrNull()?.let { it.toDouble() * 1_000.0 / bucketMillis.toDouble() }
    }.orEmpty()

@Composable
private fun SpeedChart(
    lines: List<Pair<Color, List<Double?>>>,
    peak: Double,
    axisColor: Color,
    modifier: Modifier,
) {
    Canvas(modifier) {
        val stroke = 1.dp.toPx()
        listOf(0f, 0.5f, 1f).forEach { fraction ->
            val y = size.height * fraction
            drawLine(axisColor, Offset(0f, y), Offset(size.width, y), strokeWidth = stroke)
        }
        val maximum = peak.takeIf { it > 0.0 } ?: 1.0
        lines.forEachIndexed { index, (color, values) ->
            if (values.size < 2) return@forEachIndexed
            val step = size.width / (values.size - 1)
            var segment: Path? = null
            var fill: Path? = null
            var segmentStartX = 0f
            var lastX = 0f
            fun closeFill() {
                val area = fill ?: return
                area.lineTo(lastX, size.height)
                area.lineTo(segmentStartX, size.height)
                area.close()
                if (index == 0) drawPath(area, color.copy(alpha = 0.15f))
                drawPath(segment!!, color, style = Stroke(2.dp.toPx()))
                segment = null
                fill = null
            }
            values.forEachIndexed { point, value ->
                if (value == null) {
                    closeFill()
                    return@forEachIndexed
                }
                val x = step * point
                val y = size.height - (value / maximum * size.height).toFloat()
                if (segment == null) {
                    segment = Path().apply { moveTo(x, y) }
                    fill = Path().apply { moveTo(x, y) }
                    segmentStartX = x
                } else {
                    segment!!.lineTo(x, y)
                    fill!!.lineTo(x, y)
                }
                lastX = x
            }
            closeFill()
        }
    }
}

@Composable
internal fun DhtScreen(
    inspection: DhtInspectionView?,
    onBack: () -> Unit,
) {
    ProductRouteScaffold(stringResource(R.string.library_menu_dht), onBack) {
        if (inspection == null) {
            item("loading") { RouteMessage(stringResource(R.string.dht_loading)) }
        } else {
            item("summary") {
                Column(Modifier.fillMaxWidth().padding(16.dp)) {
                    Text(
                        stringResource(
                            R.string.dht_state_summary,
                            inspection.lifecycle.name.lowercase(),
                            inspection.networkPolicy.name.lowercase(),
                        ),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        stringResource(
                            R.string.dht_summary,
                            inspection.activeTransactions.toLong(),
                            inspection.activeLookups.toLong(),
                            inspection.discoveredPeers.toLong(),
                        ),
                    )
                }
                HorizontalDivider()
            }
            items(inspection.families, key = { it.family.name }) { family ->
                ListItem(
                    headlineContent = { Text(family.family.name) },
                    supportingContent = {
                        Column {
                            Text(
                                stringResource(
                                    R.string.dht_family_summary,
                                    family.lifecycle.name.lowercase(),
                                    family.routingNodes.toLong(),
                                    family.occupiedBuckets.toLong(),
                                ),
                            )
                            Text(
                                family.observedExternalAddress ?: family.localAddress,
                                fontFamily = FontFamily.Monospace,
                            )
                        }
                    },
                )
                HorizontalDivider()
            }
            item("traffic") {
                ListItem(
                    headlineContent = { Text(stringResource(R.string.dht_traffic)) },
                    supportingContent = {
                        Text(
                            stringResource(
                                R.string.dht_traffic_summary,
                                formatBytes(inspection.datagramBytesSent),
                                formatBytes(inspection.datagramBytesReceived),
                                inspection.malformedReceived.toLong(),
                                inspection.rateLimited.toLong(),
                            ),
                        )
                    },
                )
            }
        }
    }
}

@Composable
private fun ProductRouteScaffold(
    title: String,
    onBack: () -> Unit,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.action_back),
                        )
                    }
                },
            )
        },
    ) { padding -> LazyColumn(Modifier.fillMaxSize().padding(padding), content = content) }
}

@Composable
private fun RouteMessage(message: String) {
    Box(Modifier.fillMaxWidth().padding(24.dp)) {
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
