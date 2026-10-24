package org.rstorrent.bootstrap

import android.content.Context
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.rstorrent.bootstrap.uniffi.migrateLegacyAndroid

/** Runs on the service initialization dispatcher before native engine admission. */
internal object ProductLegacyAndroidMigration {
    fun hasMigratedSource(context: Context): Boolean =
        context.getSharedPreferences("product-legacy-bootstrap", Context.MODE_PRIVATE)
            .getBoolean("migrated_source", false)

    fun run(context: Context) {
        // Incubation remains a separate product. Same-package replacement opts in.
        if (context.packageName != "com.jstorrent.app") return
        val completed = context.getSharedPreferences("product-legacy-bootstrap", Context.MODE_PRIVATE)
        // Explicit profile clearing must not resurrect retained old source data.
        if (completed.getBoolean("complete", false)) return
        val registry = ProductSafRootRegistry.load(context)
        val bindings = JSONArray()
        registry.roots.forEach { root ->
            bindings.put(JSONObject().put("root_id", root.rootId).put("label", root.label).put("tree_uri", root.treeUri))
        }
        val legacy = context.getSharedPreferences("jstorrent_settings", Context.MODE_PRIVATE)
        val registryBudget =
            if (registry.roots.size >= ProductSafRootRegistry.MAX_ROOTS) 0
            else ProductSafRootRegistry.MAX_ENCODED_BYTES - ProductSafRootRegistryCodec.encode(registry).length
        val preferences = JSONObject().put("_registry_budget_bytes", registryBudget)
        for (key in listOf("wifi_only_enabled", "background_downloads_enabled", "cpu_wake_lock_enabled", "show_file_selection", "when_downloads_complete")) {
            val value = legacy.all[key]
            if (value is Boolean || value is String) preferences.put(key, value)
        }
        val result = migrateLegacyAndroid(
            File(context.filesDir, ProductPrivateProfileReset.PROFILE_DIRECTORY).absolutePath,
            context.getDatabasePath("jstorrent_kv.db").absolutePath,
            context.filesDir.absolutePath,
            context.cacheDir.absolutePath,
            preferences.toString(),
            bindings.toString(),
        )
        if (result == "null") {
            // Fresh successor installs must also retire this one-time boundary.
            check(completed.edit().putBoolean("complete", true).commit())
            return
        }
        val bootstrap = JSONObject(result)
        val roots = bootstrap.getJSONArray("roots")
        ProductSafRootRegistry.restoreLegacyBindings(context, List(roots.length()) { index ->
            val root = roots.getJSONObject(index)
            ProductSafRootGrant(root.getString("root_id"), root.getString("label"), root.getString("tree_uri"), 1)
        })
        if (!bootstrap.getJSONObject("report").getBoolean("settings_preserved")) {
            val supported = bootstrap.getJSONObject("preferences")
            copyBoolean(context, supported, "wifi_only_enabled", "product_network", "unmetered_networks_only")
            copyBoolean(context, supported, "background_downloads_enabled", "product_lifecycle", "background_downloads_enabled")
            copyBoolean(context, supported, "cpu_wake_lock_enabled", "product_power", "prevent_sleep_during_active_downloads")
            if (supported.has("when_downloads_complete")) {
                val target = context.getSharedPreferences("product_lifecycle", Context.MODE_PRIVATE)
                if (!target.contains("background_completion_policy")) {
                    val value = if (supported.getString("when_downloads_complete") == "keep_seeding") "keep_seeding" else "stop_when_downloads_complete"
                    check(target.edit().putString("background_completion_policy", value).commit())
                }
            }
        }
        check(completed.edit().putBoolean("migrated_source", true).putBoolean("complete", true).commit())
    }

    private fun copyBoolean(context: Context, source: JSONObject, sourceKey: String, file: String, targetKey: String) {
        val target = context.getSharedPreferences(file, Context.MODE_PRIVATE)
        if (source.has(sourceKey) && !target.contains(targetKey)) {
            check(target.edit().putBoolean(targetKey, source.getBoolean(sourceKey)).commit())
        }
    }
}
