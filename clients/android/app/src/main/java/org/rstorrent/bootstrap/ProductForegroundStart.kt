package org.rstorrent.bootstrap

import android.app.ForegroundServiceStartNotAllowedException
import android.os.Build
import android.util.Log

/** Android can reject a start or promotion after the activity loses eligibility. */
internal inline fun tryProductForegroundStart(
    stage: String,
    start: () -> Unit,
): Boolean =
    try {
        start()
        true
    } catch (error: IllegalStateException) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            error !is ForegroundServiceStartNotAllowedException
        ) {
            throw error
        }
        Log.w("RSTorrentProduct", "product_foreground_start rejected stage=$stage")
        false
    }
