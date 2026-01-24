package com.jstorrent.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import com.jstorrent.app.auth.StandaloneMode
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.link.PendingLinkManager
import com.jstorrent.app.mode.ModeDetector
import com.jstorrent.app.service.IoDaemonService

private const val TAG = "LinkHandlerActivity"

/**
 * Transparent trampoline activity for handling magnet links and torrent files.
 *
 * This activity has no UI and finishes immediately after processing the intent.
 * This prevents the companion app from coming to the foreground when the user
 * clicks a magnet link - only the extension UI should appear.
 *
 * Routing logic:
 * - Chromebook: Process via IoDaemonService (bridge to extension)
 * - Non-Chromebook: Forward to standalone activity (NativeStandaloneActivity or StandaloneActivity)
 */
class LinkHandlerActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val uri = intent?.data
        if (uri == null) {
            Log.w(TAG, "No URI in intent")
            finish()
            return
        }

        Log.d(TAG, "Received intent: $uri")

        val isChromebook = ModeDetector.isChromebook(this)

        if (isChromebook) {
            handleChromebookIntent(uri)
        } else {
            handleStandaloneIntent(uri)
        }

        // Always finish immediately - this activity has no UI
        finish()
    }

    /**
     * Chromebook mode: Process link via IoDaemonService to bridge to extension.
     */
    private fun handleChromebookIntent(uri: Uri) {
        // Ensure service is running
        IoDaemonService.start(this)

        when {
            uri.scheme == "magnet" -> {
                Log.i(TAG, "Chromebook: Magnet link")
                handleMagnetLink(uri.toString())
            }
            uri.scheme == "file" || uri.scheme == "content" -> {
                Log.i(TAG, "Chromebook: Torrent file")
                handleTorrentFile(uri)
            }
            else -> {
                Log.w(TAG, "Chromebook: Unknown URI scheme: ${uri.scheme}")
            }
        }
    }

    /**
     * Standalone mode: Forward to the appropriate standalone activity.
     */
    private fun handleStandaloneIntent(uri: Uri) {
        val tokenStore = TokenStore(this)
        val targetActivity = when (tokenStore.standaloneMode) {
            StandaloneMode.NATIVE -> {
                Log.i(TAG, "Standalone: Forwarding to native activity")
                NativeStandaloneActivity::class.java
            }
            StandaloneMode.WEBVIEW -> {
                Log.i(TAG, "Standalone: Forwarding to WebView activity")
                StandaloneActivity::class.java
            }
        }

        // Read torrent file now (we have URI permission) and pass as extra
        // This avoids permission issues when forwarding content:// URIs between activities
        var torrentBase64: String? = null
        if (uri.scheme == "content" || uri.scheme == "file") {
            try {
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes != null) {
                    torrentBase64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                    Log.i(TAG, "Read torrent file: ${bytes.size} bytes")
                } else {
                    Log.e(TAG, "Failed to read torrent file: openInputStream returned null")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to read torrent file", e)
            }
        }

        startActivity(Intent(this, targetActivity).apply {
            if (torrentBase64 != null) {
                putExtra("torrent_base64", torrentBase64)
            } else {
                data = uri  // Magnet links pass through as URI
            }
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        })
    }

    private fun handleMagnetLink(magnetLink: String) {
        val service = IoDaemonService.instance

        if (service?.hasActiveControlConnection() == true) {
            // Connection exists - send immediately
            Log.i(TAG, "Control connection active, sending magnet immediately")
            service.sendMagnetAdded(magnetLink)
        } else {
            // No connection - queue link for when connection is established
            Log.i(TAG, "No control connection, queuing magnet")
            PendingLinkManager.addMagnet(magnetLink)
            // The extension will connect and drain pending links
        }
    }

    private fun handleTorrentFile(uri: Uri) {
        // Read torrent file and encode as base64
        val name = uri.lastPathSegment ?: "unknown.torrent"
        val bytes = try {
            contentResolver.openInputStream(uri)?.use { it.readBytes() }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to read torrent file: ${e.message}")
            return
        }

        if (bytes == null) {
            Log.e(TAG, "Failed to read torrent file: empty content")
            return
        }

        val contentsBase64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)

        val service = IoDaemonService.instance

        if (service?.hasActiveControlConnection() == true) {
            Log.i(TAG, "Control connection active, sending torrent immediately")
            service.sendTorrentAdded(name, contentsBase64)
        } else {
            Log.i(TAG, "No control connection, queuing torrent")
            PendingLinkManager.addTorrent(name, contentsBase64)
        }
    }
}
