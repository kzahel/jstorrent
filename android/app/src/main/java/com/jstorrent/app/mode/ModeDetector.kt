package com.jstorrent.app.mode

import android.content.Context

/**
 * Detects runtime environment to route between companion and standalone modes.
 *
 * Companion mode (ChromeOS): Extension runs in Chrome, app provides I/O
 * Standalone mode (Android): Full app experience with embedded WebView
 */
object ModeDetector {

    enum class Mode {
        /** Running on ChromeOS - acts as companion to browser extension */
        COMPANION,
        /** Running on Android phone/tablet - standalone app with WebView */
        STANDALONE
    }

    /**
     * Detect if running on ChromeOS (via ARC - Android Runtime for Chrome).
     */
    fun isChromebook(context: Context): Boolean {
        return context.packageManager.hasSystemFeature("org.chromium.arc") ||
            context.packageManager.hasSystemFeature("org.chromium.arc.device_management")
    }

    /**
     * Determine the runtime mode based on device detection.
     */
    fun detectMode(context: Context): Mode {
        return if (isChromebook(context)) Mode.COMPANION else Mode.STANDALONE
    }
}
