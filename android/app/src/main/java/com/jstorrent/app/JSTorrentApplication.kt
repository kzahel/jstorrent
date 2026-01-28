package com.jstorrent.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.net.Uri
import android.util.Log
import com.jstorrent.app.cache.TorrentSummaryCache
import com.jstorrent.app.service.ServiceLifecycleManager
import com.jstorrent.app.settings.SettingsStore
import com.jstorrent.app.storage.RootStore
import com.jstorrent.quickjs.EngineController
import com.jstorrent.quickjs.model.ContentRoot
import com.jstorrent.quickjs.model.EngineConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

private const val TAG = "JSTorrentApplication"

/**
 * Application class for JSTorrent.
 *
 * Creates notification channels on startup. This ensures channels exist
 * before any service tries to use them.
 *
 * Also hosts the engine controller which lives for the process lifetime.
 */
class JSTorrentApplication : Application() {

    /**
     * Centralized notification channel IDs.
     */
    object NotificationChannels {
        /** Foreground service notification - low priority, silent, persistent */
        const val SERVICE = "jstorrent_service"

        /** Download complete notifications - default priority, plays sound */
        const val COMPLETE = "jstorrent_complete"

        /** Error notifications - high priority */
        const val ERRORS = "jstorrent_errors"
    }

    // Torrent summary cache for lazy engine startup (Stage 1)
    // Provides cached torrent list without starting the engine
    val torrentSummaryCache: TorrentSummaryCache by lazy {
        TorrentSummaryCache(this)
    }

    // Service lifecycle management
    lateinit var serviceLifecycleManager: ServiceLifecycleManager
        private set

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        deleteLegacyChannels()

