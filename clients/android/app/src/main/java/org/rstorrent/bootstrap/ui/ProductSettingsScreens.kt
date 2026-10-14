package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import org.rstorrent.bootstrap.ProductNetworkState
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.ActiveSeedLimit
import org.rstorrent.session.uniffi.ClientSettingsApplicationState
import org.rstorrent.session.uniffi.ClientSettingsRuntimeView
import org.rstorrent.session.uniffi.EncryptionPolicy
import org.rstorrent.session.uniffi.ListenerBindFailureReason
import org.rstorrent.session.uniffi.ListenerPolicy
import org.rstorrent.session.uniffi.ListenerStatus
import org.rstorrent.session.uniffi.PortMappingFailureStage
import org.rstorrent.session.uniffi.PortMappingPolicy
import org.rstorrent.session.uniffi.PortMappingStatus
import org.rstorrent.session.uniffi.SeedStopLimit
import org.rstorrent.session.uniffi.TorrentSeedStopLimit
import org.rstorrent.session.uniffi.TransferRateLimit

@Composable
internal fun ConnectionLimitsSettings(
    settings: ClientSettingsRuntimeView,
    onPeerConnections: (UInt) -> Unit,
    onUploadSlots: (UShort) -> Unit,
    onActiveDownloads: (UShort) -> Unit,
    onActiveSeeds: (ActiveSeedLimit) -> Unit,
    onUploadRateLimit: (TransferRateLimit) -> Unit,
    onDownloadRateLimit: (TransferRateLimit) -> Unit,
    onSeedStopRatio: (SeedStopLimit) -> Unit,
    onSeedStopTime: (SeedStopLimit) -> Unit,
) {
    SettingsSection(stringResource(R.string.settings_section_speed_limits))
    RateLimitSetting(
        title = stringResource(R.string.setting_download),
        configured = settings.configured.downloadRateLimit,
        effective = settings.effectiveDownloadRateLimit,
        application = settings.bandwidthApplication,
        onValue = onDownloadRateLimit,
    )
    RateLimitSetting(
        title = stringResource(R.string.setting_upload),
        configured = settings.configured.uploadRateLimit,
        effective = settings.effectiveUploadRateLimit,
        application = settings.bandwidthApplication,
        onValue = onUploadRateLimit,
    )
    SettingsSection(stringResource(R.string.settings_section_queue))
    NumericSetting(
        stringResource(R.string.setting_active_downloads),
        settings.configured.activeDownloads.toInt(),
        1..20,
        supporting =
            limitedNote(
                settings.configured.activeDownloads.toLong(),
                settings.effectiveActiveDownloads.toLong(),
            ),
    ) { onActiveDownloads(it.toUShort()) }
    ActiveSeedSetting(
        configured = settings.configured.activeSeeds,
        onValue = onActiveSeeds,
    )
    SettingsSection(stringResource(R.string.settings_section_stop_seeding))
    Text(
        stringResource(R.string.setting_stop_seeding_detail),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
    )
    SeedStopRatioSetting(
        configured = settings.configured.seedStopRatioPercent.asTorrentLimit(),
        global = null,
        perTorrent = false,
        onValue = { limit -> limit.asSessionLimit()?.let(onSeedStopRatio) },
    )
    SeedStopTimeSetting(
        configured = settings.configured.seedStopTimeSeconds.asTorrentLimit(),
        global = null,
        perTorrent = false,
        onValue = { limit -> limit.asSessionLimit()?.let(onSeedStopTime) },
    )
    SettingsSection(stringResource(R.string.settings_section_connections))
    NumericSetting(
        stringResource(R.string.setting_peer_connections),
        settings.configured.peerConnectionLimit.toInt(),
        1..2_000,
        supporting =
            settingNote(
                settings.peerConnectionsApplication,
                limitedNote(
                    settings.configured.peerConnectionLimit.toLong(),
                    settings.effectivePeerConnectionLimit.toLong(),
                ),
            ),
    ) { onPeerConnections(it.toUInt()) }
    NumericSetting(
        stringResource(R.string.setting_upload_slots),
        settings.configured.uploadSlots.toInt(),
        0..50,
        supporting =
            settingNote(
                settings.uploadSlotsApplication,
                limitedNote(
                    settings.configured.uploadSlots.toLong(),
                    settings.effectiveUploadSlots.toLong(),
                ),
            ),
    ) { onUploadSlots(it.toUShort()) }
}

