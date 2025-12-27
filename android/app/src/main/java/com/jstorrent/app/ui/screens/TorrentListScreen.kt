package com.jstorrent.app.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sort
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.R
import com.jstorrent.app.model.TorrentFilter
import com.jstorrent.app.model.TorrentListUiState
import com.jstorrent.app.model.TorrentSortOrder
import com.jstorrent.app.ui.components.TorrentCard
import com.jstorrent.app.ui.dialogs.AddTorrentDialog
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.TorrentListViewModel
import com.jstorrent.quickjs.model.TorrentSummary

/**
 * Main torrent list screen.
 * Displays a list of torrents with filter tabs, search, and add FAB.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TorrentListScreen(
    viewModel: TorrentListViewModel,
    onTorrentClick: (String) -> Unit = {},
    onAddRootClick: () -> Unit = {},
    onSettingsClick: () -> Unit = {},
    onSearchClick: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val currentFilter by viewModel.filter.collectAsState()
    val currentSortOrder by viewModel.sortOrder.collectAsState()

    var showAddDialog by remember { mutableStateOf(false) }
    var showMenu by remember { mutableStateOf(false) }
    var showSortMenu by remember { mutableStateOf(false) }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            painter = painterResource(id = R.drawable.ic_launcher_foreground),
                            contentDescription = null,
                            modifier = Modifier.size(48.dp)
                        )
                        Text("JSTorrent")
                    }
                },
                actions = {
                    // Sort button with dropdown
                    Box {
                        IconButton(onClick = { showSortMenu = true }) {
                            Icon(
                                imageVector = Icons.Default.Sort,
                                contentDescription = "Sort"
                            )
                        }
                        DropdownMenu(
                            expanded = showSortMenu,
                            onDismissRequest = { showSortMenu = false }
                        ) {
                            TorrentSortOrder.entries.forEach { sortOrder ->
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            text = getSortOrderDisplayName(sortOrder),
                                            color = if (sortOrder == currentSortOrder) {
                                                MaterialTheme.colorScheme.primary
                                            } else {
                                                MaterialTheme.colorScheme.onSurface
                                            }
                                        )
                                    },
                                    onClick = {
                                        showSortMenu = false
                                        viewModel.setSortOrder(sortOrder)
                                    }
                                )
                            }
                        }
                    }
                    IconButton(onClick = onSearchClick) {
                        Icon(
                            imageVector = Icons.Default.Search,
                            contentDescription = "Search"
                        )
                    }
                    IconButton(onClick = { showMenu = true }) {
                        Icon(
                            imageVector = Icons.Default.MoreVert,
                            contentDescription = "Menu"
                        )
                    }
                    DropdownMenu(
                        expanded = showMenu,
                        onDismissRequest = { showMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("Pause All") },
                            onClick = {
                                showMenu = false
                                viewModel.pauseAll()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Resume All") },
                            onClick = {
                                showMenu = false
                                viewModel.resumeAll()
                            }
                        )
                        HorizontalDivider()
                        DropdownMenuItem(
                            text = { Text("Add Download Folder") },
                            onClick = {
                                showMenu = false
                                onAddRootClick()
                            }
                        )
                        DropdownMenuItem(
                            text = { Text("Settings") },
                            onClick = {
                                showMenu = false
                                onSettingsClick()
                            }
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            if (uiState is TorrentListUiState.Loaded) {
                FloatingActionButton(
                    onClick = { showAddDialog = true }
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = "Add torrent"
                    )
                }
            }
        }
    ) { innerPadding ->
        when (val state = uiState) {
            is TorrentListUiState.Loading -> {
                LoadingContent(modifier = Modifier.padding(innerPadding))
            }
            is TorrentListUiState.Error -> {
                ErrorContent(
                    message = state.message,
                    modifier = Modifier.padding(innerPadding)
                )
            }
            is TorrentListUiState.Loaded -> {
                TorrentListContent(
                    torrents = state.torrents,
                    currentFilter = currentFilter,
                    onFilterChange = { viewModel.setFilter(it) },
                    getFilterCount = { viewModel.getFilterCount(it) },
                    onTorrentClick = onTorrentClick,
                    onPauseTorrent = { viewModel.pauseTorrent(it) },
                    onResumeTorrent = { viewModel.resumeTorrent(it) },
                    isPaused = { viewModel.isPaused(it) },
                    modifier = Modifier.padding(innerPadding)
                )
            }
        }
    }

    // Add torrent dialog
    if (showAddDialog) {
        AddTorrentDialog(
            onDismiss = { showAddDialog = false },
            onAddTorrent = { magnetLink ->
                viewModel.addTorrent(magnetLink)
                showAddDialog = false
            }
        )
    }
}

/**
 * Content shown while loading.
 */
