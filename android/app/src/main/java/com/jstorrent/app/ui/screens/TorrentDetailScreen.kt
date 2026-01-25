package com.jstorrent.app.ui.screens

import android.content.Intent
import android.net.Uri
import android.widget.Toast
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
import androidx.compose.material3.ScrollableTabRow
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
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.jstorrent.app.model.DetailTab
import com.jstorrent.app.model.FilePriority
import com.jstorrent.app.model.TorrentDetailUi
import com.jstorrent.app.model.TorrentDetailUiState
import com.jstorrent.app.model.TorrentFileUi
import com.jstorrent.app.ui.dialogs.RemoveTorrentDialog
import com.jstorrent.app.ui.tabs.DetailsTab
import com.jstorrent.app.ui.tabs.FilesTab
import com.jstorrent.app.ui.tabs.PeersTab
import com.jstorrent.app.ui.tabs.PiecesTab
import com.jstorrent.app.ui.tabs.StatusTab
import com.jstorrent.app.ui.tabs.TrackersTab
import com.jstorrent.app.ui.theme.JSTorrentTheme
import com.jstorrent.app.viewmodel.TorrentDetailViewModel
import java.io.File

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

    // Re-sync pieces when app resumes from background to catch any updates
    // that were missed while the app was suspended
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        viewModel.resyncPieces()
    }

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
                    hasPendingFileChanges = state.hasPendingFileChanges,
                    onTabSelected = { viewModel.setSelectedTab(it) },
                    onToggleFileSelection = { viewModel.toggleFileSelection(it) },
                    onSetFilePriority = { index, priority -> viewModel.setFilePriority(index, priority) },
                    onSelectAllFiles = { viewModel.selectAllFiles() },
                    onSelectNoFiles = { viewModel.deselectAllFiles() },
                    onApplyFileChanges = { viewModel.applyFileChanges() },
                    onCancelFileChanges = { viewModel.cancelFileChanges() },
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
    hasPendingFileChanges: Boolean,
    onTabSelected: (DetailTab) -> Unit,
    onToggleFileSelection: (Int) -> Unit,
    onSetFilePriority: (Int, FilePriority) -> Unit,
    onSelectAllFiles: () -> Unit,
    onSelectNoFiles: () -> Unit,
    onApplyFileChanges: () -> Unit,
    onCancelFileChanges: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
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
        // Tab bar - use ScrollableTabRow to prevent text wrapping on narrow screens
        ScrollableTabRow(
            selectedTabIndex = tabs.indexOf(selectedTab),
            modifier = Modifier.fillMaxWidth(),
            edgePadding = 0.dp
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
                DetailTab.DETAILS -> DetailsTab(torrent = torrent)
                DetailTab.STATUS -> StatusTab(torrent = torrent)
                DetailTab.FILES -> FilesTab(
                    files = torrent.files,
                    hasPendingChanges = hasPendingFileChanges,
                    onToggleFileSelection = onToggleFileSelection,
                    onOpenFile = { fileIndex ->
                        openFile(context, torrent.files, fileIndex)
                    },
                    onSetFilePriority = onSetFilePriority,
                    onSelectAll = onSelectAllFiles,
                    onSelectNone = onSelectNoFiles,
                    onApplyChanges = onApplyFileChanges,
                    onCancelChanges = onCancelFileChanges
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
// Helper Functions
// =============================================================================

/**
 * Open a file using the system's file handler (open with... dialog).
 */
private fun openFile(
    context: android.content.Context,
    files: List<TorrentFileUi>,
    fileIndex: Int
) {
    val file = files.find { it.index == fileIndex } ?: return

    // Check if file is complete enough to open
    if (file.progress < 0.999) {
        Toast.makeText(
            context,
            "File is not fully downloaded yet",
            Toast.LENGTH_SHORT
        ).show()
        return
    }

    // TODO: Get actual download directory from engine/settings
    // For now, use a placeholder path
    val downloadDir = context.getExternalFilesDir(null)
    val filePath = File(downloadDir, file.path)

    if (!filePath.exists()) {
        Toast.makeText(
            context,
            "File not found",
            Toast.LENGTH_SHORT
        ).show()
        return
    }

    try {
        // Use FileProvider for secure file sharing
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            filePath
        )

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, getMimeType(file.name))
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        // Create chooser for "Open with..." dialog
        val chooser = Intent.createChooser(intent, "Open with")
        context.startActivity(chooser)
    } catch (e: Exception) {
        Toast.makeText(
            context,
            "Could not open file: ${e.message}",
            Toast.LENGTH_SHORT
        ).show()
    }
}

/**
 * Get MIME type based on file extension.
 */
private fun getMimeType(fileName: String): String {
    val extension = fileName.substringAfterLast('.', "").lowercase()
    return when (extension) {
        // Video
        "mp4" -> "video/mp4"
        "mkv" -> "video/x-matroska"
        "avi" -> "video/x-msvideo"
        "mov" -> "video/quicktime"
        "wmv" -> "video/x-ms-wmv"
        "flv" -> "video/x-flv"
        "webm" -> "video/webm"
        "m4v" -> "video/x-m4v"
        // Audio
        "mp3" -> "audio/mpeg"
        "flac" -> "audio/flac"
        "wav" -> "audio/wav"
        "aac" -> "audio/aac"
        "ogg" -> "audio/ogg"
        "m4a" -> "audio/mp4"
        "wma" -> "audio/x-ms-wma"
        // Images
        "jpg", "jpeg" -> "image/jpeg"
        "png" -> "image/png"
        "gif" -> "image/gif"
        "bmp" -> "image/bmp"
        "webp" -> "image/webp"
        "svg" -> "image/svg+xml"
        // Documents
        "pdf" -> "application/pdf"
        "doc" -> "application/msword"
        "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        "txt" -> "text/plain"
        "rtf" -> "application/rtf"
        // Archives
        "zip" -> "application/zip"
        "rar" -> "application/x-rar-compressed"
        "7z" -> "application/x-7z-compressed"
        "tar" -> "application/x-tar"
        "gz" -> "application/gzip"
        // Default
        else -> "*/*"
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