/** Nothing when a setting applied normally; a short line while pending or when it failed. */
@Composable
internal fun settingNote(
    application: ClientSettingsApplicationState,
    applied: String? = null,
): String? =
    when (application) {
        ClientSettingsApplicationState.Applied -> applied
        ClientSettingsApplicationState.Applying -> stringResource(R.string.state_applying)
        is ClientSettingsApplicationState.Degraded -> stringResource(R.string.setting_not_applied)
    }

@Composable
private fun limitedNote(configured: Long, effective: Long): String? =
    if (effective != configured) stringResource(R.string.setting_limited_on_device, effective) else null

@Composable
private fun ActiveSeedSetting(
    configured: ActiveSeedLimit,
    onValue: (ActiveSeedLimit) -> Unit,
) {
    var dialog by remember { mutableStateOf(false) }
    val title = stringResource(R.string.setting_active_seeds)
    ValueRow(title, activeSeedLimitLabel(configured), null) { dialog = true }
    if (dialog) {
        var unlimited by remember(configured) {
            mutableStateOf(configured is ActiveSeedLimit.Unlimited)
        }
        var text by remember(configured) {
            mutableStateOf((configured as? ActiveSeedLimit.Limited)?.torrents?.toString() ?: "5")
        }
        val parsed = if (unlimited) null else text.toIntOrNull()?.takeIf { it in 0..500 }
        AlertDialog(
            onDismissRequest = { dialog = false },
            title = { Text(title) },
            text = {
                Column(Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.setting_unlimited)) },
                        trailingContent = {
                            Switch(unlimited, onCheckedChange = { unlimited = it })
                        },
                    )
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it.filter(Char::isDigit) },
                        enabled = !unlimited,
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        supportingText = { Text(stringResource(R.string.setting_range, 0, 500)) },
                        isError = !unlimited && parsed == null,
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onValue(
                            if (unlimited) ActiveSeedLimit.Unlimited
                            else ActiveSeedLimit.Limited(requireNotNull(parsed).toUShort()),
                        )
                        dialog = false
                    },
                    enabled = unlimited || parsed != null,
                ) { Text(stringResource(R.string.action_apply)) }
            },
            dismissButton = { TextButton(onClick = { dialog = false }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

@Composable
private fun activeSeedLimitLabel(limit: ActiveSeedLimit): String =
    when (limit) {
        ActiveSeedLimit.Unlimited -> stringResource(R.string.setting_unlimited)
        is ActiveSeedLimit.Limited -> limit.torrents.toString()
    }

private const val KIB = 1_024U
private const val MIB = 1_048_576U

/** Rate presets in bytes per second; KB and MB are 1024-based. */
internal val RATE_LIMIT_PRESETS: List<UInt> =
    listOf(100U * KIB, 500U * KIB, MIB, 5U * MIB, 10U * MIB)

@Composable
internal fun RateLimitSetting(
    title: String,
    configured: TransferRateLimit,
    effective: TransferRateLimit? = null,
    application: ClientSettingsApplicationState? = null,
    onValue: (TransferRateLimit) -> Unit,
) {
    var dialog by remember { mutableStateOf(false) }
    val usingNote =
        effective?.takeIf { it != configured }?.let {
            stringResource(R.string.setting_using_value, rateLimitLabel(it))
        }
    val supporting = application?.let { settingNote(it, usingNote) } ?: usingNote
    ValueRow(title, rateLimitLabel(configured), supporting) { dialog = true }
    if (dialog) {
        RateLimitDialog(title, configured, onDismiss = { dialog = false }) {
            onValue(it)
            dialog = false
        }
    }
}

/** One choice in the rate dialog: unlimited, a preset, or a custom value. */
private sealed interface RateChoice {
    data object Unlimited : RateChoice

    data class Preset(val bytesPerSecond: UInt) : RateChoice

    data object Custom : RateChoice
}

@Composable
private fun RateLimitDialog(
    title: String,
    configured: TransferRateLimit,
    onDismiss: () -> Unit,
    onApply: (TransferRateLimit) -> Unit,
) {
    var choice by remember(configured) {
        mutableStateOf(
            when (configured) {
                TransferRateLimit.Unlimited -> RateChoice.Unlimited
                is TransferRateLimit.Limited ->
                    if (configured.bytesPerSecond in RATE_LIMIT_PRESETS) {
                        RateChoice.Preset(configured.bytesPerSecond)
                    } else {
                        RateChoice.Custom
                    }
            },
        )
    }
    var text by remember(configured) { mutableStateOf(customRateText(configured)) }
    val parsed: TransferRateLimit? =
        when (val selected = choice) {
            RateChoice.Unlimited -> TransferRateLimit.Unlimited
            is RateChoice.Preset -> TransferRateLimit.Limited(selected.bytesPerSecond)
            RateChoice.Custom -> parseRateLimit(text)
        }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.fillMaxWidth()) {
                ChoiceRow(stringResource(R.string.setting_unlimited), choice == RateChoice.Unlimited) {
                    choice = RateChoice.Unlimited
                }
                RATE_LIMIT_PRESETS.forEach { preset ->
                    ChoiceRow(
                        rateLimitLabel(TransferRateLimit.Limited(preset)),
                        choice == RateChoice.Preset(preset),
                    ) { choice = RateChoice.Preset(preset) }
                }
                ChoiceRow(stringResource(R.string.setting_custom), choice == RateChoice.Custom) {
                    choice = RateChoice.Custom
                }
                if (choice == RateChoice.Custom) {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it.filter { character -> character.isDigit() || character == '.' } },
                        singleLine = true,
                        label = { Text(stringResource(R.string.setting_rate_unit)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        isError = parsed == null,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onApply(requireNotNull(parsed)) },
                enabled = parsed != null,
            ) { Text(stringResource(R.string.action_apply)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/**
 * Share ratio stop limit. In global Settings it offers Off, presets and
 * Custom; per torrent it adds Use global and reads Off as No limit.
 */
@Composable
internal fun SeedStopRatioSetting(
    configured: TorrentSeedStopLimit,
    global: SeedStopLimit?,
    perTorrent: Boolean,
    onValue: (TorrentSeedStopLimit) -> Unit,
) {
    var dialog by remember { mutableStateOf(false) }
    val title = stringResource(R.string.setting_seed_stop_ratio)
    val valueLabel: @Composable (UInt) -> String = { seedStopRatioValueLabel(it) }
    ValueRow(title, seedStopRowLabel(configured, global, perTorrent, valueLabel), null) { dialog = true }
    if (!dialog) return
    var choice by remember(configured) {
        mutableStateOf(seedStopChoice(configured, SEED_STOP_RATIO_PRESETS))
    }
    var text by remember(configured) {
        mutableStateOf(seedStopRatioText((configured as? TorrentSeedStopLimit.Limited)?.value))
    }
    val parsed = choice.toLimit(parseSeedStopRatio(text))
    SeedStopDialog(
        title = title,
        choice = choice,
        onChoice = { choice = it },
        global = global,
        perTorrent = perTorrent,
        presets = SEED_STOP_RATIO_PRESETS,
        valueLabel = valueLabel,
        parsed = parsed,
        onDismiss = { dialog = false },
        onApply = { onValue(it); dialog = false },
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = {
                text = it.filter { character -> character.isDigit() || character == '.' || character == ',' }
            },
            singleLine = true,
            label = { Text(stringResource(R.string.seed_stop_ratio_field)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            isError = parsed == null,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

/**
 * Seeding time stop limit. Custom takes a whole number of minutes, hours or
 * days.
 */
@Composable
internal fun SeedStopTimeSetting(
    configured: TorrentSeedStopLimit,
    global: SeedStopLimit?,
    perTorrent: Boolean,
    onValue: (TorrentSeedStopLimit) -> Unit,
) {
    var dialog by remember { mutableStateOf(false) }
    val title = stringResource(R.string.setting_seed_stop_time)
    val valueLabel: @Composable (UInt) -> String = { seedStopTimeValueLabel(it) }
    ValueRow(title, seedStopRowLabel(configured, global, perTorrent, valueLabel), null) { dialog = true }
    if (!dialog) return
    val initial = seedStopTimeText((configured as? TorrentSeedStopLimit.Limited)?.value)
    var choice by remember(configured) {
        mutableStateOf(seedStopChoice(configured, SEED_STOP_TIME_PRESETS))
    }
    var text by remember(configured) { mutableStateOf(initial.first) }
    var unit by remember(configured) { mutableStateOf(initial.second) }
    val parsed = choice.toLimit(parseSeedStopTime(text, unit))
    SeedStopDialog(
        title = title,
        choice = choice,
        onChoice = { choice = it },
        global = global,
        perTorrent = perTorrent,
        presets = SEED_STOP_TIME_PRESETS,
        valueLabel = valueLabel,
        parsed = parsed,
        onDismiss = { dialog = false },
        onApply = { onValue(it); dialog = false },
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it.filter(Char::isDigit) },
            singleLine = true,
            label = { Text(stringResource(R.string.seed_stop_time_field)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            isError = parsed == null,
            modifier = Modifier.padding(top = 8.dp),
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            SeedTimeUnit.entries.forEach { option ->
                FilterChip(
                    selected = unit == option,
                    onClick = { unit = option },
                    label = { Text(seedTimeUnitLabel(option)) },
                )
            }
        }
    }
}

@Composable
private fun seedStopRowLabel(
    configured: TorrentSeedStopLimit,
    global: SeedStopLimit?,
    perTorrent: Boolean,
    valueLabel: @Composable (UInt) -> String,
): String =
    if (perTorrent) {
        torrentSeedStopLimitLabel(configured, global, valueLabel)
    } else {
        seedStopLimitLabel(configured.asSessionLimit() ?: SeedStopLimit.Off, valueLabel)
    }

@Composable
private fun SeedStopDialog(
    title: String,
    choice: SeedStopChoice,
    onChoice: (SeedStopChoice) -> Unit,
    global: SeedStopLimit?,
    perTorrent: Boolean,
    presets: List<UInt>,
    valueLabel: @Composable (UInt) -> String,
    parsed: TorrentSeedStopLimit?,
    onDismiss: () -> Unit,
    onApply: (TorrentSeedStopLimit) -> Unit,
    customField: @Composable () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                if (perTorrent) {
                    ChoiceRow(
                        torrentSeedStopLimitLabel(TorrentSeedStopLimit.UseGlobal, global, valueLabel),
                        choice == SeedStopChoice.UseGlobal,
                    ) { onChoice(SeedStopChoice.UseGlobal) }
                }
                ChoiceRow(
                    stringResource(if (perTorrent) R.string.seed_stop_no_limit else R.string.seed_stop_off),
                    choice == SeedStopChoice.Off,
                ) { onChoice(SeedStopChoice.Off) }
                presets.forEach { preset ->
                    ChoiceRow(valueLabel(preset), choice == SeedStopChoice.Preset(preset)) {
                        onChoice(SeedStopChoice.Preset(preset))
                    }
                }
                ChoiceRow(stringResource(R.string.setting_custom), choice == SeedStopChoice.Custom) {
                    onChoice(SeedStopChoice.Custom)
                }
                if (choice == SeedStopChoice.Custom) customField()
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onApply(requireNotNull(parsed)) },
                enabled = parsed != null,
            ) { Text(stringResource(R.string.action_apply)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun seedTimeUnitLabel(unit: SeedTimeUnit): String =
    stringResource(
        when (unit) {
            SeedTimeUnit.MINUTES -> R.string.seed_stop_unit_minutes
            SeedTimeUnit.HOURS -> R.string.seed_stop_unit_hours
            SeedTimeUnit.DAYS -> R.string.seed_stop_unit_days
        },
    )

@Composable
private fun ChoiceRow(
    label: String,
    selected: Boolean,
    onSelect: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier =
            Modifier.fillMaxWidth()
                .selectable(selected = selected, onClick = onSelect, role = Role.RadioButton),
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(label, modifier = Modifier.padding(start = 12.dp, top = 12.dp, bottom = 12.dp))
    }
}

internal fun parseRateLimit(valueKiB: String): TransferRateLimit.Limited? {
    if (!Regex("^\\d+(?:\\.\\d+)?$").matches(valueKiB)) return null
    val bytes = (valueKiB.toDoubleOrNull() ?: return null) * 1024.0
    if (!bytes.isFinite() || bytes % 1.0 != 0.0 || bytes < 1_024.0 || bytes > UInt.MAX_VALUE.toDouble()) {
        return null
    }
    return TransferRateLimit.Limited(bytes.toLong().toUInt())
}

/** The custom field's starting text: the exact limit in KB/s, or a 1 MB/s suggestion. */
internal fun customRateText(limit: TransferRateLimit): String =
    when (limit) {
        TransferRateLimit.Unlimited -> "1024"
        is TransferRateLimit.Limited -> {
            val kib = limit.bytesPerSecond.toDouble() / 1024.0
            if (kib % 1.0 == 0.0) kib.toLong().toString() else kib.toString()
        }
    }

@Composable
internal fun rateLimitLabel(limit: TransferRateLimit): String =
    when (limit) {
        TransferRateLimit.Unlimited -> stringResource(R.string.setting_unlimited)
        is TransferRateLimit.Limited -> {
            val bytes = limit.bytesPerSecond
            val format = NumberFormat.getNumberInstance().apply { maximumFractionDigits = 1 }
            if (bytes % MIB == 0U) {
                stringResource(R.string.rate_megabytes_per_second, format.format((bytes / MIB).toLong()))
            } else {
                stringResource(R.string.rate_kilobytes_per_second, format.format(bytes.toDouble() / 1024.0))
            }
        }
    }

@Composable
internal fun NetworkSettings(
    settings: ClientSettingsRuntimeView,
    network: ProductNetworkState,
    onUnmeteredNetworksOnly: (Boolean) -> Unit,
    onListener: (Boolean) -> Unit,
    onPortMapping: (Boolean) -> Unit,
    onIpv6: (Boolean) -> Unit,
    onDht: (Boolean) -> Unit,
    onPeerExchange: (Boolean) -> Unit,
    onEncryption: (EncryptionPolicy) -> Unit,
) {
    SettingsSection(stringResource(R.string.settings_section_connection))
    ToggleSetting(
        title = stringResource(R.string.setting_wifi_only),
        detail = stringResource(R.string.setting_wifi_only_detail),
        checked = network.unmeteredNetworksOnly,
        onChecked = onUnmeteredNetworksOnly,
    )
    network.preferenceError?.let {
        ReadOnlySettingsRow(stringResource(R.string.setting_not_saved), productErrorText(it))
    }
    network.runtimeError?.let {
        ReadOnlySettingsRow(stringResource(R.string.setting_network_attention), productErrorText(it))
    }
    SettingsSection(stringResource(R.string.settings_section_peers))
    ToggleSetting(
        title = stringResource(R.string.setting_incoming_connections),
        detail = listenerStatusText(settings.listenerStatus),
        checked = settings.configured.listener !is ListenerPolicy.Disabled,
        onChecked = onListener,
    )
    ToggleSetting(
        title = stringResource(R.string.setting_upnp),
        detail = portMappingStatusText(settings.portMappingStatus),
        checked = settings.configured.portMapping == PortMappingPolicy.UPNP,
        onChecked = onPortMapping,
    )
    ToggleSetting(
        title = stringResource(R.string.setting_ipv6),
        detail = settingNote(settings.ipv6Application),
        checked = settings.configured.ipv6Enabled,
        onChecked = onIpv6,
    )
    ToggleSetting(
        title = stringResource(R.string.setting_dht),
        detail =
            settingNote(settings.dhtApplication, stringResource(R.string.setting_dht_detail)),
        checked = settings.configured.dhtEnabled,
        onChecked = onDht,
    )
    ToggleSetting(
        title = stringResource(R.string.setting_peer_exchange),
        detail =
            settingNote(
                settings.peerExchangeApplication,
                stringResource(R.string.setting_peer_exchange_detail),
            ),
        checked = settings.configured.peerExchangeEnabled,
        onChecked = onPeerExchange,
    )
    ChoiceSetting(
        title = stringResource(R.string.setting_peer_encryption),
        selected = settings.configured.encryption,
        values = EncryptionPolicy.entries,
        label = { encryptionLabel(it) },
        detail =
            settingNote(
                settings.encryptionApplication,
                settings.effectiveEncryption.takeIf { it != settings.configured.encryption }?.let {
                    stringResource(R.string.setting_using_value, encryptionLabel(it))
                },
            ),
        onSelected = onEncryption,
    )
}

@Composable
private fun encryptionLabel(policy: EncryptionPolicy): String =
    stringResource(
        when (policy) {
            EncryptionPolicy.DISABLED -> R.string.encryption_disabled
            EncryptionPolicy.ALLOW -> R.string.encryption_allow
            EncryptionPolicy.PREFER -> R.string.encryption_prefer
            EncryptionPolicy.REQUIRED -> R.string.encryption_required
        },
    )

@Composable
internal fun SettingsSection(title: String) {
    Text(
        title,
        color = MaterialTheme.colorScheme.primary,
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 4.dp),
    )
}

/** A tappable row whose current value sits on the trailing edge. */
@Composable
private fun ValueRow(
    title: String,
    value: String,
    supporting: String?,
    onClick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = supporting?.let { { Text(it) } },
        trailingContent = { Text(value, color = MaterialTheme.colorScheme.primary) },
        modifier = Modifier.clickable(onClick = onClick),
    )
    HorizontalDivider()
}

@Composable
private fun NumericSetting(
    title: String,
    value: Int,
    range: IntRange,
    supporting: String? = null,
    onValue: (Int) -> Unit,
) {
    var dialog by remember { mutableStateOf(false) }
    ValueRow(title, value.toString(), supporting) { dialog = true }
    if (dialog) {
        var text by remember(value) { mutableStateOf(value.toString()) }
        val parsed = text.toIntOrNull()
        AlertDialog(
            onDismissRequest = { dialog = false },
            title = { Text(title) },
            text = {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it.filter(Char::isDigit) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    supportingText = {
                        Text(stringResource(R.string.setting_range, range.first, range.last))
                    },
                )
            },
            confirmButton = {
                TextButton(
                    onClick = { onValue(requireNotNull(parsed)); dialog = false },
                    enabled = parsed != null && parsed in range,
                ) { Text(stringResource(R.string.action_apply)) }
            },
            dismissButton = { TextButton(onClick = { dialog = false }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

@Composable
private fun ToggleSetting(
    title: String,
    detail: String?,
    checked: Boolean,
    onChecked: (Boolean) -> Unit,
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = detail?.let { { Text(it) } },
        trailingContent = {
            Switch(
                checked = checked,
                onCheckedChange = onChecked,
                modifier = Modifier.semantics { contentDescription = title },
            )
        },
    )
    HorizontalDivider()
}

@Composable
internal fun <T> ChoiceSetting(
    title: String,
    selected: T,
    values: List<T>,
    label: @Composable (T) -> String,
    detail: String? = null,
    onSelected: (T) -> Unit,
) {
    var dialog by remember { mutableStateOf(false) }
    ValueRow(title, label(selected), detail) { dialog = true }
    if (dialog) {
        AlertDialog(
            onDismissRequest = { dialog = false },
            title = { Text(title) },
            text = {
                Column(Modifier.fillMaxWidth()) {
                    values.forEach { value ->
                        ChoiceRow(label(value), value == selected) {
                            onSelected(value)
                            dialog = false
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { dialog = false }) { Text(stringResource(R.string.action_cancel)) } },
        )
    }
}

@Composable
internal fun ReadOnlySettingsRow(
    title: String,
    detail: String,
) {
    ListItem(headlineContent = { Text(title) }, supportingContent = { Text(detail) })
    HorizontalDivider()
}

/** Plain status for the incoming-connections row; nothing when it is off. */
@Composable
internal fun listenerStatusText(status: ListenerStatus): String? =
    when (status) {
        ListenerStatus.Disabled -> null
        is ListenerStatus.Listening -> stringResource(R.string.listener_listening, status.port.toInt())
        is ListenerStatus.BindFailed ->
            stringResource(
                when (status.reason) {
                    ListenerBindFailureReason.ADDRESS_IN_USE -> R.string.listener_address_in_use
                    ListenerBindFailureReason.PERMISSION_DENIED -> R.string.listener_permission_denied
                    ListenerBindFailureReason.ADDRESS_UNAVAILABLE -> R.string.listener_address_unavailable
                    ListenerBindFailureReason.OTHER -> R.string.listener_bind_failed
                },
            )
    }

/** Plain status for the port-forwarding row; router and lease facts stay in logs. */
@Composable
internal fun portMappingStatusText(status: PortMappingStatus): String? =
    when (status) {
        PortMappingStatus.Disabled -> null
        PortMappingStatus.Ineligible -> stringResource(R.string.port_mapping_ineligible)
        PortMappingStatus.Discovering -> stringResource(R.string.port_mapping_discovering)
        PortMappingStatus.Mapping -> stringResource(R.string.port_mapping_requesting)
        PortMappingStatus.Stopping -> stringResource(R.string.port_mapping_stopping)
        is PortMappingStatus.Mapped ->
            stringResource(R.string.port_mapping_mapped, status.externalPort.toInt())
        is PortMappingStatus.Failed ->
            stringResource(
                if (status.stage == PortMappingFailureStage.DISCOVERY) {
                    R.string.port_mapping_no_router
                } else {
                    R.string.port_mapping_failed
                },
            )
        is PortMappingStatus.RenewalFailed ->
            stringResource(R.string.port_mapping_renewal_failed, status.externalPort.toInt())
        is PortMappingStatus.CleanupFailed ->
            stringResource(R.string.port_mapping_cleanup_failed, status.externalPort.toInt())
    }
