package com.jstorrent.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.link.PendingLinkManager
import com.jstorrent.app.storage.RootStore
import com.jstorrent.companion.server.CompanionServerDeps
import com.jstorrent.companion.server.DownloadRoot
import com.jstorrent.companion.server.RootStoreProvider
import com.jstorrent.companion.server.TokenStoreProvider

private const val TAG = "CompanionServerDepsImpl"

/**
 * Implementation of CompanionServerDeps that bridges companion-server
 * to app-level components.
 */
class CompanionServerDepsImpl(
    override val appContext: Context,
    private val tokenStoreImpl: TokenStore,
    private val rootStoreImpl: RootStore
) : CompanionServerDeps {

    override val versionName: String = BuildConfig.VERSION_NAME

    override val tokenStore: TokenStoreProvider = object : TokenStoreProvider {
        override val token: String? get() = tokenStoreImpl.token
        override val extensionId: String? get() = tokenStoreImpl.extensionId
        override val installId: String? get() = tokenStoreImpl.installId
        override val standaloneToken: String get() = tokenStoreImpl.standaloneToken

        override fun hasToken(): Boolean = tokenStoreImpl.hasToken()
        override fun isPairedWith(extensionId: String, installId: String): Boolean =
            tokenStoreImpl.isPairedWith(extensionId, installId)
        override fun isTokenValid(token: String): Boolean = tokenStoreImpl.isTokenValid(token)
        override fun pair(token: String, installId: String, extensionId: String) {
            tokenStoreImpl.pair(token, installId, extensionId)
        }
    }

    override val rootStore: RootStoreProvider = object : RootStoreProvider {
        override fun refreshAvailability(): List<DownloadRoot> {
            return rootStoreImpl.refreshAvailability().map { root ->
                DownloadRoot(
                    key = root.key,
                    uri = root.uri,
                    displayName = root.displayName,
                    removable = root.removable,
                    lastStatOk = root.lastStatOk,
                    lastChecked = root.lastChecked
                )
            }
        }

        override fun getRoot(key: String): DownloadRoot? {
            return rootStoreImpl.getRoot(key)?.let { root ->
                DownloadRoot(
                    key = root.key,
                    uri = root.uri,
                    displayName = root.displayName,
                    removable = root.removable,
                    lastStatOk = root.lastStatOk,
                    lastChecked = root.lastChecked
                )
            }
        }

        override fun removeRoot(key: String): Boolean = rootStoreImpl.removeRoot(key)

        override fun resolveKey(key: String): Uri? = rootStoreImpl.resolveKey(key)
    }

    /**
     * Open the SAF folder picker activity.
     * Uses notification with full-screen intent as fallback for background restrictions.
     */
    override fun openFolderPicker() {
        val intent = Intent(appContext, AddRootActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NEW_DOCUMENT
        }

        // Post notification first (as safety net) - activity will cancel it when it starts
        val channelId = "jstorrent_folder_picker"
        val notificationId = AddRootActivity.FOLDER_PICKER_NOTIFICATION_ID

        val channel = NotificationChannel(
            channelId,
            "Folder Picker",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Shows folder picker when requested by extension"
        }
        val notificationManager = appContext.getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)

        // Cancel any existing notification first - forces fresh heads-up
        notificationManager.cancel(notificationId)

        val pendingIntent = PendingIntent.getActivity(
            appContext,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(appContext, channelId)
            .setContentTitle("Add Download Folder")
            .setContentText("Tap to select a download folder")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(pendingIntent, true)
            .setAutoCancel(true)
            .build()

        notificationManager.notify(notificationId, notification)
        Log.i(TAG, "Folder picker notification posted")

        // Also try direct activity start
        try {
            appContext.startActivity(intent)
            Log.i(TAG, "Folder picker activity start attempted")
        } catch (e: Exception) {
            Log.w(TAG, "Direct activity start failed: ${e.message}")
        }
    }

    /**
     * Show pairing approval dialog.
     */
    override fun showPairingDialog(
        token: String,
        installId: String,
        extensionId: String,
        isReplace: Boolean
    ) {
        PairingApprovalActivity.pendingCallback = { approved, approvedToken, approvedInstallId, approvedExtensionId ->
            if (approved && approvedToken != null && approvedInstallId != null && approvedExtensionId != null) {
                tokenStoreImpl.pair(approvedToken, approvedInstallId, approvedExtensionId)
                Log.i(TAG, "Pairing approved and stored")
            } else {
                Log.i(TAG, "Pairing denied or dismissed")
            }
        }

        val intent = Intent(appContext, PairingApprovalActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
            putExtra(PairingApprovalActivity.EXTRA_TOKEN, token)
            putExtra(PairingApprovalActivity.EXTRA_INSTALL_ID, installId)
            putExtra(PairingApprovalActivity.EXTRA_EXTENSION_ID, extensionId)
            putExtra(PairingApprovalActivity.EXTRA_IS_REPLACE, isReplace)
        }
        appContext.startActivity(intent)
    }

    /**
     * Release SAF permission for a URI.
     */
    override fun releaseSafPermission(uriString: String) {
        try {
            val uri = Uri.parse(uriString)
            appContext.contentResolver.releasePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            Log.i(TAG, "Released SAF permission for $uriString")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to release SAF permission: ${e.message}")
        }
    }

    /**
     * Notify that a new control connection has been established.
     */
    override fun notifyConnectionEstablished() {
        PendingLinkManager.notifyConnectionEstablished()
    }
}
