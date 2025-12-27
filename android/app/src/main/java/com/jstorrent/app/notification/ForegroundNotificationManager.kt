package com.jstorrent.app.notification

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.NativeStandaloneActivity
import com.jstorrent.app.R
import com.jstorrent.app.util.Formatters
import com.jstorrent.quickjs.model.TorrentSummary

private const val TAG = "ForegroundNotifMgr"

/**
 * Manages the foreground service notification with dynamic content.
 *
 * Shows:
 * - Torrent counts (downloading, seeding)
 * - Aggregate speeds
 * - Action buttons (Pause All / Resume All, Quit)
 */
class ForegroundNotificationManager(private val context: Context) {

    companion object {
        const val NOTIFICATION_ID = 2
    }

    /**
     * Computed notification state from torrent list.
     */
    data class NotificationState(
        val downloadingCount: Int,
        val seedingCount: Int,
        val downloadSpeed: Long,
        val uploadSpeed: Long,
        val hasActiveTorrents: Boolean
    )

    /**
     * Build notification from current torrent list.
     */
    fun buildNotification(torrents: List<TorrentSummary>): Notification {
        val state = computeState(torrents)
        return createNotification(state)
    }

    /**
     * Update the notification with new torrent state.
     */
    fun updateNotification(torrents: List<TorrentSummary>) {
        val notification = buildNotification(torrents)
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, notification)
    }

    /**
     * Compute notification state from torrent list.
     */
    private fun computeState(torrents: List<TorrentSummary>): NotificationState {
        var downloading = 0
        var seeding = 0
        var totalDown = 0L
        var totalUp = 0L
        var hasActive = false

        for (torrent in torrents) {
            // Check status - also consider progress and speeds for detection
            // (status string may not always match expected values)
            val isDownloading = torrent.status in listOf("downloading", "downloading_metadata", "checking", "queued") ||
                (torrent.progress < 1.0 && torrent.downloadSpeed > 0)
            val isSeeding = torrent.status == "seeding" ||
                (torrent.progress >= 1.0 && torrent.uploadSpeed > 0)
            val isStopped = torrent.status == "stopped"

            when {
                isDownloading && !isStopped -> {
                    downloading++
                    hasActive = true
                }
                isSeeding && !isStopped -> {
                    seeding++
                    hasActive = true
                }
            }
            totalDown += torrent.downloadSpeed
            totalUp += torrent.uploadSpeed
        }

        return NotificationState(
            downloadingCount = downloading,
            seedingCount = seeding,
            downloadSpeed = totalDown,
            uploadSpeed = totalUp,
            hasActiveTorrents = hasActive
        )
    }

    private fun createNotification(state: NotificationState): Notification {
        // Content intent - open app
        val contentIntent = PendingIntent.getActivity(
            context,
            0,
            Intent(context, NativeStandaloneActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        // Build status line
        val statusLine = buildStatusLine(state)

        // Build speed line
        val speedLine = buildSpeedLine(state)

        val builder = NotificationCompat.Builder(context, JSTorrentApplication.NotificationChannels.SERVICE)
            .setContentTitle("JSTorrent")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)

        // Set content based on whether we have speeds
        if (speedLine.isNotEmpty()) {
            builder.setContentText(statusLine)
            builder.setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("$statusLine\n$speedLine")
            )
        } else {
            builder.setContentText(statusLine)
        }

        // Add action buttons
        addActionButtons(builder, state)

        return builder.build()
    }

    /**
     * Build status line like "↓ 2 downloading · ↑ 1 seeding" or "No active torrents"
     */
    private fun buildStatusLine(state: NotificationState): String {
        val parts = mutableListOf<String>()

        if (state.downloadingCount > 0) {
            parts.add("\u2193 ${state.downloadingCount} downloading")
        }
        if (state.seedingCount > 0) {
            parts.add("\u2191 ${state.seedingCount} seeding")
        }

        return if (parts.isEmpty()) {
            "No active torrents"
        } else {
            parts.joinToString(" \u00B7 ")  // Middle dot separator
        }
    }

    /**
     * Build speed line like "12.5 MB/s down · 1.2 MB/s up"
     */
    private fun buildSpeedLine(state: NotificationState): String {
        val parts = mutableListOf<String>()

        if (state.downloadSpeed > 0) {
            parts.add("${Formatters.formatSpeed(state.downloadSpeed)} down")
        }
        if (state.uploadSpeed > 0) {
            parts.add("${Formatters.formatSpeed(state.uploadSpeed)} up")
        }

        return parts.joinToString(" \u00B7 ")
    }

    private fun addActionButtons(builder: NotificationCompat.Builder, state: NotificationState) {
        // Pause All / Resume All (mutually exclusive based on state)
        if (state.hasActiveTorrents) {
            val pauseIntent = PendingIntent.getBroadcast(
                context,
                0,
                Intent(NotificationActionReceiver.ACTION_PAUSE_ALL).setPackage(context.packageName),
                PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Pause All", pauseIntent)
        } else {
            val resumeIntent = PendingIntent.getBroadcast(
                context,
                1,
                Intent(NotificationActionReceiver.ACTION_RESUME_ALL).setPackage(context.packageName),
                PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Resume All", resumeIntent)
        }

        // Quit action (always shown)
        val quitIntent = PendingIntent.getBroadcast(
            context,
            2,
            Intent(NotificationActionReceiver.ACTION_QUIT).setPackage(context.packageName),
            PendingIntent.FLAG_IMMUTABLE
        )
        builder.addAction(0, "Quit", quitIntent)
    }
}
