package com.jstorrent.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

/**
 * Application class for JSTorrent.
 *
 * Creates notification channels on startup. This ensures channels exist
 * before any service tries to use them.
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

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        deleteLegacyChannels()
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
            "jstorrent_engine",           // Old EngineService channel
            "jstorrent_download_complete" // Old TorrentNotificationManager channel
        )

        for (channelId in legacyChannels) {
            manager.deleteNotificationChannel(channelId)
        }
    }
}
