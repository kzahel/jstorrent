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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BatteryChargingFull
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material.icons.filled.People
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.storage.DownloadRoot
import com.jstorrent.app.ui.dialogs.NotificationRequiredDialog
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.SettingsUiState
import com.jstorrent.app.viewmodel.SettingsViewModel

// =============================================================================
// Settings Hub Screen (main settings page with navigation links)
// =============================================================================

/**
 * Settings hub screen - shows navigation links to settings sub-pages.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    onNavigateToStorage: () -> Unit,
    onNavigateToBandwidth: () -> Unit,
    onNavigateToConnectionLimits: () -> Unit,
    onNavigateToNotifications: () -> Unit,
    onNavigateToNetwork: () -> Unit,
    onNavigateToPower: () -> Unit,
    onNavigateToAdvanced: () -> Unit,
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
            item {
                SettingsNavItem(
                    icon = Icons.Default.Folder,
                    title = "Storage",
                    subtitle = "Download folders",
                    onClick = onNavigateToStorage
                )
            }
            item {
                SettingsNavItem(
                    icon = Icons.Default.Speed,
                    title = "Bandwidth",
                    subtitle = "Speed limits",
                    onClick = onNavigateToBandwidth
                )
            }
            item {
                SettingsNavItem(
                    icon = Icons.Default.People,
                    title = "Connection Limits",
                    subtitle = "Peers, upload slots, pipeline",
                    onClick = onNavigateToConnectionLimits
                )
            }
            item {
                SettingsNavItem(
                    icon = Icons.Default.Notifications,
                    title = "Notifications",
                    subtitle = "Permission and alerts",
                    onClick = onNavigateToNotifications
                )
            }
            item {
                SettingsNavItem(
                    icon = Icons.Default.Wifi,
                    title = "Network",
                    subtitle = "DHT, UPnP, encryption",
                    onClick = onNavigateToNetwork
                )
            }
            item {
                SettingsNavItem(
                    icon = Icons.Default.BatteryChargingFull,
                    title = "Power Management",
                    subtitle = "Background downloads, seeding",
                    onClick = onNavigateToPower
                )
            }
            item {
                SettingsNavItem(
                    icon = Icons.Default.Settings,
                    title = "Advanced",
                    subtitle = "Reset settings",
                    onClick = onNavigateToAdvanced
                )
            }
        }
    }
}

@Composable
private fun SettingsNavItem(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(24.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Icon(
            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

// =============================================================================
// Storage Settings Screen
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StorageSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
    onAddRootClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Storage") },
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
            item {
                SectionHeader(title = "Download Folders")
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
                        onSetDefault = { viewModel.setDefaultRoot(root.key) },
                        onRemove = { viewModel.removeRoot(root.key) }
                    )
                }
            }

            item {
                AddFolderButton(onClick = onAddRootClick)
            }
        }
    }
}

// =============================================================================
// Bandwidth Settings Screen
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BandwidthSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Bandwidth") },
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
            item {
                SectionHeader(title = "Speed Limits")
            }

            item {
                BandwidthSection(
                    downloadUnlimited = uiState.downloadSpeedUnlimited,
                    downloadLimit = uiState.downloadSpeedLimit,
                    uploadUnlimited = uiState.uploadSpeedUnlimited,
                    uploadLimit = uiState.uploadSpeedLimit,
                    onDownloadUnlimitedChange = { viewModel.setDownloadSpeedUnlimited(it) },
                    onDownloadLimitChange = { viewModel.setDownloadSpeedLimit(it) },
                    onUploadUnlimitedChange = { viewModel.setUploadSpeedUnlimited(it) },
                    onUploadLimitChange = { viewModel.setUploadSpeedLimit(it) }
                )
            }
        }
    }
}

// =============================================================================
// Connection Limits Settings Screen
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionLimitsSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Connection Limits") },
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
            item {
                SectionHeader(title = "Peer Limits")
            }

            item {
                ConnectionLimitsSection(
                    maxPeersPerTorrent = uiState.maxPeersPerTorrent,
                    maxGlobalPeers = uiState.maxGlobalPeers,
                    maxUploadSlots = uiState.maxUploadSlots,
                    maxPipelineDepth = uiState.maxPipelineDepth,
                    onMaxPeersPerTorrentChange = { viewModel.setMaxPeersPerTorrent(it) },
                    onMaxGlobalPeersChange = { viewModel.setMaxGlobalPeers(it) },
                    onMaxUploadSlotsChange = { viewModel.setMaxUploadSlots(it) },
                    onMaxPipelineDepthChange = { viewModel.setMaxPipelineDepth(it) }
                )
            }
        }
    }
}

// =============================================================================
// Notifications Settings Screen
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
    onRequestNotificationPermission: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Notifications") },
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
            item {
                SectionHeader(title = "Permission")
            }

            item {
                NotificationsSection(
                    permissionGranted = uiState.notificationPermissionGranted,
                    canRequestInline = uiState.canRequestNotificationPermission,
                    onRequestPermission = onRequestNotificationPermission,
                    onOpenSettings = onOpenNotificationSettings
                )
            }
        }
    }
}

// =============================================================================
// Network Settings Screen
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NetworkSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
    onDhtInfoClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Network") },
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
            item {
                SectionHeader(title = "Connection")
            }

            item {
                NetworkSection(
                    wifiOnly = uiState.wifiOnlyEnabled,
                    encryptionPolicy = uiState.encryptionPolicy,
                    dhtEnabled = uiState.dhtEnabled,
                    pexEnabled = uiState.pexEnabled,
                    upnpEnabled = uiState.upnpEnabled,
                    upnpStatus = uiState.upnpStatus,
                    upnpExternalIP = uiState.upnpExternalIP,
                    upnpPort = uiState.upnpPort,
                    hasReceivedIncomingConnection = uiState.hasReceivedIncomingConnection,
                    onWifiOnlyChange = { viewModel.setWifiOnly(it) },
                    onEncryptionPolicyChange = { viewModel.setEncryptionPolicy(it) },
                    onDhtChange = { viewModel.setDhtEnabled(it) },
                    onPexChange = { viewModel.setPexEnabled(it) },
                    onUpnpChange = { viewModel.setUpnpEnabled(it) },
                    onDhtInfoClick = onDhtInfoClick
                )
            }
        }
    }
}

// =============================================================================
// Power Management Settings Screen
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PowerManagementSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Power Management") },
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
            item {
                SectionHeader(title = "Background Activity")
            }

            item {
                PowerManagementSection(
                    backgroundDownloadsEnabled = uiState.backgroundDownloadsEnabled,
                    notificationPermissionGranted = uiState.notificationPermissionGranted,
                    onBackgroundDownloadsChange = { viewModel.setBackgroundDownloadsEnabled(it) },
                    whenDownloadsComplete = uiState.whenDownloadsComplete,
                    onWhenDownloadsCompleteChange = { viewModel.setWhenDownloadsComplete(it) }
                )
            }
        }
    }

    // Notification required dialog
    if (uiState.showNotificationRequiredDialog) {
        NotificationRequiredDialog(
            onOpenSettings = {
                viewModel.dismissNotificationRequiredDialog()
                onOpenNotificationSettings()
            },
            onDismiss = { viewModel.dismissNotificationRequiredDialog() }
        )
    }
}

// =============================================================================
// Advanced Settings Screen
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdvancedSettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Advanced") },
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
            item {
                SectionHeader(title = "Reset")
            }

            item {
                ClearSettingsButton(
                    onClick = { viewModel.showClearConfirmation() },
                    enabled = uiState.downloadRoots.isNotEmpty()
                )
            }
        }
    }

    // Clear confirmation dialog
    if (uiState.showClearConfirmation) {
        ClearConfirmationDialog(
            onDismiss = { viewModel.dismissClearConfirmation() },
            onConfirm = { viewModel.clearAllRoots() }
        )
    }
}

// =============================================================================
// Shared Components
// =============================================================================

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
    downloadUnlimited: Boolean,
    downloadLimit: Int,
    uploadUnlimited: Boolean,
    uploadLimit: Int,
    onDownloadUnlimitedChange: (Boolean) -> Unit,
    onDownloadLimitChange: (Int) -> Unit,
    onUploadUnlimitedChange: (Boolean) -> Unit,
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
            unlimited = downloadUnlimited,
            currentValue = downloadLimit,
            onUnlimitedChange = onDownloadUnlimitedChange,
            onValueChange = onDownloadLimitChange
        )
        Spacer(modifier = Modifier.height(8.dp))
        SpeedLimitRow(
            label = "Max upload speed",
            unlimited = uploadUnlimited,
            currentValue = uploadLimit,
            onUnlimitedChange = onUploadUnlimitedChange,
            onValueChange = onUploadLimitChange
        )
    }
}

@Composable
private fun SpeedLimitRow(
    label: String,
    unlimited: Boolean,
    currentValue: Int,
    onUnlimitedChange: (Boolean) -> Unit,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }
    // Filter out the "Unlimited" preset since we have a separate switch
    val limitPresets = speedPresets.filter { it.bytesPerSec > 0 }
    val currentPreset = limitPresets.find { it.bytesPerSec == currentValue }
        ?: SpeedPreset(currentValue, formatSpeed(currentValue))

    Column(modifier = modifier.fillMaxWidth()) {
        // Unlimited toggle
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onUnlimitedChange(!unlimited) }
                .padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyLarge
            )
            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Unlimited",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.width(8.dp))
                Switch(
                    checked = unlimited,
                    onCheckedChange = onUnlimitedChange
                )
            }
        }

        // Speed preset dropdown (only shown when not unlimited)
        if (!unlimited) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp, horizontal = 16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Limit",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
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
                        limitPresets.forEach { preset ->
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
    }
}

private fun formatSpeed(bytesPerSec: Int): String {
    return when {
        bytesPerSec >= 1048576 -> "${bytesPerSec / 1048576} MB/s"
        bytesPerSec >= 1024 -> "${bytesPerSec / 1024} KB/s"
        else -> "$bytesPerSec B/s"
    }
}

// =============================================================================
// Connection Limits Section
// =============================================================================

private data class ConnectionLimitPreset(val value: Int, val label: String)

private val maxPeersPerTorrentPresets = listOf(
    ConnectionLimitPreset(5, "5"),
    ConnectionLimitPreset(10, "10"),
    ConnectionLimitPreset(20, "20"),
    ConnectionLimitPreset(50, "50"),
    ConnectionLimitPreset(100, "100")
)

private val maxGlobalPeersPresets = listOf(
    ConnectionLimitPreset(50, "50"),
    ConnectionLimitPreset(100, "100"),
    ConnectionLimitPreset(200, "200"),
    ConnectionLimitPreset(500, "500"),
    ConnectionLimitPreset(1000, "1000")
)

private val maxUploadSlotsPresets = listOf(
    ConnectionLimitPreset(0, "0 (disabled)"),
    ConnectionLimitPreset(2, "2"),
    ConnectionLimitPreset(4, "4"),
    ConnectionLimitPreset(8, "8"),
    ConnectionLimitPreset(16, "16")
)

private val maxPipelineDepthPresets = listOf(
    ConnectionLimitPreset(10, "10 (conservative)"),
    ConnectionLimitPreset(25, "25"),
    ConnectionLimitPreset(50, "50 (default)"),
    ConnectionLimitPreset(100, "100"),
    ConnectionLimitPreset(250, "250"),
    ConnectionLimitPreset(500, "500 (aggressive)")
)

@Composable
private fun ConnectionLimitsSection(
    maxPeersPerTorrent: Int,
    maxGlobalPeers: Int,
    maxUploadSlots: Int,
    maxPipelineDepth: Int,
    onMaxPeersPerTorrentChange: (Int) -> Unit,
    onMaxGlobalPeersChange: (Int) -> Unit,
    onMaxUploadSlotsChange: (Int) -> Unit,
    onMaxPipelineDepthChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        ConnectionLimitRow(
            label = "Max peers per torrent",
            description = "Maximum connections per torrent",
            currentValue = maxPeersPerTorrent,
            presets = maxPeersPerTorrentPresets,
            onValueChange = onMaxPeersPerTorrentChange
        )
        Spacer(modifier = Modifier.height(8.dp))
        ConnectionLimitRow(
            label = "Max global peers",
            description = "Maximum total connections",
            currentValue = maxGlobalPeers,
            presets = maxGlobalPeersPresets,
            onValueChange = onMaxGlobalPeersChange
        )
        Spacer(modifier = Modifier.height(8.dp))
        ConnectionLimitRow(
            label = "Max upload slots",
            description = "Simultaneous upload connections",
            currentValue = maxUploadSlots,
            presets = maxUploadSlotsPresets,
            onValueChange = onMaxUploadSlotsChange
        )
        Spacer(modifier = Modifier.height(16.dp))
        HorizontalDivider()
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Advanced",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(8.dp))
        ConnectionLimitRow(
            label = "Pipeline depth",
            description = "Outstanding block requests per peer. Higher values improve speed on high-latency connections but use more memory.",
            currentValue = maxPipelineDepth,
            presets = maxPipelineDepthPresets,
            onValueChange = onMaxPipelineDepthChange
        )
    }
}

@Composable
private fun ConnectionLimitRow(
    label: String,
    description: String,
    currentValue: Int,
    presets: List<ConnectionLimitPreset>,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by remember { mutableStateOf(false) }
    val currentPreset = presets.find { it.value == currentValue }
        ?: ConnectionLimitPreset(currentValue, currentValue.toString())

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
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
            Spacer(modifier = Modifier.width(8.dp))
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
                    presets.forEach { preset ->
                        DropdownMenuItem(
                            text = { Text(preset.label) },
                            onClick = {
                                onValueChange(preset.value)
                                expanded = false
                            },
                            trailingIcon = if (preset.value == currentValue) {
                                { Icon(Icons.Default.Check, contentDescription = "Selected") }
                            } else null
                        )
                    }
                }
            }
        }
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
    Column(modifier = modifier.fillMaxWidth()) {
        Card(
            modifier = Modifier
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

        // Always show link to system notification settings
        Text(
            text = "Manage notification preferences",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .clickable(onClick = onOpenSettings)
                .padding(horizontal = 20.dp, vertical = 12.dp)
        )
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
    whenDownloadsComplete: String,
    onWhenDownloadsCompleteChange: (String) -> Unit,
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

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "When downloads complete",
            style = MaterialTheme.typography.bodyLarge
        )
        Spacer(modifier = Modifier.height(4.dp))

        val options = listOf(
            "stop_and_close" to "Stop and close app",
            "keep_seeding" to "Keep seeding in background"
        )

        options.forEach { (value, label) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .selectable(
                        selected = whenDownloadsComplete == value,
                        onClick = { onWhenDownloadsCompleteChange(value) },
                        role = Role.RadioButton
                    )
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RadioButton(
                    selected = whenDownloadsComplete == value,
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
    upnpEnabled: Boolean,
    upnpStatus: String,
    upnpExternalIP: String?,
    upnpPort: Int,
    hasReceivedIncomingConnection: Boolean,
    onWifiOnlyChange: (Boolean) -> Unit,
    onEncryptionPolicyChange: (String) -> Unit,
    onDhtChange: (Boolean) -> Unit,
    onPexChange: (Boolean) -> Unit,
    onUpnpChange: (Boolean) -> Unit,
    onDhtInfoClick: () -> Unit,
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

        // DHT info link
        Text(
            text = "View DHT Info",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .clickable(onClick = onDhtInfoClick)
                .padding(start = 4.dp, top = 4.dp, bottom = 8.dp)
        )

        Spacer(modifier = Modifier.height(8.dp))

        // PEX toggle
        SettingToggleRow(
            label = "PEX (Peer Exchange)",
            description = "Share peer lists with other clients",
            checked = pexEnabled,
            onCheckedChange = onPexChange
        )

        Spacer(modifier = Modifier.height(8.dp))

        // UPnP toggle with status
        UpnpRow(
            enabled = upnpEnabled,
            status = upnpStatus,
            externalIP = upnpExternalIP,
            port = upnpPort,
            hasReceivedIncomingConnection = hasReceivedIncomingConnection,
            onEnabledChange = onUpnpChange
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
private fun UpnpRow(
    enabled: Boolean,
    status: String,
    externalIP: String?,
    port: Int,
    hasReceivedIncomingConnection: Boolean,
    onEnabledChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier
) {
    // Determine status text and color
    val (statusText, statusColor) = when {
        !enabled -> "" to MaterialTheme.colorScheme.onSurfaceVariant
        status == "discovering" -> "Discovering..." to MaterialTheme.colorScheme.onSurfaceVariant
        status == "mapped" -> {
            val portStr = if (port > 0) ":$port" else ""
            val ipStr = externalIP ?: "Unknown"
            "$ipStr$portStr" to MaterialTheme.colorScheme.primary
        }
        status == "unavailable" -> "No UPnP gateway found" to MaterialTheme.colorScheme.onSurfaceVariant
        status == "failed" -> "Port mapping failed" to MaterialTheme.colorScheme.error
        else -> "" to MaterialTheme.colorScheme.onSurfaceVariant
    }

    // Incoming connection status (only show when enabled)
    val incomingStatusText = if (enabled && status == "mapped") {
        if (hasReceivedIncomingConnection) "Incoming: verified" else "Incoming: not yet verified"
    } else ""
    val incomingStatusColor = if (hasReceivedIncomingConnection) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable { onEnabledChange(!enabled) }
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "UPnP Port Forwarding",
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                text = "Automatically configure router port forwarding",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (enabled && statusText.isNotEmpty()) {
                Text(
                    text = statusText,
                    style = MaterialTheme.typography.bodySmall,
                    color = statusColor
                )
            }
            if (incomingStatusText.isNotEmpty()) {
                Text(
                    text = incomingStatusText,
                    style = MaterialTheme.typography.bodySmall,
                    color = incomingStatusColor
                )
            }
        }
        Switch(
            checked = enabled,
            onCheckedChange = onEnabledChange
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

@Preview(showBackground = true)
@Composable
private fun SettingsHubPreview() {
    JSTorrentTheme {
        SettingsScreen(
            onNavigateBack = {},
            onNavigateToStorage = {},
            onNavigateToBandwidth = {},
            onNavigateToConnectionLimits = {},
            onNavigateToNotifications = {},
            onNavigateToNetwork = {},
            onNavigateToPower = {},
            onNavigateToAdvanced = {}
        )
    }
}
