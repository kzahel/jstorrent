package org.rstorrent.bootstrap.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.max
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.ProgressReason
import org.rstorrent.session.uniffi.RemovalState
import org.rstorrent.session.uniffi.TorrentEtaView
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentView

internal fun productFailureDetail(error: Throwable, fallback: String): String =
    error.message?.takeIf { it.isNotBlank() } ?: fallback

internal fun formatBytes(decimal: String?): String {
    val bytes = decimal?.toDoubleOrNull() ?: return "—"
    // 1024-based, labelled KB/MB like the original JSTorrent app.
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var value = bytes
    var unit = 0
    while (value >= 1024.0 && unit < units.lastIndex) {
        value /= 1024.0
        unit += 1
    }
    val pattern = if (unit == 0) "%.0f %s" else "%.1f %s"
    return String.format(Locale.getDefault(), pattern, value, units[unit])
}

internal fun formatRate(decimal: String?): String =
    if ((decimal?.toULongOrNull() ?: 0UL) == 0UL) "0 B/s" else "${formatBytes(decimal)}/s"

internal fun torrentPresentationName(torrent: TorrentView): String =
    torrent.displayName ?: torrent.sourceDisplayName ?: torrent.torrentId

/**
 * The size a magnet link claimed (`xl`), only while the verified size is
 * unknown. A claim from the link, never a verified size.
 */
internal fun linkClaimedSizeBytes(torrent: TorrentView): String? =
    torrent.sourceSizeBytes?.takeIf { torrent.totalSizeBytes == null }

/** The verified size, or before metadata the link's size labelled as such. */
@Composable
internal fun torrentSizeText(torrent: TorrentView): String {
    val claimed = linkClaimedSizeBytes(torrent) ?: return formatBytes(torrent.totalSizeBytes)
    return stringResource(R.string.detail_size_from_link, formatBytes(claimed))
}

@Composable
internal fun formatDuration(seconds: ULong): String {
    val days = seconds / 86_400UL
    val hours = seconds % 86_400UL / 3_600UL
    val minutes = seconds % 3_600UL / 60UL
    val remaining = seconds % 60UL
    return when {
        days > 0UL -> stringResource(R.string.duration_days_hours, days.toLong(), hours.toLong())
        hours > 0UL -> stringResource(R.string.duration_hours_minutes, hours.toLong(), minutes.toLong())
        minutes > 0UL -> stringResource(R.string.duration_minutes_seconds, minutes.toLong(), remaining.toLong())
        else -> stringResource(R.string.duration_seconds, remaining.toLong())
    }
}

@Composable
internal fun formatDuration(decimal: String): String {
    val seconds = decimal.toULongOrNull() ?: return "—"
    return formatDuration(seconds)
}

internal fun formatShareRatio(hundredths: String?): String {
    val value = hundredths?.toBigIntegerOrNull()?.takeIf { it.signum() >= 0 } ?: return "—"
    return NumberFormat.getNumberInstance().apply {
        minimumFractionDigits = 2
        maximumFractionDigits = 2
        isGroupingUsed = false
    }.format(BigDecimal(value).movePointLeft(2))
}

internal fun torrentProgress(torrent: TorrentView): Float {
    val required = torrent.requiredPayloadBytes?.toDoubleOrNull()
    val remaining = torrent.remainingPayloadBytes?.toDoubleOrNull()
    if (required != null && remaining != null && required > 0.0) {
        return ((required - remaining) / required).coerceIn(0.0, 1.0).toFloat()
    }
    if (torrent.pieceCount > 0U) {
        return (torrent.verifiedPieceCount.toFloat() / torrent.pieceCount.toFloat())
            .coerceIn(0f, 1f)
    }
    return 0f
}

@Composable
internal fun torrentEta(torrent: TorrentView): String =
    when (val eta = torrent.eta) {
        is TorrentEtaView.Estimate -> formatDuration(eta.seconds)
        TorrentEtaView.WarmingUp -> stringResource(R.string.state_calculating)
        TorrentEtaView.Stalled -> stringResource(R.string.state_stalled)
        TorrentEtaView.Unavailable -> "—"
    }

