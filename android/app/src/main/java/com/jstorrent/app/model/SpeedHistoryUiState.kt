package com.jstorrent.app.model

import com.jstorrent.quickjs.model.SpeedSample

/**
 * UI state for the Speed History screen.
 */
sealed class SpeedHistoryUiState {
    /**
     * Initial loading state.
     */
    data object Loading : SpeedHistoryUiState()

    /**
     * Speed data loaded and ready to display.
     */
    data class Loaded(
        val downloadSamples: List<SpeedSample>,
        val uploadSamples: List<SpeedSample>,
        val diskWriteSamples: List<SpeedSample>,
        val bucketMs: Long,
        val currentDownloadRate: Long,
        val currentUploadRate: Long,
        val currentDiskWriteRate: Long,
        val nowMs: Long
    ) : SpeedHistoryUiState()

    /**
     * Error state.
     */
    data class Error(val message: String) : SpeedHistoryUiState()
}

/**
 * Available time windows for the speed chart.
 */
enum class TimeWindow(val durationMs: Long, val label: String) {
    ONE_MINUTE(60_000L, "1m"),
    TEN_MINUTES(600_000L, "10m"),
    THIRTY_MINUTES(1_800_000L, "30m")
}
