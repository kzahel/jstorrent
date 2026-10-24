package org.rstorrent.bootstrap.ui

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import java.math.BigDecimal
import java.text.NumberFormat
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.seedStopLimits
import org.rstorrent.session.uniffi.ClientSettings
import org.rstorrent.session.uniffi.SeedStopLimit
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentSeedStopLimit
import org.rstorrent.session.uniffi.TorrentView

/** Largest ratio percent or seeding time in seconds the engine accepts. */
internal const val SEED_STOP_LIMIT_MAX: UInt = 2_147_483_647U

private const val MINUTE = 60U
private const val HOUR = 3_600U
private const val DAY = 86_400U
private const val WEEK = 604_800U

/** Share ratio presets in percent: 1.0, 1.5, 2.0, 3.0 and 5.0. */
internal val SEED_STOP_RATIO_PRESETS: List<UInt> = listOf(100U, 150U, 200U, 300U, 500U)

/** Seeding time presets in seconds: 1 hour, 6 hours, 1 day, 3 days, 1 week, 30 days. */
internal val SEED_STOP_TIME_PRESETS: List<UInt> =
    listOf(HOUR, 6U * HOUR, DAY, 3U * DAY, WEEK, 30U * DAY)

/** Units offered for a custom seeding time. */
internal enum class SeedTimeUnit(val seconds: UInt) {
    MINUTES(MINUTE),
    HOURS(HOUR),
    DAYS(DAY),
}

/** One choice in a stop-limit dialog. Use global is offered only per torrent. */
internal sealed interface SeedStopChoice {
    data object UseGlobal : SeedStopChoice

    data object Off : SeedStopChoice

    data class Preset(val value: UInt) : SeedStopChoice

    data object Custom : SeedStopChoice
}

/** The choice that shows [limit]; a value outside [presets] opens as Custom. */
internal fun seedStopChoice(
    limit: TorrentSeedStopLimit,
    presets: List<UInt>,
): SeedStopChoice =
    when (limit) {
        TorrentSeedStopLimit.UseGlobal -> SeedStopChoice.UseGlobal
        TorrentSeedStopLimit.Off -> SeedStopChoice.Off
        is TorrentSeedStopLimit.Limited ->
            if (limit.value in presets) SeedStopChoice.Preset(limit.value) else SeedStopChoice.Custom
    }

/** The limit a choice selects, or null while the custom value is invalid. */
internal fun SeedStopChoice.toLimit(custom: UInt?): TorrentSeedStopLimit? =
    when (this) {
        SeedStopChoice.UseGlobal -> TorrentSeedStopLimit.UseGlobal
        SeedStopChoice.Off -> TorrentSeedStopLimit.Off
        is SeedStopChoice.Preset -> TorrentSeedStopLimit.Limited(value)
        SeedStopChoice.Custom -> custom?.let { TorrentSeedStopLimit.Limited(it) }
    }

internal fun SeedStopLimit.asTorrentLimit(): TorrentSeedStopLimit =
    when (this) {
        SeedStopLimit.Off -> TorrentSeedStopLimit.Off
        is SeedStopLimit.Limited -> TorrentSeedStopLimit.Limited(value)
    }

/** The session form of a choice; null for Use global, which the session cannot hold. */
internal fun TorrentSeedStopLimit.asSessionLimit(): SeedStopLimit? =
    when (this) {
        TorrentSeedStopLimit.UseGlobal -> null
        TorrentSeedStopLimit.Off -> SeedStopLimit.Off
        is TorrentSeedStopLimit.Limited -> SeedStopLimit.Limited(value)
    }

/** The torrent's own limit unless it uses the session's; null when that is not loaded. */
internal fun effectiveSeedStopLimit(
    own: TorrentSeedStopLimit,
    global: SeedStopLimit?,
): SeedStopLimit? = own.asSessionLimit() ?: global

/** Parses a share ratio such as `2`, `1.5` or `1,25` into percent. */
internal fun parseSeedStopRatio(text: String): UInt? {
    val normalized = text.trim().replace(',', '.')
    if (!Regex("^\\d{1,8}(?:\\.\\d{1,2})?$").matches(normalized)) return null
    val percent = BigDecimal(normalized).movePointRight(2).longValueExact()
    return percent.takeIf { it <= SEED_STOP_LIMIT_MAX.toLong() }?.toUInt()
}

/** The custom ratio field's text for [percent], e.g. `2.5`; a 2.0 suggestion when unset. */
internal fun seedStopRatioText(percent: UInt?): String =
    BigDecimal((percent ?: 200U).toLong()).movePointLeft(2).stripTrailingZeros().toPlainString()

/** Parses a whole number of [unit] into seconds. */
internal fun parseSeedStopTime(
    text: String,
    unit: SeedTimeUnit,
): UInt? {
    if (!Regex("^\\d{1,10}$").matches(text.trim())) return null
    val seconds = text.trim().toLong() * unit.seconds.toLong()
    return seconds.takeIf { it <= SEED_STOP_LIMIT_MAX.toLong() }?.toUInt()
}

/**
 * The custom time fields for [seconds] in the largest exact unit; values
 * that are not whole minutes round to the nearest minute. A 1 day suggestion
 * when unset.
 */
internal fun seedStopTimeText(seconds: UInt?): Pair<String, SeedTimeUnit> {
    val value = seconds ?: return "1" to SeedTimeUnit.DAYS
    return when {
        value != 0U && value % DAY == 0U -> (value / DAY).toString() to SeedTimeUnit.DAYS
        value != 0U && value % HOUR == 0U -> (value / HOUR).toString() to SeedTimeUnit.HOURS
        else -> ((value.toLong() + 30L) / 60L).toString() to SeedTimeUnit.MINUTES
    }
}

