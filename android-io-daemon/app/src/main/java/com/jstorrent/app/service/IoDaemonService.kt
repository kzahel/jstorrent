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
import com.jstorrent.app.CompanionServerDepsImpl
import com.jstorrent.app.MainActivity
import com.jstorrent.app.R
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.storage.RootStore
import com.jstorrent.companion.server.CompanionHttpServer
import com.jstorrent.companion.server.DownloadRoot
import com.jstorrent.io.file.FileManagerImpl
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

private const val TAG = "IoDaemonService"
private const val NOTIFICATION_ID = 1
private const val CHANNEL_ID = "jstorrent_daemon"

class IoDaemonService : Service() {

    private lateinit var tokenStore: TokenStore
    private lateinit var rootStore: RootStore
    private var httpServer: CompanionHttpServer? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")

        tokenStore = TokenStore(this)
        rootStore = RootStore(this)
        createNotificationChannel()

        // Set singleton for static access
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Service starting")

        // Must call startForeground immediately after startForegroundService (Android requirement)
        startForeground(NOTIFICATION_ID, createNotification("Starting..."))

        // Start HTTP server
        startServer()

        // Update notification
        updateNotification("Running in background")

        // If background mode is disabled, remove foreground status
        // Service continues running but will be killed when activity closes
        if (!tokenStore.backgroundModeEnabled) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            Log.i(TAG, "Background mode disabled, removed foreground status")
        }

        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "Service destroying")
        instance = null
        stopServer()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startServer() {
        if (httpServer?.isRunning == true) {
            Log.w(TAG, "Server already running")
            return
        }

        val deps = CompanionServerDepsImpl(this, tokenStore, rootStore)
        val fileManager = FileManagerImpl(this)
        httpServer = CompanionHttpServer(deps, fileManager)

        try {
            httpServer?.start()
            Log.i(TAG, "HTTP server started on port ${httpServer?.port}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start server", e)
        }
    }

    private fun stopServer() {
        httpServer?.stop()
        httpServer = null
    }

    // =========================================================================
    // Foreground Mode
    // =========================================================================

    /**
     * Toggle foreground mode at runtime.
     * When enabled, shows a persistent notification and service survives activity close.
     * When disabled, removes notification and service will be killed when activity closes.
     */
    fun setForegroundMode(enabled: Boolean) {
        if (enabled) {
            startForeground(NOTIFICATION_ID, createNotification("Running in background"))
            Log.i(TAG, "Foreground mode enabled")
        } else {
            stopForeground(STOP_FOREGROUND_REMOVE)
            Log.i(TAG, "Foreground mode disabled")
        }
    }

    // =========================================================================
    // Control Plane
    // =========================================================================

    /**
     * Get the current server port.
     */
    val port: Int
        get() = httpServer?.port ?: 7800

    /**
     * Check if the HTTP server is running and ready.
     */
    val isServerRunning: Boolean
        get() = httpServer?.isRunning == true

    /**
     * Broadcast ROOTS_CHANGED to all connected WebSocket clients.
     * Call this after AddRootActivity adds a new root.
     */
    fun broadcastRootsChanged() {
        val appRoots = rootStore.refreshAvailability()
        // Convert app DownloadRoot to companion-server DownloadRoot
        val roots = appRoots.map { root ->
            DownloadRoot(
                key = root.key,
                uri = root.uri,
                displayName = root.displayName,
                removable = root.removable,
                lastStatOk = root.lastStatOk,
                lastChecked = root.lastChecked
            )
        }
        httpServer?.broadcastRootsChanged(roots)
        Log.i(TAG, "Broadcast ROOTS_CHANGED with ${roots.size} roots")
    }

    /**
     * Broadcast a generic event to all connected WebSocket clients.
     */
    fun broadcastEvent(event: String, payload: JsonElement? = null) {
        httpServer?.broadcastEvent(event, payload)
        Log.i(TAG, "Broadcast event: $event")
    }

    /**
     * Check if any authenticated control session is connected.
     */
    fun hasActiveControlConnection(): Boolean =
        httpServer?.hasActiveControlConnection() ?: false

    /**
     * Close all connected WebSocket sessions.
     * Call this when the user unpairs to disconnect the extension.
     */
    suspend fun closeAllSessions() {
        httpServer?.closeAllSessions()
    }

    /**
     * Send a MagnetAdded event to the extension.
     */
    fun sendMagnetAdded(magnet: String) {
        val payload = kotlinx.serialization.json.buildJsonObject {
            put("link", kotlinx.serialization.json.JsonPrimitive(magnet))
        }
        broadcastEvent("MagnetAdded", payload)
    }

    /**
     * Send a TorrentAdded event to the extension.
     */
    fun sendTorrentAdded(name: String, contentsBase64: String) {
        val payload = kotlinx.serialization.json.buildJsonObject {
            put("name", kotlinx.serialization.json.JsonPrimitive(name))
            put("contentsBase64", kotlinx.serialization.json.JsonPrimitive(contentsBase64))
        }
        broadcastEvent("TorrentAdded", payload)
    }

    // =========================================================================
    // Notification
    // =========================================================================

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "JSTorrent System Bridge",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows when JSTorrent System Bridge is running in background"
            setShowBadge(false)
        }

        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun createNotification(status: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("System Bridge")
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
        // Singleton for static access from AddRootActivity
        @Volatile
        var instance: IoDaemonService? = null
            private set

        fun start(context: Context) {
            val intent = Intent(context, IoDaemonService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, IoDaemonService::class.java)
            context.stopService(intent)
        }
    }
}
