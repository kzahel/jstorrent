package org.rstorrent.bootstrap.ui

import org.rstorrent.bootstrap.checkingStorage

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.ProductState
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.ApplicationNetworkPrerequisiteView
import org.rstorrent.session.uniffi.ApplicationNetworkRuntimeState
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentView

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
internal fun LibraryScreen(
    state: ProductState,
    notificationsGranted: Boolean,
    onEnableBackgroundDownloads: () -> Unit,
    backgroundControlsEnabled: Boolean,
    onSelectStorage: () -> Unit,
    onRepairStorage: (String) -> Unit,
    onOpenTorrent: (String) -> Unit,
    onAddMagnet: (String, Boolean) -> Unit,
    onBrowseTorrent: () -> Unit,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onMoveTop: (String) -> Unit,
    onMoveBottom: (String) -> Unit,
    onArchive: (String) -> Unit,
    onRemove: (Set<String>) -> Unit,
    onSpeed: () -> Unit,
    onDht: () -> Unit,
    onLogs: () -> Unit,
    onSettings: () -> Unit,
    onShutdown: () -> Unit,
) {
    var filterName by rememberSaveable { mutableStateOf(LibraryFilter.ALL.name) }
    var sortName by rememberSaveable { mutableStateOf(LibrarySort.STABLE.name) }
    var addOpen by rememberSaveable { mutableStateOf(false) }
    var sortOpen by remember { mutableStateOf(false) }
    var overflowOpen by remember { mutableStateOf(false) }
    var selection by rememberSaveable { mutableStateOf(emptySet<String>()) }
    var backgroundOfferDismissed by rememberSaveable { mutableStateOf(false) }
    var migrationGuidanceDismissed by rememberSaveable { mutableStateOf(false) }
    val filter = LibraryFilter.valueOf(filterName)
    val sort = LibrarySort.valueOf(sortName)
    val torrents = filteredAndSortedTorrents(state.torrents.values, filter, sort)
    val networkRuntime = state.clientSettings?.applicationNetwork
    val waitingForUnmeteredNetwork =
        networkRuntime?.requestedPrerequisite ==
            ApplicationNetworkPrerequisiteView.WAITING_FOR_UNMETERED_NETWORK &&
            networkRuntime.state != ApplicationNetworkRuntimeState.ALLOWED
    val stateError = state.error?.let { productErrorText(it) }
    val sortDescription = stringResource(R.string.a11y_sort_torrents)
    val moreDescription = stringResource(R.string.a11y_more_options)
    val addDescription = stringResource(R.string.a11y_add_torrent)

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        RstorrentLogo(Modifier.size(40.dp))
                        Spacer(Modifier.size(10.dp))
                        Column {
                            Text(stringResource(R.string.app_name), fontWeight = FontWeight.SemiBold)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Surface(
                                    modifier = Modifier.size(8.dp),
                                    shape = CircleShape,
                                    color =
                                        if (state.ready && !state.checkingStorage) {
                                            Color(0xFF2E7D32)
                                        } else {
                                            MaterialTheme.colorScheme.outline
                                        },
                                ) {}
                                Spacer(Modifier.size(6.dp))
                                Text(
                                    stringResource(
                                        if (state.ready && !state.checkingStorage) R.string.status_live else R.string.status_connecting,
                                    ),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                },
                actions = {
                    Box {
                        IconButton(
                            onClick = { sortOpen = true },
                            modifier =
                                Modifier.semantics { contentDescription = sortDescription },
                        ) {
                            Icon(Icons.AutoMirrored.Outlined.Sort, contentDescription = null)
                        }
                        DropdownMenu(expanded = sortOpen, onDismissRequest = { sortOpen = false }) {
                            LibrarySort.entries.forEach { candidate ->
                                DropdownMenuItem(
                                    text = { Text(stringResource(candidate.labelRes)) },
                                    onClick = {
                                        sortName = candidate.name
                                        sortOpen = false
                                    },
                                    leadingIcon = {
                                        if (candidate == sort) {
                                            Text(stringResource(R.string.selection_mark))
                                        }
                                    },
                                )
                            }
                        }
                    }
                    Box {
                        IconButton(
                            onClick = { overflowOpen = true },
                            modifier =
                                Modifier.semantics { contentDescription = moreDescription },
                        ) {
                            Icon(Icons.Outlined.MoreVert, contentDescription = null)
                        }
                        LibraryOverflowMenu(
                            expanded = overflowOpen,
                            onDismiss = { overflowOpen = false },
                            onPauseAll = {
                                state.torrents.values.forEach { onPause(it.torrentId) }
                            },
                            onResumeAll = {
                                state.torrents.values.forEach { onResume(it.torrentId) }
                            },
                            onSelectStorage = onSelectStorage,
                            onSpeed = onSpeed,
                            onDht = onDht,
                            onLogs = onLogs,
                            onSettings = onSettings,
                            onShutdown = onShutdown,
                        )
                    }
                },
            )
        },
        floatingActionButton = {
            if (selection.isEmpty()) {
                ExtendedFloatingActionButton(
                    onClick = { addOpen = true },
                    icon = { Icon(Icons.Default.Add, contentDescription = null) },
                    text = { Text(stringResource(R.string.action_add)) },
                    modifier =
                        Modifier.semantics { contentDescription = addDescription },
                )
            }
        },
        bottomBar = {
            if (selection.isNotEmpty()) {
                SelectionActions(
                    count = selection.size,
                    onPause = { selection.forEach(onPause) },
                    onResume = { selection.forEach(onResume) },
                    onMoveTop = { selection.forEach(onMoveTop) },
                    onMoveBottom = { selection.forEach(onMoveBottom) },
                    onArchive = { selection.forEach(onArchive) },
                    onRemove = { onRemove(selection) },
                    onClear = { selection = emptySet() },
                )
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            ScrollableTabRow(selectedTabIndex = filter.ordinal, edgePadding = 12.dp) {
                LibraryFilter.entries.forEach { candidate ->
                    Tab(
                        selected = candidate == filter,
                        onClick = { filterName = candidate.name },
                        text = { Text(stringResource(candidate.labelRes)) },
                    )
                }
            }
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (state.legacyChromeOsMigration && !migrationGuidanceDismissed && state.lifecycle.companionConnections == 0) {
                    item("legacy-chromeos-migration") {
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                stringResource(R.string.legacy_chromeos_migration_guidance),
                                modifier = Modifier.padding(16.dp),
                            )
                            TextButton(onClick = { migrationGuidanceDismissed = true }) {
                                Text(stringResource(R.string.action_done))
                            }
                        }
                    }
                }
                if (waitingForUnmeteredNetwork) {
                    item("network-prerequisite") {
                        Card(
                            modifier = Modifier.fillMaxWidth().widthIn(max = 720.dp),
                            colors =
                                CardDefaults.cardColors(
                                    MaterialTheme.colorScheme.secondaryContainer,
                                ),
                        ) {
                            Column(Modifier.padding(16.dp)) {
                                Text(
                                    stringResource(R.string.library_waiting_unmetered),
                                    fontWeight = FontWeight.SemiBold,
                                )
                                Text(
                                    if (networkRuntime?.state ==
                                        ApplicationNetworkRuntimeState.DEGRADED
                                    ) {
                                        stringResource(R.string.library_waiting_unmetered_degraded)
                                    } else {
                                        stringResource(R.string.library_waiting_unmetered_detail)
                                    },
                                )
                            }
                        }
                    }
                }
                if (state.checkingStorage) {
                    item("checking-storage") {
                        Card(modifier = Modifier.fillMaxWidth().widthIn(max = 720.dp)) {
                            Column(Modifier.padding(16.dp)) {
                                Text(stringResource(R.string.storage_checking_folders))
                                Spacer(Modifier.height(8.dp))
                                LinearProgressIndicator(Modifier.fillMaxWidth())
                            }
                        }
                    }
                } else if (!state.storageRootReady) {
                    item("storage") {
                        SetupCard(
                            title = stringResource(
                                if (state.storageRootLabel == null) R.string.storage_choose_folder
                                else R.string.error_storage_unavailable,
                            ),
                            detail =
                                stateError
                                    ?: stringResource(
                                        if (state.storageRootLabel == null) R.string.storage_select_before_download
                                        else R.string.storage_repair_existing_folder,
                                    ),
                            action =
                                stringResource(
                                    if (state.storageRootLabel == null) {
                                        R.string.action_select_folder
                                    } else {
                                        R.string.action_repair
                                    },
                                ),
                            onAction = {
                                val rootId = state.storage?.defaultRoot
                                if (rootId == null) onSelectStorage() else onRepairStorage(rootId)
                            },
                        )
                    }
                }
                if (
                    state.ready && state.storageRootReady && !state.checkingStorage &&
                        !state.lifecycle.effectiveBackgroundDownloads && !backgroundOfferDismissed
                ) {
                    item("background-setup") {
                        SetupCard(
                            title = stringResource(R.string.library_background_title),
                            detail = stringResource(
                                if (notificationsGranted) R.string.library_background_offer
                                else R.string.library_background_permission,
                            ),
                            action = stringResource(R.string.action_enable),
                            onAction = onEnableBackgroundDownloads,
                            actionEnabled = backgroundControlsEnabled,
                            onDismiss = { backgroundOfferDismissed = true },
                        )
                        state.lifecycle.preferenceError?.let {
                            Text(productErrorText(it), color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                stateError?.takeIf { state.storageRootReady }?.let { error ->
                    item("error") {
                        Card(
                            modifier = Modifier.fillMaxWidth().widthIn(max = 720.dp),
                            colors = CardDefaults.cardColors(MaterialTheme.colorScheme.errorContainer),
                        ) {
                            Text(
                                error,
                                modifier = Modifier.padding(16.dp),
                                color = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                    }
                }
                if (torrents.isEmpty() && !state.checkingStorage) {
                    item("empty") { EmptyLibrary(filter) }
                }
                items(if (state.checkingStorage) emptyList() else torrents, key = TorrentView::torrentId) { torrent ->
                    TorrentCard(
                        torrent = torrent,
                        selected = torrent.torrentId in selection,
                        selectionMode = selection.isNotEmpty(),
                        onClick = {
                            if (selection.isEmpty()) {
                                onOpenTorrent(torrent.torrentId)
                            } else {
                                selection = selection.toggle(torrent.torrentId)
                            }
                        },
                        onLongClick = { selection = selection.toggle(torrent.torrentId) },
                        onPause = { onPause(torrent.torrentId) },
                        onResume = { onResume(torrent.torrentId) },
                    )
                }
            }
        }
    }

    if (addOpen) {
        AddTorrentDialog(
            enabled = state.ready && state.storageRootReady,
            onDismiss = { addOpen = false },
            onAddMagnet = { magnet, chooseFiles ->
                onAddMagnet(magnet, chooseFiles)
                addOpen = false
            },
            onBrowse = {
                addOpen = false
                onBrowseTorrent()
            },
        )
    }
}

@Composable
private fun LibraryOverflowMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    onPauseAll: () -> Unit,
    onResumeAll: () -> Unit,
    onSelectStorage: () -> Unit,
    onSpeed: () -> Unit,
    onDht: () -> Unit,
    onLogs: () -> Unit,
    onSettings: () -> Unit,
    onShutdown: () -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(text = { Text(stringResource(R.string.action_pause_all)) }, onClick = { onDismiss(); onPauseAll() })
        DropdownMenuItem(text = { Text(stringResource(R.string.action_resume_all)) }, onClick = { onDismiss(); onResumeAll() })
        DropdownMenuItem(
            text = { Text(stringResource(R.string.storage_choose_folder)) },
            leadingIcon = { Icon(Icons.Outlined.Folder, contentDescription = null) },
            onClick = { onDismiss(); onSelectStorage() },
        )
        HorizontalDivider()
        DropdownMenuItem(text = { Text(stringResource(R.string.library_menu_speed)) }, onClick = { onDismiss(); onSpeed() })
        DropdownMenuItem(text = { Text(stringResource(R.string.library_menu_dht)) }, onClick = { onDismiss(); onDht() })
        DropdownMenuItem(text = { Text(stringResource(R.string.logs_title)) }, onClick = { onDismiss(); onLogs() })
        DropdownMenuItem(text = { Text(stringResource(R.string.settings_title)) }, onClick = { onDismiss(); onSettings() })
        DropdownMenuItem(text = { Text(stringResource(R.string.action_shutdown)) }, onClick = { onDismiss(); onShutdown() })
    }
}

