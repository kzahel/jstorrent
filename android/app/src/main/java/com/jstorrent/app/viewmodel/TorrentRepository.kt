package com.jstorrent.app.viewmodel

import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.PeerInfo
import com.jstorrent.quickjs.model.TorrentInfo
import com.jstorrent.quickjs.model.TrackerInfo
import kotlinx.coroutines.flow.StateFlow

/**
 * Interface for accessing torrent engine functionality.
 * Abstracts the EngineController for testability.
 */
interface TorrentRepository {
    /**
     * Flow of engine state updates (torrents list).
     */
    val state: StateFlow<EngineState?>

    /**
     * Flow indicating whether the engine is loaded.
     */
    val isLoaded: StateFlow<Boolean>

    /**
     * Flow of last error message.
     */
    val lastError: StateFlow<String?>

    /**
     * Add a torrent from magnet link or base64-encoded .torrent file.
     */
    fun addTorrent(magnetOrBase64: String)

    /**
     * Pause a torrent by info hash.
     */
    fun pauseTorrent(infoHash: String)

    /**
     * Resume a paused torrent.
     */
    fun resumeTorrent(infoHash: String)

    /**
     * Remove a torrent.
     * @param infoHash The torrent's info hash
     * @param deleteFiles If true, also delete downloaded files
     */
    fun removeTorrent(infoHash: String, deleteFiles: Boolean = false)

    /**
     * Pause all torrents.
     */
    fun pauseAll()

    /**
     * Resume all torrents.
     */
    fun resumeAll()

    /**
     * Get detailed torrent list (suspend query).
     */
    suspend fun getTorrentList(): List<TorrentInfo>

    /**
     * Get file list for a specific torrent (suspend query).
     */
    suspend fun getFiles(infoHash: String): List<FileInfo>

    /**
     * Get tracker list for a specific torrent (suspend query).
     */
    suspend fun getTrackers(infoHash: String): List<TrackerInfo>

    /**
     * Get peer list for a specific torrent (suspend query).
     */
    suspend fun getPeers(infoHash: String): List<PeerInfo>
}