        // Initialize service lifecycle manager with shutdown/restore callbacks
        // When background downloads are disabled, we completely shut down the engine
        // to prevent the 100ms tick loop from draining battery
        // Stage 4: Also pass cache for checking active torrents when engine not running
        serviceLifecycleManager = ServiceLifecycleManager(
            context = this,
            settingsStore = SettingsStore(this),
            torrentSummaryCache = torrentSummaryCache,
            onShutdownForBackground = { shutdownEngineForBackground() },
            onRestoreFromBackground = { restoreEngineFromBackground() },
            onStartEngineForBackground = { startEngineForBackground() }
        )
    }

    /**
     * Completely shut down the engine when going to background.
     * This stops the 100ms tick loop and all intervals to prevent battery drain.
     * Called when background downloads are disabled and user leaves the app.
     */
    private fun shutdownEngineForBackground() {
        if (_engineController == null) {
            Log.d(TAG, "Engine not initialized, nothing to shut down")
            return
        }
        Log.i(TAG, "Shutting down engine for background (battery saving)")
        shutdownEngine()
    }

    /**
     * Restore the engine after coming back from background.
     * The engine will be lazily reinitialized when the Activity calls ensureEngine().
     * We don't reinitialize here because the Activity hasn't started yet.
     */
    private fun restoreEngineFromBackground() {
        // The engine will be reinitialized by the Activity when it calls ensureEngine()
        // in onStart(). We just log here for debugging.
        Log.i(TAG, "Engine restore requested - will reinitialize on Activity start")
    }

    /**
     * Start the engine in background when there are active incomplete torrents.
     * Stage 4: Called by ServiceLifecycleManager when user backgrounds the app
     * but cache shows active downloads that should continue.
     */
    private fun startEngineForBackground() {
        if (_engineController != null) {
            Log.d(TAG, "Engine already running, no need to start for background")
            return
        }
        Log.i(TAG, "Starting engine for background downloads")
        initializeEngine()
    }

    private fun createNotificationChannels() {
        val manager = getSystemService(NotificationManager::class.java)

        // Service channel (foreground service)
        manager.createNotificationChannel(
            NotificationChannel(
                NotificationChannels.SERVICE,
                "JSTorrent Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when JSTorrent is running"
                setShowBadge(false)
            }
        )

        // Download complete channel
        manager.createNotificationChannel(
            NotificationChannel(
                NotificationChannels.COMPLETE,
                "Download Complete",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Notifications when downloads complete"
                enableVibration(true)
                setShowBadge(true)
            }
        )

        // Errors channel
        manager.createNotificationChannel(
            NotificationChannel(
                NotificationChannels.ERRORS,
                "Errors",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Storage full, connection issues"
                enableVibration(true)
            }
        )
    }

    /**
     * Delete legacy notification channels from previous versions.
     */
    private fun deleteLegacyChannels() {
        val manager = getSystemService(NotificationManager::class.java)

        // Legacy channel IDs that are no longer used
        val legacyChannels = listOf(
            "jstorrent_engine",           // Old ForegroundNotificationService channel
            "jstorrent_download_complete" // Old TorrentNotificationManager channel
        )

        for (channelId in legacyChannels) {
            manager.deleteNotificationChannel(channelId)
        }
    }

    // =========================================================================
    // Engine Controller - lives for process lifetime
    // =========================================================================

    // Stage 5: @Volatile ensures visibility across threads for race condition safety
    @Volatile
    private var _engineController: EngineController? = null

    // Stage 5: Lock object for thread-safe engine initialization
    private val engineLock = Any()

    val engineController: EngineController?
        get() = _engineController

    // Scope for engine - lives for process lifetime
    private val engineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Initialize the engine. Called from Activity on first launch.
     * Idempotent and thread-safe - safe to call multiple times from multiple threads.
     *
     * Stage 5: Uses synchronized block to prevent race conditions where multiple
     * threads could both see _engineController as null and try to initialize.
     */
    fun initializeEngine(storageMode: String? = null): EngineController {
        // Quick check without lock (volatile read)
        _engineController?.let { return it }

        // Double-checked locking pattern for thread-safe initialization
        synchronized(engineLock) {
            // Check again inside lock (another thread may have initialized)
            _engineController?.let { return it }

            Log.i(TAG, "Initializing engine...")

            val rootStore = RootStore(this)
            val settingsStore = SettingsStore(this)

            // Create rootResolver that queries RootStore dynamically
            val rootResolver: (String) -> Uri? = { key ->
                rootStore.reload()
                rootStore.resolveKey(key)
            }

            val controller = EngineController(
                context = this,
                scope = engineScope,
                rootResolver = rootResolver
            )

            // Build config from RootStore
            val roots = rootStore.listRoots()
            val defaultKey = settingsStore.defaultRootKey?.takeIf { key ->
                roots.any { it.key == key }
            } ?: roots.firstOrNull()?.key

            val config = EngineConfig(
                contentRoots = roots.map { root ->
                    ContentRoot(key = root.key, label = root.displayName, path = root.uri)
                },
                defaultContentRoot = defaultKey,
                storageMode = if (storageMode == "null") "null" else null
            )

            controller.loadEngine(config)
            _engineController = controller
            Log.i(TAG, "Engine loaded successfully")

            // Start host-driven tick loop for better timing visibility
            controller.startHostDrivenTick()

            // Start observing torrent state for service lifecycle decisions
            startTorrentStateObservation(controller)

            // Apply saved settings
            applyEngineSettings(controller, settingsStore)

            return controller
        }
    }

    val isEngineInitialized: Boolean
        get() = _engineController != null

    /**
     * Lazily start the engine on demand (Stage 2: Deferred Engine Initialization).
     *
     * This is the primary entry point for starting the engine. It should be called when:
     * - User taps play/resume on a torrent
     * - User opens torrent detail view
     * - User adds a new torrent (magnet link, .torrent file)
     * - Background download setting is enabled and there's pending work
     *
     * Idempotent - safe to call multiple times.
     *
     * @param storageMode Optional storage mode for testing
     * @return The engine controller (newly created or existing)
     */
    fun ensureEngineStarted(storageMode: String? = null): EngineController {
        return ensureEngine(storageMode)
    }

    /**
     * Shutdown engine. Called on explicit quit or for testing.
     * Stage 5: Thread-safe shutdown using synchronized block.
     */
    fun shutdownEngine() {
        synchronized(engineLock) {
            _engineController?.close()
            _engineController = null
        }
    }

    /**
     * Ensure the engine is healthy. If engine crashed or was closed,
     * reinitialize it.
     *
     * Stage 5: Thread-safe health check and reinitialization.
     *
     * @param storageMode Optional storage mode for testing
     * @return The healthy engine controller
     */
    fun ensureEngine(storageMode: String? = null): EngineController {
        // Quick check without lock - if healthy, return immediately
        _engineController?.let { controller ->
            if (controller.isHealthy) {
                return controller
            }
        }

        // Need to check/reinitialize under lock
        synchronized(engineLock) {
            _engineController?.let { controller ->
                if (controller.isHealthy) {
                    return controller
                }
                Log.w(TAG, "Engine unhealthy, reinitializing...")
                try {
                    controller.close()
                } catch (e: Exception) {
                    Log.e(TAG, "Error closing unhealthy engine", e)
                }
                _engineController = null
            }
        }
        return initializeEngine(storageMode)
    }

    /**
     * Observe torrent state changes and notify the service lifecycle manager.
     * Runs in engineScope so it lives for the process lifetime.
     */
    private fun startTorrentStateObservation(controller: EngineController) {
        engineScope.launch {
            controller.state.collect { state ->
                val torrents = state?.torrents ?: emptyList()
                serviceLifecycleManager.onTorrentStateChanged(torrents)
            }
        }
    }

    private fun applyEngineSettings(controller: EngineController, settingsStore: SettingsStore) {
        val configBridge = controller.getConfigBridge() ?: return

        // Use 0 for unlimited, otherwise use the configured limit
        val effectiveDownloadLimit = if (settingsStore.downloadSpeedUnlimited) 0 else settingsStore.downloadSpeedLimit
        val effectiveUploadLimit = if (settingsStore.uploadSpeedUnlimited) 0 else settingsStore.uploadSpeedLimit

        configBridge.setDownloadSpeedLimit(effectiveDownloadLimit)
        configBridge.setUploadSpeedLimit(effectiveUploadLimit)

        configBridge.setDhtEnabled(settingsStore.dhtEnabled)
        configBridge.setPexEnabled(settingsStore.pexEnabled)
        configBridge.setUpnpEnabled(settingsStore.upnpEnabled)
        configBridge.setEncryptionPolicy(settingsStore.encryptionPolicy)

        Log.i(TAG, "Applied engine settings: download=${if (effectiveDownloadLimit == 0) "unlimited" else "${effectiveDownloadLimit}B/s"}, " +
            "upload=${if (effectiveUploadLimit == 0) "unlimited" else "${effectiveUploadLimit}B/s"}, " +
            "dht=${settingsStore.dhtEnabled}, pex=${settingsStore.pexEnabled}, " +
            "upnp=${settingsStore.upnpEnabled}, encryption=${settingsStore.encryptionPolicy}")
    }
}
