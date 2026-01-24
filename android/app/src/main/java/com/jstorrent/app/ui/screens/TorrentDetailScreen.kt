package com.jstorrent.app.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.jstorrent.app.model.DetailTab
import com.jstorrent.app.model.TorrentDetailUi
import com.jstorrent.app.model.TorrentDetailUiState
import com.jstorrent.app.ui.dialogs.RemoveTorrentDialog
import com.jstorrent.app.ui.tabs.FilesTab
import com.jstorrent.app.ui.tabs.PeersTab
import com.jstorrent.app.ui.tabs.PiecesTab
import com.jstorrent.app.ui.tabs.StatusTab
import com.jstorrent.app.ui.tabs.TrackersTab
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.TorrentDetailViewModel

/**
 * Torrent detail screen.
 * Shows detailed information about a torrent with tabs for different aspects.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun TorrentDetailScreen(
    viewModel: TorrentDetailViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val selectedTab by viewModel.selectedTab.collectAsState()

    var showMenu by remember { mutableStateOf(false) }
    var showRemoveDialog by remember { mutableStateOf(false) }

    when (val state = uiState) {
        is TorrentDetailUiState.Loading -> {
            LoadingContent(modifier = modifier)
        }
        is TorrentDetailUiState.Error -> {
            ErrorContent(
                message = state.message,
                onNavigateBack = onNavigateBack,
                modifier = modifier
            )
        }
        is TorrentDetailUiState.Loaded -> {
            val torrent = state.torrent
            val isPaused = torrent.status == "stopped"

            Scaffold(
                modifier = modifier.fillMaxSize(),
                topBar = {
                    TopAppBar(
                        title = {
                            Text(
                                text = torrent.name,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        },
                        navigationIcon = {
                            IconButton(onClick = onNavigateBack) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = "Back"
                                )
                            }
                        },
                        actions = {
                            // Play/Pause button
                            IconButton(
                                onClick = {
                                    if (isPaused) viewModel.resume() else viewModel.pause()
                                }
                            ) {
                                Icon(
                                    imageVector = if (isPaused) Icons.Default.PlayArrow else Icons.Default.Pause,
                                    contentDescription = if (isPaused) "Resume" else "Pause"
                                )
                            }

                            // Overflow menu
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
                                    text = { Text("Remove torrent") },
                                    onClick = {
                                        showMenu = false
                                        showRemoveDialog = true
                                    },
                                    leadingIcon = {
                                        Icon(Icons.Default.Delete, contentDescription = null)
                                    }
                                )
                            }
                        }
                    )
                }
            ) { innerPadding ->
                DetailContent(
                    torrent = torrent,
                    selectedTab = selectedTab,
                    onTabSelected = { viewModel.setSelectedTab(it) },
                    onToggleFileSelection = { viewModel.toggleFileSelection(it) },
                    modifier = Modifier.padding(innerPadding)
                )
            }

            // Remove torrent dialog
            if (showRemoveDialog) {
                RemoveTorrentDialog(
                    torrentName = torrent.name,
                    onDismiss = { showRemoveDialog = false },
                    onConfirm = { deleteFiles ->
                        viewModel.remove(deleteFiles)
                        showRemoveDialog = false
                        onNavigateBack()
                    }
                )
            }
        }
    }
}

/**
 * Content showing loading state.
 */
@Composable
private fun LoadingContent(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        CircularProgressIndicator()
    }
}

/**
 * Content showing error state with back navigation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ErrorContent(
    message: String,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("Error") },
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
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

/**
 * Main detail content with tab bar and pager.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DetailContent(
    torrent: TorrentDetailUi,
    selectedTab: DetailTab,
    onTabSelected: (DetailTab) -> Unit,
    onToggleFileSelection: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val tabs = DetailTab.entries
    val pagerState = rememberPagerState(
        initialPage = tabs.indexOf(selectedTab),
        pageCount = { tabs.size }
    )

    // Sync pager with tab selection
    LaunchedEffect(selectedTab) {
        val targetPage = tabs.indexOf(selectedTab)
        if (pagerState.currentPage != targetPage) {
            // If animation is in progress (rapid taps), snap immediately to avoid conflicts
            if (pagerState.isScrollInProgress) {
                pagerState.scrollToPage(targetPage)
            } else {
                pagerState.animateScrollToPage(targetPage)
            }
        }
    }

    // Sync tab selection with pager (use settledPage to avoid mid-animation triggers)
    LaunchedEffect(pagerState.settledPage) {
        val currentTab = tabs[pagerState.settledPage]
        if (currentTab != selectedTab) {
            onTabSelected(currentTab)
        }
    }

    Column(modifier = modifier.fillMaxSize()) {
        // Tab bar
        TabRow(
            selectedTabIndex = tabs.indexOf(selectedTab),
            modifier = Modifier.fillMaxWidth()
        ) {
            tabs.forEach { tab ->
                Tab(
                    selected = tab == selectedTab,
                    onClick = { onTabSelected(tab) },
                    text = {
                        Text(
                            text = tab.name,
                            style = MaterialTheme.typography.labelMedium
                        )
                    }
                )
            }
        }

        // Tab content
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxSize()
        ) { page ->
            when (tabs[page]) {
                DetailTab.STATUS -> StatusTab(torrent = torrent)
                DetailTab.FILES -> FilesTab(
                    files = torrent.files,
                    onToggleFileSelection = onToggleFileSelection
                )
                DetailTab.TRACKERS -> TrackersTab(
                    trackers = torrent.trackers,
                    dhtEnabled = torrent.dhtEnabled,
                    lsdEnabled = torrent.lsdEnabled,
                    pexEnabled = torrent.pexEnabled
                )
                DetailTab.PEERS -> PeersTab(peers = torrent.peers)
                DetailTab.PIECES -> PiecesTab(
                    piecesCompleted = torrent.piecesCompleted,
                    piecesTotal = torrent.piecesTotal,
                    pieceSize = torrent.pieceSize,
                    bitfield = torrent.pieceBitfield
                )
            }
        }
    }
}

// =============================================================================
// Previews
// =============================================================================

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
        ErrorContent(
            message = "Torrent not found",
            onNavigateBack = {}
        )
    }
}