/** Display unit for a seeding time limit. */
internal enum class SeedTimeAmountUnit { WEEKS, DAYS, HOURS, MINUTES }

/** A seeding time limit in its largest exact display unit, e.g. 1 week or 30 days. */
internal fun seedTimeAmount(seconds: UInt): Pair<Long, SeedTimeAmountUnit> =
    when {
        seconds != 0U && seconds % WEEK == 0U -> (seconds / WEEK).toLong() to SeedTimeAmountUnit.WEEKS
        seconds != 0U && seconds % DAY == 0U -> (seconds / DAY).toLong() to SeedTimeAmountUnit.DAYS
        seconds != 0U && seconds % HOUR == 0U -> (seconds / HOUR).toLong() to SeedTimeAmountUnit.HOURS
        else -> (seconds.toLong() + 30L) / 60L to SeedTimeAmountUnit.MINUTES
    }

/** Whether the engine paused this torrent because a stop limit was reached. */
internal val TorrentView.stoppedBySeedLimit: Boolean
    get() = seeding.stop?.stopped == true

/** Label for the single-torrent play/pause control. */
@StringRes
internal fun TorrentView.pauseResumeLabelRes(): Int =
    when {
        operationalState != TorrentOperationalState.PAUSED -> R.string.action_pause
        stoppedBySeedLimit -> R.string.action_keep_seeding
        else -> R.string.action_resume
    }

/** One effective stop limit with the torrent's progress toward it. */
internal sealed interface SeedStopProgress {
    data class Ratio(val limitPercent: UInt, val currentHundredths: String?) : SeedStopProgress

    data class Time(val limitSeconds: UInt, val seededSeconds: String) : SeedStopProgress
}

/**
 * The torrent's effective stop limits with progress, or null when a limit
 * follows session settings that are not loaded yet. An empty list means no
 * stop limit applies.
 */
internal fun seedStopProgress(
    torrent: TorrentView,
    global: ClientSettings?,
): List<SeedStopProgress>? {
    val own = torrent.seedStopLimits()
    val ratio = effectiveSeedStopLimit(own.ratioPercent, global?.seedStopRatioPercent) ?: return null
    val time = effectiveSeedStopLimit(own.timeSeconds, global?.seedStopTimeSeconds) ?: return null
    return buildList {
        if (ratio is SeedStopLimit.Limited) {
            add(SeedStopProgress.Ratio(ratio.value, torrent.lifetime.shareRatioHundredths))
        }
        if (time is SeedStopLimit.Limited) {
            add(SeedStopProgress.Time(time.value, torrent.lifetime.finishedSeconds))
        }
    }
}

@Composable
internal fun seedStopRatioValueLabel(percent: UInt): String =
    NumberFormat.getNumberInstance().apply {
        minimumFractionDigits = 1
        maximumFractionDigits = 2
        isGroupingUsed = false
    }.format(BigDecimal(percent.toLong()).movePointLeft(2))

@Composable
internal fun seedStopTimeValueLabel(seconds: UInt): String {
    val (amount, unit) = seedTimeAmount(seconds)
    val count = amount.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    return pluralStringResource(
        when (unit) {
            SeedTimeAmountUnit.WEEKS -> R.plurals.seed_stop_weeks
            SeedTimeAmountUnit.DAYS -> R.plurals.seed_stop_days
            SeedTimeAmountUnit.HOURS -> R.plurals.seed_stop_hours
            SeedTimeAmountUnit.MINUTES -> R.plurals.seed_stop_minutes
        },
        count,
        count,
    )
}

/** Global setting value: Off or the limit. */
@Composable
internal fun seedStopLimitLabel(
    limit: SeedStopLimit,
    valueLabel: @Composable (UInt) -> String,
): String =
    when (limit) {
        SeedStopLimit.Off -> stringResource(R.string.seed_stop_off)
        is SeedStopLimit.Limited -> valueLabel(limit.value)
    }

/** Per-torrent value: Use global (its value), No limit, or the limit. */
@Composable
internal fun torrentSeedStopLimitLabel(
    limit: TorrentSeedStopLimit,
    global: SeedStopLimit?,
    valueLabel: @Composable (UInt) -> String,
): String =
    when (limit) {
        TorrentSeedStopLimit.UseGlobal ->
            global?.let {
                // A torrent's own Off reads "No limit", so the global Off does too.
                val value = when (it) {
                    SeedStopLimit.Off -> stringResource(R.string.seed_stop_no_limit)
                    is SeedStopLimit.Limited -> valueLabel(it.value)
                }
                stringResource(R.string.seed_stop_use_global_value, value)
            } ?: stringResource(R.string.seed_stop_use_global)
        TorrentSeedStopLimit.Off -> stringResource(R.string.seed_stop_no_limit)
        is TorrentSeedStopLimit.Limited -> valueLabel(limit.value)
    }

/** Details text: each effective limit with progress, or No stop limit. */
@Composable
internal fun seedStopProgressText(progress: List<SeedStopProgress>): String =
    if (progress.isEmpty()) {
        stringResource(R.string.seed_stop_none)
    } else {
        progress.map {
            when (it) {
                is SeedStopProgress.Ratio ->
                    stringResource(
                        R.string.seed_stop_ratio_progress,
                        formatShareRatio(it.limitPercent.toString()),
                        formatShareRatio(it.currentHundredths),
                    )
                is SeedStopProgress.Time ->
                    stringResource(
                        R.string.seed_stop_time_progress,
                        seedStopTimeValueLabel(it.limitSeconds),
                        formatDuration(it.seededSeconds),
                    )
            }
        }.joinToString("\n")
    }
