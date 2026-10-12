package org.rstorrent.bootstrap.ui

import android.icu.text.ListFormatter
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.max
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.ClientSettingsApplicationState
import org.rstorrent.session.uniffi.SeedAdmissionView
import org.rstorrent.session.uniffi.SeedGoalView
import org.rstorrent.session.uniffi.TorrentEtaView
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentView

internal fun productFailureDetail(error: Throwable, fallback: String): String =
    error.message?.takeIf { it.isNotBlank() } ?: fallback

internal fun formatBytes(decimal: String?): String {
    val bytes = decimal?.toDoubleOrNull() ?: return "—"
    val units = arrayOf("B", "KiB", "MiB", "GiB", "TiB")
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

@Composable
internal fun seedAdmissionLabel(admission: SeedAdmissionView): String =
    when (admission) {
        SeedAdmissionView.ACTIVE -> stringResource(R.string.seed_active)
        SeedAdmissionView.QUEUED -> stringResource(R.string.seed_queued)
        SeedAdmissionView.INACTIVE_EXEMPT -> stringResource(R.string.seed_inactive_exempt)
        SeedAdmissionView.INELIGIBLE -> stringResource(R.string.seed_ineligible)
    }

@Composable
internal fun seedGoalLabel(goal: SeedGoalView?): String {
    goal ?: return "—"
    val configuration = LocalConfiguration.current
    val thresholds =
        buildList {
            if (goal.shareRatioMet) add(stringResource(R.string.seed_goal_share_ratio))
            if (goal.finishedDownloadRatioMet) {
                add(stringResource(R.string.seed_goal_finished_download_ratio))
            }
            if (goal.finishedTimeMet) add(stringResource(R.string.seed_goal_finished_time))
        }.ifEmpty { listOf(stringResource(R.string.seed_goal_none)) }
    val status =
        stringResource(
            if (goal.status.name == "MET") R.string.seed_goal_met else R.string.seed_goal_unmet,
        )
    return stringResource(
        R.string.seed_goal_summary,
        status,
        ListFormatter.getInstance(configuration.locales[0]).format(thresholds),
    )
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
    stringResource(
        when (state) {
            TorrentOperationalState.QUEUED -> R.string.state_queued
            TorrentOperationalState.STARTING -> R.string.state_starting
            TorrentOperationalState.DOWNLOADING -> R.string.state_downloading
            TorrentOperationalState.CHECKING -> R.string.state_checking
            TorrentOperationalState.STOPPING -> R.string.state_stopping
            TorrentOperationalState.SEEDING -> R.string.state_seeding
            TorrentOperationalState.PAUSED -> R.string.state_paused
            TorrentOperationalState.ERROR -> R.string.state_error
        },
    )

/** Archived torrents are paused and inactive; show that instead of the paused state. */
@Composable
internal fun torrentStatusLabel(torrent: TorrentView): String =
    if (torrent.archived) stringResource(R.string.state_archived)
    else operationalLabel(torrent.operationalState)

@Composable
internal fun settingsApplicationLabel(state: ClientSettingsApplicationState): String =
    when (state) {
        ClientSettingsApplicationState.Applied -> stringResource(R.string.state_applied)
        ClientSettingsApplicationState.Applying -> stringResource(R.string.state_applying)
        is ClientSettingsApplicationState.Degraded -> state.detail
    }

internal fun percentLabel(progress: Float): String =
    String.format(Locale.getDefault(), "%.1f%%", max(0f, progress) * 100f)
