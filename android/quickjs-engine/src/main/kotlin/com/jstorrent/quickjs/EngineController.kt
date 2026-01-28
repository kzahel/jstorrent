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
import com.jstorrent.quickjs.model.TrackerInfo
import com.jstorrent.quickjs.model.TrackerListResponse
import com.jstorrent.quickjs.model.PeerInfo
import com.jstorrent.quickjs.model.PeerListResponse
import com.jstorrent.quickjs.model.PieceInfo
import com.jstorrent.quickjs.model.TorrentDetails
import com.jstorrent.quickjs.model.DhtStats
import com.jstorrent.quickjs.model.EngineStats
import com.jstorrent.quickjs.model.JsThreadStats
import com.jstorrent.quickjs.model.SpeedSamplesResult
import com.jstorrent.quickjs.model.UpnpStatus
import com.jstorrent.quickjs.bindings.FileBindings
import com.jstorrent.quickjs.bindings.TcpBindings
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

    // Host-driven tick loop state
    private var tickRunnable: Runnable? = null
    private var tickEnabled = false
    private var tickCount = 0L
    private var tickTotalJsMs = 0L
    private var tickTotalPumpMs = 0L
    private var tickTotalMs = 0L
    private var tickMaxMs = 0L
    private var tickLastLogTime = 0L
    private val TICK_INTERVAL_MS = 100L
    private val TICK_LOG_INTERVAL_MS = 5000L

    /**
     * Check if the engine is healthy and responsive.
     * Returns false if engine is not loaded or has been closed.
     */
    val isHealthy: Boolean
        get() = engine != null && _isLoaded.value

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

        // Start JS thread health monitoring
        engine!!.jsThread.startHealthCheck()

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
     * Set file priorities for a torrent.
     *
     * @param infoHash The torrent's info hash
     * @param priorities Map of file index to priority (0=Normal, 1=Skip, 2=High)
     */
    fun setFilePriorities(infoHash: String, priorities: Map<Int, Int>) {
        checkLoaded()
        val prioritiesJson = json.encodeToString(priorities.mapKeys { it.key.toString() })
        engine!!.callGlobalFunction(
            "__jstorrent_cmd_set_file_priorities",
            infoHash,
            prioritiesJson
        )
        Log.i(TAG, "setFilePriorities: $infoHash (${priorities.size} files)")
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
     * Get tracker list for a specific torrent.
     */
    fun getTrackers(infoHash: String): List<TrackerInfo> {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunction("__jstorrent_query_trackers", infoHash) as? String
            ?: return emptyList()
        return try {
            json.decodeFromString<TrackerListResponse>(resultJson).trackers
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse tracker list", e)
            emptyList()
        }
    }

    /**
     * Get peer list for a specific torrent.
     */
    fun getPeers(infoHash: String): List<PeerInfo> {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunction("__jstorrent_query_peers", infoHash) as? String
            ?: return emptyList()
        return try {
            json.decodeFromString<PeerListResponse>(resultJson).peers
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse peer list", e)
            emptyList()
        }
    }

    /**
     * Get piece info for a specific torrent.
     * Returns piece counts and hex-encoded bitfield.
     */
    fun getPieces(infoHash: String): PieceInfo? {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunction("__jstorrent_query_pieces", infoHash) as? String
            ?: return null
        return try {
            json.decodeFromString<PieceInfo>(resultJson)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse piece info", e)
            null
        }
    }

    /**
     * Get detailed torrent metadata for the Details tab.
     * Returns timestamps, size info, and magnet URL.
     */
    fun getDetails(infoHash: String): TorrentDetails? {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunction("__jstorrent_query_details", infoHash) as? String
            ?: return null
        return try {
            json.decodeFromString<TorrentDetails>(resultJson)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse torrent details", e)
            null
        }
    }

    // =========================================================================
    // Debug API
    // =========================================================================

    /**
     * Set log level for debugging.
     * Valid levels: "debug", "info", "warn", "error"
     * Optionally filter by components.
     */
    fun setLogLevel(level: String, components: List<String>? = null) {
        checkLoaded()
        val componentsJson = components?.let { json.encodeToString(it) }
        if (componentsJson != null) {
            engine!!.callGlobalFunction("__jstorrent_cmd_set_log_level", level, componentsJson)
        } else {
            engine!!.callGlobalFunction("__jstorrent_cmd_set_log_level", level)
        }
        Log.i(TAG, "setLogLevel: $level${components?.let { ", components: $it" } ?: ""}")
    }

    /**
     * Get detailed swarm debug info for a torrent.
     * Returns JSON with all peers and their connection states.
     */
    fun getSwarmDebug(infoHash: String): String {
        checkLoaded()
        return engine!!.callGlobalFunction("__jstorrent_query_swarm_debug", infoHash) as? String
            ?: """{"error": "No result"}"""
    }

    /**
     * Evaluate arbitrary JavaScript code (for debugging).
     * Use with caution - this can execute any code in the engine context.
     */
    fun evaluate(script: String): Any? {
        checkLoaded()
        return engine!!.evaluate(script)
    }

    /**
     * Evaluate arbitrary JavaScript code (suspend version for debugging).
     * Use with caution - this can execute any code in the engine context.
     */
    suspend fun evaluateAsync(script: String): Any? {
        checkLoaded()
        return engine!!.evaluateAsync(script)
    }

    /**
     * Get the maximum JS thread latency observed since engine start.
     * Useful for diagnosing thread overload conditions.
     */
    fun getMaxJsThreadLatencyMs(): Long {
        return engine?.jsThread?.getMaxLatencyMs() ?: 0L
    }

    /**
     * Get comprehensive JS thread health statistics.
     * Includes current/max latency and callback queue depths for TCP and disk I/O.
     */
    fun getJsThreadStats(): JsThreadStats {
        val jsThread = engine?.jsThread
        return JsThreadStats(
            currentLatencyMs = jsThread?.getCurrentLatencyMs() ?: 0L,
            maxLatencyMs = jsThread?.getMaxLatencyMs() ?: 0L,
            tcpQueueDepth = TcpBindings.getQueueDepth(),
            tcpMaxQueueDepth = TcpBindings.getMaxQueueDepth(),
            diskQueueDepth = FileBindings.getQueueDepth(),
            diskMaxQueueDepth = FileBindings.getMaxQueueDepth()
        )
    }

    // =========================================================================
    // Async Command API - safe to call from Main thread
    // =========================================================================

    /**
     * Add a torrent (suspend version).
     * Awaits until the torrent is fully added to the engine.
     */
    suspend fun addTorrentAsync(magnetOrBase64: String): String? {
        checkLoaded()
        val result = engine!!.callGlobalFunctionAwaitPromise("__jstorrent_cmd_add_torrent", magnetOrBase64)
        Log.i(TAG, "addTorrentAsync completed: $result")
        return result
    }

    /**
     * Pause a torrent (suspend version).
     */
    suspend fun pauseTorrentAsync(infoHash: String) {
        checkLoaded()
        engine!!.callGlobalFunctionAsync("__jstorrent_cmd_pause", infoHash)
        Log.i(TAG, "pauseTorrentAsync: $infoHash")
    }

    /**
     * Resume a torrent (suspend version).
     */
    suspend fun resumeTorrentAsync(infoHash: String) {
        checkLoaded()
        engine!!.callGlobalFunctionAsync("__jstorrent_cmd_resume", infoHash)
        Log.i(TAG, "resumeTorrentAsync: $infoHash")
    }

    /**
     * Remove a torrent (suspend version).
     * Awaits until the torrent is fully removed from the engine.
     */
    suspend fun removeTorrentAsync(infoHash: String, deleteFiles: Boolean = false): String? {
        checkLoaded()
        val result = engine!!.callGlobalFunctionAwaitPromise(
            "__jstorrent_cmd_remove",
            infoHash,
            deleteFiles.toString()
        )
        Log.i(TAG, "removeTorrentAsync completed: $infoHash (deleteFiles=$deleteFiles)")
        return result
    }

    /**
     * Set file priorities for a torrent (suspend version).
     *
     * @param infoHash The torrent's info hash
     * @param priorities Map of file index to priority (0=Normal, 1=Skip, 2=High)
     */
    suspend fun setFilePrioritiesAsync(infoHash: String, priorities: Map<Int, Int>) {
        checkLoaded()
        val prioritiesJson = json.encodeToString(priorities.mapKeys { it.key.toString() })
        engine!!.callGlobalFunctionAsync(
            "__jstorrent_cmd_set_file_priorities",
            infoHash,
            prioritiesJson
        )
        Log.i(TAG, "setFilePrioritiesAsync: $infoHash (${priorities.size} files)")
    }

    /**
     * Add test torrent (suspend version).
     */
    suspend fun addTestTorrentAsync() {
        checkLoaded()
        engine!!.callGlobalFunctionAsync("__jstorrent_cmd_add_test_torrent")
        Log.i(TAG, "addTestTorrentAsync called")
    }

    // =========================================================================
    // Async Root Management - safe to call from Main thread
    // =========================================================================

    /**
     * Add a storage root (suspend version).
     */
    suspend fun addRootAsync(key: String, label: String, uri: String) {
        checkLoaded()
        engine!!.callGlobalFunctionAsync(
            "__jstorrent_cmd_add_root",
            key.escapeJs(),
            label.escapeJs(),
            uri.escapeJs()
        )
        Log.i(TAG, "Added root to engine (async): $key -> $label")
    }

    /**
     * Set default storage root (suspend version).
     */
    suspend fun setDefaultRootAsync(key: String) {
        checkLoaded()
        engine!!.callGlobalFunctionAsync("__jstorrent_cmd_set_default_root", key.escapeJs())
        Log.i(TAG, "Set default root (async): $key")
    }

    /**
     * Remove a storage root (suspend version).
     */
    suspend fun removeRootAsync(key: String) {
        checkLoaded()
        engine!!.callGlobalFunctionAsync("__jstorrent_cmd_remove_root", key.escapeJs())
        Log.i(TAG, "Removed root (async): $key")
    }

    // =========================================================================
    // Async Query API - safe to call from Main thread
    // =========================================================================

    /**
     * Get torrent list (suspend version).
     */
    suspend fun getTorrentListAsync(): List<TorrentInfo> {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_torrent_list") as? String
            ?: return emptyList()
        return try {
            json.decodeFromString<TorrentListResponse>(resultJson).torrents
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse torrent list", e)
            emptyList()
        }
    }

    /**
     * Get files for a torrent (suspend version).
     */
    suspend fun getFilesAsync(infoHash: String): List<FileInfo> {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_files", infoHash) as? String
            ?: return emptyList()
        return try {
            json.decodeFromString<FileListResponse>(resultJson).files
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse file list", e)
            emptyList()
        }
    }

    /**
     * Get trackers for a torrent (suspend version).
     */
    suspend fun getTrackersAsync(infoHash: String): List<TrackerInfo> {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_trackers", infoHash) as? String
            ?: return emptyList()
        return try {
            json.decodeFromString<TrackerListResponse>(resultJson).trackers
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse tracker list", e)
            emptyList()
        }
    }

    /**
     * Get peers for a torrent (suspend version).
     */
    suspend fun getPeersAsync(infoHash: String): List<PeerInfo> {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_peers", infoHash) as? String
            ?: return emptyList()
        return try {
            json.decodeFromString<PeerListResponse>(resultJson).peers
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse peer list", e)
            emptyList()
        }
    }

    /**
     * Get piece info for a torrent (suspend version).
     */
    suspend fun getPiecesAsync(infoHash: String): PieceInfo? {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_pieces", infoHash) as? String
            ?: return null
        return try {
            json.decodeFromString<PieceInfo>(resultJson)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse piece info", e)
            null
        }
    }

    /**
     * Get detailed torrent metadata (suspend version).
     */
    suspend fun getDetailsAsync(infoHash: String): TorrentDetails? {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_details", infoHash) as? String
            ?: return null
        return try {
            json.decodeFromString<TorrentDetails>(resultJson)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse torrent details", e)
            null
        }
    }

    /**
     * Get DHT statistics (suspend version).
     * Returns null if DHT is not initialized.
     */
    suspend fun getDhtStatsAsync(): DhtStats? {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_dht_stats") as? String
            ?: return null
        // Handle "null" string response
        if (resultJson == "null") return null
        return try {
            json.decodeFromString<DhtStats>(resultJson)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse DHT stats", e)
            null
        }
    }

    /**
     * Get UPnP status (synchronous version).
     * Returns status and external IP if mapped.
     */
    fun getUpnpStatus(): UpnpStatus? {
        val eng = engine ?: return null
        val resultJson = eng.callGlobalFunction("__jstorrent_query_upnp_status") as? String
            ?: return null
        return try {
            json.decodeFromString<UpnpStatus>(resultJson)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse UPnP status", e)
            null
        }
    }

    /**
     * Get UPnP status (suspend version).
     * Returns status and external IP if mapped.
     */
    suspend fun getUpnpStatusAsync(): UpnpStatus? {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync("__jstorrent_query_upnp_status") as? String
            ?: return null
        return try {
            json.decodeFromString<UpnpStatus>(resultJson)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse UPnP status", e)
            null
        }
    }

    /**
     * Get speed samples from the bandwidth tracker for graphing (suspend version).
     *
     * @param direction "down" or "up"
     * @param categories "all" or JSON array of categories (e.g., '["peer:protocol"]')
     * @param fromTime Start timestamp in ms since epoch
     * @param toTime End timestamp in ms since epoch
     * @param maxPoints Maximum number of data points to return (default 300)
     * @return SpeedSamplesResult with samples and bucket metadata, or null on error
     */
    suspend fun getSpeedSamplesAsync(
        direction: String,
        categories: String = "all",
        fromTime: Long,
        toTime: Long,
        maxPoints: Int = 300
    ): SpeedSamplesResult? {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync(
            "__jstorrent_query_speed_samples",
            direction,
            categories,
            fromTime.toString(),
            toTime.toString(),
            maxPoints.toString()
        ) as? String ?: return null
        return try {
            json.decodeFromString<SpeedSamplesResult>(resultJson)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse speed samples", e)
            null
        }
    }

    /**
     * Get engine statistics for health monitoring (suspend version).
     * Fetches tick stats, active pieces, and connected peers from JS engine.
     */
    suspend fun getEngineStatsAsync(): EngineStats? {
        checkLoaded()
        val resultJson = engine!!.callGlobalFunctionAsync(
            "__jstorrent_query_engine_stats"
        ) as? String ?: return null
        return try {
            json.decodeFromString<EngineStats>(resultJson)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse engine stats", e)
            null
        }
    }

    // ============================================================
    // HOST-DRIVEN TICK LOOP
    // ============================================================

    /**
     * Start host-driven tick loop.
     *
     * This switches from JS-owned setInterval to Kotlin-owned tick scheduling.
     * Benefits:
     * - Full visibility into tick timing (JS execution + job pump)
     * - No Handler queue latency between tick and job pump
     * - Accurate timing measurements for bottleneck analysis
     *
     * The tick runs directly on the JS thread:
     * 1. Call __jstorrent_engine_tick (JS work)
     * 2. Pump all pending jobs (microtasks)
     * 3. Log timing breakdown every 5 seconds
     * 4. Schedule next tick
     */
    fun startHostDrivenTick() {
        if (tickEnabled) {
            Log.w(TAG, "Host-driven tick already running")
            return
        }

        val eng = engine ?: run {
            Log.e(TAG, "Cannot start tick: engine not loaded")
            return
        }

        // Switch JS to host-driven mode (stops JS setInterval)
        eng.jsThread.post {
            eng.context.callGlobalFunction("__jstorrent_set_tick_mode", "host")
        }

        tickEnabled = true
        tickCount = 0
        tickTotalJsMs = 0
        tickTotalPumpMs = 0
        tickTotalMs = 0
        tickMaxMs = 0
        tickLastLogTime = System.currentTimeMillis()

        Log.i(TAG, "Starting host-driven tick loop (${TICK_INTERVAL_MS}ms interval)")

        tickRunnable = object : Runnable {
            override fun run() {
                if (!tickEnabled) return

                val tickStart = System.currentTimeMillis()

                // 1. Call JS tick
                val jsStart = System.currentTimeMillis()
                try {
                    eng.context.callGlobalFunction("__jstorrent_engine_tick")
                } catch (e: Exception) {
                    Log.e(TAG, "Tick JS error", e)
                }
                val jsEnd = System.currentTimeMillis()
                val jsMs = jsEnd - jsStart

                // 2. Pump all pending jobs synchronously (no queue delay!)
                val pumpStart = System.currentTimeMillis()
                eng.context.executeAllPendingJobs()
                val pumpEnd = System.currentTimeMillis()
                val pumpMs = pumpEnd - pumpStart

                val totalMs = pumpEnd - tickStart

                // Update stats
                tickCount++
                tickTotalJsMs += jsMs
                tickTotalPumpMs += pumpMs
                tickTotalMs += totalMs
                if (totalMs > tickMaxMs) {
                    tickMaxMs = totalMs
                }

                // Log every 5 seconds
                val now = System.currentTimeMillis()
                if (now - tickLastLogTime >= TICK_LOG_INTERVAL_MS && tickCount > 0) {
                    val avgJs = tickTotalJsMs.toFloat() / tickCount
                    val avgPump = tickTotalPumpMs.toFloat() / tickCount
                    val avgTotal = tickTotalMs.toFloat() / tickCount
                    Log.i(TAG, "Tick: ${tickCount} ticks, avg %.1fms (js=%.1fms pump=%.1fms), max ${tickMaxMs}ms".format(
                        avgTotal, avgJs, avgPump))

                    // Reset stats
                    tickCount = 0
                    tickTotalJsMs = 0
                    tickTotalPumpMs = 0
                    tickTotalMs = 0
                    tickMaxMs = 0
                    tickLastLogTime = now
                }

                // 3. Schedule next tick
                if (tickEnabled) {
                    eng.jsThread.handler.postDelayed(this, TICK_INTERVAL_MS)
                }
            }
        }

        // Start the tick loop on JS thread
        eng.jsThread.handler.post(tickRunnable!!)
    }

    /**
     * Stop host-driven tick loop.
     * Switches back to JS-owned setInterval.
     */
    fun stopHostDrivenTick() {
        if (!tickEnabled) return

        tickEnabled = false
        tickRunnable?.let { runnable ->
            engine?.jsThread?.handler?.removeCallbacks(runnable)
        }
        tickRunnable = null

        // Switch JS back to JS-driven mode
        engine?.jsThread?.post {
            engine?.context?.callGlobalFunction("__jstorrent_set_tick_mode", "js")
        }

        Log.i(TAG, "Host-driven tick stopped")
    }

    /**
     * Gracefully shutdown the JS engine (saves DHT state, stops torrents).
     * Call this before close() for clean shutdown, or let close() handle it.
     */
    suspend fun shutdownAsync() {
        val eng = engine ?: return
        Log.i(TAG, "Calling JS engine shutdown...")
        try {
            eng.callGlobalFunctionAsync("__jstorrent_cmd_shutdown")
            Log.i(TAG, "JS engine shutdown complete")
        } catch (e: Exception) {
            Log.e(TAG, "JS engine shutdown failed", e)
        }
    }

    /**
     * Shutdown the engine and release resources.
     * Calls JS shutdown first to save DHT state.
     */
    override fun close() {
        Log.i(TAG, "Shutting down engine...")

        // Stop host-driven tick if running
        stopHostDrivenTick()

        // Gracefully shutdown JS engine (saves DHT state, stops torrents)
        engine?.let { eng ->
            try {
                kotlinx.coroutines.runBlocking {
                    eng.callGlobalFunctionAsync("__jstorrent_cmd_shutdown")
                }
                Log.i(TAG, "JS engine shutdown complete")
            } catch (e: Exception) {
                Log.e(TAG, "JS engine shutdown failed (continuing with close)", e)
            }
        }

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
