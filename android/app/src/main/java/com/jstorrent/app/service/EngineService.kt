package com.jstorrent.app.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.jstorrent.app.notification.ForegroundNotificationManager
import com.jstorrent.app.settings.SettingsStore
import com.jstorrent.app.storage.RootStore
import com.jstorrent.quickjs.EngineController
import com.jstorrent.quickjs.model.ContentRoot
import com.jstorrent.quickjs.model.EngineConfig
import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.TorrentInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private const val TAG = "EngineService"

/**
 * Foreground service for the JSTorrent engine.
 *
 * Runs the QuickJS engine with the TypeScript BitTorrent implementation.
 * Provides singleton access for Activities to control torrents.
 *
 * Usage:
 * ```kotlin
 * EngineService.start(context)
 * EngineService.instance?.addTorrent("magnet:...")
 * EngineService.stop(context)
 * ```
 */
class EngineService : Service() {

    // Use IO dispatcher for network/file operations in the engine
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var rootStore: RootStore
    private lateinit var settingsStore: SettingsStore
    private var _controller: EngineController? = null

    // Notification management
    private lateinit var notificationManager: ForegroundNotificationManager
    private var notificationUpdateJob: Job? = null

    /** Public access to controller for root management */
    val controller: EngineController?
        get() = _controller

    // Exposed state for UI
    val state: StateFlow<EngineState?>?
        get() = controller?.state

    val isLoaded: StateFlow<Boolean>?
        get() = controller?.isLoaded

    val lastError: StateFlow<String?>?
        get() = controller?.lastError

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")

        rootStore = RootStore(this)
        settingsStore = SettingsStore(this)
        notificationManager = ForegroundNotificationManager(this)

        // Set singleton
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Service starting")

