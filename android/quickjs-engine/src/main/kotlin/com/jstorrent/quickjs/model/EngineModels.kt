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
    val progress: Double
)

/**
 * Wrapper for file list query response.
 */
@Serializable
data class FileListResponse(
    val files: List<FileInfo>
)

/**
 * Compact state pushed from engine every 500ms.
 */
@Serializable
data class EngineState(
    val torrents: List<TorrentSummary>
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
    val status: String
)

/**
 * Configuration for engine initialization.
 */
@Serializable
data class EngineConfig(
    val contentRoots: List<ContentRoot>,
    val defaultContentRoot: String? = null,
    val port: Int? = null
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
