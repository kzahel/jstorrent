package com.jstorrent.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface
import com.jstorrent.app.storage.RootStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * JavaScript bridge for download root access.
 * Exposes SAF-selected folders to the WebView.
 */
class RootsBridge(private val context: Context) {

    private val rootStore by lazy { RootStore(context) }

    @JavascriptInterface
    fun hasDownloadRoot(): Boolean {
        return rootStore.listRoots().isNotEmpty()
    }

    @JavascriptInterface
    fun getDownloadRoots(): String {
        val roots = rootStore.listRoots()
        val arr = JSONArray()
        for (root in roots) {
            arr.put(JSONObject().apply {
                put("key", root.key)
                put("uri", root.uri)
                put("displayName", root.displayName)
                put("available", root.lastStatOk)
            })
        }
        return arr.toString()
    }

    @JavascriptInterface
    fun getDefaultRootKey(): String? {
        return rootStore.listRoots().firstOrNull()?.key
    }

    /**
     * Reload roots from disk.
     * Call after adding roots from another component.
     */
    fun reload() {
        rootStore.reload()
    }
}