        // Must call startForeground immediately (Android requirement)
        // Android 14+ requires specifying foreground service type
        val initialNotification = notificationManager.buildNotification(emptyList())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                ForegroundNotificationManager.NOTIFICATION_ID,
                initialNotification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(ForegroundNotificationManager.NOTIFICATION_ID, initialNotification)
        }

        // Initialize engine on IO thread
        ioScope.launch {
            try {
                initializeEngine()
                startNotificationUpdates()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize engine", e)
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "Service destroying")
        instance = null

        notificationUpdateJob?.cancel()
        notificationUpdateJob = null

        _controller?.close()
        _controller = null

        ioScope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // =========================================================================
    // Engine Control API
    // =========================================================================

    /**
     * Add a torrent from magnet link or base64-encoded .torrent file.
     */
    fun addTorrent(magnetOrBase64: String) {
        controller?.addTorrent(magnetOrBase64)
    }

    /**
     * Add test torrent with hardcoded peer hint for debugging.
     */
    fun addTestTorrent() {
        controller?.addTestTorrent()
    }

    /**
     * Pause a torrent.
     */
    fun pauseTorrent(infoHash: String) {
        controller?.pauseTorrent(infoHash)
    }

    /**
     * Resume a paused torrent.
     */
    fun resumeTorrent(infoHash: String) {
        controller?.resumeTorrent(infoHash)
    }

    /**
     * Remove a torrent.
     */
    fun removeTorrent(infoHash: String, deleteFiles: Boolean = false) {
        controller?.removeTorrent(infoHash, deleteFiles)
    }

    /**
     * Get full torrent list.
     */
    fun getTorrentList(): List<TorrentInfo> {
        return controller?.getTorrentList() ?: emptyList()
    }

    /**
     * Get files for a torrent.
     */
    fun getFiles(infoHash: String): List<FileInfo> {
        return controller?.getFiles(infoHash) ?: emptyList()
    }

    // =========================================================================
    // Async Engine Control API
    // =========================================================================

    /**
     * Add a torrent from magnet link or base64-encoded .torrent file (async).
     */
    suspend fun addTorrentAsync(magnetOrBase64: String) {
        controller?.addTorrentAsync(magnetOrBase64)
    }

    /**
     * Add test torrent with hardcoded peer hint for debugging (async).
     */
    suspend fun addTestTorrentAsync() {
        controller?.addTestTorrentAsync()
    }

    /**
     * Pause a torrent (async).
     */
    suspend fun pauseTorrentAsync(infoHash: String) {
        controller?.pauseTorrentAsync(infoHash)
    }

    /**
     * Resume a paused torrent (async).
     */
    suspend fun resumeTorrentAsync(infoHash: String) {
        controller?.resumeTorrentAsync(infoHash)
    }

    /**
     * Remove a torrent (async).
     */
    suspend fun removeTorrentAsync(infoHash: String, deleteFiles: Boolean = false) {
        controller?.removeTorrentAsync(infoHash, deleteFiles)
    }

    /**
     * Get full torrent list (async).
     */
    suspend fun getTorrentListAsync(): List<TorrentInfo> {
        return controller?.getTorrentListAsync() ?: emptyList()
    }

    /**
     * Get files for a torrent (async).
     */
    suspend fun getFilesAsync(infoHash: String): List<FileInfo> {
        return controller?.getFilesAsync(infoHash) ?: emptyList()
    }

    // =========================================================================
    // Bandwidth Control API
    // =========================================================================

    /**
     * Set download speed limit and persist to settings.
     * @param bytesPerSec Limit in bytes/sec (0 = unlimited)
     */
    fun setDownloadSpeedLimit(bytesPerSec: Int) {
        settingsStore.downloadSpeedLimit = bytesPerSec
        controller?.getConfigBridge()?.setDownloadSpeedLimit(bytesPerSec)
        Log.i(TAG, "Download limit set: $bytesPerSec B/s")
    }

    /**
     * Set upload speed limit and persist to settings.
     * @param bytesPerSec Limit in bytes/sec (0 = unlimited)
     */
    fun setUploadSpeedLimit(bytesPerSec: Int) {
        settingsStore.uploadSpeedLimit = bytesPerSec
        controller?.getConfigBridge()?.setUploadSpeedLimit(bytesPerSec)
        Log.i(TAG, "Upload limit set: $bytesPerSec B/s")
    }

    /**
     * Get the current download speed limit.
     * @return Limit in bytes/sec (0 = unlimited)
     */
    fun getDownloadSpeedLimit(): Int = settingsStore.downloadSpeedLimit

    /**
     * Get the current upload speed limit.
     * @return Limit in bytes/sec (0 = unlimited)
     */
    fun getUploadSpeedLimit(): Int = settingsStore.uploadSpeedLimit

    // =========================================================================
    // Private Implementation
    // =========================================================================

    private fun initializeEngine() {
        // Don't reinitialize if already loaded
        if (_controller?.isLoaded?.value == true) {
            Log.i(TAG, "Engine already loaded, skipping initialization")
            return
        }

        Log.i(TAG, "Initializing engine...")

        // Create rootResolver that queries RootStore dynamically
        // This allows FileBindings to find roots added after engine startup
        // We reload() before each resolve to pick up changes from AddRootActivity
        val rootResolver: (String) -> android.net.Uri? = { key ->
            rootStore.reload()
            rootStore.resolveKey(key)
        }

        _controller = EngineController(
            context = this,
            scope = ioScope,
            rootResolver = rootResolver
        )

        // Build config from RootStore
        val roots = rootStore.listRoots()
        val config = EngineConfig(
            contentRoots = roots.map { root ->
                ContentRoot(
                    key = root.key,
                    label = root.displayName,
                    path = root.uri  // SAF URI as path
                )
            },
            defaultContentRoot = roots.firstOrNull()?.key,
            storageMode = if (storageMode == "null") "null" else null
        )

        _controller!!.loadEngine(config)
        Log.i(TAG, "Engine loaded successfully")

        // Apply saved bandwidth settings
        applyBandwidthSettings()
    }

    /**
     * Apply saved bandwidth settings from SettingsStore to the engine.
     */
    private fun applyBandwidthSettings() {
        val configBridge = _controller?.getConfigBridge() ?: return

        val downloadLimit = settingsStore.downloadSpeedLimit
        val uploadLimit = settingsStore.uploadSpeedLimit

        if (downloadLimit > 0) {
            configBridge.setDownloadSpeedLimit(downloadLimit)
        }
        if (uploadLimit > 0) {
            configBridge.setUploadSpeedLimit(uploadLimit)
        }

        Log.i(TAG, "Applied bandwidth limits: download=${downloadLimit}B/s, upload=${uploadLimit}B/s")
    }

    // =========================================================================
    // Notification
    // =========================================================================

    /**
     * Start the notification update loop.
     * Updates notification every 1 second with current torrent stats.
     */
    private fun startNotificationUpdates() {
        notificationUpdateJob = ioScope.launch {
            while (isActive) {
                val torrents = state?.value?.torrents ?: emptyList()
                notificationManager.updateNotification(torrents)
                delay(1000)  // Update every 1 second
            }
        }
    }

    /**
     * Pause all active torrents. Called from notification action.
     */
    fun pauseAllTorrents() {
        ioScope.launch {
            val torrents = state?.value?.torrents ?: return@launch
            for (torrent in torrents) {
                if (torrent.status != "stopped") {
                    pauseTorrentAsync(torrent.infoHash)
                }
            }
        }
    }

    /**
     * Resume all stopped torrents. Called from notification action.
     */
    fun resumeAllTorrents() {
        ioScope.launch {
            val torrents = state?.value?.torrents ?: return@launch
            for (torrent in torrents) {
                if (torrent.status == "stopped") {
                    resumeTorrentAsync(torrent.infoHash)
                }
            }
        }
    }

    companion object {
        @Volatile
        var instance: EngineService? = null
            private set

        @Volatile
        var storageMode: String? = null
            private set

        fun start(context: Context, storageMode: String? = null) {
            this.storageMode = storageMode
            val intent = Intent(context, EngineService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, EngineService::class.java)
            context.stopService(intent)
        }
    }
}
