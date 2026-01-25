package com.jstorrent.quickjs.bindings

import android.content.Context
import android.content.SharedPreferences
import com.jstorrent.quickjs.QuickJsContext
import org.json.JSONArray

private const val PREFS_NAME = "jstorrent_session"

/**
 * Storage bindings for QuickJS using Android SharedPreferences.
 *
 * Implements the following native functions:
 * - __jstorrent_storage_get(key) -> string | null
 * - __jstorrent_storage_set(key, value) -> void
 * - __jstorrent_storage_delete(key) -> void
 * - __jstorrent_storage_keys(prefix) -> string (JSON array)
 *
 * All operations are synchronous - they block the JS thread until complete.
 * SharedPreferences operations are generally very fast.
 */
class StorageBindings(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Register all storage bindings on the given context.
     */
    fun register(ctx: QuickJsContext) {
        // __jstorrent_storage_get(key: string): string | null
        ctx.setGlobalFunction("__jstorrent_storage_get") { args ->
            val key = args.getOrNull(0) ?: return@setGlobalFunction null
            prefs.getString(key, null)
        }

        // __jstorrent_storage_set(key: string, value: string): void
        ctx.setGlobalFunction("__jstorrent_storage_set") { args ->
            val key = args.getOrNull(0)
            val value = args.getOrNull(1)

            if (key != null && value != null) {
                // Use commit() for synchronous write to ensure data is persisted
                // before the JS call returns. This prevents data loss if the app
                // is closed shortly after adding a torrent.
                prefs.edit().putString(key, value).commit()
            }
            null
        }

        // __jstorrent_storage_delete(key: string): void
        ctx.setGlobalFunction("__jstorrent_storage_delete") { args ->
            val key = args.getOrNull(0)

            if (key != null) {
                prefs.edit().remove(key).commit()
            }
            null
        }

        // __jstorrent_storage_keys(prefix: string): string (JSON array)
        ctx.setGlobalFunction("__jstorrent_storage_keys") { args ->
            val prefix = args.getOrNull(0) ?: ""

            val keys = prefs.all.keys.filter { it.startsWith(prefix) }

            JSONArray().apply {
                keys.forEach { put(it) }
            }.toString()
        }
    }
}
