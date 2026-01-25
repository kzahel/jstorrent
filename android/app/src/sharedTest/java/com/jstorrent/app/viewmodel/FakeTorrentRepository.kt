package com.jstorrent.app.viewmodel

import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.PeerInfo
import com.jstorrent.quickjs.model.PieceInfo
import com.jstorrent.quickjs.model.TorrentDetails
import com.jstorrent.quickjs.model.TorrentInfo
import com.jstorrent.quickjs.model.TorrentSummary
import com.jstorrent.quickjs.model.TrackerInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Fake TorrentRepository for testing.
 * Allows tests to control the state and verify interactions.
 */
class FakeTorrentRepository : TorrentRepository {

    private val _state = MutableStateFlow<EngineState?>(null)
    override val state: StateFlow<EngineState?> = _state.asStateFlow()

    private val _isLoaded = MutableStateFlow(false)
    override val isLoaded: StateFlow<Boolean> = _isLoaded.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    override val lastError: StateFlow<String?> = _lastError.asStateFlow()

    // Track method calls for verification
    val addedTorrents = mutableListOf<String>()
    val pausedTorrents = mutableListOf<String>()
    val resumedTorrents = mutableListOf<String>()
    val removedTorrents = mutableListOf<Pair<String, Boolean>>()
    var pauseAllCalled = false
    var resumeAllCalled = false

    // Data for queries
    var torrentListData: List<TorrentInfo> = emptyList()
    var filesData: Map<String, List<FileInfo>> = emptyMap()
    var trackersData: Map<String, List<TrackerInfo>> = emptyMap()
    var peersData: Map<String, List<PeerInfo>> = emptyMap()
    var piecesData: Map<String, PieceInfo> = emptyMap()
    var detailsData: Map<String, TorrentDetails> = emptyMap()

    // ==========================================================================
    // Test control methods
    // ==========================================================================

    fun setLoaded(loaded: Boolean) {
        _isLoaded.value = loaded
    }

    fun setError(error: String?) {
        _lastError.value = error
    }

    fun setTorrents(torrents: List<TorrentSummary>) {
        _state.value = EngineState(torrents)
    }

    fun reset() {
        _state.value = null
        _isLoaded.value = false
        _lastError.value = null
        addedTorrents.clear()
        pausedTorrents.clear()
        resumedTorrents.clear()
        removedTorrents.clear()
        pauseAllCalled = false
        resumeAllCalled = false
        torrentListData = emptyList()
        filesData = emptyMap()
        trackersData = emptyMap()
        peersData = emptyMap()
        piecesData = emptyMap()
        detailsData = emptyMap()
    }

    // ==========================================================================
    // TorrentRepository implementation
    // ==========================================================================

    override fun addTorrent(magnetOrBase64: String) {
        addedTorrents.add(magnetOrBase64)
    }

    override fun pauseTorrent(infoHash: String) {
        pausedTorrents.add(infoHash)
        // Update state to reflect pause
        _state.value?.let { currentState ->
            val updatedTorrents = currentState.torrents.map { torrent ->
                if (torrent.infoHash == infoHash) {
                    torrent.copy(status = "stopped", downloadSpeed = 0, uploadSpeed = 0)
                } else {
                    torrent
                }
            }
            _state.value = EngineState(updatedTorrents)
        }
    }

    override fun resumeTorrent(infoHash: String) {
        resumedTorrents.add(infoHash)
        // Update state to reflect resume
        _state.value?.let { currentState ->
            val updatedTorrents = currentState.torrents.map { torrent ->
                if (torrent.infoHash == infoHash) {
                    torrent.copy(status = "downloading")
                } else {
                    torrent
                }
            }
            _state.value = EngineState(updatedTorrents)
        }
    }

    override fun removeTorrent(infoHash: String, deleteFiles: Boolean) {
        removedTorrents.add(Pair(infoHash, deleteFiles))
        // Update state to reflect removal
        _state.value?.let { currentState ->
            val updatedTorrents = currentState.torrents.filter { it.infoHash != infoHash }
            _state.value = EngineState(updatedTorrents)
        }
    }

    override suspend fun replaceAndAddTorrent(magnetOrBase64: String, infoHash: String?) {
        // Remove first if infoHash provided
        if (infoHash != null) {
            removeTorrent(infoHash, deleteFiles = true)
        }
        // Then add
        addTorrent(magnetOrBase64)
    }

    override fun pauseAll() {
        pauseAllCalled = true
        _state.value?.let { currentState ->
            val updatedTorrents = currentState.torrents.map { torrent ->
                torrent.copy(status = "stopped", downloadSpeed = 0, uploadSpeed = 0)
            }
            _state.value = EngineState(updatedTorrents)
        }
    }

    override fun resumeAll() {
        resumeAllCalled = true
        _state.value?.let { currentState ->
            val updatedTorrents = currentState.torrents.map { torrent ->
                if (torrent.status == "stopped") {
                    torrent.copy(status = "downloading")
                } else {
                    torrent
                }
            }
            _state.value = EngineState(updatedTorrents)
        }
    }

    override suspend fun getTorrentList(): List<TorrentInfo> {
        return torrentListData
    }

    override suspend fun getFiles(infoHash: String): List<FileInfo> {
        return filesData[infoHash] ?: emptyList()
    }

    override suspend fun getTrackers(infoHash: String): List<TrackerInfo> {
        return trackersData[infoHash] ?: emptyList()
    }

    override suspend fun getPeers(infoHash: String): List<PeerInfo> {
        return peersData[infoHash] ?: emptyList()
    }

    override suspend fun getPieces(infoHash: String): PieceInfo? {
        return piecesData[infoHash]
    }

    override suspend fun getDetails(infoHash: String): TorrentDetails? {
        return detailsData[infoHash]
    }

    override fun setFilePriorities(infoHash: String, priorities: Map<Int, Int>) {
        // No-op for testing - just record if needed
    }
}

// ==========================================================================
// Test data helpers
// ==========================================================================

fun createTestTorrent(
    infoHash: String = "abc123",
    name: String = "Test Torrent",
    progress: Double = 0.5,
    downloadSpeed: Long = 1000000,
    uploadSpeed: Long = 50000,
    status: String = "downloading"
) = TorrentSummary(
    infoHash = infoHash,
    name = name,
    progress = progress,
    downloadSpeed = downloadSpeed,
    uploadSpeed = uploadSpeed,
    status = status
)
