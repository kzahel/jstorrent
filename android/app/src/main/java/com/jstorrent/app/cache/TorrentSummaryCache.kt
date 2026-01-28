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
 * The cache reads the same SharedPreferences that the JS engine uses (jstorrent_session),
 * parsing the bencoded torrent files to extract metadata.
 *
 * Storage format:
 * - Keys are prefixed with "session:" (e.g., "session:torrents")
 * - JSON values are prefixed with "json:" (e.g., "json:{...}")
 */
open class TorrentSummaryCache(context: Context?) {

    private val prefs: SharedPreferences? =
        context?.getSharedPreferences("jstorrent_session", Context.MODE_PRIVATE)

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Get a session value, stripping the "json:" prefix if present.
     */
    private fun getSessionJson(key: String): String? {
        val value = prefs?.getString("session:$key", null) ?: return null
        return if (value.startsWith("json:")) value.substring(5) else value
    }

    /**
     * Get a raw binary value stored by the JS engine.
     *
     * The JS engine stores binary data with double-encoding:
     * 1. Binary data → base64 string
     * 2. String → UTF-8 bytes (TextEncoder)
     * 3. UTF-8 bytes → base64 for storage
     *
     * So stored value is: base64(utf8Encode(base64(raw)))
     *
     * This method decodes the outer base64 and UTF-8 to return the inner base64 string,
     * which can then be decoded by the caller to get the raw bytes.
     */
    private fun getSessionBinary(key: String): String? {
        val storedValue = prefs?.getString("session:$key", null) ?: return null
        return try {
            // Decode outer base64 to get UTF-8 bytes
            val utf8Bytes = Base64.decode(storedValue, Base64.DEFAULT)
            // Decode UTF-8 to get inner base64 string
            String(utf8Bytes, Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to decode binary value for $key: ${e.message}")
            null
        }
    }

    protected val _cachedSummaries = MutableStateFlow<List<CachedTorrentSummary>>(emptyList())
    protected val _isLoaded = MutableStateFlow(false)

    /**
     * Flow of cached torrent summaries.
     * Emits immediately with cached data, no engine required.
     */
    open val summaries: Flow<List<CachedTorrentSummary>> = _cachedSummaries.asStateFlow()

    /**
     * Whether the cache has finished loading.
     * Use this to distinguish "still loading" from "loaded but empty".
     */
    open val isLoaded: Flow<Boolean> = _isLoaded.asStateFlow()

    /**
     * Load cached summaries from SharedPreferences.
     * Call this on app startup before engine initialization.
     */
    open suspend fun load(): List<CachedTorrentSummary> = withContext(Dispatchers.IO) {
        val summaries = mutableListOf<CachedTorrentSummary>()
        val localPrefs = prefs

        if (localPrefs != null) {
            try {
                // Load the torrent list index
                val torrentListJson = getSessionJson("torrents")
                if (torrentListJson != null) {
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
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load torrent list", e)
            }
        }

        _cachedSummaries.value = summaries
        _isLoaded.value = true
        summaries
    }

    /**
     * Check if there are any cached torrents.
     * Fast check without full parsing.
     */
    open fun hasCachedTorrents(): Boolean {
        val torrentListJson = getSessionJson("torrents") ?: return false
        return try {
            val torrentList = json.decodeFromString<TorrentListData>(torrentListJson)
            torrentList.torrents.isNotEmpty()
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Check if there are any active incomplete torrents that need the engine to run.
     * Used by ServiceLifecycleManager to decide if engine should start in background.
     *
     * An "active incomplete" torrent is one with:
     * - userState == "active" (user wants it running)
     * - progress < 1.0 (not yet complete)
     *
     * This is a lightweight check - it only parses torrent state, not full metadata.
     *
     * @return true if there are active incomplete torrents that need the engine
     */
    open fun hasActiveIncompleteTorrents(): Boolean {
        val torrentListJson = getSessionJson("torrents") ?: return false
        return try {
            val torrentList = json.decodeFromString<TorrentListData>(torrentListJson)

            for (entry in torrentList.torrents) {
                val stateJson = getSessionJson("torrent:${entry.infoHash}:state") ?: continue
                try {
                    val state = json.decodeFromString<TorrentStateData>(stateJson)

                    // Check if torrent is active (user wants it running)
                    if (state.userState != "active") continue

                    // Check if it's incomplete (needs downloading)
                    // If we have a bitfield, we can check progress; otherwise assume incomplete
                    val isComplete = if (state.bitfield != null) {
                        // Quick check: if bitfield is all 0xFF bytes, it's likely complete
                        // This is a heuristic - full progress calculation needs metadata
                        state.bitfield.all { it == 'f' || it == 'F' }
                    } else {
                        // No bitfield = metadata-only magnet or no progress yet
                        false
                    }

                    if (!isComplete) {
                        return true  // Found an active incomplete torrent
                    }
                } catch (e: Exception) {
                    // If we can't parse state, assume it might need work
                    Log.w(TAG, "Failed to parse state for ${entry.infoHash}, assuming incomplete")
                    return true
                }
            }
            false
        } catch (e: Exception) {
            Log.w(TAG, "Failed to check for active incomplete torrents: ${e.message}")
            false
        }
    }

    /**
     * Load a single torrent summary from persisted data.
     */
    private fun loadTorrentSummary(entry: TorrentListEntry): CachedTorrentSummary? {
        val infoHash = entry.infoHash

        // Load torrent state (userState, bitfield, uploaded, downloaded)
        val stateJson = getSessionJson("torrent:$infoHash:state")
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

        // If we have no metadata (magnet without infodict yet), use dn= param or placeholder
        val name = metadata?.name
            ?: entry.magnetUri?.let { parseDisplayName(it) }
            ?: "Fetching metadata..."
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
     *
     * Stage 5: Catches all exceptions (not just BencodeException) to handle:
     * - Corrupted base64 data (IllegalArgumentException)
     * - Corrupted bencode data (BencodeException)
     * - Missing/deleted files (returns null gracefully)
     */
    private fun loadMetadata(infoHash: String, source: String): TorrentMetadata? {
        return try {
            if (source == "file") {
                // File-source: load from torrent file
                val torrentFileBase64 = getSessionBinary("torrent:$infoHash:torrentfile")
                    ?: return null
                TorrentMetadata.fromTorrentFileBase64(torrentFileBase64)
            } else {
                // Magnet-source: load from info dict (may not exist yet)
                val infoDictBase64 = getSessionBinary("torrent:$infoHash:infodict")
                    ?: return null
                TorrentMetadata.fromInfoDictBase64(infoDictBase64)
            }
        } catch (e: Exception) {
            // Stage 5: Catch all exceptions to handle corrupted data gracefully
            Log.w(TAG, "Failed to parse metadata for $infoHash: ${e.message}")
            null
        }
    }

    companion object {
        private const val TAG = "TorrentSummaryCache"

        /**
         * Parse display name (dn=) from magnet URI.
         * Example: magnet:?xt=urn:btih:...&dn=Ubuntu+20.04
         *
         * Uses simple string parsing instead of android.net.Uri for testability.
         */
        internal fun parseDisplayName(magnetUri: String): String? {
            return try {
                // Find dn= parameter
                val dnStart = magnetUri.indexOf("dn=")
                if (dnStart == -1) return null

                val valueStart = dnStart + 3
                val valueEnd = magnetUri.indexOf('&', valueStart).takeIf { it != -1 }
                    ?: magnetUri.length

                val encoded = magnetUri.substring(valueStart, valueEnd)
                java.net.URLDecoder.decode(encoded, "UTF-8")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to parse dn from magnet: ${e.message}")
                null
            }
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
     *
     * Stage 5: Passes hasMetadata flag so UI can show "—" for unknown values.
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
            skippedFilesCount = 0,
            hasMetadata = hasMetadata
        )
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
