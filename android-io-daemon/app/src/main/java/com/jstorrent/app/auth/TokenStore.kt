package com.jstorrent.app.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/**
 * Stores the authentication token shared between the extension and this app.
 * The extension generates a token, sends it via intent, and uses it for all requests.
 */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(
        PREFS_NAME,
        Context.MODE_PRIVATE
    )

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit { putString(KEY_TOKEN, value) }

    fun hasToken(): Boolean = token != null

    fun clear() {
        prefs.edit { remove(KEY_TOKEN) }
    }

    companion object {
        private const val PREFS_NAME = "jstorrent_auth"
        private const val KEY_TOKEN = "auth_token"
    }
}
