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
import com.jstorrent.quickjs.model.PieceInfo
import com.jstorrent.quickjs.model.TorrentSummary
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.PeerInfo
import com.jstorrent.quickjs.model.TrackerInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.BitSet

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

    // Cached peers (fetched asynchronously)
    private val _cachedPeers = MutableStateFlow<List<PeerInfo>>(emptyList())

    // Cached piece info (fetched asynchronously)
    private val _cachedPieces = MutableStateFlow<PieceInfo?>(null)

    // Local bitfield maintained from initial fetch + diffs
    private val _pieceBitfield = MutableStateFlow<BitSet?>(null)

    init {
        // Fetch files, trackers, peers, and pieces when engine state changes
        viewModelScope.launch {
            repository.state.collect { state ->
                if (state?.torrents?.any { it.infoHash == infoHash } == true) {
                    _cachedFiles.value = repository.getFiles(infoHash)
                    _cachedTrackers.value = repository.getTrackers(infoHash)
                    _cachedPeers.value = repository.getPeers(infoHash)

                    // Fetch piece info if we don't have it yet, or if piece count changed
                    // (magnet links start with 0 pieces until metadata arrives)
                    val currentPieces = _cachedPieces.value
                    if (currentPieces == null || currentPieces.piecesTotal == 0) {
                        val pieces = repository.getPieces(infoHash)
                        if (pieces != null && pieces.piecesTotal > 0) {
                            _cachedPieces.value = pieces
                            _pieceBitfield.value = decodeBitfield(pieces.bitfield, pieces.piecesTotal)
                        }
                    }

                    // Apply piece diffs from state update
                    val diffs = state.pieceChanges?.get(infoHash)
                    if (!diffs.isNullOrEmpty()) {
                        val bitfield = _pieceBitfield.value ?: BitSet()
                        diffs.forEach { pieceIndex -> bitfield.set(pieceIndex) }
                        _pieceBitfield.value = bitfield
                        // Update completed count
                        _cachedPieces.value?.let { pieces ->
                            _cachedPieces.value = pieces.copy(
                                piecesCompleted = bitfield.cardinality()
                            )
                        }
                    }
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
        _cachedTrackers,
        _cachedPeers,
        _cachedPieces,
        _pieceBitfield
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
        @Suppress("UNCHECKED_CAST")
        val peers = values[7] as List<PeerInfo>
        val pieces = values[8] as? PieceInfo
        val bitfield = values[9] as? BitSet
        when {
            error != null && !isLoaded -> TorrentDetailUiState.Error(error)
            !isLoaded -> TorrentDetailUiState.Loading
            else -> {
                val torrent = state?.torrents?.find { it.infoHash == infoHash }
                if (torrent == null) {
                    TorrentDetailUiState.Error("Torrent not found")
                } else {
                    TorrentDetailUiState.Loaded(
                        torrent = createTorrentDetailUi(torrent, selections, files, trackers, peers, pieces, bitfield),
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
        trackers: List<TrackerInfo>,
        peers: List<PeerInfo>,
        pieces: PieceInfo?,
        bitfield: BitSet?
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

        // Map peer info to UI models
        val peerUis = peers.map { peer ->
            PeerUi(
                address = "${peer.ip}:${peer.port}",
                client = peer.clientName,
                downloadSpeed = peer.downloadSpeed,
                uploadSpeed = peer.uploadSpeed,
                progress = peer.progress,
                flags = if (peer.isEncrypted) "E" else null,
                state = peer.state
            )
        }

        // Calculate totals from files
        val totalSize = files.sumOf { it.size }
        val downloaded = files.sumOf { it.downloaded }
        val uploaded = (downloaded * 0.1).toLong() // Placeholder - need real data from engine

        // Calculate share ratio
        val shareRatio = if (downloaded > 0) uploaded.toDouble() / downloaded else 0.0

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
            peersConnected = peers.count { it.state == "connected" },
            peersTotal = null,
            seedersConnected = null,
            seedersTotal = null,
            leechersConnected = null,
            leechersTotal = null,
            eta = calculateEta(summary.downloadSpeed, totalSize - downloaded),
            shareRatio = shareRatio,
            piecesCompleted = pieces?.piecesCompleted,
            piecesTotal = pieces?.piecesTotal,
            pieceSize = pieces?.pieceSize,
            pieceBitfield = bitfield,
            files = fileUis,
            trackers = trackerUis,
            peers = peerUis
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
     * Decode hex-encoded bitfield to BitSet.
     * BitTorrent bitfield: MSB first, bit 0 of byte 0 = piece 0.
     */
    private fun decodeBitfield(hex: String, piecesTotal: Int): BitSet {
        val bitset = BitSet(piecesTotal)
        if (hex.isEmpty()) return bitset

        val bytes = hex.chunked(2).map { it.toInt(16).toByte() }
        for (pieceIndex in 0 until piecesTotal) {
            val byteIndex = pieceIndex / 8
            if (byteIndex >= bytes.size) break
            val bitIndex = 7 - (pieceIndex % 8) // MSB first
            val byte = bytes[byteIndex].toInt() and 0xFF
            if ((byte shr bitIndex) and 1 == 1) {
                bitset.set(pieceIndex)
            }
        }
        return bitset
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
