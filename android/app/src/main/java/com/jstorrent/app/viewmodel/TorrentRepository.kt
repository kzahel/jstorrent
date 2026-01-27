package com.jstorrent.app.viewmodel

import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.PeerInfo
import com.jstorrent.quickjs.model.PieceInfo
import com.jstorrent.quickjs.model.TorrentDetails
import com.jstorrent.quickjs.model.TorrentInfo
import com.jstorrent.quickjs.model.TrackerInfo
import com.jstorrent.quickjs.model.DhtStats
import com.jstorrent.quickjs.model.EngineStats
import com.jstorrent.quickjs.model.JsThreadStats
import com.jstorrent.quickjs.model.SpeedSamplesResult
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
     * Replace an existing torrent (if present) and add fresh.
     * Awaits removal completion before adding to avoid race conditions.
     * @param magnetOrBase64 Magnet link or base64-encoded .torrent
     * @param infoHash The info hash to remove (if known), or null to extract from magnet
     */
    suspend fun replaceAndAddTorrent(magnetOrBase64: String, infoHash: String?)

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

    /**
     * Get piece info for a specific torrent (suspend query).
     */
    suspend fun getPieces(infoHash: String): PieceInfo?

    /**
     * Get detailed metadata for a specific torrent (suspend query).
     */
    suspend fun getDetails(infoHash: String): TorrentDetails?

    /**
     * Set file priorities for a torrent.
     * @param infoHash The torrent's info hash
     * @param priorities Map of file index to priority (0=Normal, 1=Skip, 2=High)
     */
    fun setFilePriorities(infoHash: String, priorities: Map<Int, Int>)

    /**
     * Get DHT statistics (suspend query).
     * Returns null if DHT is not initialized.
     */
    suspend fun getDhtStats(): DhtStats?

    /**
     * Get speed samples from the bandwidth tracker for graphing.
     *
     * @param direction "down" or "up"
     * @param categories "all" or JSON array of categories
     * @param fromTime Start timestamp in ms since epoch
     * @param toTime End timestamp in ms since epoch
     * @param maxPoints Maximum number of data points to return
     * @return SpeedSamplesResult with samples and bucket metadata, or null on error
     */
    suspend fun getSpeedSamples(
        direction: String,
        categories: String = "all",
        fromTime: Long,
        toTime: Long,
        maxPoints: Int = 300
    ): SpeedSamplesResult?

    /**
     * Get JS thread health statistics.
     * Returns current/max latency and callback queue depth.
     */
    fun getJsThreadStats(): JsThreadStats?

    /**
     * Get engine statistics for health monitoring.
     * Returns tick duration, active pieces, and connected peers from JS engine.
     */
    suspend fun getEngineStats(): EngineStats?
}
