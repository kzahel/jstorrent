package com.jstorrent.app.cache

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import android.util.Log
import com.jstorrent.app.bencode.BencodeException
import com.jstorrent.app.bencode.TorrentMetadata
import com.jstorrent.quickjs.model.TorrentSummary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Provides cached torrent summaries from SharedPreferences without starting the engine.
 *
 * This allows the UI to display the torrent list immediately on app launch,
 * deferring QuickJS engine startup until the user actually interacts with a torrent.
 *
 * The cache reads the same SharedPreferences that the JS engine uses (jstorrent_kv),
 * parsing the bencoded torrent files to extract metadata.
 */
class TorrentSummaryCache(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("jstorrent_kv", Context.MODE_PRIVATE)

    private val json = Json { ignoreUnknownKeys = true }

    private val _cachedSummaries = MutableStateFlow<List<CachedTorrentSummary>>(emptyList())

    /**
     * Flow of cached torrent summaries.
     * Emits immediately with cached data, no engine required.
     */
    val summaries: Flow<List<CachedTorrentSummary>> = _cachedSummaries.asStateFlow()

    /**
     * Load cached summaries from SharedPreferences.
     * Call this on app startup before engine initialization.
     */
    suspend fun load(): List<CachedTorrentSummary> = withContext(Dispatchers.IO) {
        val summaries = mutableListOf<CachedTorrentSummary>()

        try {
            // Load the torrent list index
            val torrentListJson = prefs.getString("torrents", null) ?: return@withContext emptyList()
            val torrentList = json.decodeFromString<TorrentListData>(torrentListJson)

            for (entry in torrentList.torrents) {
                try {
                    val summary = loadTorrentSummary(entry)
                    if (summary != null) {
                        summaries.add(summary)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to load cached summary for ${entry.infoHash}: ${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load torrent list", e)
        }

        _cachedSummaries.value = summaries
        summaries
    }

    /**
     * Check if there are any cached torrents.
     * Fast check without full parsing.
     */
    fun hasCachedTorrents(): Boolean {
        val torrentListJson = prefs.getString("torrents", null) ?: return false
        return try {
            val torrentList = json.decodeFromString<TorrentListData>(torrentListJson)
            torrentList.torrents.isNotEmpty()
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Load a single torrent summary from persisted data.
     */
    private fun loadTorrentSummary(entry: TorrentListEntry): CachedTorrentSummary? {
        val infoHash = entry.infoHash

        // Load torrent state (userState, bitfield, uploaded, downloaded)
        val stateJson = prefs.getString("torrent:$infoHash:state", null)
        val state = stateJson?.let {
            try {
                json.decodeFromString<TorrentStateData>(it)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to parse state for $infoHash: ${e.message}")
                null
            }
        }

        // Try to load metadata from torrent file or info dict
        val metadata = loadMetadata(infoHash, entry.source)

        // If we have no metadata (magnet without infodict yet), use placeholder
        val name = metadata?.name ?: "Fetching metadata..."
        val totalSize = metadata?.totalSize ?: 0L
        val fileCount = metadata?.fileCount ?: 0

        // Calculate progress from bitfield if available
        val progress = if (state?.bitfield != null && metadata != null) {
            calculateProgressFromBitfield(state.bitfield, metadata.pieceLength, totalSize)
        } else {
            0.0
        }

        // Map userState to status
        val status = when (state?.userState) {
            "active" -> if (progress >= 0.999) "seeding" else "stopped" // Will become "downloading" when engine starts
            "inactive", "paused" -> "stopped"
            else -> "stopped"
        }

        return CachedTorrentSummary(
            infoHash = infoHash,
            name = name,
            progress = progress,
            status = status,
            totalSize = totalSize,
            downloaded = state?.downloaded ?: 0L,
            uploaded = state?.uploaded ?: 0L,
            fileCount = fileCount,
            addedAt = entry.addedAt,
            hasMetadata = metadata != null,
            userState = state?.userState ?: "active"
        )
    }

    /**
     * Load torrent metadata from either .torrent file or info dict.
     */
    private fun loadMetadata(infoHash: String, source: String): TorrentMetadata? {
        return try {
            if (source == "file") {
                // File-source: load from torrent file
                val torrentFileBase64 = prefs.getString("torrent:$infoHash:torrentfile", null)
                    ?: return null
                TorrentMetadata.fromTorrentFileBase64(torrentFileBase64)
            } else {
                // Magnet-source: load from info dict (may not exist yet)
                val infoDictBase64 = prefs.getString("torrent:$infoHash:infodict", null)
                    ?: return null
                TorrentMetadata.fromInfoDictBase64(infoDictBase64)
            }
        } catch (e: BencodeException) {
            Log.w(TAG, "Failed to parse metadata for $infoHash: ${e.message}")
            null
        }
    }

    /**
     * Calculate approximate progress from hex-encoded bitfield.
     */
    private fun calculateProgressFromBitfield(
        bitfieldHex: String,
        pieceLength: Int,
        totalSize: Long
    ): Double {
        if (totalSize == 0L || pieceLength == 0) return 0.0

        val pieceCount = ((totalSize + pieceLength - 1) / pieceLength).toInt()
        if (pieceCount == 0) return 0.0

        // Count set bits in the bitfield
        var completedPieces = 0
        for (i in bitfieldHex.indices step 2) {
            if (i + 1 < bitfieldHex.length) {
                val byte = bitfieldHex.substring(i, i + 2).toIntOrNull(16) ?: 0
                completedPieces += Integer.bitCount(byte)
            }
        }

        // Clamp to actual piece count (bitfield may have padding bits)
        val actualCompleted = minOf(completedPieces, pieceCount)
        return actualCompleted.toDouble() / pieceCount
    }

    /**
     * Convert cached summary to TorrentSummary for UI compatibility.
     * Speeds will be 0 since we're not running the engine.
     */
    fun CachedTorrentSummary.toTorrentSummary(): TorrentSummary {
        return TorrentSummary(
            infoHash = infoHash,
            name = name,
            progress = progress,
            downloadSpeed = 0L,
            uploadSpeed = 0L,
            status = status,
            numPeers = 0,
            swarmPeers = 0,
            skippedFilesCount = 0
        )
    }

    companion object {
        private const val TAG = "TorrentSummaryCache"
    }
}

/**
 * Cached torrent summary with additional metadata not in TorrentSummary.
 */
data class CachedTorrentSummary(
    val infoHash: String,
    val name: String,
    val progress: Double,
    val status: String,
    val totalSize: Long,
    val downloaded: Long,
    val uploaded: Long,
    val fileCount: Int,
    val addedAt: Long,
    val hasMetadata: Boolean,
    val userState: String
)

// ============================================================================
// JSON data models matching JS engine's session-persistence.ts
// ============================================================================

@Serializable
private data class TorrentListData(
    val version: Int,
    val torrents: List<TorrentListEntry>
)

@Serializable
private data class TorrentListEntry(
    val infoHash: String,
    val source: String, // "file" or "magnet"
    val magnetUri: String? = null,
    val addedAt: Long
)

@Serializable
private data class TorrentStateData(
    val userState: String, // "active", "inactive", "paused"
    val storageKey: String? = null,
    val queuePosition: Int? = null,
    val bitfield: String? = null, // Hex-encoded
    val uploaded: Long = 0,
    val downloaded: Long = 0,
    val updatedAt: Long = 0,
    val filePriorities: List<Int>? = null
)
