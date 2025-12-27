package com.jstorrent.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.jstorrent.app.NativeStandaloneActivity
import com.jstorrent.app.R
import com.jstorrent.app.storage.RootStore
import com.jstorrent.quickjs.EngineController
import com.jstorrent.quickjs.model.ContentRoot
import com.jstorrent.quickjs.model.EngineConfig
import com.jstorrent.quickjs.model.EngineState
import com.jstorrent.quickjs.model.FileInfo
import com.jstorrent.quickjs.model.TorrentInfo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

private const val TAG = "EngineService"
private const val NOTIFICATION_ID = 2  // Different from IoDaemonService
private const val CHANNEL_ID = "jstorrent_engine"

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
    private var _controller: EngineController? = null

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
        createNotificationChannel()

        // Set singleton
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Service starting")

        // Must call startForeground immediately (Android requirement)
        startForeground(NOTIFICATION_ID, createNotification("Starting engine..."))

        // Initialize engine on IO thread
        ioScope.launch {
            try {
                initializeEngine()
                updateNotification("Engine running")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize engine", e)
                updateNotification("Engine failed: ${e.message}")
            }
        }

        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "Service destroying")
        instance = null

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
    }

    // =========================================================================
    // Notification
    // =========================================================================

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "JSTorrent Engine",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows when JSTorrent engine is running"
            setShowBadge(false)
        }

        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun createNotification(status: String): Notification {
        // Open NativeStandaloneActivity when notification is tapped
        // (EngineService is only used in native standalone mode)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, NativeStandaloneActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("JSTorrent")
            .setContentText(status)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification(status: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, createNotification(status))
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
