package com.jstorrent.app.viewmodel

import android.app.Application
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.quickjs.EngineController
import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.PeerInfo
import com.jstorrent.quickjs.model.PieceInfo
import com.jstorrent.quickjs.model.TorrentDetails
import com.jstorrent.quickjs.model.TorrentInfo
import com.jstorrent.quickjs.model.TrackerInfo
import com.jstorrent.quickjs.model.DhtStats
import com.jstorrent.quickjs.model.JsThreadStats
import com.jstorrent.quickjs.model.SpeedSamplesResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * TorrentRepository implementation that accesses the engine.
 *
 * Connects to the EngineController directly from the Application.
 * The engine lives for the process lifetime in JSTorrentApplication,
 * independent of whether ForegroundNotificationService is running (service only runs
 * when there's background work to do).
 *
 * Uses bridged StateFlows to handle the race condition where the ViewModel
 * may be created before the engine is initialized.
 */
class EngineServiceRepository(
    private val application: Application
) : TorrentRepository {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val app: JSTorrentApplication
        get() = application as JSTorrentApplication

    private val controller: EngineController?
        get() = app.engineController

    // Bridged state flows that forward from the engine controller
    private val _state = MutableStateFlow<EngineState?>(null)
    private val _isLoaded = MutableStateFlow(false)
    private val _lastError = MutableStateFlow<String?>(null)

    override val state: StateFlow<EngineState?> = _state.asStateFlow()
    override val isLoaded: StateFlow<Boolean> = _isLoaded.asStateFlow()
    override val lastError: StateFlow<String?> = _lastError.asStateFlow()

    // Track the controller we're connected to and collection jobs
    private var connectedController: EngineController? = null
    private var collectionJobs: List<Job> = emptyList()

    init {
        // Continuously monitor for engine controller availability
        // Reconnects when engine is restarted
        scope.launch {
            while (true) {
                val currentController = app.engineController

                // Check if we need to disconnect from old controller
                if (connectedController != null && currentController !== connectedController) {
                    // Controller changed - cancel old collections and reset state
                    collectionJobs.forEach { it.cancel() }
                    collectionJobs = emptyList()
                    connectedController = null
                    _isLoaded.value = false
                    _state.value = null
                    _lastError.value = null
                }

                // Check if we need to connect to new controller
                if (currentController != null && currentController !== connectedController) {
                    connectedController = currentController
                    collectionJobs = listOf(
                        launch { currentController.state.collect { _state.value = it } },
                        launch { currentController.isLoaded.collect { _isLoaded.value = it } },
                        launch { currentController.lastError.collect { _lastError.value = it } }
                    )
                }

                delay(50)
            }
        }
    }

    override fun addTorrent(magnetOrBase64: String) {
        scope.launch { controller?.addTorrentAsync(magnetOrBase64) }
    }

    override fun pauseTorrent(infoHash: String) {
        scope.launch { controller?.pauseTorrentAsync(infoHash) }
    }

    override fun resumeTorrent(infoHash: String) {
        scope.launch { controller?.resumeTorrentAsync(infoHash) }
    }

    override fun removeTorrent(infoHash: String, deleteFiles: Boolean) {
        scope.launch { controller?.removeTorrentAsync(infoHash, deleteFiles) }
    }

    override suspend fun replaceAndAddTorrent(magnetOrBase64: String, infoHash: String?) {
        // Remove existing torrent first (if infoHash provided) and wait for completion
        if (infoHash != null) {
            controller?.removeTorrentAsync(infoHash, deleteFiles = true)
        }
        // Then add the new torrent
        controller?.addTorrentAsync(magnetOrBase64)
    }

    override fun pauseAll() {
        // Get current torrent list and pause each one (fire-and-forget)
        val torrents = state.value?.torrents ?: return
        scope.launch {
            torrents.forEach { torrent ->
                if (torrent.status != "stopped") {
                    controller?.pauseTorrentAsync(torrent.infoHash)
                }
            }
        }
    }

    override fun resumeAll() {
        // Get current torrent list and resume each one (fire-and-forget)
        val torrents = state.value?.torrents ?: return
        scope.launch {
            torrents.forEach { torrent ->
                if (torrent.status == "stopped") {
                    controller?.resumeTorrentAsync(torrent.infoHash)
                }
            }
        }
    }

    override suspend fun getTorrentList(): List<TorrentInfo> {
        return controller?.getTorrentListAsync() ?: emptyList()
    }

    override suspend fun getFiles(infoHash: String): List<FileInfo> {
        return controller?.getFilesAsync(infoHash) ?: emptyList()
    }

    override suspend fun getTrackers(infoHash: String): List<TrackerInfo> {
        return controller?.getTrackersAsync(infoHash) ?: emptyList()
    }

    override suspend fun getPeers(infoHash: String): List<PeerInfo> {
        return controller?.getPeersAsync(infoHash) ?: emptyList()
    }

    override suspend fun getPieces(infoHash: String): PieceInfo? {
        return controller?.getPiecesAsync(infoHash)
    }

    override suspend fun getDetails(infoHash: String): TorrentDetails? {
        return controller?.getDetailsAsync(infoHash)
    }

    override fun setFilePriorities(infoHash: String, priorities: Map<Int, Int>) {
        scope.launch { controller?.setFilePrioritiesAsync(infoHash, priorities) }
    }

    override suspend fun getDhtStats(): DhtStats? {
        return controller?.getDhtStatsAsync()
    }

    override suspend fun getSpeedSamples(
        direction: String,
        categories: String,
        fromTime: Long,
        toTime: Long,
        maxPoints: Int
    ): SpeedSamplesResult? {
        return controller?.getSpeedSamplesAsync(direction, categories, fromTime, toTime, maxPoints)
    }

    override fun getJsThreadStats(): JsThreadStats? {
        return controller?.getJsThreadStats()
    }
}
