package com.jstorrent.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jstorrent.app.model.TorrentFilter
import com.jstorrent.app.model.TorrentListUiState
import com.jstorrent.app.model.TorrentSortOrder
import com.jstorrent.app.model.filterByStatus
import com.jstorrent.app.model.sortByOrder
import com.jstorrent.quickjs.model.TorrentSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * ViewModel for the torrent list screen.
 * Manages torrent list state, filtering, and sorting.
 */
class TorrentListViewModel(
    private val repository: TorrentRepository
) : ViewModel() {

    // Filter and sort state
    private val _filter = MutableStateFlow(TorrentFilter.ALL)
    val filter: StateFlow<TorrentFilter> = _filter

    private val _sortOrder = MutableStateFlow(TorrentSortOrder.QUEUE_ORDER)
    val sortOrder: StateFlow<TorrentSortOrder> = _sortOrder

    // Selection state for multi-select mode
    private val _selectedTorrents = MutableStateFlow<Set<String>>(emptySet())
    val selectedTorrents: StateFlow<Set<String>> = _selectedTorrents.asStateFlow()

    val isSelectionMode: StateFlow<Boolean> = _selectedTorrents.map { it.isNotEmpty() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    // Combined UI state
    val uiState: StateFlow<TorrentListUiState> = combine(
        repository.isLoaded,
        repository.state,
        repository.lastError,
        _filter,
        _sortOrder
    ) { isLoaded, state, error, filter, sortOrder ->
        when {
            error != null && !isLoaded -> TorrentListUiState.Error(error)
            !isLoaded -> TorrentListUiState.Loading
            else -> {
                val torrents = state?.torrents ?: emptyList()
                val filteredTorrents = torrents
                    .filterByStatus(filter)
                    .sortByOrder(sortOrder)
                TorrentListUiState.Loaded(
                    torrents = filteredTorrents,
                    filter = filter,
                    sortOrder = sortOrder
                )
            }
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = TorrentListUiState.Loading
    )

    /**
     * Aggregate download speed across all torrents (bytes/sec).
     * Updates every 500ms when engine state changes.
     */
    val aggregateDownloadSpeed: StateFlow<Long> = repository.state.map { state ->
        state?.torrents?.sumOf { it.downloadSpeed } ?: 0L
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = 0L
    )

    /**
     * Aggregate upload speed across all torrents (bytes/sec).
     * Updates every 500ms when engine state changes.
     */
    val aggregateUploadSpeed: StateFlow<Long> = repository.state.map { state ->
        state?.torrents?.sumOf { it.uploadSpeed } ?: 0L
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = 0L
    )

    /**
     * Filter counts for each filter type.
     * Exposed as StateFlow so Compose can observe and recompose when counts change.
     */
    val filterCounts: StateFlow<Map<TorrentFilter, Int>> = repository.state.map { state ->
        val torrents = state?.torrents ?: emptyList()
        TorrentFilter.entries.associateWith { filter ->
            torrents.filterByStatus(filter).size
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = TorrentFilter.entries.associateWith { 0 }
    )

    /**
     * Set the filter for the torrent list.
     */
    fun setFilter(filter: TorrentFilter) {
        _filter.value = filter
    }

    /**
     * Set the sort order for the torrent list.
     */
    fun setSortOrder(sortOrder: TorrentSortOrder) {
        _sortOrder.value = sortOrder
    }

    /**
     * Add a torrent from magnet link or base64 data.
     */
    fun addTorrent(magnetOrBase64: String) {
        if (magnetOrBase64.isBlank()) return
        repository.addTorrent(magnetOrBase64)
    }

    /**
     * Pause a torrent by info hash.
     */
    fun pauseTorrent(infoHash: String) {
        repository.pauseTorrent(infoHash)
    }

    /**
     * Resume a torrent by info hash.
     */
    fun resumeTorrent(infoHash: String) {
        repository.resumeTorrent(infoHash)
    }

    /**
     * Remove a torrent by info hash.
     */
    fun removeTorrent(infoHash: String, deleteFiles: Boolean = false) {
        repository.removeTorrent(infoHash, deleteFiles)
    }

    /**
     * Pause all torrents.
     */
    fun pauseAll() {
        repository.pauseAll()
    }

    /**
     * Resume all torrents.
     */
    fun resumeAll() {
        repository.resumeAll()
    }

    /**
     * Get the count of torrents matching a specific filter.
     * Useful for displaying badge counts on filter tabs.
     */
    fun getFilterCount(filter: TorrentFilter): Int {
        val state = uiState.value
        if (state !is TorrentListUiState.Loaded) return 0

        // We need unfiltered list, get from repository
        val allTorrents = repository.state.value?.torrents ?: return 0
        return allTorrents.filterByStatus(filter).size
    }

    /**
     * Check if a torrent is paused.
     */
    fun isPaused(torrent: TorrentSummary): Boolean {
        return torrent.status == "stopped"
    }

    // =========================================================================
    // Selection mode methods
    // =========================================================================

    /**
     * Select a torrent (enters selection mode if not already).
     */
    fun selectTorrent(infoHash: String) {
        _selectedTorrents.value = _selectedTorrents.value + infoHash
    }

    /**
     * Toggle selection state for a torrent.
     */
    fun toggleSelection(infoHash: String) {
        _selectedTorrents.value = if (infoHash in _selectedTorrents.value) {
            _selectedTorrents.value - infoHash
        } else {
            _selectedTorrents.value + infoHash
        }
    }

    /**
     * Clear all selections (exits selection mode).
     */
    fun clearSelection() {
        _selectedTorrents.value = emptySet()
    }

    /**
     * Pause all selected torrents.
     */
    fun pauseSelected() {
        _selectedTorrents.value.forEach { hash ->
            repository.pauseTorrent(hash)
        }
        clearSelection()
    }

    /**
     * Resume all selected torrents.
     */
    fun resumeSelected() {
        _selectedTorrents.value.forEach { hash ->
            repository.resumeTorrent(hash)
        }
        clearSelection()
    }

    /**
     * Remove all selected torrents.
     */
    fun removeSelected(deleteFiles: Boolean) {
        _selectedTorrents.value.forEach { hash ->
            repository.removeTorrent(hash, deleteFiles)
        }
        clearSelection()
    }

    /**
     * Factory for creating TorrentListViewModel with dependencies.
     */
    class Factory(
        private val application: android.app.Application
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TorrentListViewModel::class.java)) {
                return TorrentListViewModel(EngineServiceRepository(application)) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
