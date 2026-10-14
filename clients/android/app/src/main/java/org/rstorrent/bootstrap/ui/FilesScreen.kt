@file:OptIn(
    androidx.compose.foundation.ExperimentalFoundationApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.Block
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.FolderZip
import androidx.compose.material.icons.outlined.HorizontalRule
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.KeyboardDoubleArrowUp
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Movie
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.AndroidMediaPlaybackPolicy
import org.rstorrent.bootstrap.FileCatalogViewState
import org.rstorrent.bootstrap.MAX_SHARED_FILES
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.FileCatalogState
import org.rstorrent.session.uniffi.FilePriority
import org.rstorrent.session.uniffi.FileSelectionView
import org.rstorrent.session.uniffi.FileView

private val filePriorityChoices =
    listOf(
        Triple(FilePriority.SKIP, FileSelectionView.SKIPPED, R.string.priority_skip),
        Triple(FilePriority.NORMAL, FileSelectionView.NORMAL, R.string.priority_normal),
        Triple(FilePriority.HIGH, FileSelectionView.HIGH, R.string.priority_high),
    )

private val audioExtensions = setOf("aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma")
private val imageExtensions = setOf("bmp", "gif", "jpeg", "jpg", "png", "svg", "webp")
private val textExtensions = setOf("ass", "md", "nfo", "pdf", "srt", "sub", "txt", "vtt")
private val archiveExtensions = setOf("7z", "bz2", "gz", "iso", "rar", "tar", "xz", "zip")

/** Non-padding files of the presented catalog page, in torrent order. */
internal fun presentedFiles(catalog: FileCatalogViewState?): List<FileView> =
    catalog?.files?.values?.filterNot(FileView::padding)?.sortedBy(FileView::fileIndex).orEmpty()

/**
 * The Files tab. The torrent detail screen owns [selection] so that, as in the
 * Library, its selection bars can replace the screen's app bar.
 */
@Composable
internal fun FilesScreen(
    catalog: FileCatalogViewState?,
    archived: Boolean = false,
    selection: Set<String> = emptySet(),
    onSelectionChange: (Set<String>) -> Unit = {},
    onSetPriority: (List<FileView>, FilePriority) -> Unit,
    onDownloadNow: (List<FileView>) -> Unit,
    onShare: (List<FileView>) -> Unit = {},
    onPlay: (FileView) -> Unit,
    onOpen: (FileView) -> Unit,
    mediaLaunchPending: Boolean,
    onPage: (UInt) -> Unit,
) {
    if (catalog == null) {
        ProductLoading(stringResource(R.string.file_catalog_title))
        return
    }
    val files = remember(catalog.files) { presentedFiles(catalog) }
    var sheetFileId by rememberSaveable { mutableStateOf<String?>(null) }
    val selectionMode = files.any { it.fileId in selection }

    LazyColumn(Modifier.fillMaxSize()) {
        item("summary") {
            FilesSummary(catalog, files)
            if (archived) {
                Text(
                    stringResource(R.string.file_restore_to_download),
                    modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 12.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider()
            // Selection is scoped to the presented catalog page.
            CatalogPager(catalog.page) {
                onSelectionChange(emptySet())
                onPage(it)
            }
        }
        items(files, key = FileView::fileId) { file ->
            FileRow(
                file = file,
                selected = file.fileId in selection,
                selectionMode = selectionMode,
                mediaLaunchPending = mediaLaunchPending,
                onClick = {
                    if (selectionMode) {
                        onSelectionChange(selection.toggleFile(file.fileId))
                    } else {
                        sheetFileId = file.fileId
                    }
                },
                onLongClick = { onSelectionChange(selection.toggleFile(file.fileId)) },
                onPlay = { onPlay(file) },
                onOpen = { onOpen(file) },
            )
            HorizontalDivider()
        }
    }

    sheetFileId?.let(catalog.files::get)?.takeIf { !selectionMode }?.let { file ->
        FileActionsSheet(
            file = file,
            archived = archived,
            mediaLaunchPending = mediaLaunchPending,
            onDismiss = { sheetFileId = null },
            onSetPriority = { onSetPriority(listOf(file), it) },
            onDownloadNow = {
                sheetFileId = null
                onDownloadNow(listOf(file))
            },
            shareEnabled = catalog.state == FileCatalogState.AVAILABLE,
            onShare = {
                sheetFileId = null
                onShare(listOf(file))
            },
            onPlay = {
                sheetFileId = null
                onPlay(file)
            },
            onOpen = {
                sheetFileId = null
                onOpen(file)
            },
        )
    }
}

@Composable
private fun FilesSummary(
    catalog: FileCatalogViewState,
    files: List<FileView>,
) {
    val paged = catalog.page.offset != 0U || catalog.page.nextOffset != null
    val count = if (paged) catalog.page.total.toInt() else files.size
    val skipped = files.count { it.selection == FileSelectionView.SKIPPED }
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            pluralStringResource(R.plurals.file_count, count, count),
            style = MaterialTheme.typography.titleSmall,
        )
        val detail =
            when (catalog.state) {
                FileCatalogState.METADATA_PENDING -> stringResource(R.string.files_metadata_pending)
                FileCatalogState.TORRENT_MISSING -> stringResource(R.string.torrent_unavailable)
                FileCatalogState.AVAILABLE ->
                    if (skipped > 0) {
                        pluralStringResource(R.plurals.file_skipped_count, skipped, skipped)
                    } else {
                        null
                    }
            }
        detail?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun FileRow(
    file: FileView,
    selected: Boolean,
    selectionMode: Boolean,
    mediaLaunchPending: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    onPlay: () -> Unit,
    onOpen: () -> Unit,
) {
    val skipped = file.selection == FileSelectionView.SKIPPED
    val complete = fileComplete(file)
    val video = AndroidMediaPlaybackPolicy.isRecognizedVideo(file.path)
    Row(
        modifier =
            Modifier.fillMaxWidth()
                .background(
                    if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                )
                .combinedClickable(onClick = onClick, onLongClick = onLongClick)
                .testTag("file-${file.fileId}")
                .padding(start = 8.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
            Icon(
                fileTypeIcon(file.path),
                contentDescription = null,
                modifier = Modifier.alpha(if (skipped) 0.5f else 1f),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
            Text(
                file.path.lastOrNull().orEmpty(),
                modifier = Modifier.alpha(if (skipped) 0.6f else 1f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                fontWeight = FontWeight.Medium,
            )
            if (file.path.size > 1) {
                Text(
                    file.path.dropLast(1).joinToString("/"),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            FileStatusLine(file)
            if (!complete && !skipped) {
                Spacer(Modifier.height(6.dp))
                LinearProgressIndicator(
                    progress = { fileProgress(file) },
                    modifier = Modifier.fillMaxWidth().height(4.dp).clip(CircleShape),
                )
            }
        }
        // The slot is reserved even when empty so names and progress bars align.
        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
            if (video) {
                IconButton(
                    onClick = onPlay,
                    enabled =
                        !selectionMode &&
                            AndroidMediaPlaybackPolicy.isPlayActionEnabled(file, mediaLaunchPending),
                    modifier = Modifier.testTag("play-${file.fileId}"),
                ) {
                    Icon(
                        Icons.Default.PlayArrow,
                        contentDescription = stringResource(R.string.action_play),
                    )
                }
            } else if (complete) {
                IconButton(
                    onClick = onOpen,
                    enabled = !selectionMode,
                    modifier = Modifier.testTag("open-${file.fileId}"),
                ) {
                    Icon(
                        Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = stringResource(R.string.action_open),
                    )
                }
            }
        }
        IconButton(
            onClick = onClick,
            enabled = !selectionMode,
            modifier = Modifier.testTag("more-${file.fileId}"),
        ) {
            Icon(
                Icons.Outlined.MoreVert,
                contentDescription = stringResource(R.string.a11y_file_actions),
            )
        }
    }
}

@Composable
private fun FileStatusLine(file: FileView) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val complete = fileComplete(file)
        // Priority no longer changes anything once a file is complete.
        when (file.selection.takeUnless { complete }) {
            FileSelectionView.HIGH ->
                Text(
                    stringResource(R.string.priority_high),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            FileSelectionView.SKIPPED ->
                Text(
                    stringResource(R.string.file_priority_skipped_label),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            else -> Unit
        }
        Text(
            if (complete || fileVerifiedBytes(file) == 0UL) {
                formatBytes(file.lengthBytes)
            } else {
                stringResource(
                    R.string.file_progress_status,
                    percentLabel(fileProgress(file)),
                    formatBytes(file.verifiedBytes),
                    formatBytes(file.lengthBytes),
                )
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun FileActionsSheet(
    file: FileView,
    archived: Boolean,
    mediaLaunchPending: Boolean,
    onDismiss: () -> Unit,
    onSetPriority: (FilePriority) -> Unit,
    onDownloadNow: () -> Unit,
    shareEnabled: Boolean,
    onShare: () -> Unit,
    onPlay: () -> Unit,
    onOpen: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
            Column(Modifier.padding(horizontal = 24.dp)) {
                Text(
                    file.path.lastOrNull().orEmpty(),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleMedium,
                )
                FileStatusLine(file)
                Spacer(Modifier.height(20.dp))
                Text(
                    stringResource(R.string.file_priority_title),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    filePriorityChoices.forEachIndexed { index, (priority, view, label) ->
                        SegmentedButton(
                            selected = file.selection == view,
                            onClick = { if (file.selection != view) onSetPriority(priority) },
                            shape =
                                SegmentedButtonDefaults.itemShape(index, filePriorityChoices.size),
                            enabled = file.selection != null,
                            modifier = Modifier.testTag("priority-${priority.name.lowercase()}"),
                        ) {
                            Text(stringResource(label), maxLines = 1)
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(
                        when (file.selection) {
                            FileSelectionView.HIGH -> R.string.file_priority_high_detail
                            FileSelectionView.SKIPPED -> R.string.file_priority_skip_detail
                            else -> R.string.file_priority_normal_detail
                        },
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(12.dp))
            HorizontalDivider()
            if (AndroidMediaPlaybackPolicy.isRecognizedVideo(file.path)) {
                FileSheetAction(
                    icon = Icons.Default.PlayArrow,
                    label = stringResource(R.string.action_play),
                    enabled =
                        AndroidMediaPlaybackPolicy.isPlayActionEnabled(file, mediaLaunchPending),
                    tag = "sheet-play-${file.fileId}",
                    onClick = onPlay,
                )
            }
            FileSheetAction(
                icon = Icons.AutoMirrored.Outlined.OpenInNew,
                label = stringResource(R.string.action_open),
                enabled = fileComplete(file),
                tag = "sheet-open-${file.fileId}",
                onClick = onOpen,
            )
            FileSheetAction(
                icon = Icons.Outlined.Download,
                label = stringResource(R.string.action_download_now),
                enabled = !archived && downloadNowEligible(file),
                tag = "sheet-download-${file.fileId}",
                onClick = onDownloadNow,
            )
            FileSheetAction(
                icon = Icons.Outlined.Share,
                label = stringResource(R.string.action_share_file),
                enabled = shareEnabled && !file.padding,
                tag = "sheet-share-${file.fileId}",
                onClick = onShare,
            )
        }
    }
}

@Composable
private fun FileSheetAction(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier.fillMaxWidth()
                .clickable(enabled = enabled, onClick = onClick)
                .testTag(tag)
                .alpha(if (enabled) 1f else 0.38f)
                .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(20.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}

/**
 * Labeled actions for the selected files, shaped like the Library selection
 * bar. Every action applies only to the selected files that allow it and is
 * disabled when none do; each is one bounded batch command.
 */
@Composable
internal fun FileSelectionBottomBar(
    selected: List<FileView>,
    archived: Boolean,
    onSetPriority: (List<FileView>, FilePriority) -> Unit,
    onDownloadNow: (List<FileView>) -> Unit,
    onShare: (List<FileView>) -> Unit,
) {
    val prioritizable = selected.filter { it.selection != null }
    // An archived torrent cannot start until it is restored.
    val downloadable = if (archived) emptyList() else selected.filter(::downloadNowEligible)
    BottomAppBar {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            filePriorityChoices.forEach { (priority, _, label) ->
                SelectionBarButton(
                    filePriorityIcon(priority),
                    stringResource(label),
                    enabled = prioritizable.isNotEmpty(),
                ) {
                    onSetPriority(prioritizable, priority)
                }
            }
            SelectionBarButton(
                Icons.Outlined.Download,
                stringResource(R.string.action_download_now),
                enabled = downloadable.isNotEmpty(),
            ) {
                onDownloadNow(downloadable)
            }
            // Share links name verified file indices, so a file list is enough.
            val shareable = selected.filterNot(FileView::padding)
            SelectionBarButton(
                Icons.Outlined.Share,
                stringResource(if (shareable.size == 1) R.string.action_share_file else R.string.action_share_files),
                enabled = shareable.isNotEmpty() && shareable.size <= MAX_SHARED_FILES,
            ) {
                onShare(shareable)
            }
        }
    }
}

private fun filePriorityIcon(priority: FilePriority): ImageVector =
    when (priority) {
        FilePriority.SKIP -> Icons.Outlined.Block
        FilePriority.NORMAL -> Icons.Outlined.HorizontalRule
        FilePriority.HIGH -> Icons.Outlined.KeyboardDoubleArrowUp
    }

private fun fileLengthBytes(file: FileView): ULong = file.lengthBytes.toULongOrNull() ?: 0UL

private fun fileVerifiedBytes(file: FileView): ULong = file.verifiedBytes.toULongOrNull() ?: 0UL

private fun fileComplete(file: FileView): Boolean {
    val length = fileLengthBytes(file)
    return length > 0UL && fileVerifiedBytes(file) >= length
}

private fun fileProgress(file: FileView): Float {
    val length = fileLengthBytes(file)
    return if (length == 0UL) 0f else (fileVerifiedBytes(file).toDouble() / length.toDouble()).toFloat()
}

private fun downloadNowEligible(file: FileView): Boolean =
    file.selection != FileSelectionView.SKIPPED && !fileComplete(file)

private fun fileTypeIcon(path: List<String>): ImageVector {
    if (AndroidMediaPlaybackPolicy.isRecognizedVideo(path)) return Icons.Outlined.Movie
    return when (path.lastOrNull().orEmpty().substringAfterLast('.', "").lowercase()) {
        in audioExtensions -> Icons.Outlined.MusicNote
        in imageExtensions -> Icons.Outlined.Image
        in textExtensions -> Icons.Outlined.Description
        in archiveExtensions -> Icons.Outlined.FolderZip
        else -> Icons.AutoMirrored.Outlined.InsertDriveFile
    }
}

private fun Set<String>.toggleFile(value: String): Set<String> =
    if (value in this) this - value else this + value