@Composable
private fun LoadingContent(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Starting engine...",
                style = MaterialTheme.typography.bodyLarge
            )
        }
    }
}

/**
 * Content shown on error.
 */
@Composable
private fun ErrorContent(
    message: String,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp)
        ) {
            Text(
                text = "Error",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.error
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center
            )
        }
    }
}

/**
 * Main content with filter tabs and torrent list.
 */
@Composable
private fun TorrentListContent(
    torrents: List<TorrentSummary>,
    currentFilter: TorrentFilter,
    onFilterChange: (TorrentFilter) -> Unit,
    getFilterCount: (TorrentFilter) -> Int,
    onTorrentClick: (String) -> Unit,
    onPauseTorrent: (String) -> Unit,
    onResumeTorrent: (String) -> Unit,
    isPaused: (TorrentSummary) -> Boolean,
    modifier: Modifier = Modifier
) {
    Column(modifier = modifier.fillMaxSize()) {
        // Filter tabs
        FilterTabRow(
            currentFilter = currentFilter,
            onFilterChange = onFilterChange,
            getFilterCount = getFilterCount
        )

        // Torrent list or empty state
        if (torrents.isEmpty()) {
            EmptyState(currentFilter = currentFilter)
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(torrents, key = { it.infoHash }) { torrent ->
                    TorrentCard(
                        torrent = torrent,
                        onPause = { onPauseTorrent(torrent.infoHash) },
                        onResume = { onResumeTorrent(torrent.infoHash) },
                        onClick = { onTorrentClick(torrent.infoHash) }
                    )
                }
            }
        }
    }
}

/**
 * Filter tab row: ALL | QUEUED | FINISHED
 */
@Composable
private fun FilterTabRow(
    currentFilter: TorrentFilter,
    onFilterChange: (TorrentFilter) -> Unit,
    getFilterCount: (TorrentFilter) -> Int,
    modifier: Modifier = Modifier
) {
    val tabs = listOf(TorrentFilter.ALL, TorrentFilter.QUEUED, TorrentFilter.FINISHED)
    val selectedIndex = tabs.indexOf(currentFilter)

    TabRow(
        selectedTabIndex = selectedIndex,
        modifier = modifier.fillMaxWidth()
    ) {
        tabs.forEach { filter ->
            val count = getFilterCount(filter)
            Tab(
                selected = filter == currentFilter,
                onClick = { onFilterChange(filter) },
                text = {
                    Text(
                        text = if (count > 0) {
                            "${filter.displayName} ($count)"
                        } else {
                            filter.displayName
                        }
                    )
                }
            )
        }
    }
}

/**
 * Empty state when no torrents match the filter.
 */
@Composable
private fun EmptyState(
    currentFilter: TorrentFilter,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp)
        ) {
            Text(
                text = when (currentFilter) {
                    TorrentFilter.ALL -> "No torrents yet"
                    TorrentFilter.QUEUED -> "No active torrents"
                    TorrentFilter.FINISHED -> "No completed torrents"
                },
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = when (currentFilter) {
                    TorrentFilter.ALL -> "Tap + to add a magnet link"
                    TorrentFilter.QUEUED -> "Downloading torrents will appear here"
                    TorrentFilter.FINISHED -> "Completed torrents will appear here"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    }
}

// =============================================================================
// Previews
// =============================================================================

@Preview(showBackground = true)
@Composable
private fun EmptyStatePreview() {
    JSTorrentTheme {
        EmptyState(currentFilter = TorrentFilter.ALL)
    }
}

@Preview(showBackground = true)
@Composable
private fun LoadingContentPreview() {
    JSTorrentTheme {
        LoadingContent()
    }
}

@Preview(showBackground = true)
@Composable
private fun ErrorContentPreview() {
    JSTorrentTheme {
        ErrorContent(message = "Failed to initialize engine")
    }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get display name for sort order.
 */
private fun getSortOrderDisplayName(sortOrder: TorrentSortOrder): String {
    return when (sortOrder) {
        TorrentSortOrder.QUEUE_ORDER -> "Queue Order"
        TorrentSortOrder.NAME -> "Name"
        TorrentSortOrder.DATE_ADDED -> "Date Added"
        TorrentSortOrder.DOWNLOAD_SPEED -> "Download Speed"
        TorrentSortOrder.ETA -> "ETA"
    }
}
