package com.jstorrent.app.viewmodel

import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jstorrent.app.model.SpeedHistoryUiState
import com.jstorrent.app.model.TimeWindow
import com.jstorrent.quickjs.model.SpeedSample
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel for the Speed History screen.
 * Polls speed samples from the engine and manages time window state.
 */
class SpeedHistoryViewModel(
    private val repository: TorrentRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<SpeedHistoryUiState>(SpeedHistoryUiState.Loading)
    val uiState: StateFlow<SpeedHistoryUiState> = _uiState.asStateFlow()

    private val _timeWindow = MutableStateFlow(TimeWindow.ONE_MINUTE)
    val timeWindow: StateFlow<TimeWindow> = _timeWindow.asStateFlow()

    init {
        // Poll speed samples every 1.5 seconds
        viewModelScope.launch {
            while (true) {
                fetchSpeedSamples()
                delay(1500)
            }
        }
    }

    /**
     * Change the time window for the chart.
     */
    fun setTimeWindow(window: TimeWindow) {
        _timeWindow.value = window
        // Immediately fetch new data for the new window
        viewModelScope.launch {
            fetchSpeedSamples()
        }
    }

    private suspend fun fetchSpeedSamples() {
        try {
            val now = System.currentTimeMillis()
            val window = _timeWindow.value
            val fromTime = now - window.durationMs

            // Fetch both download and upload samples in parallel
            val downloadResult = repository.getSpeedSamples(
                direction = "down",
                categories = "all",
                fromTime = fromTime,
                toTime = now,
                maxPoints = 300
            )

            val uploadResult = repository.getSpeedSamples(
                direction = "up",
                categories = "all",
                fromTime = fromTime,
                toTime = now,
                maxPoints = 300
            )

            if (downloadResult != null || uploadResult != null) {
                // Calculate current rates from the most recent samples
                val currentDownloadRate = downloadResult?.samples?.lastOrNull()?.value?.toLong() ?: 0L
                val currentUploadRate = uploadResult?.samples?.lastOrNull()?.value?.toLong() ?: 0L

                _uiState.value = SpeedHistoryUiState.Loaded(
                    downloadSamples = downloadResult?.samples ?: emptyList(),
                    uploadSamples = uploadResult?.samples ?: emptyList(),
                    bucketMs = downloadResult?.bucketMs ?: uploadResult?.bucketMs ?: 500L,
                    currentDownloadRate = currentDownloadRate,
                    currentUploadRate = currentUploadRate
                )
            } else {
                // No data yet but engine might not be ready
                if (_uiState.value is SpeedHistoryUiState.Loading) {
                    // Keep loading state
                } else {
                    // Show empty data
                    _uiState.value = SpeedHistoryUiState.Loaded(
                        downloadSamples = emptyList(),
                        uploadSamples = emptyList(),
                        bucketMs = 500L,
                        currentDownloadRate = 0L,
                        currentUploadRate = 0L
                    )
                }
            }
        } catch (e: Exception) {
            _uiState.value = SpeedHistoryUiState.Error(e.message ?: "Unknown error")
        }
    }

    /**
     * Factory for creating SpeedHistoryViewModel with dependencies.
     */
    class Factory(
        private val application: Application
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(SpeedHistoryViewModel::class.java)) {
                return SpeedHistoryViewModel(EngineServiceRepository(application)) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