@Composable
internal fun operationalLabel(state: TorrentOperationalState): String =
    stringResource(operationalLabelRes(state))

@StringRes
internal fun operationalLabelRes(state: TorrentOperationalState): Int =
    when (state) {
        TorrentOperationalState.QUEUED -> R.string.state_queued
        TorrentOperationalState.STARTING -> R.string.state_starting
        TorrentOperationalState.DOWNLOADING -> R.string.state_downloading
        TorrentOperationalState.CHECKING -> R.string.state_checking
        TorrentOperationalState.STOPPING -> R.string.state_stopping
        TorrentOperationalState.SEEDING -> R.string.state_seeding
        TorrentOperationalState.PAUSED -> R.string.state_paused
        TorrentOperationalState.ERROR -> R.string.state_error
    }

/** Its download folder is missing, removed or lost its Android access. */
internal fun TorrentView.waitingForStorage(): Boolean =
    progress.reason == ProgressReason.WAITING_FOR_STORAGE

@Composable
internal fun torrentStatusLabel(torrent: TorrentView): String =
    stringResource(torrentStatusLabelRes(torrent))

/**
 * Removal outranks every other state because the torrent is going away.
 * Archived torrents are paused and inactive; show that instead of the paused
 * state. A torrent the engine paused at a stop limit reads Seeding limit
 * reached rather than Paused.
 */
@StringRes
internal fun torrentStatusLabelRes(torrent: TorrentView): Int =
    when {
        torrent.removalActive -> R.string.state_removing
        torrent.removalState == RemovalState.FAILED -> R.string.state_removal_failed
        torrent.archived -> R.string.state_archived
        torrent.waitingForStorage() -> R.string.state_folder_unavailable
        torrent.operationalState == TorrentOperationalState.PAUSED && torrent.stoppedBySeedLimit ->
            R.string.state_seed_limit_reached
        else -> operationalLabelRes(torrent.operationalState)
    }

/** What the torrent is doing right now, for the Status tab. */
@Composable
internal fun torrentActivityLabel(torrent: TorrentView): String =
    stringResource(torrentActivityLabelRes(torrent))

@StringRes
internal fun torrentActivityLabelRes(torrent: TorrentView): Int =
    if (torrent.progress.reason == ProgressReason.PAUSED && torrent.stoppedBySeedLimit) {
        R.string.state_seed_limit_reached
    } else {
        progressReasonLabelRes(torrent.progress.reason)
    }

@StringRes
internal fun progressReasonLabelRes(reason: ProgressReason): Int =
    when (reason) {
        ProgressReason.NETWORK_DISABLED -> R.string.activity_network_off
        ProgressReason.WAITING_FOR_UNMETERED_NETWORK -> R.string.status_waiting_unmetered
        ProgressReason.DISCOVERING_PEERS,
        ProgressReason.WAITING_FOR_DISCOVERY,
        -> R.string.activity_finding_peers
        ProgressReason.NO_ENABLED_DISCOVERY_SOURCE -> R.string.activity_no_peer_sources
        ProgressReason.ACQUIRING_METADATA -> R.string.activity_getting_metadata
        ProgressReason.PREPARING_STORAGE -> R.string.activity_preparing_files
        ProgressReason.WAITING_FOR_STORAGE -> R.string.state_folder_unavailable
        ProgressReason.PREPARING_INTEGRITY -> R.string.state_checking
        ProgressReason.TRANSFERRING_PIECES -> R.string.state_downloading
        ProgressReason.VERIFYING_PIECES -> R.string.activity_verifying
        ProgressReason.PAUSED -> R.string.state_paused
        ProgressReason.COMPLETE -> R.string.activity_complete
        ProgressReason.NEEDS_REPAIR -> R.string.activity_needs_repair
        ProgressReason.FAILED -> R.string.state_error
    }

internal fun percentLabel(progress: Float): String =
    String.format(Locale.getDefault(), "%.1f%%", max(0f, progress) * 100f)
