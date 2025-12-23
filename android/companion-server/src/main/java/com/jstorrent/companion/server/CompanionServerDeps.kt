package com.jstorrent.companion.server

import android.content.Context
import android.net.Uri
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A user-selected download folder.
 * Mirrors the desktop DownloadRoot structure for API compatibility.
 */
@Serializable
data class DownloadRoot(
    /** Opaque key: sha256(salt + uri.toString()), first 16 hex chars */
    val key: String,

    /** SAF tree URI (e.g., content://com.android.externalstorage.documents/tree/...) */
    val uri: String,

    /** User-friendly label extracted from URI path */
    @SerialName("display_name")
    val displayName: String,

    /** Whether this is removable storage (SD card, USB) */
    val removable: Boolean = false,

    /** Last availability check result */
    @SerialName("last_stat_ok")
    val lastStatOk: Boolean = true,

    /** Timestamp of last availability check (epoch millis) */
    @SerialName("last_checked")
    val lastChecked: Long = System.currentTimeMillis()
)

/**
 * Interface for token/authentication operations.
 * Implemented by app module's TokenStore.
 */
interface TokenStoreProvider {
    /** The pairing token, or null if not paired */
    val token: String?

    /** The paired extension ID, or null */
    val extensionId: String?

    /** The paired installation ID, or null */
    val installId: String?

    /** Token for standalone mode (local WebView) */
    val standaloneToken: String

    /** Returns true if paired with an extension */
    fun hasToken(): Boolean

    /** Check if paired with a specific extension installation */
    fun isPairedWith(extensionId: String, installId: String): Boolean

    /** Validate a token matches stored token or standalone token */
    fun isTokenValid(token: String): Boolean

    /** Store pairing credentials */
    fun pair(token: String, installId: String, extensionId: String)
}

/**
 * Interface for download root management.
 * Implemented by app module's RootStore.
 */
interface RootStoreProvider {
    /** Reload and check availability of all roots */
    fun refreshAvailability(): List<DownloadRoot>

    /** Get a root by key */
    fun getRoot(key: String): DownloadRoot?

    /** Remove a root by key, returns true if found and removed */
    fun removeRoot(key: String): Boolean

    /** Resolve a root key to its SAF URI */
    fun resolveKey(key: String): Uri?
}

/**
 * Dependencies that the companion server needs from the app module.
 * The app module implements this interface to provide concrete implementations.
 */
interface CompanionServerDeps {
    /** Android application context */
    val appContext: Context

    /** Token/authentication provider */
    val tokenStore: TokenStoreProvider

    /** Download root management provider */
    val rootStore: RootStoreProvider

    /** App version name for status responses */
    val versionName: String

    /**
     * Open the SAF folder picker activity.
     * Uses notification with full-screen intent as fallback for background restrictions.
     */
    fun openFolderPicker()

    /**
     * Show pairing approval dialog.
     * @param token The pairing token from extension
     * @param installId The extension installation ID
     * @param extensionId The Chrome extension ID
     * @param isReplace True if replacing existing pairing
     */
    fun showPairingDialog(
        token: String,
        installId: String,
        extensionId: String,
        isReplace: Boolean
    )

    /**
     * Release SAF permission for a URI.
     * Called when a root is deleted.
     */
    fun releaseSafPermission(uriString: String)

    /**
     * Notify that a new control connection has been established.
     * Used for intent handling (e.g., pending magnet links).
     */
    fun notifyConnectionEstablished()
}
