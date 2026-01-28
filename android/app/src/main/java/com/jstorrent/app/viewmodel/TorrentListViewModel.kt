package com.jstorrent.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jstorrent.app.cache.TorrentSummaryCache
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
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * ViewModel for the torrent list screen.
 * Manages torrent list state, filtering, and sorting.
 *
 * Stage 1 of lazy engine startup: Uses TorrentSummaryCache as initial data source.
 * Stage 2 of lazy engine startup: Engine starts on demand when user takes action.
 * Engine state always wins when available.
 */
class TorrentListViewModel(
    private val repository: TorrentRepository,
    private val cache: TorrentSummaryCache? = null,
    private val onEnsureEngineStarted: () -> Unit = {}
) : ViewModel() {

    init {
        // Load cache asynchronously on initialization
        cache?.let { summaryCache ->
            viewModelScope.launch {
                summaryCache.load()
            }
        }
    }

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

    // Flow of cached summaries (empty list if no cache provided)
    private val cachedSummariesFlow = cache?.summaries ?: flowOf(emptyList())
    // If no cache provided, treat as "not loaded" - must wait for engine
    private val cacheIsLoadedFlow = cache?.isLoaded ?: flowOf(false)

    // Combined data source flow - combines engine state with cache fallback
    private val dataSourceFlow = combine(
        repository.isLoaded,
        repository.state,
        repository.lastError,
        cachedSummariesFlow,
        cacheIsLoadedFlow
    ) { isLoaded, state, error, cachedSummaries, cacheIsLoaded ->
        DataSourceState(isLoaded, state, error, cachedSummaries, cacheIsLoaded)
    }

    // Combined UI state - engine state wins when available, falls back to cache
    val uiState: StateFlow<TorrentListUiState> = combine(
        dataSourceFlow,
        _filter,
        _sortOrder
    ) { dataSource, filter, sortOrder ->
        when {
            // Error state (only show if engine hasn't loaded yet)
            dataSource.error != null && !dataSource.isLoaded ->
                TorrentListUiState.Error(dataSource.error)

            // Engine is loaded - use live state (engine wins)
            dataSource.isLoaded -> {
                val torrents = dataSource.state?.torrents ?: emptyList()
                val filteredTorrents = torrents
                    .filterByStatus(filter)
                    .sortByOrder(sortOrder)
                TorrentListUiState.Loaded(
                    torrents = filteredTorrents,
                    filter = filter,
                    sortOrder = sortOrder
                )
            }

            // Engine not loaded but cache has data - show cached
            dataSource.cachedSummaries.isNotEmpty() -> {
                val torrents = dataSource.cachedSummaries.map { cached ->
                    with(cache!!) { cached.toTorrentSummary() }
                }
                val filteredTorrents = torrents
                    .filterByStatus(filter)
                    .sortByOrder(sortOrder)
                TorrentListUiState.Loaded(
                    torrents = filteredTorrents,
                    filter = filter,
                    sortOrder = sortOrder
                )
            }

            // Cache has loaded but is empty - show empty list (not loading spinner)
            dataSource.cacheIsLoaded -> {
                TorrentListUiState.Loaded(
                    torrents = emptyList(),
                    filter = filter,
                    sortOrder = sortOrder
                )
            }

            // Cache still loading - show loading spinner
            else -> TorrentListUiState.Loading
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = TorrentListUiState.Loading
    )

    // Helper data class for combining engine + cache state
    private data class DataSourceState(
        val isLoaded: Boolean,
        val state: com.jstorrent.quickjs.model.EngineState?,
        val error: String?,
        val cachedSummaries: List<com.jstorrent.app.cache.CachedTorrentSummary>,
        val cacheIsLoaded: Boolean
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
     * Stage 2: Starts engine on demand if not running.
     */
    fun addTorrent(magnetOrBase64: String) {
        if (magnetOrBase64.isBlank()) return
        onEnsureEngineStarted()
        repository.addTorrent(magnetOrBase64)
    }

    /**
     * Replace an existing torrent (if present) and add/start fresh.
     * This removes any existing torrent with the same infohash before adding,
     * ensuring the torrent starts in active state.
     * Stage 2: Starts engine on demand if not running.
     */
    fun replaceAndStartTorrent(magnetOrBase64: String) {
        if (magnetOrBase64.isBlank()) return
        onEnsureEngineStarted()
        val infoHash = extractInfoHash(magnetOrBase64)
        // Use viewModelScope to properly sequence remove -> add
        viewModelScope.launch {
            repository.replaceAndAddTorrent(magnetOrBase64, infoHash)
        }
    }

    companion object {
        /**
         * Extract infohash from a magnet link.
         * Returns null if not a valid magnet link.
         */
        fun extractInfoHash(magnetOrBase64: String): String? {
            val magnet = magnetOrBase64.trim()
            if (!magnet.startsWith("magnet:?", ignoreCase = true)) {
                return null
            }
            // Find xt=urn:btih: parameter
            val btihPrefix = "xt=urn:btih:"
            val startIdx = magnet.indexOf(btihPrefix, ignoreCase = true)
            if (startIdx < 0) return null
            val hashStart = startIdx + btihPrefix.length
            // Find end of hash (& or end of string)
            val hashEnd = magnet.indexOf('&', hashStart).let { if (it < 0) magnet.length else it }
            val hash = magnet.substring(hashStart, hashEnd)
            // Infohash should be 40 hex chars (SHA1) or 32 base32 chars
            return if (hash.length == 40 || hash.length == 32) hash.lowercase() else null
        }
    }

    /**
     * Pause a torrent by info hash.
     * Stage 2: Starts engine on demand if not running.
     */
    fun pauseTorrent(infoHash: String) {
        onEnsureEngineStarted()
        repository.pauseTorrent(infoHash)
    }

    /**
     * Resume a torrent by info hash.
     * Stage 2: Starts engine on demand if not running.
     */
    fun resumeTorrent(infoHash: String) {
        onEnsureEngineStarted()
        repository.resumeTorrent(infoHash)
    }

    /**
     * Remove a torrent by info hash.
     * Stage 2: Starts engine on demand if not running.
     */
    fun removeTorrent(infoHash: String, deleteFiles: Boolean = false) {
        onEnsureEngineStarted()
        repository.removeTorrent(infoHash, deleteFiles)
    }

    /**
     * Pause all torrents.
     * Stage 2: Starts engine on demand if not running.
     */
    fun pauseAll() {
        onEnsureEngineStarted()
        repository.pauseAll()
    }

    /**
     * Resume all torrents.
     * Stage 2: Starts engine on demand if not running.
     */
    fun resumeAll() {
        onEnsureEngineStarted()
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
                val app = application as com.jstorrent.app.JSTorrentApplication
                return TorrentListViewModel(
                    repository = EngineServiceRepository(application),
                    cache = app.torrentSummaryCache,
                    onEnsureEngineStarted = { app.ensureEngineStarted() }
                ) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
