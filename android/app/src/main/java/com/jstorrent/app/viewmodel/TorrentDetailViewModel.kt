package com.jstorrent.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.jstorrent.app.model.DetailTab
import com.jstorrent.app.model.DhtStatus
import com.jstorrent.app.model.FilePriority
import com.jstorrent.app.model.PeerUi
import com.jstorrent.app.model.TorrentDetailUi
import com.jstorrent.app.model.TorrentDetailUiState
import com.jstorrent.app.model.TorrentFileUi
import com.jstorrent.app.model.TrackerStatus
import com.jstorrent.app.model.TrackerUi
import com.jstorrent.app.model.toUi
import com.jstorrent.quickjs.model.PieceInfo
import com.jstorrent.quickjs.model.TorrentDetails
import com.jstorrent.quickjs.model.TorrentSummary
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.PeerInfo
import com.jstorrent.quickjs.model.TrackerInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.BitSet

/**
 * File state for tracking selection and priority.
 */
data class FileState(
    val isSelected: Boolean = true,
    val priority: FilePriority = FilePriority.NORMAL
)

/**
 * ViewModel for the torrent detail screen.
 * Manages torrent details, files, peers, and trackers.
 */
class TorrentDetailViewModel(
    private val repository: TorrentRepository,
    private val infoHash: String
) : ViewModel() {

    // Selected tab - default to STATUS (most relevant when opening a torrent)
    private val _selectedTab = MutableStateFlow(DetailTab.STATUS)
    val selectedTab: StateFlow<DetailTab> = _selectedTab

    // Applied file state (committed to engine) - file index -> FileState
    private val _appliedFileState = MutableStateFlow<Map<Int, FileState>>(emptyMap())

    // Pending file state (uncommitted changes) - file index -> FileState
    // When null, no pending changes exist
    private val _pendingFileState = MutableStateFlow<Map<Int, FileState>?>(null)

    // Computed: whether there are pending changes
    val hasPendingFileChanges: StateFlow<Boolean> = _pendingFileState
        .map { it != null }
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    // Cached files (fetched asynchronously)
    private val _cachedFiles = MutableStateFlow<List<FileInfo>>(emptyList())

    // Cached trackers (fetched asynchronously)
    private val _cachedTrackers = MutableStateFlow<List<TrackerInfo>>(emptyList())

    // Cached peers (fetched asynchronously)
    private val _cachedPeers = MutableStateFlow<List<PeerInfo>>(emptyList())

    // Cached piece info (fetched asynchronously)
    private val _cachedPieces = MutableStateFlow<PieceInfo?>(null)

    // Cached torrent details (fetched asynchronously)
    private val _cachedDetails = MutableStateFlow<TorrentDetails?>(null)

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

                    // Fetch details once (timestamps don't change frequently)
                    if (_cachedDetails.value == null) {
                        _cachedDetails.value = repository.getDetails(infoHash)
                    }

                    // Fetch piece info if we don't have it yet, or if piece count changed
                    // (magnet links start with 0 pieces until metadata arrives)
                    val currentPieces = _cachedPieces.value
                    if (currentPieces == null || currentPieces.piecesTotal == 0) {
                        val pieces = repository.getPieces(infoHash)
                        if (pieces != null && pieces.piecesTotal > 0) {
                            _cachedPieces.value = pieces
                            // OR with existing bitfield to preserve any diffs that arrived
                            // while the snapshot was in flight (pieces only complete, never un-complete)
                            val newBitfield = decodeBitfield(pieces.bitfield, pieces.piecesTotal)
                            _pieceBitfield.value?.let { existing -> newBitfield.or(existing) }
                            _pieceBitfield.value = newBitfield
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
        _appliedFileState,
        _pendingFileState,
        _cachedFiles,
        _cachedTrackers,
        _cachedPeers,
        _cachedPieces,
        _pieceBitfield,
        _cachedDetails
    ) { values ->
        val isLoaded = values[0] as Boolean
        val state = values[1] as? com.jstorrent.quickjs.model.EngineState
        val error = values[2] as? String
        val tab = values[3] as DetailTab
        @Suppress("UNCHECKED_CAST")
        val appliedState = values[4] as Map<Int, FileState>
        @Suppress("UNCHECKED_CAST")
        val pendingState = values[5] as? Map<Int, FileState>
        @Suppress("UNCHECKED_CAST")
        val files = values[6] as List<FileInfo>
        @Suppress("UNCHECKED_CAST")
        val trackers = values[7] as List<TrackerInfo>
        @Suppress("UNCHECKED_CAST")
        val peers = values[8] as List<PeerInfo>
        val pieces = values[9] as? PieceInfo
        val bitfield = values[10] as? BitSet
        val details = values[11] as? TorrentDetails

        // Use pending state if available, otherwise use applied state
        val effectiveFileState = pendingState ?: appliedState

        when {
            error != null && !isLoaded -> TorrentDetailUiState.Error(error)
            !isLoaded -> TorrentDetailUiState.Loading
            else -> {
                val torrent = state?.torrents?.find { it.infoHash == infoHash }
                if (torrent == null) {
                    TorrentDetailUiState.Error("Torrent not found")
                } else {
                    TorrentDetailUiState.Loaded(
                        torrent = createTorrentDetailUi(torrent, effectiveFileState, files, trackers, peers, pieces, bitfield, details),
                        selectedTab = tab,
                        hasPendingFileChanges = pendingState != null
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
     * Toggle file selection for a specific file (batched - requires apply).
     */
    fun toggleFileSelection(fileIndex: Int) {
        val baseState = _pendingFileState.value ?: _appliedFileState.value
        val currentState = baseState[fileIndex] ?: FileState()
        val newState = currentState.copy(isSelected = !currentState.isSelected)

        val newPending = baseState.toMutableMap()
        newPending[fileIndex] = newState
        _pendingFileState.value = newPending
    }

    /**
     * Set file priority (batched - requires apply).
     */
    fun setFilePriority(fileIndex: Int, priority: FilePriority) {
        val baseState = _pendingFileState.value ?: _appliedFileState.value
        val currentState = baseState[fileIndex] ?: FileState()

        // SKIP priority also deselects the file
        val isSelected = if (priority == FilePriority.SKIP) false else currentState.isSelected
        val newState = currentState.copy(isSelected = isSelected, priority = priority)

        val newPending = baseState.toMutableMap()
        newPending[fileIndex] = newState
        _pendingFileState.value = newPending
    }

    /**
     * Select all files in the torrent (batched - requires apply).
     */
    fun selectAllFiles() {
        viewModelScope.launch {
            val files = repository.getFiles(infoHash)
            val baseState = _pendingFileState.value ?: _appliedFileState.value
            val newPending = baseState.toMutableMap()
            files.forEach { file ->
                val current = newPending[file.index] ?: FileState()
                newPending[file.index] = current.copy(isSelected = true)
            }
            _pendingFileState.value = newPending
        }
    }

    /**
     * Deselect all files in the torrent (batched - requires apply).
     */
    fun deselectAllFiles() {
        viewModelScope.launch {
            val files = repository.getFiles(infoHash)
            val baseState = _pendingFileState.value ?: _appliedFileState.value
            val newPending = baseState.toMutableMap()
            files.forEach { file ->
                val current = newPending[file.index] ?: FileState()
                newPending[file.index] = current.copy(isSelected = false)
            }
            _pendingFileState.value = newPending
        }
    }

    /**
     * Apply pending file changes to the engine.
     */
    fun applyFileChanges() {
        val pending = _pendingFileState.value ?: return
        _appliedFileState.value = pending
        _pendingFileState.value = null

        // Convert to engine values: 0=Normal, 1=Skip, 2=High
        // isSelected=false means skip, regardless of priority setting
        val priorities = pending.mapValues { (_, state) ->
            if (!state.isSelected) {
                1 // Skip
            } else {
                when (state.priority) {
                    FilePriority.HIGH -> 2
                    FilePriority.SKIP -> 1
                    else -> 0 // NORMAL and LOW both map to Normal
                }
            }
        }

        repository.setFilePriorities(infoHash, priorities)
    }

    /**
     * Cancel pending file changes.
     */
    fun cancelFileChanges() {
        _pendingFileState.value = null
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
     * Re-sync pieces state from the engine.
     * Call this when the app resumes from background to ensure the bitfield
     * reflects any progress made while incremental updates were missed.
     */
    fun resyncPieces() {
        viewModelScope.launch {
            val pieces = repository.getPieces(infoHash)
            if (pieces != null && pieces.piecesTotal > 0) {
                _cachedPieces.value = pieces
                // OR with existing bitfield to preserve any diffs that arrived
                // while the snapshot was in flight (pieces only complete, never un-complete)
                val newBitfield = decodeBitfield(pieces.bitfield, pieces.piecesTotal)
                _pieceBitfield.value?.let { existing -> newBitfield.or(existing) }
                _pieceBitfield.value = newBitfield
            }
        }
    }

    /**
     * Create the full detail UI model from torrent summary.
     */
    private fun createTorrentDetailUi(
        summary: TorrentSummary,
        fileState: Map<Int, FileState>,
        files: List<FileInfo>,
        trackers: List<TrackerInfo>,
        peers: List<PeerInfo>,
        pieces: PieceInfo?,
        bitfield: BitSet?,
        details: TorrentDetails?
    ): TorrentDetailUi {
        val fileUis = files.map { file ->
            // Use pending state if exists, otherwise use engine's actual priority
            val pendingState = fileState[file.index]
            val priority = pendingState?.priority ?: enginePriorityToFilePriority(file.priority)
            val isSelected = pendingState?.isSelected ?: (file.priority != 1) // Not selected if skipped
            file.toUi(isSelected, priority)
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
            peersTotal = if (summary.swarmPeers > 0) summary.swarmPeers else null,
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
            peers = peerUis,
            addedAt = details?.addedAt,
            completedAt = details?.completedAt,
            magnetUrl = details?.magnetUrl,
            rootKey = details?.rootKey
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
     * Convert engine priority (0=Normal, 1=Skip, 2=High) to FilePriority enum.
     */
    private fun enginePriorityToFilePriority(enginePriority: Int): FilePriority {
        return when (enginePriority) {
            1 -> FilePriority.SKIP
            2 -> FilePriority.HIGH
            else -> FilePriority.NORMAL
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
