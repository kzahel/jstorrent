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
     * Download speed limit in bytes/sec. 0 = unlimited.
     */
    var downloadSpeedLimit: Int
        get() = prefs.getInt(KEY_DOWNLOAD_SPEED_LIMIT, 0)
        set(value) = prefs.edit { putInt(KEY_DOWNLOAD_SPEED_LIMIT, value) }

    /**
     * Upload speed limit in bytes/sec. 0 = unlimited.
     */
    var uploadSpeedLimit: Int
        get() = prefs.getInt(KEY_UPLOAD_SPEED_LIMIT, 0)
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
     * Protocol encryption policy: "disabled", "allow", "prefer", "required".
     */
    var encryptionPolicy: String
        get() = prefs.getString(KEY_ENCRYPTION_POLICY, "allow") ?: "allow"
        set(value) = prefs.edit { putString(KEY_ENCRYPTION_POLICY, value) }

    companion object {
        private const val PREFS_NAME = "jstorrent_settings"
        private const val KEY_DOWNLOAD_SPEED_LIMIT = "download_speed_limit"
        private const val KEY_UPLOAD_SPEED_LIMIT = "upload_speed_limit"
        private const val KEY_DEFAULT_ROOT_KEY = "default_root_key"
        private const val KEY_WHEN_DOWNLOADS_COMPLETE = "when_downloads_complete"
        private const val KEY_WIFI_ONLY_ENABLED = "wifi_only_enabled"
        private const val KEY_DHT_ENABLED = "dht_enabled"
        private const val KEY_PEX_ENABLED = "pex_enabled"
        private const val KEY_ENCRYPTION_POLICY = "encryption_policy"
    }
}