@Composable
private fun SetupCard(
    title: String,
    detail: String,
    action: String,
    onAction: () -> Unit,
    actionEnabled: Boolean = true,
    onDismiss: (() -> Unit)? = null,
) {
    Card(
        modifier = Modifier.fillMaxWidth().widthIn(max = 720.dp),
        colors = CardDefaults.cardColors(MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(4.dp))
            Text(detail, color = MaterialTheme.colorScheme.onSecondaryContainer)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onAction, enabled = actionEnabled) { Text(action) }
                onDismiss?.let {
                    TextButton(
                        onClick = it,
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                        ),
                    ) { Text(stringResource(R.string.action_not_now)) }
                }
            }
        }
    }
}

@Composable
private fun EmptyLibrary(filter: LibraryFilter) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.Folder,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.outline,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            if (filter == LibraryFilter.ALL) {
                stringResource(R.string.library_empty)
            } else {
                stringResource(
                    R.string.library_empty_filtered,
                    stringResource(filter.labelRes).lowercase(),
                )
            },
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            stringResource(
                if (filter == LibraryFilter.ALL) {
                    R.string.library_empty_hint
                } else {
                    R.string.library_empty_filtered_hint
                },
            ),
            modifier = Modifier.padding(top = 4.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TorrentCard(
    torrent: TorrentView,
    selected: Boolean,
    selectionMode: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
) {
    val progress = torrentProgress(torrent)
    val paused = torrent.operationalState == TorrentOperationalState.PAUSED
    val pauseResumeDescription =
        stringResource(if (paused) R.string.action_resume else R.string.action_pause)
    Card(
        modifier =
            Modifier.fillMaxWidth().widthIn(max = 720.dp)
                .combinedClickable(onClick = onClick, onLongClick = onLongClick),
        colors =
            CardDefaults.cardColors(
                if (selected) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surfaceContainer,
            ),
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = if (paused) onResume else onPause,
                enabled = !selectionMode,
                modifier =
                    Modifier.clip(CircleShape)
                        .semantics { contentDescription = pauseResumeDescription },
            ) {
                Icon(
                    if (paused) Icons.Default.PlayArrow else Icons.Default.Pause,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            Column(Modifier.weight(1f)) {
                Text(
                    torrentPresentationName(torrent),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    fontWeight = FontWeight.SemiBold,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        torrent.downloadQueuePosition?.let {
                            stringResource(
                                R.string.library_queue_position,
                                operationalLabel(torrent.operationalState),
                                it.toInt(),
                            )
                        } ?: operationalLabel(torrent.operationalState),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(percentLabel(progress), style = MaterialTheme.typography.labelMedium)
                }
                Spacer(Modifier.height(6.dp))
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape),
                )
                Spacer(Modifier.height(7.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(stringResource(R.string.library_download_rate, formatRate(torrent.payloadDownloadRateBytes)))
                    Text(stringResource(R.string.library_eta, torrentEta(torrent)))
                }
            }
        }
    }
}

