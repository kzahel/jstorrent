package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlin.math.abs
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import org.rstorrent.bootstrap.FileCatalogViewState
import org.rstorrent.bootstrap.PendingFileSelectionDraft
import org.rstorrent.bootstrap.R
import org.rstorrent.session.uniffi.FileCatalogState
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.TorrentView

private const val MAX_CACHED_SELECTION_PAGES = 3

private data class CachedSelectionPage(
    val offset: UInt,
    val nextOffset: UInt?,
    val rows: List<FileView>,
)

@Composable
internal fun PendingFileSelectionDialog(
    torrent: TorrentView,
    files: FileCatalogViewState?,
    rootLabel: String,
    rootReady: Boolean,
    queuedCount: Int,
    error: String?,
    onPage: (UInt) -> Unit,
    onRepairRoot: () -> Unit,
    onConfirm: (PendingFileSelectionDraft, Boolean) -> Unit,
    onCancel: () -> Unit,
    onDownloadAll: () -> Unit,
) {
    var draft by remember(torrent.torrentId) { mutableStateOf(PendingFileSelectionDraft()) }
    var disableFuture by remember(torrent.torrentId) { mutableStateOf(false) }
    var draftError by remember(torrent.torrentId) { mutableStateOf<String?>(null) }
    var pages by
        remember(torrent.torrentId) {
            mutableStateOf<Map<UInt, CachedSelectionPage>>(emptyMap())
        }
    var lastPageRequest by remember(torrent.torrentId) { mutableStateOf<UInt?>(null) }
    val listState = rememberLazyListState()

    LaunchedEffect(torrent.torrentId, files) {
        val page = files ?: return@LaunchedEffect
        val currentOffset = page.page.offset
        val updated =
            pages +
                (
                    currentOffset to
                        CachedSelectionPage(
                            currentOffset,
                            page.page.nextOffset,
                            page.files.values.filterNot(FileView::padding).sortedBy(FileView::fileIndex),
                        )
                )
        val retained =
            updated.keys
                .sortedBy { abs(it.toLong() - currentOffset.toLong()) }
                .take(MAX_CACHED_SELECTION_PAGES)
                .toSet()
        pages = updated.filterKeys(retained::contains)
        lastPageRequest = null
    }

    val rows =
        pages.values
            .sortedBy(CachedSelectionPage::offset)
            .flatMap(CachedSelectionPage::rows)
    LaunchedEffect(listState, rows, pages) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo }
            .map { visible -> visible.firstOrNull()?.index to visible.lastOrNull()?.index }
            .distinctUntilChanged()
            .collect { (first, last) ->
                if (first == null || last == null || rows.isEmpty()) return@collect
                val minimum = pages.keys.minOrNull() ?: return@collect
                val maximum = pages.keys.maxOrNull() ?: return@collect
                val requested =
                    when {
                        last >= rows.lastIndex - 4 -> pages[maximum]?.nextOffset
                        first <= 4 && minimum > 0U -> minimum.saturatingSub(1_024U)
                        else -> null
                    }
                if (requested != null && requested != lastPageRequest) {
                    lastPageRequest = requested
                    onPage(requested)
                }
            }
    }

    val metadataReady =
        torrent.fileCatalogId != null &&
            (files?.state == FileCatalogState.AVAILABLE || pages.isNotEmpty())
    val summary = draft.summary(torrent)
    val overrideLimitError = stringResource(R.string.file_selection_override_limit)
    fun toggleFile(file: FileView) {
        val next = draft.toggle(file)
        draftError = if (next == null) overrideLimitError else null
        if (next != null) draft = next
    }
    Dialog(
        onDismissRequest = {},
        properties =
            DialogProperties(
                dismissOnBackPress = false,
                dismissOnClickOutside = false,
                usePlatformDefaultWidth = false,
            ),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            shape = MaterialTheme.shapes.extraLarge,
            tonalElevation = 6.dp,
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    torrentPresentationName(torrent),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    stringResource(R.string.file_selection_explanation),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    if (queuedCount > 0) {
                        pluralStringResource(
                            R.plurals.file_selection_folder_pending,
                            queuedCount,
                            rootLabel,
                            queuedCount,
                        )
                    } else {
                        stringResource(R.string.file_selection_folder, rootLabel)
                    },
                    style = MaterialTheme.typography.labelMedium,
                )
                if (!metadataReady) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CircularProgressIndicator()
                        Text(stringResource(R.string.file_selection_fetching))
                        Text(
                            stringResource(R.string.file_selection_download_blocked),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { draft = draft.selectAll(); draftError = null }) {
                            Text(stringResource(R.string.action_all))
                        }
                        TextButton(onClick = { draft = draft.selectNone(); draftError = null }) {
                            Text(stringResource(R.string.action_none))
                        }
                        Text(
                            stringResource(
                                R.string.file_selection_summary,
                                summary.count,
                                torrent.selectableFileCount.toLong(),
                                formatBytes(summary.bytes.toString()),
                            ),
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxWidth().weight(1f, fill = false).heightIn(max = 420.dp),
                    ) {
                        items(rows.size, key = { rows[it].fileId }) { index ->
                            val file = rows[index]
                            val checked = draft.selected(file)
                            Row(
                                modifier =
                                    Modifier.fillMaxWidth().clickable {
                                        toggleFile(file)
                                    }.padding(vertical = 7.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(
                                    checked = checked,
                                    onCheckedChange = { toggleFile(file) },
                                )
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        file.path.joinToString("/"),
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        formatBytes(file.lengthBytes),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
                if (metadataReady) {
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable {
                            disableFuture = !disableFuture
                        },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = disableFuture,
                            onCheckedChange = { disableFuture = it },
                        )
                        Text(stringResource(R.string.file_selection_disable_future))
                    }
                    TextButton(
                        onClick = { onConfirm(draft.selectAll(), disableFuture) },
                        enabled = rootReady,
                    ) {
                        Text(stringResource(R.string.action_download_all))
                    }
                }
                (draftError ?: error)?.let {
                    Text(it, color = MaterialTheme.colorScheme.error)
                }
                if (!rootReady) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            stringResource(R.string.file_selection_repair_before_confirm),
                            modifier = Modifier.weight(1f),
                            color = MaterialTheme.colorScheme.error,
                        )
                        TextButton(onClick = onRepairRoot) { Text(stringResource(R.string.action_repair_folder)) }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                ) {
                    OutlinedButton(onClick = onCancel) { Text(stringResource(R.string.action_cancel)) }
                    if (!metadataReady) {
                        Button(onClick = onDownloadAll, enabled = rootReady) {
                            Text(stringResource(R.string.action_download_all))
                        }
                    } else {
                        Button(
                            onClick = { onConfirm(draft, disableFuture) },
                            enabled = rootReady,
                        ) {
                            Text(
                                stringResource(
                                    if (summary.count == 0L) R.string.action_add else R.string.action_download,
                                ),
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun UInt.saturatingSub(other: UInt): UInt =
    if (this > other) this - other else 0U
