package com.jstorrent.app.notification

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.NativeStandaloneActivity
import com.jstorrent.app.R
import com.jstorrent.app.util.Formatters

/**
 * Manages notifications for torrent events.
 *
 * Handles:
 * - Download complete notifications (with "Open Folder" action)
 * - Error notifications (storage full, connection issues)
 * - Permission handling for Android 13+ (TIRAMISU)
 *
 * Usage:
 * ```kotlin
 * val manager = TorrentNotificationManager(context)
 * manager.showDownloadComplete("ubuntu-22.04.iso", "abc123", 4_700_000_000L, folderUri)
 * manager.showError("ubuntu-22.04.iso", "abc123", "Storage full")
 * ```
 */
class TorrentNotificationManager(private val context: Context) {

    companion object {
        private const val NOTIFICATION_ID_BASE = 1000 // Download complete notifications
        private const val ERROR_NOTIFICATION_ID_BASE = 2000 // Error notifications
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
     * Show a download complete notification with size and "Open Folder" action.
     *
     * @param torrentName The name of the completed torrent
     * @param infoHash The info hash (used to generate unique notification ID)
     * @param sizeBytes The total size of the torrent in bytes
     * @param folderUri Optional URI of the download folder (for "Open Folder" action)
     */
    fun showDownloadComplete(
        torrentName: String,
        infoHash: String,
        sizeBytes: Long = 0L,
        folderUri: Uri? = null
    ) {
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

        // Format content text with size if available
        val contentText = if (sizeBytes > 0) {
            "$torrentName · ${Formatters.formatBytes(sizeBytes)}"
        } else {
            torrentName
        }

        val builder = NotificationCompat.Builder(context, JSTorrentApplication.NotificationChannels.COMPLETE)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("✓ Download complete")
            .setContentText(contentText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(contentText))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)

        // Add "Open Folder" action if folder URI is available
        if (folderUri != null) {
            val openFolderIntent = Intent(context, NotificationActionReceiver::class.java).apply {
                action = NotificationActionReceiver.ACTION_OPEN_FOLDER
                putExtra(NotificationActionReceiver.EXTRA_FOLDER_URI, folderUri.toString())
            }
            val openFolderPendingIntent = PendingIntent.getBroadcast(
                context,
                (infoHash.hashCode() + 1), // Different request code from content intent
                openFolderIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            builder.addAction(0, "Open Folder", openFolderPendingIntent)
        }

        val notificationId = NOTIFICATION_ID_BASE + (infoHash.hashCode() and 0xFFFF)

        try {
            NotificationManagerCompat.from(context).notify(notificationId, builder.build())
        } catch (e: SecurityException) {
            // Permission was revoked between check and notify
        }
    }

    /**
     * Show an error notification for a torrent.
     *
     * @param torrentName The name of the torrent with the error
     * @param infoHash The info hash (used to generate unique notification ID)
     * @param errorMessage Short error description (e.g., "Storage full")
     */
    fun showError(torrentName: String, infoHash: String, errorMessage: String) {
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

        val contentText = "$torrentName paused - $errorMessage"

        val notification = NotificationCompat.Builder(context, JSTorrentApplication.NotificationChannels.ERRORS)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("⚠️ $errorMessage")
            .setContentText(contentText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(contentText))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val notificationId = ERROR_NOTIFICATION_ID_BASE + (infoHash.hashCode() and 0xFFFF)

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
     * Cancel an error notification.
     *
     * @param infoHash The info hash of the torrent
     */
    fun cancelError(infoHash: String) {
        val notificationId = ERROR_NOTIFICATION_ID_BASE + (infoHash.hashCode() and 0xFFFF)
        NotificationManagerCompat.from(context).cancel(notificationId)
    }

    /**
     * Cancel all download complete notifications.
     */
    fun cancelAllDownloadComplete() {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications.forEach { notification ->
            if (notification.id >= NOTIFICATION_ID_BASE && notification.id < ERROR_NOTIFICATION_ID_BASE) {
                manager.cancel(notification.id)
            }
        }
    }

    /**
     * Cancel all error notifications.
     */
    fun cancelAllErrors() {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.activeNotifications.forEach { notification ->
            if (notification.id >= ERROR_NOTIFICATION_ID_BASE) {
                manager.cancel(notification.id)
            }
        }
    }

    /**
     * Cancel all notifications (completion and errors).
     */
    fun cancelAll() {
        cancelAllDownloadComplete()
        cancelAllErrors()
    }
}