@Composable
private fun SelectionActions(
    count: Int,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onMoveTop: () -> Unit,
    onMoveBottom: () -> Unit,
    onArchive: () -> Unit,
    onRemove: () -> Unit,
    onClear: () -> Unit,
) {
    Surface(shadowElevation = 8.dp) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(pluralStringResource(R.plurals.library_selected_count, count, count), modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                TextButton(onClick = onPause) { Text(stringResource(R.string.action_pause)) }
                TextButton(onClick = onResume) { Text(stringResource(R.string.action_resume)) }
                TextButton(onClick = onClear) { Text(stringResource(R.string.action_done)) }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onMoveTop) { Text(stringResource(R.string.action_top)) }
                TextButton(onClick = onMoveBottom) { Text(stringResource(R.string.action_bottom)) }
                TextButton(onClick = onArchive) { Text(stringResource(R.string.action_archive_or_restore)) }
                TextButton(onClick = onRemove) { Text(stringResource(R.string.action_remove)) }
            }
        }
    }
}

@Composable
internal fun AddTorrentDialog(
    enabled: Boolean,
    onDismiss: () -> Unit,
    onAddMagnet: (String, Boolean) -> Unit,
    onBrowse: () -> Unit,
) {
    var magnet by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_torrent_title)) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = magnet,
                    onValueChange = { magnet = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.add_magnet_label)) },
                    minLines = 3,
                )
                OutlinedButton(
                    onClick = onBrowse,
                    enabled = enabled,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.action_browse_torrent))
                }
                if (!enabled) {
                    Text(
                        stringResource(R.string.add_folder_required),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onAddMagnet(magnet.trim(), false) },
                enabled = enabled && magnet.isNotBlank(),
            ) { Text(stringResource(R.string.action_download_all)) }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
                TextButton(
                    onClick = { onAddMagnet(magnet.trim(), true) },
                    enabled = enabled && magnet.isNotBlank(),
                ) { Text(stringResource(R.string.action_choose_files)) }
            }
        },
    )
}

@Composable
internal fun RstorrentLogo(modifier: Modifier = Modifier) {
    androidx.compose.foundation.Image(
        painter = androidx.compose.ui.res.painterResource(R.drawable.jstorrent_brand),
        contentDescription = null,
        modifier = modifier,
    )
}

private fun Set<String>.toggle(value: String): Set<String> =
    if (value in this) this - value else this + value
