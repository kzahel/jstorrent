package com.jstorrent.quickjs.model

import kotlinx.serialization.Serializable

/**
 * Full torrent information from __jstorrent_query_torrent_list.
 */
@Serializable
data class TorrentInfo(
    val infoHash: String,
    val name: String,
    val progress: Double,
    val downloadSpeed: Long,
    val uploadSpeed: Long,
    val status: String,
    val size: Long,
    val downloaded: Long,
    val uploaded: Long,
    val peersConnected: Int
)

/**
 * Wrapper for torrent list query response.
 */
@Serializable
data class TorrentListResponse(
    val torrents: List<TorrentInfo>
)

/**
 * File information from __jstorrent_query_files.
 */
@Serializable
data class FileInfo(
    val index: Int,
    val path: String,
    val size: Long,
    val downloaded: Long,
    val progress: Double,
    val priority: Int = 0 // 0=Normal, 1=Skip, 2=High
)

/**
 * Wrapper for file list query response.
 */
@Serializable
data class FileListResponse(
    val files: List<FileInfo>
)

/**
 * Tracker information from __jstorrent_query_trackers.
 */
@Serializable
data class TrackerInfo(
    val url: String,
    val type: String,
    val status: String, // 'idle' | 'announcing' | 'ok' | 'error'
    val seeders: Int? = null,
    val leechers: Int? = null,
    val lastError: String? = null
)

/**
 * Wrapper for tracker list query response.
 */
@Serializable
data class TrackerListResponse(
    val trackers: List<TrackerInfo>
)

/**
 * Peer information from __jstorrent_query_peers.
 */
@Serializable
data class PeerInfo(
    val key: String,
    val ip: String,
    val port: Int,
    val state: String,
    val downloadSpeed: Long = 0,
    val uploadSpeed: Long = 0,
    val progress: Double = 0.0,
    val isEncrypted: Boolean = false,
    val clientName: String? = null
)

/**
 * Wrapper for peer list query response.
 */
@Serializable
data class PeerListResponse(
    val peers: List<PeerInfo>
)

/**
 * Piece information from __jstorrent_query_pieces.
 */
@Serializable
data class PieceInfo(
    val piecesTotal: Int,
    val piecesCompleted: Int,
    val pieceSize: Long,
    val lastPieceSize: Long,
    val bitfield: String // Hex-encoded bitfield
)

/**
 * Torrent details from __jstorrent_query_details.
 * Contains metadata for the Details tab.
 */
@Serializable
data class TorrentDetails(
    val infoHash: String,
    val addedAt: Long,              // Epoch milliseconds
    val completedAt: Long? = null,  // Epoch milliseconds, null if incomplete
    val totalSize: Long,            // Total size in bytes
    val pieceSize: Long,            // Piece size in bytes
    val pieceCount: Int,            // Total number of pieces
    val magnetUrl: String,          // Full magnet URI with trackers
    val rootKey: String? = null     // Storage root key for file access
)

/**
 * Compact state pushed from engine every 500ms.
 * Includes piece changes (diffs) for efficient updates.
 */
@Serializable
data class EngineState(
    val torrents: List<TorrentSummary>,
    val pieceChanges: Map<String, List<Int>>? = null // infoHash -> newly completed piece indices
)

/**
 * Summary torrent info for state updates (compact).
 */
@Serializable
data class TorrentSummary(
    val infoHash: String,
    val name: String,
    val progress: Double,
    val downloadSpeed: Long,
    val uploadSpeed: Long,
    val status: String,
    val numPeers: Int = 0,
    val swarmPeers: Int = 0
)

/**
 * Configuration for engine initialization.
 */
@Serializable
data class EngineConfig(
    val contentRoots: List<ContentRoot>,
    val defaultContentRoot: String? = null,
    val port: Int? = null,
    val storageMode: String? = null  // "native" or "null" (for performance testing)
)

/**
 * Content root for file storage.
 */
@Serializable
data class ContentRoot(
    val key: String,
    val label: String,
    val path: String = ""
)
