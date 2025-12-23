package com.jstorrent.app.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/**
 * Standalone app mode for non-Chromebook devices.
 */
enum class StandaloneMode(val value: String) {
    /** WebView-based UI (loads HTML from assets) */
    WEBVIEW("standalone"),
    /** Native Compose UI with QuickJS engine */
    NATIVE("native")
}

/**
 * Stores the authentication credentials shared between the extension and this app.
 * - token: The shared secret for authenticating requests
 * - installId: Identifies which extension installation is paired (detects reinstalls)
 * - extensionId: The Chrome extension ID that is paired
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREFS_NAME,
        Context.MODE_PRIVATE
    )

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        private set(value) = prefs.edit { putString(KEY_TOKEN, value) }

    var installId: String?
        get() = prefs.getString(KEY_INSTALL_ID, null)
        private set(value) = prefs.edit { putString(KEY_INSTALL_ID, value) }

    var extensionId: String?
        get() = prefs.getString(KEY_EXTENSION_ID, null)
        private set(value) = prefs.edit { putString(KEY_EXTENSION_ID, value) }

    var backgroundModeEnabled: Boolean
        get() = prefs.getBoolean(KEY_BACKGROUND_MODE, false)
        set(value) = prefs.edit { putBoolean(KEY_BACKGROUND_MODE, value) }

    var uiMode: String
        get() = prefs.getString(KEY_UI_MODE, "standalone") ?: "standalone"
        set(value) = prefs.edit { putString(KEY_UI_MODE, value) }

    /**
     * Typed standalone mode setting.
     * Defaults to WEBVIEW for backwards compatibility.
     */
    var standaloneMode: StandaloneMode
        get() = when (prefs.getString(KEY_UI_MODE, "standalone")) {
            "native" -> StandaloneMode.NATIVE
            else -> StandaloneMode.WEBVIEW
        }
        set(value) = prefs.edit { putString(KEY_UI_MODE, value.value) }

    /**
     * Token for standalone mode (local WebView).
     * Auto-generated on first access, persisted across restarts.
     */
    val standaloneToken: String
        get() {
            var existing = prefs.getString(KEY_STANDALONE_TOKEN, null)
            if (existing == null) {
                existing = java.util.UUID.randomUUID().toString()
                prefs.edit { putString(KEY_STANDALONE_TOKEN, existing) }
            }
            return existing
        }

    fun hasToken(): Boolean = token != null

    /**
     * Check if paired with a specific extension installation.
     */
    fun isPairedWith(checkExtensionId: String, checkInstallId: String): Boolean {
        return token != null &&
            extensionId == checkExtensionId &&
            installId == checkInstallId
    }

    /**
     * Validate a token matches the stored token or standalone token.
     * Returns false if no token stored and doesn't match standalone token.
     */
    fun isTokenValid(checkToken: String): Boolean {
        // Check standalone token first (always available)
        if (checkToken == standaloneToken) return true
        // Then check extension pairing token
        val storedToken = token ?: return false
        return storedToken == checkToken
    }

    /**
     * Store pairing credentials atomically.
     */
    fun pair(newToken: String, newInstallId: String, newExtensionId: String) {
        prefs.edit {
            putString(KEY_TOKEN, newToken)
            putString(KEY_INSTALL_ID, newInstallId)
            putString(KEY_EXTENSION_ID, newExtensionId)
        }
    }

    fun clear() {
        prefs.edit {
            remove(KEY_TOKEN)
            remove(KEY_INSTALL_ID)
            remove(KEY_EXTENSION_ID)
        }
    }

    companion object {
        private const val PREFS_NAME = "jstorrent_auth"
        private const val KEY_TOKEN = "auth_token"
        private const val KEY_INSTALL_ID = "install_id"
        private const val KEY_EXTENSION_ID = "extension_id"
        private const val KEY_BACKGROUND_MODE = "background_mode_enabled"
        private const val KEY_STANDALONE_TOKEN = "standalone_token"
        private const val KEY_UI_MODE = "ui_mode"
    }
}
