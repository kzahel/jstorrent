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
import com.jstorrent.app.MainActivity
import com.jstorrent.app.R
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.server.HttpServer
import com.jstorrent.app.storage.RootStore
import kotlinx.serialization.json.JsonElement

private const val TAG = "IoDaemonService"
private const val NOTIFICATION_ID = 1
private const val CHANNEL_ID = "jstorrent_daemon"

class IoDaemonService : Service() {

    private lateinit var tokenStore: TokenStore
    private lateinit var rootStore: RootStore
    private var httpServer: HttpServer? = null

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

        // Start as foreground service immediately
        startForeground(NOTIFICATION_ID, createNotification("Starting..."))

        // Start HTTP server
        startServer()

        // Update notification with port
        val port = httpServer?.port ?: 0
        updateNotification("Running on port $port")

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

        httpServer = HttpServer(tokenStore, rootStore, this)

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
    // Control Plane
    // =========================================================================

    /**
     * Broadcast ROOTS_CHANGED to all connected WebSocket clients.
     * Call this after AddRootActivity adds a new root.
     */
    fun broadcastRootsChanged() {
        val roots = rootStore.refreshAvailability()
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

    // =========================================================================
    // Notification
    // =========================================================================

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "JSTorrent Daemon",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows when JSTorrent daemon is running"
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
