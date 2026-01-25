package com.jstorrent.app.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Pure formatting functions for displaying torrent data.
 * All functions are pure (no side effects) for easy testing.
 */
object Formatters {

    private const val KB = 1024L
    private const val MB = KB * 1024
    private const val GB = MB * 1024
    private const val TB = GB * 1024

    /**
     * Formats bytes to human-readable size (e.g., "1.5 GB").
     */
    fun formatBytes(bytes: Long): String {
        return when {
            bytes < 0 -> "0 B"
            bytes == 0L -> "0 B"
            bytes < KB -> "$bytes B"
            bytes < MB -> String.format(Locale.US, "%.1f KB", bytes.toDouble() / KB)
            bytes < GB -> String.format(Locale.US, "%.1f MB", bytes.toDouble() / MB)
            bytes < TB -> String.format(Locale.US, "%.2f GB", bytes.toDouble() / GB)
            else -> String.format(Locale.US, "%.2f TB", bytes.toDouble() / TB)
        }
    }

    /**
     * Formats download/upload speed (e.g., "1.2 MB/s").
     */
    fun formatSpeed(bytesPerSec: Long): String {
        if (bytesPerSec <= 0) return ""
        return when {
            bytesPerSec < KB -> "$bytesPerSec B/s"
            bytesPerSec < MB -> String.format(Locale.US, "%.1f KB/s", bytesPerSec.toDouble() / KB)
            bytesPerSec < GB -> String.format(Locale.US, "%.1f MB/s", bytesPerSec.toDouble() / MB)
            else -> String.format(Locale.US, "%.1f GB/s", bytesPerSec.toDouble() / GB)
        }
    }

    /**
     * Formats ETA in human-readable form (e.g., "2h 30m" or "∞").
     */
    fun formatEta(seconds: Long): String {
        if (seconds < 0 || seconds == Long.MAX_VALUE) return "∞"
        if (seconds == 0L) return "0s"

        val days = seconds / 86400
        val hours = (seconds % 86400) / 3600
        val minutes = (seconds % 3600) / 60
        val secs = seconds % 60

        return when {
            days > 0 -> "${days}d ${hours}h"
            hours > 0 -> "${hours}h ${minutes}m"
            minutes > 0 -> "${minutes}m ${secs}s"
            else -> "${secs}s"
        }
    }

    /**
     * Formats share ratio with appropriate precision (e.g., "1.234").
     */
    fun formatRatio(ratio: Double): String {
        return when {
            ratio < 0 -> "0.000"
            ratio.isNaN() || ratio.isInfinite() -> "∞"
            else -> String.format(Locale.US, "%.3f", ratio)
        }
    }

    /**
     * Formats progress as percentage (e.g., "45%").
     */
    fun formatPercent(fraction: Double): String {
        val percent = (fraction * 100).coerceIn(0.0, 100.0)
        return "${percent.toInt()}%"
    }

    /**
     * Formats epoch milliseconds to date/time (e.g., "12/25 5:20 PM").
     */
    fun formatDate(epochMs: Long): String {
        if (epochMs <= 0) return ""
        val date = Date(epochMs)
        val format = SimpleDateFormat("M/d h:mm a", Locale.US)
        return format.format(date)
    }

    /**
     * Formats epoch milliseconds to full date/time with year (e.g., "Jan 25, 2026 5:20 PM").
     * Use this for timestamps that may be from a different year.
     */
    fun formatDateTime(epochMs: Long): String {
        if (epochMs <= 0) return ""
        val date = Date(epochMs)
        val format = SimpleDateFormat("MMM d, yyyy h:mm a", Locale.US)
        return format.format(date)
    }

    /**
     * Formats status string to display text (e.g., "downloading" -> "Downloading").
     */
    fun formatStatus(status: String): String = when (status) {
        "downloading" -> "Downloading"
        "downloading_metadata" -> "Getting metadata..."
        "seeding" -> "Seeding"
        "stopped" -> "Paused"
        "checking" -> "Checking..."
        "error" -> "Error"
        "queued" -> "Queued"
        else -> status.replaceFirstChar { it.uppercase() }
    }

    /**
     * Formats peer counts for display (e.g., "5 (1,341)").
     * @param connected Number of currently connected peers
     * @param total Total known peers (optional)
     */
    fun formatPeers(connected: Int, total: Int? = null): String {
        return if (total != null && total > connected) {
            "$connected (${formatNumber(total)})"
        } else {
            "$connected"
        }
    }

    /**
     * Formats a number with thousands separators.
     */
    fun formatNumber(number: Int): String {
        return String.format(Locale.US, "%,d", number)
    }

    /**
     * Formats pieces info (e.g., "500/8,152 (256 KB)").
     */
    fun formatPieces(completed: Int, total: Int, pieceSize: Long): String {
        return "${formatNumber(completed)}/${formatNumber(total)} (${formatBytes(pieceSize)})"
    }

    /**
     * Formats downloaded / total size (e.g., "500 MB / 2.0 GB").
     */
    fun formatProgress(downloaded: Long, total: Long): String {
        return "${formatBytes(downloaded)} / ${formatBytes(total)}"
    }
}
