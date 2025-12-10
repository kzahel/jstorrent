package com.jstorrent.app.storage

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
