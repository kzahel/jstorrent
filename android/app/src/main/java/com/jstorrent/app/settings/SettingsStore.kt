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

    companion object {
        private const val PREFS_NAME = "jstorrent_settings"
        private const val KEY_DOWNLOAD_SPEED_LIMIT = "download_speed_limit"
        private const val KEY_UPLOAD_SPEED_LIMIT = "upload_speed_limit"
    }
}
