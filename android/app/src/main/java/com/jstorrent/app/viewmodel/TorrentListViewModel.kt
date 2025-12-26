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
import kotlinx.coroutines.flow.combine
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
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = TorrentListUiState.Loading
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

    /**
     * Factory for creating TorrentListViewModel with dependencies.
     */
    class Factory(
        private val repository: TorrentRepository = EngineServiceRepository()
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TorrentListViewModel::class.java)) {
                return TorrentListViewModel(repository) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
