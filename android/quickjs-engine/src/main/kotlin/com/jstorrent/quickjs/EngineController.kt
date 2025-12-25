package com.jstorrent.quickjs

import android.content.Context
import android.net.Uri
import android.util.Log
import com.jstorrent.io.file.FileManager
import com.jstorrent.io.file.FileManagerImpl
import com.jstorrent.quickjs.bindings.EngineErrorListener
import com.jstorrent.quickjs.bindings.EngineStateListener
import com.jstorrent.quickjs.bindings.NativeBindings
import com.jstorrent.quickjs.model.EngineConfig
import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.FileListResponse
import com.jstorrent.quickjs.model.TorrentInfo
import com.jstorrent.quickjs.model.TorrentListResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.Closeable

private const val TAG = "EngineController"

/**
 * High-level controller for the JSTorrent engine.
 *
 * Wraps QuickJsEngine and NativeBindings, exposing a Kotlin-friendly API
 * for controlling torrents. State updates are exposed via StateFlow.
 *
 * Usage:
 * ```kotlin
 * val controller = EngineController(context, scope)
 * controller.loadEngine(config)
 * controller.addTorrent("magnet:?xt=...")
 * controller.state.collect { state -> updateUI(state) }
 * controller.close()
 * ```
 *
 * @param context Android context
 * @param scope Coroutine scope for I/O operations
 * @param fileManager Optional FileManager for file I/O (defaults to FileManagerImpl)
 * @param rootResolver Optional resolver for rootKey → SAF URI (defaults to app-private fallback)
 */
