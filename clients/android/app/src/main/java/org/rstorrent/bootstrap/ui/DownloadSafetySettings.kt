package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.FileSafetyPreset
import org.rstorrent.session.uniffi.FileSafetySettings

private const val recommendedExtensions = ".exe .com .scr .msi .msix .bat .cmd .ps1 .vbs .js .jse .wsf .hta .lnk .url .dmg .pkg .app .command .sh .apk .appimage .deb .rpm .jar .desktop"
private const val archiveExtensions = ".zip .rar .7z .tar .gz .bz2 .xz .tgz"
private val extensionPattern = Regex("\\.[a-zA-Z0-9]+(?:\\.[a-zA-Z0-9]+)*")

@Composable
internal fun safetyPresetLabel(preset: FileSafetyPreset): String = stringResource(
    when (preset) {
        FileSafetyPreset.RECOMMENDED -> R.string.safety_recommended
        FileSafetyPreset.ARCHIVES -> R.string.safety_archives
        FileSafetyPreset.CUSTOM -> R.string.safety_custom
    },
)

@Composable
internal fun DownloadSafetySettings(settings: FileSafetySettings, onSave: (FileSafetySettings) -> Unit) {
    var base by remember { mutableStateOf(settings) }
    var draft by remember { mutableStateOf(settings) }
    var extensions by remember { mutableStateOf(settings.customExtensions.joinToString(", ")) }
    LaunchedEffect(settings) {
        if (draft == base || settings == draft) {
            base = settings
            draft = settings
            extensions = settings.customExtensions.joinToString(", ")
        }
    }
    val parsed = extensions.split(Regex("[\\s,;]+")).filter(String::isNotEmpty)
    val valid = parsed.size <= 128 && parsed.all { it.length <= 32 && extensionPattern.matches(it) }
    val conflict = settings != base && settings != draft
    SettingsSection(stringResource(R.string.safety_title))
    NotificationToggleSetting(
        title = stringResource(R.string.safety_enabled),
        detail = stringResource(R.string.safety_future),
        checked = draft.enabled,
        onChecked = { draft = draft.copy(enabled = it) },
    )
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        FileSafetyPreset.entries.forEach { preset ->
            Row {
                RadioButton(selected = draft.preset == preset, enabled = draft.enabled, onClick = {
                    if (preset == FileSafetyPreset.CUSTOM && draft.preset != FileSafetyPreset.CUSTOM) {
                        extensions = recommendedExtensions + if (draft.preset == FileSafetyPreset.ARCHIVES) " $archiveExtensions" else ""
                        draft = draft.copy(customExtensions = extensions.split(" "))
                    }
                    draft = draft.copy(preset = preset)
                })
                Text(safetyPresetLabel(preset), Modifier.padding(top = 12.dp))
            }
        }
        if (draft.preset == FileSafetyPreset.CUSTOM) {
            OutlinedTextField(
                value = extensions,
                onValueChange = { value ->
                    if (value.length <= 4224) {
                        extensions = value
                        draft = draft.copy(customExtensions = value.split(Regex("[\\s,;]+")).filter(String::isNotEmpty))
                    }
                },
                enabled = draft.enabled,
                label = { Text(stringResource(R.string.safety_extensions)) },
                supportingText = { Text(stringResource(if (valid) R.string.safety_extensions_help else R.string.safety_invalid)) },
                isError = !valid,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (conflict) Text(stringResource(R.string.safety_conflict), color = MaterialTheme.colorScheme.error)
        Row {
            TextButton(enabled = valid && !conflict && draft != base, onClick = { onSave(draft) }) { Text(stringResource(R.string.safety_save)) }
            TextButton(onClick = { base = settings; draft = settings; extensions = settings.customExtensions.joinToString(", ") }) { Text(stringResource(R.string.safety_discard)) }
        }
    }
}
