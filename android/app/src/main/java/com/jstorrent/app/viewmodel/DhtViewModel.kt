package com.jstorrent.app.viewmodel

import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jstorrent.quickjs.model.DhtStats
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * ViewModel for the DHT Info screen.
 * Polls DHT statistics from the engine.
 */
class DhtViewModel(
    private val repository: TorrentRepository
) : ViewModel() {

    private val _stats = MutableStateFlow<DhtStats?>(null)
    val stats: StateFlow<DhtStats?> = _stats.asStateFlow()

    private val _isLoading = MutableStateFlow(true)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    init {
        // Poll DHT stats every 1.5 seconds
        viewModelScope.launch {
            while (true) {
                try {
                    val dhtStats = repository.getDhtStats()
                    _stats.value = dhtStats
                    _isLoading.value = false
                } catch (e: Exception) {
                    // Ignore errors, keep polling
                }
                delay(1500)
            }
        }
    }

    /**
     * Factory for creating DhtViewModel with dependencies.
     */
    class Factory(
        private val application: Application
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(DhtViewModel::class.java)) {
                return DhtViewModel(EngineServiceRepository(application)) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
