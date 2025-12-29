package com.jstorrent.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.storage.DownloadRoot
import com.jstorrent.app.ui.dialogs.NotificationRequiredDialog
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.SettingsUiState
import com.jstorrent.app.viewmodel.SettingsViewModel

/**
 * Settings screen for managing app configuration.
 * Supports:
 * - Download folder management with default selection
 * - Bandwidth limits
 * - Network settings (DHT, PEX, encryption, WiFi-only)
 * - Notification permission status
 * - Behavior settings (when downloads complete)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
    onAddRootClick: () -> Unit,
    onRequestNotificationPermission: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    SettingsScreenContent(
        uiState = uiState,
        onNavigateBack = onNavigateBack,
        onAddRootClick = onAddRootClick,
        onSetDefaultRoot = { viewModel.setDefaultRoot(it) },
        onRemoveRoot = { viewModel.removeRoot(it) },
        onShowClearConfirmation = { viewModel.showClearConfirmation() },
        onDismissClearConfirmation = { viewModel.dismissClearConfirmation() },
        onClearAll = { viewModel.clearAllRoots() },
        onDownloadSpeedLimitChange = { viewModel.setDownloadSpeedLimit(it) },
        onUploadSpeedLimitChange = { viewModel.setUploadSpeedLimit(it) },
        onWhenDownloadsCompleteChange = { viewModel.setWhenDownloadsComplete(it) },
        onWifiOnlyChange = { viewModel.setWifiOnly(it) },
        onDhtEnabledChange = { viewModel.setDhtEnabled(it) },
        onPexEnabledChange = { viewModel.setPexEnabled(it) },
        onEncryptionPolicyChange = { viewModel.setEncryptionPolicy(it) },
        onBackgroundDownloadsChange = { viewModel.setBackgroundDownloadsEnabled(it) },
        onDismissNotificationRequiredDialog = { viewModel.dismissNotificationRequiredDialog() },
        onRequestNotificationPermission = onRequestNotificationPermission,
        onOpenNotificationSettings = onOpenNotificationSettings,
        modifier = modifier
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreenContent(
    uiState: SettingsUiState,
    onNavigateBack: () -> Unit,
    onAddRootClick: () -> Unit,
    onSetDefaultRoot: (String) -> Unit,
    onRemoveRoot: (String) -> Unit,
    onShowClearConfirmation: () -> Unit,
    onDismissClearConfirmation: () -> Unit,
    onClearAll: () -> Unit,
    onDownloadSpeedLimitChange: (Int) -> Unit,
    onUploadSpeedLimitChange: (Int) -> Unit,
    onWhenDownloadsCompleteChange: (String) -> Unit,
    onWifiOnlyChange: (Boolean) -> Unit,
    onDhtEnabledChange: (Boolean) -> Unit,
    onPexEnabledChange: (Boolean) -> Unit,
    onEncryptionPolicyChange: (String) -> Unit,
    onBackgroundDownloadsChange: (Boolean) -> Unit,
    onDismissNotificationRequiredDialog: () -> Unit,
    onRequestNotificationPermission: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            // =====================================================================
            // Download Locations
            // =====================================================================
            item {
                SectionHeader(title = "Download Locations")
            }

            if (uiState.downloadRoots.isEmpty()) {
                item {
                    EmptyStorageState(onAddClick = onAddRootClick)
                }
            } else {
                items(uiState.downloadRoots, key = { it.key }) { root ->
                    DownloadRootItem(
                        root = root,
                        isDefault = root.key == uiState.defaultRootKey,
                        onSetDefault = { onSetDefaultRoot(root.key) },
                        onRemove = { onRemoveRoot(root.key) }
                    )
                }
            }

            item {
                AddFolderButton(onClick = onAddRootClick)
            }

            item {
                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            }

            // =====================================================================
            // When Downloads Complete
            // =====================================================================
            item {
                SectionHeader(title = "When Downloads Complete")
            }

            item {
                WhenDownloadsCompleteSection(
                    selectedOption = uiState.whenDownloadsComplete,
                    onOptionSelected = onWhenDownloadsCompleteChange
                )
            }

            item {
                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            }

            // =====================================================================
            // Bandwidth
            // =====================================================================
            item {
                SectionHeader(title = "Bandwidth")
            }

            item {
                BandwidthSection(
                    downloadLimit = uiState.downloadSpeedLimit,
                    uploadLimit = uiState.uploadSpeedLimit,
                    onDownloadLimitChange = onDownloadSpeedLimitChange,
                    onUploadLimitChange = onUploadSpeedLimitChange
                )
            }

            item {
                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            }

            // =====================================================================
            // Notifications
            // =====================================================================
            item {
                SectionHeader(title = "Notifications")
            }

            item {
                NotificationsSection(
                    permissionGranted = uiState.notificationPermissionGranted,
                    canRequestInline = uiState.canRequestNotificationPermission,
                    onRequestPermission = onRequestNotificationPermission,
                    onOpenSettings = onOpenNotificationSettings
                )
            }

            item {
                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            }

            // =====================================================================
            // Network
            // =====================================================================
            item {
                SectionHeader(title = "Network")
            }

            item {
                NetworkSection(
                    wifiOnly = uiState.wifiOnlyEnabled,
                    encryptionPolicy = uiState.encryptionPolicy,
                    dhtEnabled = uiState.dhtEnabled,
                    pexEnabled = uiState.pexEnabled,
                    onWifiOnlyChange = onWifiOnlyChange,
                    onEncryptionPolicyChange = onEncryptionPolicyChange,
                    onDhtChange = onDhtEnabledChange,
                    onPexChange = onPexEnabledChange
                )
            }

            item {
                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            }

            // =====================================================================
            // Power Management
            // =====================================================================
            item {
                SectionHeader(title = "Power Management")
            }

            item {
                PowerManagementSection(
                    backgroundDownloadsEnabled = uiState.backgroundDownloadsEnabled,
                    notificationPermissionGranted = uiState.notificationPermissionGranted,
                    onBackgroundDownloadsChange = onBackgroundDownloadsChange
                )
            }

            item {
                HorizontalDivider(modifier = Modifier.padding(vertical = 16.dp))
            }

            // =====================================================================
            // Danger Zone
            // =====================================================================
            item {
                SectionHeader(title = "Danger Zone")
            }

            item {
                ClearSettingsButton(
                    onClick = onShowClearConfirmation,
                    enabled = uiState.downloadRoots.isNotEmpty()
                )
            }

            item {
                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }

    // Clear confirmation dialog
    if (uiState.showClearConfirmation) {
        ClearConfirmationDialog(
            onDismiss = onDismissClearConfirmation,
            onConfirm = onClearAll
        )
    }

    // Notification required dialog (shown when trying to enable background downloads without permission)
    if (uiState.showNotificationRequiredDialog) {
        NotificationRequiredDialog(
            onOpenSettings = {
                onDismissNotificationRequiredDialog()
                onOpenNotificationSettings()
            },
            onDismiss = onDismissNotificationRequiredDialog
        )
    }
}

@Composable
private fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier
) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
    )
}

@Composable
private fun EmptyStorageState(
    onAddClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clickable(onClick = onAddClick),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = Icons.Default.Folder,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "No download folder configured",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Tap to add a download folder",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun DownloadRootItem(
    root: DownloadRoot,
    isDefault: Boolean,
    onSetDefault: () -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (root.lastStatOk) {
                MaterialTheme.colorScheme.surface
            } else {
                MaterialTheme.colorScheme.errorContainer
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Folder,
                contentDescription = null,
                modifier = Modifier.size(40.dp),
                tint = if (root.lastStatOk) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.error
                }
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = root.displayName,
                        style = MaterialTheme.typography.bodyLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    if (isDefault) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Icon(
                            imageVector = Icons.Filled.Star,
                            contentDescription = "Default folder",
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (!root.lastStatOk) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = "Unavailable",
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "Unavailable",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    } else {
                        Text(
                            text = if (isDefault) "Default" else if (root.removable) "Removable storage" else "Internal storage",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
            if (!isDefault) {
                IconButton(onClick = onSetDefault) {
                    Icon(
                        imageVector = Icons.Outlined.StarOutline,
                        contentDescription = "Set as default",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            IconButton(onClick = onRemove) {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = "Remove folder",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun AddFolderButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Add,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = "Add download folder",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

// =============================================================================
// When Downloads Complete Section
// =============================================================================

@Composable
private fun WhenDownloadsCompleteSection(
    selectedOption: String,
    onOptionSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        val options = listOf(
            "stop_and_close" to "Stop and close app",
            "keep_seeding" to "Keep seeding in background"
        )

        options.forEach { (value, label) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .selectable(
                        selected = selectedOption == value,
                        onClick = { onOptionSelected(value) },
                        role = Role.RadioButton
                    )
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RadioButton(
                    selected = selectedOption == value,
                    onClick = null
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
        }
    }
}

// =============================================================================
// Bandwidth Section
// =============================================================================

private data class SpeedPreset(val bytesPerSec: Int, val label: String)

private val speedPresets = listOf(
    SpeedPreset(0, "Unlimited"),
    SpeedPreset(102400, "100 KB/s"),
    SpeedPreset(512000, "500 KB/s"),
    SpeedPreset(1048576, "1 MB/s"),
    SpeedPreset(5242880, "5 MB/s"),
    SpeedPreset(10485760, "10 MB/s")
)

@Composable
private fun BandwidthSection(
    downloadLimit: Int,
    uploadLimit: Int,
    onDownloadLimitChange: (Int) -> Unit,
    onUploadLimitChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        SpeedLimitRow(
            label = "Max download speed",
            currentValue = downloadLimit,
            onValueChange = onDownloadLimitChange
        )
        Spacer(modifier = Modifier.height(8.dp))
        SpeedLimitRow(
            label = "Max upload speed",
            currentValue = uploadLimit,
            onValueChange = onUploadLimitChange
        )
    }
}

@Composable
private fun SpeedLimitRow(
    label: String,
    currentValue: Int,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }
    val currentPreset = speedPresets.find { it.bytesPerSec == currentValue }
        ?: SpeedPreset(currentValue, formatSpeed(currentValue))

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge
        )
        Box {
            OutlinedCard(
                modifier = Modifier.clickable { expanded = true }
            ) {
                Text(
                    text = currentPreset.label,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false }
            ) {
                speedPresets.forEach { preset ->
                    DropdownMenuItem(
                        text = { Text(preset.label) },
                        onClick = {
                            onValueChange(preset.bytesPerSec)
                            expanded = false
                        },
                        trailingIcon = if (preset.bytesPerSec == currentValue) {
                            { Icon(Icons.Default.Check, contentDescription = "Selected") }
                        } else null
                    )
                }
            }
        }
    }
}

private fun formatSpeed(bytesPerSec: Int): String {
    return when {
        bytesPerSec == 0 -> "Unlimited"
        bytesPerSec >= 1048576 -> "${bytesPerSec / 1048576} MB/s"
        bytesPerSec >= 1024 -> "${bytesPerSec / 1024} KB/s"
        else -> "$bytesPerSec B/s"
    }
}

// =============================================================================
// Notifications Section
// =============================================================================

@Composable
private fun NotificationsSection(
    permissionGranted: Boolean,
    canRequestInline: Boolean,
    onRequestPermission: () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (permissionGranted) {
                MaterialTheme.colorScheme.surface
            } else {
                MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (permissionGranted) {
                    Icons.Default.Notifications
                } else {
                    Icons.Default.NotificationsOff
                },
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = if (permissionGranted) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.error
                }
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = if (permissionGranted) "Enabled" else "Disabled",
                    style = MaterialTheme.typography.bodyLarge
                )
                if (!permissionGranted) {
                    Text(
                        text = "Required for background downloads",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            if (!permissionGranted) {
                Button(
                    onClick = if (canRequestInline) onRequestPermission else onOpenSettings
                ) {
                    Text(if (canRequestInline) "Enable" else "Settings")
                }
            }
        }
    }
}

// =============================================================================
// Power Management Section
// =============================================================================

@Composable
private fun PowerManagementSection(
    backgroundDownloadsEnabled: Boolean,
    notificationPermissionGranted: Boolean,
    onBackgroundDownloadsChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        SettingToggleRow(
            label = "Download in background",
            description = if (notificationPermissionGranted) {
                "Continue downloads when app is closed"
            } else {
                "Requires notification permission"
            },
            checked = backgroundDownloadsEnabled,
            onCheckedChange = onBackgroundDownloadsChange
        )
    }
}

// =============================================================================
// Network Section
// =============================================================================

private data class EncryptionOption(val value: String, val label: String)

private val encryptionOptions = listOf(
    EncryptionOption("disabled", "Disabled"),
    EncryptionOption("allow", "Allow"),
    EncryptionOption("prefer", "Prefer"),
    EncryptionOption("required", "Required")
)

@Composable
private fun NetworkSection(
    wifiOnly: Boolean,
    encryptionPolicy: String,
    dhtEnabled: Boolean,
    pexEnabled: Boolean,
    onWifiOnlyChange: (Boolean) -> Unit,
    onEncryptionPolicyChange: (String) -> Unit,
    onDhtChange: (Boolean) -> Unit,
    onPexChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        // WiFi-only toggle
        SettingToggleRow(
            label = "WiFi-only",
            description = "Pause downloads on mobile data",
            checked = wifiOnly,
            onCheckedChange = onWifiOnlyChange
        )

        Spacer(modifier = Modifier.height(8.dp))

        // Protocol encryption dropdown
        EncryptionRow(
            currentPolicy = encryptionPolicy,
            onPolicyChange = onEncryptionPolicyChange
        )

        Spacer(modifier = Modifier.height(8.dp))

        // DHT toggle
        SettingToggleRow(
            label = "DHT",
            description = "Distributed Hash Table for finding peers",
            checked = dhtEnabled,
            onCheckedChange = onDhtChange
        )

        Spacer(modifier = Modifier.height(8.dp))

        // PEX toggle
        SettingToggleRow(
            label = "PEX (Peer Exchange)",
            description = "Share peer lists with other clients",
            checked = pexEnabled,
            onCheckedChange = onPexChange
        )
    }
}

@Composable
private fun SettingToggleRow(
    label: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable { onCheckedChange(!checked) }
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange
        )
    }
}

@Composable
private fun EncryptionRow(
    currentPolicy: String,
    onPolicyChange: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }
    val currentOption = encryptionOptions.find { it.value == currentPolicy }
        ?: encryptionOptions[1] // Default to "allow"

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "Protocol encryption",
            style = MaterialTheme.typography.bodyLarge
        )
        Box {
            OutlinedCard(
                modifier = Modifier.clickable { expanded = true }
            ) {
                Text(
                    text = currentOption.label,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false }
            ) {
                encryptionOptions.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.label) },
                        onClick = {
                            onPolicyChange(option.value)
                            expanded = false
                        },
                        trailingIcon = if (option.value == currentPolicy) {
                            { Icon(Icons.Default.Check, contentDescription = "Selected") }
                        } else null
                    )
                }
            }
        }
    }
}

@Composable
private fun ClearSettingsButton(
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        colors = CardDefaults.cardColors(
            containerColor = if (enabled) {
                MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
            } else {
                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Delete,
                contentDescription = null,
                modifier = Modifier.size(24.dp),
                tint = if (enabled) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                }
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column {
                Text(
                    text = "Clear all settings",
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (enabled) {
                        MaterialTheme.colorScheme.error
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    }
                )
                Text(
                    text = "Remove all download folders",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (enabled) {
                        MaterialTheme.colorScheme.onErrorContainer
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    }
                )
            }
        }
    }
}

@Composable
private fun ClearConfirmationDialog(
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                imageVector = Icons.Default.Warning,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error
            )
        },
        title = { Text("Clear all settings?") },
        text = {
            Text("This will remove all download folders. Your downloaded files will not be deleted.")
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(
                    text = "Clear",
                    color = MaterialTheme.colorScheme.error
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true, heightDp = 800)
@Composable
private fun SettingsScreenEmptyPreview() {
    JSTorrentTheme {
        SettingsScreenContent(
            uiState = SettingsUiState(
                downloadRoots = emptyList()
            ),
            onNavigateBack = {},
            onAddRootClick = {},
            onSetDefaultRoot = {},
            onRemoveRoot = {},
            onShowClearConfirmation = {},
            onDismissClearConfirmation = {},
            onClearAll = {},
            onDownloadSpeedLimitChange = {},
            onUploadSpeedLimitChange = {},
            onWhenDownloadsCompleteChange = {},
            onWifiOnlyChange = {},
            onDhtEnabledChange = {},
            onPexEnabledChange = {},
            onEncryptionPolicyChange = {},
            onBackgroundDownloadsChange = {},
            onDismissNotificationRequiredDialog = {},
            onRequestNotificationPermission = {},
            onOpenNotificationSettings = {}
        )
    }
}

@Preview(showBackground = true, heightDp = 1200)
@Composable
private fun SettingsScreenWithRootsPreview() {
    JSTorrentTheme {
        SettingsScreenContent(
            uiState = SettingsUiState(
                downloadRoots = listOf(
                    DownloadRoot(
                        key = "abc123",
                        uri = "content://...",
                        displayName = "Download/JSTorrent",
                        removable = false,
                        lastStatOk = true,
                        lastChecked = System.currentTimeMillis()
                    ),
                    DownloadRoot(
                        key = "def456",
                        uri = "content://...",
                        displayName = "SD Card/Torrents",
                        removable = true,
                        lastStatOk = false,
                        lastChecked = System.currentTimeMillis()
                    )
                ),
                defaultRootKey = "abc123",
                downloadSpeedLimit = 1048576,
                uploadSpeedLimit = 512000,
                notificationPermissionGranted = true,
                backgroundDownloadsEnabled = true,
                dhtEnabled = true,
                pexEnabled = true,
                wifiOnlyEnabled = false,
                encryptionPolicy = "allow"
            ),
            onNavigateBack = {},
            onAddRootClick = {},
            onSetDefaultRoot = {},
            onRemoveRoot = {},
            onShowClearConfirmation = {},
            onDismissClearConfirmation = {},
            onClearAll = {},
            onDownloadSpeedLimitChange = {},
            onUploadSpeedLimitChange = {},
            onWhenDownloadsCompleteChange = {},
            onWifiOnlyChange = {},
            onDhtEnabledChange = {},
            onPexEnabledChange = {},
            onEncryptionPolicyChange = {},
            onBackgroundDownloadsChange = {},
            onDismissNotificationRequiredDialog = {},
            onRequestNotificationPermission = {},
            onOpenNotificationSettings = {}
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun ClearConfirmationDialogPreview() {
    JSTorrentTheme {
        ClearConfirmationDialog(
            onDismiss = {},
            onConfirm = {}
        )
    }
}
