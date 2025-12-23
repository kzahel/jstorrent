package com.jstorrent.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * JavaScript bridge for key-value storage.
 * Backs the engine's session and settings stores via SharedPreferences.
 *
 * Called from JS as: window.KVBridge.get("key")
 */
class KVBridge(context: Context) {

    private val prefs = context.getSharedPreferences("jstorrent_kv", Context.MODE_PRIVATE)

    @JavascriptInterface
    fun get(key: String): String? {
        return prefs.getString(key, null)
    }

    @JavascriptInterface
    fun set(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    @JavascriptInterface
    fun delete(key: String) {
        prefs.edit().remove(key).apply()
    }

    @JavascriptInterface
    fun clear() {
        prefs.edit().clear().apply()
    }

    /**
     * Get all keys matching a prefix.
     * Returns JSON array of keys.
     */
    @JavascriptInterface
    fun keys(prefix: String): String {
        val matchingKeys = prefs.all.keys.filter { it.startsWith(prefix) }
        return JSONArray(matchingKeys).toString()
    }

    /**
     * Get multiple values at once.
     * Input: JSON array of keys
     * Output: JSON object { key: value, ... } (null values omitted)
     */
    @JavascriptInterface
    fun getMulti(keysJson: String): String {
        val keys = JSONArray(keysJson)
        val result = JSONObject()
        for (i in 0 until keys.length()) {
            val key = keys.getString(i)
            prefs.getString(key, null)?.let { result.put(key, it) }
        }
        return result.toString()
    }
}
