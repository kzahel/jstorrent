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
    val lastPeersReceived: Int? = null,
    val uniquePeersDiscovered: Int? = null,
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
    val isIncoming: Boolean = false,
    val clientName: String? = null,
    // Choking/interested states for flag display
    val amInterested: Boolean = false,
    val peerChoking: Boolean = true,
    val peerInterested: Boolean = false,
    val amChoking: Boolean = true
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
    val swarmPeers: Int = 0,
    val skippedFilesCount: Int = 0
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

/**
 * UPnP status from __jstorrent_query_upnp_status.
 * Shows port mapping status, external IP, and listening port.
 */
@Serializable
data class UpnpStatus(
    val status: String, // disabled, discovering, mapped, unavailable, failed
    val externalIP: String? = null,
    val port: Int = 0,
    val hasReceivedIncomingConnection: Boolean = false
)

/**
 * A single speed sample from the bandwidth tracker.
 */
@Serializable
data class SpeedSample(
    val time: Long,  // Timestamp in ms since epoch
    val value: Float // Bytes accumulated in this bucket (use bucketMs to convert to rate)
)

/**
 * Result from __jstorrent_query_speed_samples.
 * Contains samples and metadata about the bucket resolution.
 */
@Serializable
data class SpeedSamplesResult(
    val samples: List<SpeedSample>,
    val bucketMs: Long,        // Resolution of each sample in milliseconds
    val latestBucketTime: Long // Timestamp of the most recent bucket
)

/**
 * JS thread health statistics.
 * Used for monitoring QuickJS performance in the UI.
 */
data class JsThreadStats(
    val currentLatencyMs: Long,  // Most recent health check latency
    val maxLatencyMs: Long,      // Max latency since engine start
    val queueDepth: Int,         // Current TCP callback queue depth
    val maxQueueDepth: Int       // Max queue depth since last log interval
)

/**
 * DHT statistics from __jstorrent_query_dht_stats.
 * Used for debugging DHT operation.
 */
@Serializable
data class DhtStats(
    val enabled: Boolean,
    val ready: Boolean,
    val nodeId: String,
    val nodeCount: Int,
    val bucketCount: Int,
    val bytesSent: Long,
    val bytesReceived: Long,
    val pingsSent: Int,
    val findNodesSent: Int,
    val getPeersSent: Int,
    val announcesSent: Int,
    val pingsSucceeded: Int,
    val findNodesSucceeded: Int,
    val getPeersSucceeded: Int,
    val announcesSucceeded: Int,
    val pingsReceived: Int,
    val findNodesReceived: Int,
    val getPeersReceived: Int,
    val announcesReceived: Int,
    val timeouts: Int,
    val errors: Int,
    val peersDiscovered: Int
)
