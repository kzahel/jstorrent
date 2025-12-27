package com.jstorrent.app.notification

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.NativeStandaloneActivity
import com.jstorrent.app.R

/**
 * Manages notifications for torrent events.
 *
 * Handles:
 * - Download complete notifications
 * - Permission handling for Android 13+ (TIRAMISU)
 *
 * Usage:
 * ```kotlin
 * val manager = TorrentNotificationManager(context)
 * manager.showDownloadComplete("ubuntu-22.04.iso", "abc123")
 * ```
 */
class TorrentNotificationManager(private val context: Context) {

    companion object {
        private const val NOTIFICATION_ID_BASE = 1000 // Use different range from service notification
    }

    /**
     * Check if notification permission is granted.
     * On Android 12 and below, always returns true.
     * On Android 13+, checks POST_NOTIFICATIONS permission.
     */
    fun hasNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    /**
     * Get the notification permission string.
     * Used when requesting permission from Activity.
     */
    fun getNotificationPermission(): String? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.POST_NOTIFICATIONS
        } else {
            null
        }
    }

    /**
     * Show a download complete notification.
     *
     * @param torrentName The name of the completed torrent
     * @param infoHash The info hash (used to generate unique notification ID)
     */
    fun showDownloadComplete(torrentName: String, infoHash: String) {
        if (!hasNotificationPermission()) {
            return
        }

        // Create intent to open app when notification is tapped
        val intent = Intent(context, NativeStandaloneActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("infoHash", infoHash)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            infoHash.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(context, JSTorrentApplication.NotificationChannels.COMPLETE)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("Download Complete")
            .setContentText(torrentName)
            .setStyle(NotificationCompat.BigTextStyle().bigText(torrentName))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val notificationId = NOTIFICATION_ID_BASE + (infoHash.hashCode() and 0xFFFF)

        try {
            NotificationManagerCompat.from(context).notify(notificationId, notification)
        } catch (e: SecurityException) {
            // Permission was revoked between check and notify
        }
    }

    /**
     * Cancel a download complete notification.
     *
     * @param infoHash The info hash of the torrent
     */
    fun cancelDownloadComplete(infoHash: String) {
        val notificationId = NOTIFICATION_ID_BASE + (infoHash.hashCode() and 0xFFFF)
        NotificationManagerCompat.from(context).cancel(notificationId)
    }

    /**
     * Cancel all download complete notifications.
     */
    fun cancelAllDownloadComplete() {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications.forEach { notification ->
            if (notification.id >= NOTIFICATION_ID_BASE) {
                manager.cancel(notification.id)
            }
        }
    }
}
