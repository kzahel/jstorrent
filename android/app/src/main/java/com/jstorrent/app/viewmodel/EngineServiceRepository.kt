package com.jstorrent.app.viewmodel

import com.jstorrent.app.service.EngineService
import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.TorrentInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * TorrentRepository implementation that wraps EngineService singleton.
 *
 * Uses bridged StateFlows to handle the race condition where the ViewModel
 * may be created before EngineService.instance is available. The bridge
 * flows are updated by a coroutine that polls for the service and then
 * forwards updates from the real service flows.
 */
class EngineServiceRepository : TorrentRepository {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val service: EngineService?
        get() = EngineService.instance

    // Bridged state flows that forward from the real service when available
    private val _state = MutableStateFlow<EngineState?>(null)
    private val _isLoaded = MutableStateFlow(false)
    private val _lastError = MutableStateFlow<String?>(null)

    override val state: StateFlow<EngineState?> = _state.asStateFlow()
    override val isLoaded: StateFlow<Boolean> = _isLoaded.asStateFlow()
    override val lastError: StateFlow<String?> = _lastError.asStateFlow()

    init {
        // Start forwarding from service flows when service becomes available
        scope.launch {
            // Wait for service AND controller to be available
            // The controller is initialized async after service.onCreate
            while (EngineService.instance?.isLoaded == null) {
                delay(50)
            }
            val svc = EngineService.instance!!

            // Forward state updates
            launch {
                svc.state?.collect { _state.value = it }
            }
            launch {
                svc.isLoaded?.collect { _isLoaded.value = it }
            }
            launch {
                svc.lastError?.collect { _lastError.value = it }
            }
        }
    }

    override fun addTorrent(magnetOrBase64: String) {
        scope.launch { service?.addTorrentAsync(magnetOrBase64) }
    }

    override fun pauseTorrent(infoHash: String) {
        scope.launch { service?.pauseTorrentAsync(infoHash) }
    }

    override fun resumeTorrent(infoHash: String) {
        scope.launch { service?.resumeTorrentAsync(infoHash) }
    }

    override fun removeTorrent(infoHash: String, deleteFiles: Boolean) {
        scope.launch { service?.removeTorrentAsync(infoHash, deleteFiles) }
    }

    override fun pauseAll() {
        // Get current torrent list and pause each one (fire-and-forget)
        val torrents = state.value?.torrents ?: return
        scope.launch {
            torrents.forEach { torrent ->
                if (torrent.status != "stopped") {
                    service?.pauseTorrentAsync(torrent.infoHash)
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
                    service?.resumeTorrentAsync(torrent.infoHash)
                }
            }
        }
    }

    override suspend fun getTorrentList(): List<TorrentInfo> {
        return service?.getTorrentListAsync() ?: emptyList()
    }

    override suspend fun getFiles(infoHash: String): List<FileInfo> {
        return service?.getFilesAsync(infoHash) ?: emptyList()
    }
}
