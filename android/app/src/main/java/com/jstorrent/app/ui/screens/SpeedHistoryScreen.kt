package com.jstorrent.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.jstorrent.app.model.SpeedHistoryUiState
import com.jstorrent.app.model.TimeWindow
import com.jstorrent.app.ui.components.SpeedChart
import com.jstorrent.app.viewmodel.SpeedHistoryViewModel

/**
 * Speed History screen showing download/upload speeds over time.
 * Displays a chart with configurable time window and current rates.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SpeedHistoryScreen(
    viewModel: SpeedHistoryViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val timeWindow by viewModel.timeWindow.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Speed History") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        when (val state = uiState) {
            is SpeedHistoryUiState.Loading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
            is SpeedHistoryUiState.Error -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = state.message,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
            is SpeedHistoryUiState.Loaded -> {
                SpeedHistoryContent(
                    state = state,
                    timeWindow = timeWindow,
                    onTimeWindowChange = { viewModel.setTimeWindow(it) },
                    modifier = Modifier.padding(innerPadding)
                )
            }
        }
    }
}

@Composable
private fun SpeedHistoryContent(
    state: SpeedHistoryUiState.Loaded,
    timeWindow: TimeWindow,
    onTimeWindowChange: (TimeWindow) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        // Time window selector
        TimeWindowSelector(
            selectedWindow = timeWindow,
            onWindowSelected = onTimeWindowChange
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Speed chart
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            )
        ) {
            SpeedChart(
                downloadSamples = state.downloadSamples,
                uploadSamples = state.uploadSamples,
                diskWriteSamples = state.diskWriteSamples,
                bucketMs = state.bucketMs,
                timeWindowMs = timeWindow.durationMs,
                nowMs = state.nowMs,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp)
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Current rates display
        CurrentRatesCard(
            downloadRate = state.currentDownloadRate,
            uploadRate = state.currentUploadRate,
            diskWriteRate = state.currentDiskWriteRate
        )

        Spacer(modifier = Modifier.height(16.dp))

        // JS Thread health stats
        JsThreadHealthCard(
            currentLatencyMs = state.jsCurrentLatencyMs,
            maxLatencyMs = state.jsMaxLatencyMs,
            queueDepth = state.jsQueueDepth,
            maxQueueDepth = state.jsMaxQueueDepth
        )
    }
}

@Composable
private fun TimeWindowSelector(
    selectedWindow: TimeWindow,
    onWindowSelected: (TimeWindow) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        TimeWindow.entries.forEach { window ->
            FilterChip(
                selected = window == selectedWindow,
                onClick = { onWindowSelected(window) },
                label = { Text(window.label) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        }
    }
}

@Composable
private fun CurrentRatesCard(
    downloadRate: Long,
    uploadRate: Long,
    diskWriteRate: Long,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Network rates row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                // Download rate
                RateDisplay(
                    icon = Icons.Default.ArrowDownward,
                    iconColor = Color(0xFF22C55E), // Green - matches chart
                    label = "Download",
                    rate = downloadRate
                )

                // Upload rate
                RateDisplay(
                    icon = Icons.Default.ArrowUpward,
                    iconColor = Color(0xFF3B82F6), // Blue - matches chart
                    label = "Upload",
                    rate = uploadRate
                )
            }

            // Disk rate row (centered)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center
            ) {
                RateDisplay(
                    icon = Icons.Default.Storage,
                    iconColor = Color(0xFFF59E0B), // Amber - matches chart
                    label = "Disk Write",
                    rate = diskWriteRate
                )
            }
        }
    }
}

@Composable
private fun RateDisplay(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconColor: Color,
    label: String,
    rate: Long,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = iconColor
            )
            Text(
                text = formatSpeed(rate),
                style = MaterialTheme.typography.titleLarge,
                fontFamily = FontFamily.Monospace
            )
        }
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun JsThreadHealthCard(
    currentLatencyMs: Long,
    maxLatencyMs: Long,
    queueDepth: Int,
    maxQueueDepth: Int,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Header
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Memory,
                    contentDescription = "JS Thread",
                    tint = Color(0xFF8B5CF6) // Purple
                )
                Text(
                    text = "JS Thread Health",
                    style = MaterialTheme.typography.titleMedium
                )
            }

            // Stats row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                // Latency
                StatDisplay(
                    label = "Latency",
                    value = formatLatency(currentLatencyMs),
                    subValue = "max: ${formatLatency(maxLatencyMs)}",
                    isWarning = currentLatencyMs > 1000
                )

                // Queue depth
                StatDisplay(
                    label = "Queue",
                    value = queueDepth.toString(),
                    subValue = "max: $maxQueueDepth",
                    isWarning = queueDepth > 50
                )
            }
        }
    }
}

@Composable
private fun StatDisplay(
    label: String,
    value: String,
    subValue: String,
    isWarning: Boolean,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge,
            fontFamily = FontFamily.Monospace,
            color = if (isWarning) Color(0xFFEF4444) else MaterialTheme.colorScheme.onSurface
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = subValue,
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
        )
    }
}

/**
 * Formats latency in milliseconds to human-readable string.
 */
private fun formatLatency(ms: Long): String {
    return when {
        ms >= 1000 -> String.format("%.1fs", ms / 1000.0)
        else -> "${ms}ms"
    }
}

/**
 * Formats bytes per second to human-readable speed string.
 */
private fun formatSpeed(bytesPerSec: Long): String {
    val kb = 1024.0
    val mb = kb * 1024
    val gb = mb * 1024

    return when {
        bytesPerSec >= gb -> String.format("%.1f GB/s", bytesPerSec / gb)
        bytesPerSec >= mb -> String.format("%.1f MB/s", bytesPerSec / mb)
        bytesPerSec >= kb -> String.format("%.1f KB/s", bytesPerSec / kb)
        else -> "$bytesPerSec B/s"
    }
}
