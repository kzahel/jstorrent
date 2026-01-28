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
        serviceLifecycleManager = ServiceLifecycleManager(
            context = this,
            settingsStore = SettingsStore(this),
            onShutdownForBackground = { shutdownEngineForBackground() },
            onRestoreFromBackground = { restoreEngineFromBackground() }
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

    private var _engineController: EngineController? = null

    val engineController: EngineController?
        get() = _engineController

    // Scope for engine - lives for process lifetime
    private val engineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Initialize the engine. Called from Activity on first launch.
     * Idempotent - safe to call multiple times.
     */
    fun initializeEngine(storageMode: String? = null): EngineController {
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

        // Start observing torrent state for service lifecycle decisions
        startTorrentStateObservation(controller)

        // Apply saved settings
        applyEngineSettings(controller, settingsStore)

        return controller
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
     */
    fun shutdownEngine() {
        _engineController?.close()
        _engineController = null
    }

    /**
     * Ensure the engine is healthy. If engine crashed or was closed,
     * reinitialize it.
     *
     * @param storageMode Optional storage mode for testing
     * @return The healthy engine controller
     */
    fun ensureEngine(storageMode: String? = null): EngineController {
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