class EngineController(
    private val context: Context,
    private val scope: CoroutineScope,
    private val fileManager: FileManager = FileManagerImpl(context),
    private val rootResolver: (String) -> Uri? = { null },
) : Closeable {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private var engine: QuickJsEngine? = null
    private var bindings: NativeBindings? = null
    private var configBridge: ConfigBridge? = null

    // State exposed to UI
    private val _state = MutableStateFlow<EngineState?>(null)
    val state: StateFlow<EngineState?> = _state.asStateFlow()

    private val _isLoaded = MutableStateFlow(false)
    val isLoaded: StateFlow<Boolean> = _isLoaded.asStateFlow()

    private val _lastError = MutableStateFlow<String?>(null)
    val lastError: StateFlow<String?> = _lastError.asStateFlow()

    /**
     * Load the engine bundle and initialize with configuration.
     *
     * @param config Engine configuration including content roots
     * @throws IllegalStateException if already loaded
     */
    fun loadEngine(config: EngineConfig) {
        check(engine == null) { "Engine already loaded" }

        Log.i(TAG, "Loading engine...")

        // Create QuickJS engine
        engine = QuickJsEngine()

        // Register native bindings
        bindings = NativeBindings(context, engine!!.jsThread, scope, fileManager, rootResolver).apply {
            stateListener = object : EngineStateListener {
                override fun onStateUpdate(stateJson: String) {
                    handleStateUpdate(stateJson)
                }
            }
            errorListener = object : EngineErrorListener {
                override fun onError(errorJson: String) {
                    handleError(errorJson)
                }
            }
        }

        // Register bindings on JS thread
        engine!!.postAndWait {
            bindings!!.registerAll(engine!!.context)
        }

        // Load bundle from assets
        val bundleJs = context.assets.open("engine.bundle.js").bufferedReader().use { it.readText() }
        Log.i(TAG, "Bundle loaded: ${bundleJs.length / 1024} KB")

        // Evaluate bundle
        engine!!.evaluate(bundleJs, "engine.bundle.js")
        Log.i(TAG, "Bundle evaluated")

        // Initialize engine with config
        val configJson = json.encodeToString(config)
        engine!!.evaluate("globalThis.jstorrent.init($configJson)", "init.js")

        // Execute pending jobs to complete async initialization
        // The init() call starts async work that needs microtasks to be pumped
        engine!!.executeAllPendingJobs()
        Log.i(TAG, "Engine initialized with ${config.contentRoots.size} content roots")

        // Create ConfigBridge for config management
        configBridge = ConfigBridge(engine!!)

        // Sync initial roots via ConfigBridge
        config.contentRoots.let { roots ->
            if (roots.isNotEmpty()) {
                configBridge?.syncRoots(roots, config.defaultContentRoot)
            }
        }

        _isLoaded.value = true
    }

    /**
     * Get the ConfigBridge for managing engine configuration.
     * Returns null if engine is not loaded.
     */
    fun getConfigBridge(): ConfigBridge? = configBridge

    /**
     * Add a torrent from magnet link or base64-encoded .torrent file.
     *
     * Result is async - observe state flow for updates.
     */
    fun addTorrent(magnetOrBase64: String) {
        checkLoaded()
        val escaped = magnetOrBase64.replace("\\", "\\\\").replace("'", "\\'")
        engine!!.callGlobalFunction("__jstorrent_cmd_add_torrent", escaped)
        Log.i(TAG, "addTorrent called")
    }

    /**
     * Pause a torrent by info hash.
     */
    fun pauseTorrent(infoHash: String) {
        checkLoaded()
        engine!!.callGlobalFunction("__jstorrent_cmd_pause", infoHash)
        Log.i(TAG, "pauseTorrent: $infoHash")
    }

    /**
     * Resume a paused torrent.
     */
    fun resumeTorrent(infoHash: String) {
        checkLoaded()
        engine!!.callGlobalFunction("__jstorrent_cmd_resume", infoHash)
        Log.i(TAG, "resumeTorrent: $infoHash")
    }

    /**
     * Remove a torrent.
     *
     * @param infoHash The torrent's info hash
     * @param deleteFiles If true, also delete downloaded files
     */
    fun removeTorrent(infoHash: String, deleteFiles: Boolean = false) {
        checkLoaded()
        engine!!.callGlobalFunction(
            "__jstorrent_cmd_remove",
            infoHash,
            deleteFiles.toString()
        )
        Log.i(TAG, "removeTorrent: $infoHash (deleteFiles=$deleteFiles)")
    }

    /**
     * Add a test torrent with hardcoded peer hint for debugging.
     * Uses a local qBittorrent seeder at 192.168.1.112:6082.
     */
    fun addTestTorrent() {
        checkLoaded()
        engine!!.callGlobalFunction("__jstorrent_cmd_add_test_torrent")
        Log.i(TAG, "addTestTorrent called")
    }

    // =========================================================================
    // Root Management (Deprecated - use ConfigBridge.syncRoots instead)
    // =========================================================================

    /**
     * Add a storage root at runtime.
     * Call this when user selects a new SAF folder.
     *
     * @param key Unique identifier for the root (SHA256 prefix)
     * @param label Human-readable name
     * @param uri SAF tree URI
     *
     * @deprecated Use [getConfigBridge].[syncRoots] instead for unified config management.
     */
    @Deprecated(
        message = "Use ConfigBridge.syncRoots() instead",
        replaceWith = ReplaceWith("getConfigBridge()?.syncRoots(roots, defaultKey)")
    )
    fun addRoot(key: String, label: String, uri: String) {
        checkLoaded()
        engine!!.callGlobalFunction(
            "__jstorrent_cmd_add_root",
            key.escapeJs(),
            label.escapeJs(),
            uri.escapeJs()
        )
        Log.i(TAG, "Added root to engine: $key -> $label")
    }

    /**
     * Set the default storage root.
     * New torrents will use this root unless explicitly assigned.
     *
     * @deprecated Use [getConfigBridge].[syncRoots] instead for unified config management.
     */
    @Deprecated(
        message = "Use ConfigBridge.syncRoots() instead",
        replaceWith = ReplaceWith("getConfigBridge()?.syncRoots(roots, defaultKey)")
    )
    fun setDefaultRoot(key: String) {
        checkLoaded()
        engine!!.callGlobalFunction("__jstorrent_cmd_set_default_root", key.escapeJs())
        Log.i(TAG, "Set default root: $key")
    }

    /**
     * Remove a storage root.
     *
     * @deprecated Use [getConfigBridge].[syncRoots] instead for unified config management.
     */
    @Deprecated(
        message = "Use ConfigBridge.syncRoots() instead",
        replaceWith = ReplaceWith("getConfigBridge()?.syncRoots(roots, defaultKey)")
    )
    fun removeRoot(key: String) {
        checkLoaded()
        engine!!.callGlobalFunction("__jstorrent_cmd_remove_root", key.escapeJs())
        Log.i(TAG, "Removed root: $key")
    }

    private fun String.escapeJs(): String {
        return this.replace("\\", "\\\\").replace("'", "\\'")
    }

    /**
     * Get the full torrent list with detailed info.
     *
     * For frequent updates, prefer observing [state] instead.
     */
    fun getTorrentList(): List<TorrentInfo> {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunction("__jstorrent_query_torrent_list") as? String
            ?: return emptyList()
        return try {
            json.decodeFromString<TorrentListResponse>(resultJson).torrents
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse torrent list", e)
            emptyList()
        }
    }

    /**
     * Get file list for a specific torrent.
     */
    fun getFiles(infoHash: String): List<FileInfo> {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunction("__jstorrent_query_files", infoHash) as? String
            ?: return emptyList()
        return try {
            json.decodeFromString<FileListResponse>(resultJson).files
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse file list", e)
            emptyList()
        }
    }

    /**
     * Shutdown the engine and release resources.
     */
    override fun close() {
        Log.i(TAG, "Shutting down engine...")

        configBridge = null

        bindings?.shutdown()
        bindings = null

        engine?.close()
        engine = null

        _isLoaded.value = false
        _state.value = null

        Log.i(TAG, "Engine shut down")
    }

    private fun checkLoaded() {
        check(engine != null) { "Engine not loaded. Call loadEngine() first." }
    }

    private fun handleStateUpdate(stateJson: String) {
        try {
            val state = json.decodeFromString<EngineState>(stateJson)
            _state.value = state
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse state update", e)
        }
    }

    private fun handleError(errorJson: String) {
        Log.e(TAG, "Engine error: $errorJson")
        _lastError.value = errorJson
    }
}
