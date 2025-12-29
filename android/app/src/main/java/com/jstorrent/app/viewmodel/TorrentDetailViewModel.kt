package com.jstorrent.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jstorrent.app.model.DetailTab
import com.jstorrent.app.model.DhtStatus
import com.jstorrent.app.model.PeerUi
import com.jstorrent.app.model.TorrentDetailUi
import com.jstorrent.app.model.TorrentDetailUiState
import com.jstorrent.app.model.TorrentFileUi
import com.jstorrent.app.model.TrackerStatus
import com.jstorrent.app.model.TrackerUi
import com.jstorrent.app.model.toUi
import com.jstorrent.quickjs.model.TorrentSummary
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.TrackerInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * ViewModel for the torrent detail screen.
 * Manages torrent details, files, peers, and trackers.
 */
class TorrentDetailViewModel(
    private val repository: TorrentRepository,
    private val infoHash: String
) : ViewModel() {

    // Selected tab
    private val _selectedTab = MutableStateFlow(DetailTab.STATUS)
    val selectedTab: StateFlow<DetailTab> = _selectedTab

    // File selection state (file index -> isSelected)
    private val _fileSelections = MutableStateFlow<Map<Int, Boolean>>(emptyMap())
    val fileSelections: StateFlow<Map<Int, Boolean>> = _fileSelections

    // Cached files (fetched asynchronously)
    private val _cachedFiles = MutableStateFlow<List<FileInfo>>(emptyList())

    // Cached trackers (fetched asynchronously)
    private val _cachedTrackers = MutableStateFlow<List<TrackerInfo>>(emptyList())

    init {
        // Fetch files and trackers when engine state changes
        viewModelScope.launch {
            repository.state.collect { state ->
                if (state?.torrents?.any { it.infoHash == infoHash } == true) {
                    _cachedFiles.value = repository.getFiles(infoHash)
                    _cachedTrackers.value = repository.getTrackers(infoHash)
                }
            }
        }
    }

    // Combined UI state
    val uiState: StateFlow<TorrentDetailUiState> = combine(
        repository.isLoaded,
        repository.state,
        repository.lastError,
        _selectedTab,
        _fileSelections,
        _cachedFiles,
        _cachedTrackers
    ) { values ->
        val isLoaded = values[0] as Boolean
        val state = values[1] as? com.jstorrent.quickjs.model.EngineState
        val error = values[2] as? String
        val tab = values[3] as DetailTab
        @Suppress("UNCHECKED_CAST")
        val selections = values[4] as Map<Int, Boolean>
        @Suppress("UNCHECKED_CAST")
        val files = values[5] as List<FileInfo>
        @Suppress("UNCHECKED_CAST")
        val trackers = values[6] as List<TrackerInfo>
        when {
            error != null && !isLoaded -> TorrentDetailUiState.Error(error)
            !isLoaded -> TorrentDetailUiState.Loading
            else -> {
                val torrent = state?.torrents?.find { it.infoHash == infoHash }
                if (torrent == null) {
                    TorrentDetailUiState.Error("Torrent not found")
                } else {
                    TorrentDetailUiState.Loaded(
                        torrent = createTorrentDetailUi(torrent, selections, files, trackers),
                        selectedTab = tab
                    )
                }
            }
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = TorrentDetailUiState.Loading
    )

    /**
     * Set the selected tab.
     */
    fun setSelectedTab(tab: DetailTab) {
        _selectedTab.value = tab
    }

    /**
     * Toggle file selection for a specific file.
     */
    fun toggleFileSelection(fileIndex: Int) {
        val currentSelections = _fileSelections.value.toMutableMap()
        val currentValue = currentSelections[fileIndex] ?: true
        currentSelections[fileIndex] = !currentValue
        _fileSelections.value = currentSelections

        // TODO: Call engine to update file priority when file skipping is implemented
    }

    /**
     * Select all files in the torrent.
     */
    fun selectAllFiles() {
        viewModelScope.launch {
            val files = repository.getFiles(infoHash)
            val selections = files.associate { it.index to true }
            _fileSelections.value = selections
        }
    }

    /**
     * Deselect all files in the torrent.
     */
    fun deselectAllFiles() {
        viewModelScope.launch {
            val files = repository.getFiles(infoHash)
            val selections = files.associate { it.index to false }
            _fileSelections.value = selections
        }
    }

    /**
     * Pause the current torrent.
     */
    fun pause() {
        repository.pauseTorrent(infoHash)
    }

    /**
     * Resume the current torrent.
     */
    fun resume() {
        repository.resumeTorrent(infoHash)
    }

    /**
     * Remove the current torrent.
     */
    fun remove(deleteFiles: Boolean = false) {
        repository.removeTorrent(infoHash, deleteFiles)
    }

    /**
     * Check if the torrent is currently paused.
     */
    fun isPaused(): Boolean {
        val state = uiState.value
        return if (state is TorrentDetailUiState.Loaded) {
            state.torrent.status == "stopped"
        } else {
            false
        }
    }

    /**
     * Create the full detail UI model from torrent summary.
     */
    private fun createTorrentDetailUi(
        summary: TorrentSummary,
        fileSelections: Map<Int, Boolean>,
        files: List<FileInfo>,
        trackers: List<TrackerInfo>
    ): TorrentDetailUi {
        val fileUis = files.map { file ->
            val isSelected = fileSelections[file.index] ?: true
            file.toUi(isSelected)
        }

        // Map tracker info to UI models
        val trackerUis = trackers.map { tracker ->
            TrackerUi(
                url = tracker.url,
                status = mapTrackerStatus(tracker.status),
                message = tracker.lastError,
                peers = (tracker.seeders ?: 0) + (tracker.leechers ?: 0)
            )
        }

        // Calculate totals from files
        val totalSize = files.sumOf { it.size }
        val downloaded = files.sumOf { it.downloaded }
        val uploaded = (downloaded * 0.1).toLong() // Placeholder - need real data from engine

        // Calculate share ratio
        val shareRatio = if (downloaded > 0) uploaded.toDouble() / downloaded else 0.0

        // Placeholder values for data not yet available from engine
        return TorrentDetailUi(
            infoHash = summary.infoHash,
            name = summary.name,
            status = summary.status,
            progress = summary.progress,
            downloadSpeed = summary.downloadSpeed,
            uploadSpeed = summary.uploadSpeed,
            downloaded = downloaded,
            uploaded = uploaded,
            size = totalSize,
            peersConnected = 0, // TODO: Get from engine
            peersTotal = null,
            seedersConnected = null,
            seedersTotal = null,
            leechersConnected = null,
            leechersTotal = null,
            eta = calculateEta(summary.downloadSpeed, totalSize - downloaded),
            shareRatio = shareRatio,
            piecesCompleted = null, // TODO: Get from engine
            piecesTotal = null,
            pieceSize = null,
            files = fileUis,
            trackers = trackerUis,
            peers = emptyList() // TODO: Get from engine
        )
    }

    /**
     * Map engine tracker status to UI status.
     */
    private fun mapTrackerStatus(status: String): TrackerStatus {
        return when (status) {
            "ok" -> TrackerStatus.OK
            "announcing" -> TrackerStatus.UPDATING
            "error" -> TrackerStatus.ERROR
            else -> TrackerStatus.DISABLED // 'idle' = not contacted yet
        }
    }

    /**
     * Calculate ETA based on download speed and remaining bytes.
     */
    private fun calculateEta(speed: Long, remaining: Long): Long? {
        return if (speed > 0 && remaining > 0) {
            remaining / speed
        } else if (remaining == 0L) {
            0
        } else {
            null // Infinite/unknown
        }
    }

    /**
     * Factory for creating TorrentDetailViewModel with dependencies.
     */
    class Factory(
        private val application: android.app.Application,
        private val infoHash: String
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(TorrentDetailViewModel::class.java)) {
                return TorrentDetailViewModel(EngineServiceRepository(application), infoHash) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
        }
    }
}
