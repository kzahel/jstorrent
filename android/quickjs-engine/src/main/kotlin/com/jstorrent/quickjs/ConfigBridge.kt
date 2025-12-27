package com.jstorrent.quickjs

import android.util.Log
import com.jstorrent.quickjs.model.ContentRoot
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private const val TAG = "ConfigBridge"

/**
 * Bridge for configuration between Kotlin UI and JS engine.
 *
 * Provides type-safe setters for each config key and syncs changes to the
 * JS engine via __jstorrent_config_set / __jstorrent_config_set_roots.
 *
 * Usage:
 * ```kotlin
 * val configBridge = ConfigBridge(engine)
 * configBridge.setDownloadSpeedLimit(1024 * 100)  // 100 KB/s
 * configBridge.syncRoots(roots, defaultKey)
 * ```
 *
 * @param engine The QuickJS engine to push config changes to
 */
class ConfigBridge(
    private val engine: QuickJsEngine,
) {
    private val json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    // =========================================================================
    // Rate Limits (0 = unlimited)
    // =========================================================================

    /**
     * Set download speed limit in bytes per second.
     * @param bytesPerSec Speed limit, or 0 for unlimited
     */
    fun setDownloadSpeedLimit(bytesPerSec: Int) {
        setConfig("downloadSpeedLimit", bytesPerSec)
    }

    /**
     * Set upload speed limit in bytes per second.
     * @param bytesPerSec Speed limit, or 0 for unlimited
     */
    fun setUploadSpeedLimit(bytesPerSec: Int) {
        setConfig("uploadSpeedLimit", bytesPerSec)
    }

    // =========================================================================
    // Connection Limits
    // =========================================================================

    /**
     * Set maximum peers per torrent.
     */
    fun setMaxPeersPerTorrent(max: Int) {
        setConfig("maxPeersPerTorrent", max)
    }

    /**
     * Set maximum global peers across all torrents.
     */
    fun setMaxGlobalPeers(max: Int) {
        setConfig("maxGlobalPeers", max)
    }

    /**
     * Set maximum upload slots.
     */
    fun setMaxUploadSlots(max: Int) {
        setConfig("maxUploadSlots", max)
    }

    // =========================================================================
    // Features
    // =========================================================================

    /**
     * Enable or disable DHT.
     */
    fun setDhtEnabled(enabled: Boolean) {
        setConfig("dhtEnabled", enabled)
    }

    /**
     * Enable or disable PEX (Peer Exchange).
     */
    fun setPexEnabled(enabled: Boolean) {
        setConfig("pexEnabled", enabled)
    }

    /**
     * Enable or disable UPnP port mapping.
     */
    fun setUpnpEnabled(enabled: Boolean) {
        setConfig("upnpEnabled", enabled)
    }

    // =========================================================================
    // Protocol
    // =========================================================================

    /**
     * Set encryption policy.
     * @param policy One of: "disabled", "allow", "prefer", "required"
     */
    fun setEncryptionPolicy(policy: String) {
        setConfig("encryptionPolicy", policy)
    }

    /**
     * Set listening port.
     * Note: This requires engine restart to take effect.
     * @param port Port number (0 = random)
     */
    fun setListeningPort(port: Int) {
        setConfig("listeningPort", port)
    }

    // =========================================================================
    // Advanced
    // =========================================================================

    /**
     * Set daemon operations per second rate limit.
     */
    fun setDaemonOpsPerSecond(ops: Int) {
        setConfig("daemonOpsPerSecond", ops)
    }

    /**
     * Set daemon operations burst capacity.
     */
    fun setDaemonOpsBurst(burst: Int) {
        setConfig("daemonOpsBurst", burst)
    }

    // =========================================================================
    // Logging
    // =========================================================================

    /**
     * Set global logging level.
     * @param level One of: "debug", "info", "warn", "error"
     */
    fun setLoggingLevel(level: String) {
        setConfig("loggingLevel", level)
    }

    // =========================================================================
    // Batch Updates
    // =========================================================================

    /**
     * Set multiple config values at once.
     * @param updates Map of key to value
     */
    fun batchUpdate(updates: Map<String, Any>) {
        try {
            val updatesJson = json.encodeToString(updates)
            engine.callGlobalFunction("__jstorrent_config_batch", updatesJson)
            Log.d(TAG, "Batch update: ${updates.keys.joinToString()}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to batch update config", e)
        }
    }

    // =========================================================================
    // Storage Roots
    // =========================================================================

    /**
     * Push storage roots to JS engine.
     * Called after RootStore changes.
     *
     * @param roots List of content roots
     * @param defaultKey Default root key (or null for no default)
     */
    fun syncRoots(roots: List<ContentRoot>, defaultKey: String?) {
        try {
            val rootsJson = json.encodeToString(roots)
            engine.callGlobalFunction(
                "__jstorrent_config_set_roots",
                rootsJson,
                defaultKey ?: ""
            )
            Log.d(TAG, "Synced ${roots.size} roots, default=$defaultKey")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to sync roots", e)
        }
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * Generic setter for any config key.
     */
    private fun setConfig(key: String, value: Any) {
        try {
            val valueJson = when (value) {
                is String -> json.encodeToString(value)
                is Boolean -> value.toString()
                is Int -> value.toString()
                is Long -> value.toString()
                is Double -> value.toString()
                else -> json.encodeToString(value.toString())
            }
            engine.callGlobalFunction("__jstorrent_config_set", key, valueJson)
            Log.d(TAG, "Set config: $key = $valueJson")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to set config $key", e)
        }
    }
}
