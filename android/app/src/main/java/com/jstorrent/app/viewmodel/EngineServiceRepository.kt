package com.jstorrent.app.viewmodel

import com.jstorrent.app.service.EngineService
import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.TorrentInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * TorrentRepository implementation that wraps EngineService singleton.
 */
class EngineServiceRepository : TorrentRepository {

    private val service: EngineService?
        get() = EngineService.instance

    // Fallback empty state flows for when service is not available
    private val emptyState = MutableStateFlow<EngineState?>(null)
    private val emptyLoaded = MutableStateFlow(false)
    private val emptyError = MutableStateFlow<String?>(null)

    override val state: StateFlow<EngineState?>
        get() = service?.state ?: emptyState.asStateFlow()

    override val isLoaded: StateFlow<Boolean>
        get() = service?.isLoaded ?: emptyLoaded.asStateFlow()

    override val lastError: StateFlow<String?>
        get() = service?.lastError ?: emptyError.asStateFlow()

    override fun addTorrent(magnetOrBase64: String) {
        service?.addTorrent(magnetOrBase64)
    }

    override fun pauseTorrent(infoHash: String) {
        service?.pauseTorrent(infoHash)
    }

    override fun resumeTorrent(infoHash: String) {
        service?.resumeTorrent(infoHash)
    }

    override fun removeTorrent(infoHash: String, deleteFiles: Boolean) {
        service?.removeTorrent(infoHash, deleteFiles)
    }

    override fun pauseAll() {
        // Get current torrent list and pause each one
        val torrents = state.value?.torrents ?: return
        torrents.forEach { torrent ->
            if (torrent.status != "stopped") {
                pauseTorrent(torrent.infoHash)
            }
        }
    }

    override fun resumeAll() {
        // Get current torrent list and resume each one
        val torrents = state.value?.torrents ?: return
        torrents.forEach { torrent ->
            if (torrent.status == "stopped") {
                resumeTorrent(torrent.infoHash)
            }
        }
    }

    override fun getTorrentList(): List<TorrentInfo> {
        return service?.controller?.getTorrentList() ?: emptyList()
    }

    override fun getFiles(infoHash: String): List<FileInfo> {
        return service?.controller?.getFiles(infoHash) ?: emptyList()
    }
}
