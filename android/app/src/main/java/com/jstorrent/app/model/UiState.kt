package com.jstorrent.app.model

import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.TorrentInfo
import com.jstorrent.quickjs.model.TorrentSummary
import java.util.BitSet

/**
 * UI state models for torrent screens.
 */

// =============================================================================
// Torrent List Screen
// =============================================================================

/**
 * State for the torrent list screen.
 */
sealed class TorrentListUiState {
    /**
     * Engine is starting up.
     */
    data object Loading : TorrentListUiState()

    /**
     * Engine is loaded, displaying torrents.
     */
    data class Loaded(
        val torrents: List<TorrentSummary>,
        val filter: TorrentFilter,
        val sortOrder: TorrentSortOrder
    ) : TorrentListUiState()

    /**
     * Engine failed to load.
     */
    data class Error(val message: String) : TorrentListUiState()
}

/**
 * Filter options for torrent list.
 */
enum class TorrentFilter(val displayName: String) {
    /** Show all torrents */
    ALL("All"),
    /** Show active/queued torrents (downloading, downloading_metadata, checking) */
    QUEUED("Queued"),
    /** Show completed torrents (seeding, stopped with progress = 1.0) */
    FINISHED("Finished")
}

/**
 * Sort order options for torrent list.
 */
enum class TorrentSortOrder {
    /** Original order from engine */
    QUEUE_ORDER,
    /** Alphabetical by name */
    NAME,
    /** By date added (newest first) - requires TorrentInfo with addedDate */
    DATE_ADDED,
    /** By download speed (fastest first) */
    DOWNLOAD_SPEED,
    /** By ETA (shortest first) - requires TorrentInfo with eta */
    ETA
}

// =============================================================================
// Torrent Detail Screen
// =============================================================================

/**
 * State for the torrent detail screen.
 */
sealed class TorrentDetailUiState {
    /**
     * Loading torrent details.
     */
    data object Loading : TorrentDetailUiState()

    /**
     * Torrent details loaded.
     */
    data class Loaded(
        val torrent: TorrentDetailUi,
        val selectedTab: DetailTab
    ) : TorrentDetailUiState()

    /**
     * Torrent not found or error loading.
     */
    data class Error(val message: String) : TorrentDetailUiState()
}

/**
 * Tabs in the torrent detail screen.
 */
enum class DetailTab {
    STATUS,
    FILES,
    TRACKERS,
    PEERS,
    PIECES
}

/**
 * UI model for torrent details.
 * Combines engine data with derived/formatted values.
 */
data class TorrentDetailUi(
    val infoHash: String,
    val name: String,
    val status: String,
    val progress: Double,
    val downloadSpeed: Long,
    val uploadSpeed: Long,
    val downloaded: Long,
    val uploaded: Long,
    val size: Long,
    val peersConnected: Int,
    val peersTotal: Int?,
    val seedersConnected: Int?,
    val seedersTotal: Int?,
    val leechersConnected: Int?,
    val leechersTotal: Int?,
    val eta: Long?,
    val shareRatio: Double,
    val piecesCompleted: Int?,
    val piecesTotal: Int?,
    val pieceSize: Long?,
    val pieceBitfield: BitSet?, // Which pieces are complete
    val files: List<TorrentFileUi>,
    val trackers: List<TrackerUi>,
    val peers: List<PeerUi>,
    // Peer discovery status (for TrackersTab)
    val dhtEnabled: Boolean = true,   // Engine always has DHT enabled
    val lsdEnabled: Boolean = false,  // LSD not implemented
    val pexEnabled: Boolean = true    // PeX enabled per-connection
)

/**
 * UI model for a file within a torrent.
 */
data class TorrentFileUi(
    val index: Int,
    val path: String,
    val name: String,
    val size: Long,
    val downloaded: Long,
    val progress: Double,
    val isSelected: Boolean
)

/**
 * UI model for a tracker.
 */
data class TrackerUi(
    val url: String,
    val status: TrackerStatus,
    val message: String?,
    val peers: Int?
)

/**
 * Tracker status.
 */
enum class TrackerStatus {
    OK,
    UPDATING,
    ERROR,
    DISABLED
}

/**
 * UI model for a peer.
 */
data class PeerUi(
    val address: String,
    val client: String?,
    val downloadSpeed: Long,
    val uploadSpeed: Long,
    val progress: Double,
    val flags: String?,
    val state: String  // "connecting" or "connected"
)

/**
 * DHT/LSD/PeX status for trackers tab.
 */
data class DhtStatus(
    val dhtEnabled: Boolean,
    val dhtNodes: Int?,
    val lsdEnabled: Boolean,
    val pexEnabled: Boolean
)

// =============================================================================
// Extension functions
// =============================================================================

/**
 * Filter torrents by status.
 */
fun List<TorrentSummary>.filterByStatus(filter: TorrentFilter): List<TorrentSummary> {
    return when (filter) {
        TorrentFilter.ALL -> this
        TorrentFilter.QUEUED -> this.filter { torrent ->
            torrent.status in listOf("downloading", "downloading_metadata", "checking", "queued")
        }
        TorrentFilter.FINISHED -> this.filter { torrent ->
            torrent.status == "seeding" ||
            (torrent.status == "stopped" && torrent.progress >= 0.999)
        }
    }
}

/**
 * Sort torrents by the specified order.
 */
fun List<TorrentSummary>.sortByOrder(order: TorrentSortOrder): List<TorrentSummary> {
    return when (order) {
        TorrentSortOrder.QUEUE_ORDER -> this
        TorrentSortOrder.NAME -> this.sortedBy { it.name.lowercase() }
        TorrentSortOrder.DATE_ADDED -> this // Requires additional data
        TorrentSortOrder.DOWNLOAD_SPEED -> this.sortedByDescending { it.downloadSpeed }
        TorrentSortOrder.ETA -> this // Requires additional data
    }
}

/**
 * Check if a torrent is considered "active" (downloading or seeding with speed).
 */
fun TorrentSummary.isActive(): Boolean {
    return status in listOf("downloading", "downloading_metadata", "seeding") &&
           (downloadSpeed > 0 || uploadSpeed > 0)
}

/**
 * Check if a torrent is paused.
 */
fun TorrentSummary.isPaused(): Boolean {
    return status == "stopped"
}

/**
 * Check if a torrent is completed.
 */
fun TorrentSummary.isCompleted(): Boolean {
    return progress >= 0.999
}

/**
 * Convert FileInfo to TorrentFileUi.
 */
fun FileInfo.toUi(isSelected: Boolean = true): TorrentFileUi {
    val name = path.substringAfterLast('/')
    return TorrentFileUi(
        index = index,
        path = path,
        name = name,
        size = size,
        downloaded = downloaded,
        progress = progress,
        isSelected = isSelected
    )
}
