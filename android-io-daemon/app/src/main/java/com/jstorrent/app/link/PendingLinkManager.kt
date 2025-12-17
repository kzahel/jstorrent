package com.jstorrent.app.link

import android.util.Log

private const val TAG = "PendingLinkManager"

sealed class PendingLink {
    data class Magnet(val link: String) : PendingLink()
    data class Torrent(val name: String, val contentsBase64: String) : PendingLink()
}

/**
 * Singleton for managing pending magnet/torrent links that arrive
 * before the extension's control connection is established.
 *
 * Used for cold boot scenarios on ChromeOS where the extension service
 * worker may be inactive when the user clicks a torrent file.
 */
object PendingLinkManager {
    private val pendingLinks = mutableListOf<PendingLink>()
    private var connectionListener: (() -> Unit)? = null

    @Synchronized
    fun addMagnet(link: String) {
        Log.i(TAG, "Queued magnet link: $link")
        pendingLinks.add(PendingLink.Magnet(link))
    }

    @Synchronized
    fun addTorrent(name: String, contentsBase64: String) {
        Log.i(TAG, "Queued torrent: $name")
        pendingLinks.add(PendingLink.Torrent(name, contentsBase64))
    }

    @Synchronized
    fun getPendingLinks(): List<PendingLink> = pendingLinks.toList()

    @Synchronized
    fun clearPendingLinks() {
        Log.i(TAG, "Cleared ${pendingLinks.size} pending links")
        pendingLinks.clear()
    }

    fun setConnectionListener(listener: (() -> Unit)?) {
        connectionListener = listener
    }

    /**
     * Called by SocketHandler when a control session is authenticated.
     * This triggers the MainActivity to forward any queued links.
     */
    fun notifyConnectionEstablished() {
        Log.i(TAG, "Control connection established, notifying listener")
        connectionListener?.invoke()
    }
}
