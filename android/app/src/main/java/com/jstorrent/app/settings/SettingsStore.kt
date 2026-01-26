package com.jstorrent.app.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/**
 * Persists engine settings in SharedPreferences.
 * Settings are loaded on engine startup and applied via ConfigBridge.
 */
class SettingsStore(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREFS_NAME,
        Context.MODE_PRIVATE
    )

    /**
     * Whether download speed is unlimited.
     */
    var downloadSpeedUnlimited: Boolean
        get() = prefs.getBoolean(KEY_DOWNLOAD_SPEED_UNLIMITED, true)
        set(value) = prefs.edit { putBoolean(KEY_DOWNLOAD_SPEED_UNLIMITED, value) }

    /**
     * Download speed limit in bytes/sec (used when downloadSpeedUnlimited is false).
     */
    var downloadSpeedLimit: Int
        get() = prefs.getInt(KEY_DOWNLOAD_SPEED_LIMIT, 1048576) // Default 1 MB/s
        set(value) = prefs.edit { putInt(KEY_DOWNLOAD_SPEED_LIMIT, value) }

    /**
     * Whether upload speed is unlimited.
     */
    var uploadSpeedUnlimited: Boolean
        get() = prefs.getBoolean(KEY_UPLOAD_SPEED_UNLIMITED, true)
        set(value) = prefs.edit { putBoolean(KEY_UPLOAD_SPEED_UNLIMITED, value) }

    /**
     * Upload speed limit in bytes/sec (used when uploadSpeedUnlimited is false).
     */
    var uploadSpeedLimit: Int
        get() = prefs.getInt(KEY_UPLOAD_SPEED_LIMIT, 1048576) // Default 1 MB/s
        set(value) = prefs.edit { putInt(KEY_UPLOAD_SPEED_LIMIT, value) }

    /**
     * Key of the default download folder. Null means use first available.
     */
    var defaultRootKey: String?
        get() = prefs.getString(KEY_DEFAULT_ROOT_KEY, null)
        set(value) = prefs.edit { putString(KEY_DEFAULT_ROOT_KEY, value) }

    /**
     * Behavior when downloads complete: "stop_and_close" or "keep_seeding".
     */
    var whenDownloadsComplete: String
        get() = prefs.getString(KEY_WHEN_DOWNLOADS_COMPLETE, "stop_and_close") ?: "stop_and_close"
        set(value) = prefs.edit { putString(KEY_WHEN_DOWNLOADS_COMPLETE, value) }

    /**
     * Whether to only download on WiFi (pause on cellular).
     */
    var wifiOnlyEnabled: Boolean
        get() = prefs.getBoolean(KEY_WIFI_ONLY_ENABLED, false)
        set(value) = prefs.edit { putBoolean(KEY_WIFI_ONLY_ENABLED, value) }

    /**
     * Whether DHT (Distributed Hash Table) is enabled.
     */
    var dhtEnabled: Boolean
        get() = prefs.getBoolean(KEY_DHT_ENABLED, true)
        set(value) = prefs.edit { putBoolean(KEY_DHT_ENABLED, value) }

    /**
     * Whether PEX (Peer Exchange) is enabled.
     */
    var pexEnabled: Boolean
        get() = prefs.getBoolean(KEY_PEX_ENABLED, true)
        set(value) = prefs.edit { putBoolean(KEY_PEX_ENABLED, value) }

    /**
     * Whether UPnP port mapping is enabled.
     */
    var upnpEnabled: Boolean
        get() = prefs.getBoolean(KEY_UPNP_ENABLED, true)
        set(value) = prefs.edit { putBoolean(KEY_UPNP_ENABLED, value) }

    /**
     * Protocol encryption policy: "disabled", "allow", "prefer", "required".
     */
    var encryptionPolicy: String
        get() = prefs.getString(KEY_ENCRYPTION_POLICY, "allow") ?: "allow"
        set(value) = prefs.edit { putString(KEY_ENCRYPTION_POLICY, value) }

    /**
     * Whether we've shown the notification permission prompt (first launch only).
     */
    var hasShownNotificationPrompt: Boolean
        get() = prefs.getBoolean(KEY_HAS_SHOWN_NOTIFICATION_PROMPT, false)
        set(value) = prefs.edit { putBoolean(KEY_HAS_SHOWN_NOTIFICATION_PROMPT, value) }

    /**
     * Whether to continue downloads in the background when the app is closed.
     * OFF by default - user must opt-in. Requires notification permission.
     */
    var backgroundDownloadsEnabled: Boolean
        get() = prefs.getBoolean(KEY_BACKGROUND_DOWNLOADS_ENABLED, false)
        set(value) = prefs.edit { putBoolean(KEY_BACKGROUND_DOWNLOADS_ENABLED, value) }

    // =========================================================================
    // Connection Limits
    // =========================================================================

    /**
     * Maximum peers per torrent.
     */
    var maxPeersPerTorrent: Int
        get() = prefs.getInt(KEY_MAX_PEERS_PER_TORRENT, 20)
        set(value) = prefs.edit { putInt(KEY_MAX_PEERS_PER_TORRENT, value) }

    /**
     * Maximum global peers across all torrents.
     */
    var maxGlobalPeers: Int
        get() = prefs.getInt(KEY_MAX_GLOBAL_PEERS, 200)
        set(value) = prefs.edit { putInt(KEY_MAX_GLOBAL_PEERS, value) }

    /**
     * Maximum upload slots.
     */
    var maxUploadSlots: Int
        get() = prefs.getInt(KEY_MAX_UPLOAD_SLOTS, 4)
        set(value) = prefs.edit { putInt(KEY_MAX_UPLOAD_SLOTS, value) }

    /**
     * Maximum pipeline depth (outstanding block requests per peer).
     * Default is 50 for Android standalone (lower than desktop's 500 for battery/resource efficiency).
     */
    var maxPipelineDepth: Int
        get() = prefs.getInt(KEY_MAX_PIPELINE_DEPTH, 50)
        set(value) = prefs.edit { putInt(KEY_MAX_PIPELINE_DEPTH, value) }

    companion object {
        private const val PREFS_NAME = "jstorrent_settings"
        private const val KEY_DOWNLOAD_SPEED_UNLIMITED = "download_speed_unlimited"
        private const val KEY_DOWNLOAD_SPEED_LIMIT = "download_speed_limit"
        private const val KEY_UPLOAD_SPEED_UNLIMITED = "upload_speed_unlimited"
        private const val KEY_UPLOAD_SPEED_LIMIT = "upload_speed_limit"
        private const val KEY_DEFAULT_ROOT_KEY = "default_root_key"
        private const val KEY_WHEN_DOWNLOADS_COMPLETE = "when_downloads_complete"
        private const val KEY_WIFI_ONLY_ENABLED = "wifi_only_enabled"
        private const val KEY_DHT_ENABLED = "dht_enabled"
        private const val KEY_PEX_ENABLED = "pex_enabled"
        private const val KEY_UPNP_ENABLED = "upnp_enabled"
        private const val KEY_ENCRYPTION_POLICY = "encryption_policy"
        private const val KEY_HAS_SHOWN_NOTIFICATION_PROMPT = "has_shown_notification_prompt"
        private const val KEY_BACKGROUND_DOWNLOADS_ENABLED = "background_downloads_enabled"
        // Connection limits
        private const val KEY_MAX_PEERS_PER_TORRENT = "max_peers_per_torrent"
        private const val KEY_MAX_GLOBAL_PEERS = "max_global_peers"
        private const val KEY_MAX_UPLOAD_SLOTS = "max_upload_slots"
        private const val KEY_MAX_PIPELINE_DEPTH = "max_pipeline_depth"
    }
}
