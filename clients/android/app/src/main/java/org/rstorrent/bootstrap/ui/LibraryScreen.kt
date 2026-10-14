package org.rstorrent.bootstrap.ui

import org.rstorrent.bootstrap.checkingStorage

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Deselect
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SelectAll
import androidx.compose.material.icons.outlined.Unarchive
import androidx.compose.material.icons.outlined.VerticalAlignBottom
import androidx.compose.material.icons.outlined.VerticalAlignTop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomAppBar
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
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.ProductState
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.ApplicationNetworkPrerequisiteView
import org.rstorrent.session.uniffi.ApplicationNetworkRuntimeState
import org.rstorrent.session.uniffi.RemovalState
import org.rstorrent.session.uniffi.SpeedMetric
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
    onAddTestTorrents: ((List<TestTorrent>) -> Unit)?,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onMoveTop: (List<String>) -> Unit,
    onMoveBottom: (List<String>) -> Unit,
    onForceRecheck: (String) -> Unit,
    onCopyMagnets: (List<String>) -> Unit,
    onArchive: (List<String>) -> Unit,
    onRestore: (List<String>) -> Unit,
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
    // Selection follows the visible tab: rows that leave it (for example after
    // archiving) drop out, and the selected rows keep their list order.
    val selectedTorrents = torrents.filter { it.torrentId in selection }
    LaunchedEffect(selectedTorrents.size, selection.size, state.ready) {
        // Skip while the library is not loaded so a reconnect keeps the selection.
        if (state.ready && selectedTorrents.size != selection.size) {
            selection = selectedTorrents.mapTo(mutableSetOf(), TorrentView::torrentId)
        }
    }
    BackHandler(enabled = selection.isNotEmpty()) { selection = emptySet() }
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
            if (selection.isNotEmpty()) {
                SelectionTopBar(
                    count = selection.size,
                    allSelected = selectedTorrents.size == torrents.size,
                    onClear = { selection = emptySet() },
                    onSelectAll = {
                        selection = torrents.mapTo(mutableSetOf(), TorrentView::torrentId)
                    },
                )
            } else {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RstorrentLogo(Modifier.size(40.dp))
                            Spacer(Modifier.size(10.dp))
                            Column {
                                Text(stringResource(R.string.app_name), fontWeight = FontWeight.SemiBold)
                                LibraryStatusLine(
                                    state = state,
                                    waitingForUnmeteredNetwork = waitingForUnmeteredNetwork,
                                    onSpeed = onSpeed,
                                )
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
                                    state.torrents.values
                                        .targetsFor(TorrentAction.PAUSE)
                                        .forEach(onPause)
                                },
                                onResumeAll = {
                                    state.torrents.values
                                        .targetsFor(TorrentAction.START)
                                        .forEach(onResume)
                                },
                                onSelectStorage = onSelectStorage,
                                onAddTestTorrents = onAddTestTorrents,
                                onSpeed = onSpeed,
                                onDht = onDht,
                                onLogs = onLogs,
                                onSettings = onSettings,
                                onShutdown = onShutdown,
                            )
                        }
                    },
                )
            }
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
                SelectionBottomBar(
                    selected = selectedTorrents,
                    archivedTab = filter == LibraryFilter.ARCHIVED,
                    onResume = { it.forEach(onResume) },
                    onPause = { it.forEach(onPause) },
                    onArchive = {
                        onArchive(it)
                        selection = emptySet()
                    },
                    onRestore = {
                        onRestore(it)
                        selection = emptySet()
                    },
                    onRemove = { onRemove(it.toSet()) },
                    onMoveTop = onMoveTop,
                    onMoveBottom = onMoveBottom,
                    onForceRecheck = { it.forEach(onForceRecheck) },
                    onCopyMagnets = onCopyMagnets,
                )
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            ScrollableTabRow(selectedTabIndex = filter.ordinal, edgePadding = 12.dp) {
                LibraryFilter.entries.forEach { candidate ->
                    Tab(
                        selected = candidate == filter,
                        onClick = {
                            filterName = candidate.name
                            selection = emptySet()
                        },
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
                    item("empty") {
                        EmptyLibrary(
                            filter = filter,
                            libraryEmpty = state.torrents.isEmpty(),
                            canViewAll = filter != LibraryFilter.ALL &&
                                state.torrents.values.any(LibraryFilter.ALL::matches),
                            onViewAll = {
                                filterName = LibraryFilter.ALL.name
                                selection = emptySet()
                            },
                        )
                    }
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
            // Adds made before a usable folder exists wait in the intake dialog.
            enabled = state.ready,
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
    onAddTestTorrents: ((List<TestTorrent>) -> Unit)?,
    onSpeed: () -> Unit,
    onDht: () -> Unit,
    onLogs: () -> Unit,
    onSettings: () -> Unit,
    onShutdown: () -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        if (onAddTestTorrents != null) {
            // Debug builds only: public WebTorrent samples for manual testing.
            DropdownMenuItem(
                text = { Text(stringResource(R.string.debug_add_all_test_torrents)) },
                onClick = { onDismiss(); onAddTestTorrents(WEBTORRENT_TEST_TORRENTS) },
            )
            WEBTORRENT_TEST_TORRENTS.forEach { torrent ->
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.debug_add_test_torrent, torrent.label)) },
                    onClick = { onDismiss(); onAddTestTorrents(listOf(torrent)) },
                )
            }
            HorizontalDivider()
        }
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
private fun EmptyLibrary(
    filter: LibraryFilter,
    libraryEmpty: Boolean,
    canViewAll: Boolean,
    onViewAll: () -> Unit,
) {
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
            if (libraryEmpty || filter == LibraryFilter.ALL) {
                stringResource(R.string.library_empty)
            } else {
                stringResource(
                    R.string.library_empty_filtered,
                    stringResource(filter.labelRes).lowercase(),
                )
            },
            style = MaterialTheme.typography.titleMedium,
        )
        if (canViewAll) {
            TextButton(onClick = onViewAll, modifier = Modifier.padding(top = 4.dp)) {
                Text(stringResource(R.string.library_view_all))
            }
        } else {
            Text(
                stringResource(
                    if (libraryEmpty || filter == LibraryFilter.ALL) {
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
    val removing = torrent.removalActive
    val pauseResumeDescription = stringResource(torrent.pauseResumeLabelRes())
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
            if (torrent.archived) {
                // Archived torrents cannot start; restore them from the selection bar.
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    Icon(
                        Icons.Outlined.Archive,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.outline,
                    )
                }
            } else {
                IconButton(
                    onClick = if (paused) onResume else onPause,
                    enabled = !selectionMode && !removing,
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
            }
            Column(Modifier.weight(1f)) {
                Text(
                    torrentPresentationName(torrent),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    fontWeight = FontWeight.SemiBold,
                    color =
                        if (removing) MaterialTheme.colorScheme.onSurfaceVariant
                        else Color.Unspecified,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        torrent.downloadQueuePosition
                            ?.takeUnless {
                                torrent.archived || torrent.removalState != null ||
                                    torrent.waitingForStorage()
                            }
                            ?.let {
                                stringResource(
                                    R.string.library_queue_position,
                                    operationalLabel(torrent.operationalState),
                                    it.toInt(),
                                )
                            } ?: torrentStatusLabel(torrent),
                        style = MaterialTheme.typography.bodySmall,
                        color =
                            if (torrent.removalState == RemovalState.FAILED) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    )
                    if (!removing) {
                        Text(percentLabel(progress), style = MaterialTheme.typography.labelMedium)
                    }
                }
                Spacer(Modifier.height(6.dp))
                val progressModifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape)
                if (removing) {
                    LinearProgressIndicator(modifier = progressModifier)
                } else {
                    LinearProgressIndicator(progress = { progress }, modifier = progressModifier)
                }
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

/**
 * One line under the app name: startup and blocking states first, otherwise
 * the session payload rates. Tapping the rates opens the Speed screen.
 */
@Composable
private fun LibraryStatusLine(
    state: ProductState,
    waitingForUnmeteredNetwork: Boolean,
    onSpeed: () -> Unit,
) {
    val style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum")
    val color = MaterialTheme.colorScheme.onSurfaceVariant
    val blocked =
        when {
            !state.ready -> R.string.status_starting
            state.checkingStorage -> R.string.status_checking_storage
            waitingForUnmeteredNetwork -> R.string.status_waiting_unmetered
            else -> null
        }
    if (blocked != null) {
        Text(stringResource(blocked), style = style, color = color)
        return
    }
    val rates = state.currentRates?.rates?.associate { it.metric to it.bytes }.orEmpty()
    val download = rates[SpeedMetric.PAYLOAD_RECEIVED]
    val upload = rates[SpeedMetric.PAYLOAD_UPLOADED]
    val idle = (download?.toULongOrNull() ?: 0UL) == 0UL && (upload?.toULongOrNull() ?: 0UL) == 0UL
    val speedLabel = stringResource(R.string.library_menu_speed)
    val label =
        if (idle) stringResource(R.string.status_idle)
        else stringResource(R.string.status_rates, formatRate(download), formatRate(upload))
    val description =
        if (idle) label
        else stringResource(R.string.a11y_status_rates, formatRate(download), formatRate(upload))
    Text(
        label,
        style = style,
        color = color,
        modifier =
            Modifier.clickable(onClickLabel = speedLabel, onClick = onSpeed)
                .semantics { contentDescription = description },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SelectionTopBar(
    count: Int,
    allSelected: Boolean,
    onClear: () -> Unit,
    onSelectAll: () -> Unit,
) {
    // Toggles: once every torrent in the tab is selected it deselects them all.
    val toggleLabel =
        stringResource(if (allSelected) R.string.action_deselect_all else R.string.action_select_all)
    TopAppBar(
        navigationIcon = {
            IconButton(onClick = onClear) {
                Icon(
                    Icons.Outlined.Close,
                    contentDescription = stringResource(R.string.a11y_clear_selection),
                )
            }
        },
        title = { Text(pluralStringResource(R.plurals.library_selected_count, count, count)) },
        actions = {
            TooltipBox(
                positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
                tooltip = { PlainTooltip { Text(toggleLabel) } },
                state = rememberTooltipState(),
            ) {
                IconButton(onClick = if (allSelected) onClear else onSelectAll) {
                    Icon(
                        if (allSelected) Icons.Outlined.Deselect else Icons.Outlined.SelectAll,
                        contentDescription = toggleLabel,
                    )
                }
            }
        },
        colors =
            TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.secondaryContainer,
            ),
    )
}

/**
 * Labeled actions for the selected torrents. Every action applies only to the
 * selected torrents that allow it and is disabled when none do. Tabs never mix
 * archived and unarchived torrents, so the bar offers Archive or Restore.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SelectionBottomBar(
    selected: List<TorrentView>,
    archivedTab: Boolean,
    onResume: (List<String>) -> Unit,
    onPause: (List<String>) -> Unit,
    onArchive: (List<String>) -> Unit,
    onRestore: (List<String>) -> Unit,
    onRemove: (List<String>) -> Unit,
    onMoveTop: (List<String>) -> Unit,
    onMoveBottom: (List<String>) -> Unit,
    onForceRecheck: (List<String>) -> Unit,
    onCopyMagnets: (List<String>) -> Unit,
) {
    var moreOpen by remember { mutableStateOf(false) }
    @Composable
    fun RowScope.Action(icon: ImageVector, @StringRes label: Int, action: TorrentAction, run: (List<String>) -> Unit) {
        val targets = selected.targetsFor(action)
        SelectionBarButton(icon, stringResource(label), enabled = targets.isNotEmpty()) { run(targets) }
    }
    BottomAppBar {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            if (archivedTab) {
                Action(Icons.Outlined.Unarchive, R.string.action_restore, TorrentAction.RESTORE, onRestore)
            } else {
                Action(Icons.Default.PlayArrow, R.string.action_resume, TorrentAction.START, onResume)
                Action(Icons.Default.Pause, R.string.action_pause, TorrentAction.PAUSE, onPause)
                Action(Icons.Outlined.Archive, R.string.action_archive, TorrentAction.ARCHIVE, onArchive)
            }
            Action(Icons.Outlined.Delete, R.string.action_remove, TorrentAction.REMOVE, onRemove)
            SelectionBarButton(Icons.Outlined.MoreHoriz, stringResource(R.string.action_more), enabled = true) {
                moreOpen = true
            }
        }
    }
    if (moreOpen) {
        ModalBottomSheet(onDismissRequest = { moreOpen = false }) {
            @Composable
            fun SheetAction(icon: ImageVector, label: String, action: TorrentAction, run: (List<String>) -> Unit) {
                val targets = selected.targetsFor(action)
                ListItem(
                    headlineContent = { Text(label) },
                    leadingContent = { Icon(icon, contentDescription = null) },
                    modifier =
                        Modifier.clickable(enabled = targets.isNotEmpty()) {
                            moreOpen = false
                            run(targets)
                        }.alpha(if (targets.isEmpty()) 0.38f else 1f),
                )
            }
            if (!archivedTab) {
                SheetAction(Icons.Outlined.VerticalAlignTop, stringResource(R.string.action_move_top), TorrentAction.MOVE_TOP, onMoveTop)
                SheetAction(
                    Icons.Outlined.VerticalAlignBottom,
                    stringResource(R.string.action_move_bottom),
                    TorrentAction.MOVE_BOTTOM,
                    onMoveBottom,
                )
            }
            SheetAction(Icons.Outlined.Refresh, stringResource(R.string.action_force_recheck), TorrentAction.FORCE_RECHECK, onForceRecheck)
            SheetAction(
                Icons.Outlined.Link,
                stringResource(if (selected.size == 1) R.string.action_copy_magnet else R.string.action_copy_magnets),
                TorrentAction.COPY_MAGNET,
                onCopyMagnets,
            )
            Spacer(Modifier.height(16.dp))
        }
    }
}

@Composable
internal fun RowScope.SelectionBarButton(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val color =
        if (enabled) MaterialTheme.colorScheme.onSurface
        else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f)
    Column(
        modifier =
            Modifier.weight(1f)
                .clip(RoundedCornerShape(16.dp))
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = null, tint = color)
        Spacer(Modifier.height(4.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = color, maxLines = 1)
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
