@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.DiskViewState
import org.rstorrent.bootstrap.FileCatalogViewState
import org.rstorrent.bootstrap.AndroidMediaPlaybackPolicy
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.SwarmViewState
import org.rstorrent.bootstrap.TrackerCatalogViewState
import org.rstorrent.session.uniffi.FilePriority
import org.rstorrent.session.uniffi.FileSelectionView
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.PeerView

@Composable
internal fun FilesScreen(
    catalog: FileCatalogViewState?,
    archived: Boolean = false,
    onSetPriority: (FileView, FilePriority) -> Unit,
    onDownloadNow: (FileView) -> Unit,
    onPlay: (FileView) -> Unit,
    onOpen: (FileView) -> Unit,
    mediaLaunchPending: Boolean,
    onPage: (UInt) -> Unit,
) {
    if (catalog == null) {
        ProductLoading(stringResource(R.string.file_catalog_title))
        return
    }
    val files = catalog.files.values.filterNot(FileView::padding).sortedBy(FileView::fileIndex)
    LazyColumn(Modifier.fillMaxSize()) {
        item("summary") {
            ListItem(
                headlineContent = {
                    Text(pluralStringResource(R.plurals.file_count, files.size, files.size))
                },
                supportingContent = {
                    Text(
                        stringResource(
                            R.string.catalog_showing,
                            catalog.state.name.lowercase(),
                            (catalog.page.offset + files.size.toUInt()).toLong(),
                            catalog.page.total.toLong(),
                        ),
                    )
                },
            )
            if (archived) {
                Text(
                    stringResource(R.string.file_restore_to_download),
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider()
            CatalogPager(catalog.page, onPage)
        }
        items(files, key = FileView::fileId) { file ->
            val wanted = file.selection != FileSelectionView.SKIPPED
            var priorityMenuExpanded by remember(file.fileId) { mutableStateOf(false) }
            val length = file.lengthBytes.toULongOrNull() ?: 0UL
            val done = file.verifiedBytes.toULongOrNull() ?: 0UL
            val complete = length > 0UL && done >= length
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp)) {
                Row(Modifier.fillMaxWidth()) {
                    Box {
                        OutlinedButton(
                            onClick = { priorityMenuExpanded = true },
                            enabled = file.selection != null,
                        ) {
                            Text(
                                stringResource(
                                    when (file.selection) {
                                        FileSelectionView.HIGH -> R.string.priority_high
                                        FileSelectionView.SKIPPED -> R.string.priority_skip
                                        else -> R.string.priority_normal
                                    },
                                ),
                            )
                        }
                        DropdownMenu(
                            expanded = priorityMenuExpanded,
                            onDismissRequest = { priorityMenuExpanded = false },
                        ) {
                            listOf(
                                R.string.priority_high to FilePriority.HIGH,
                                R.string.priority_normal to FilePriority.NORMAL,
                                R.string.priority_skip to FilePriority.SKIP,
                            ).forEach { (label, priority) ->
                                DropdownMenuItem(
                                    text = { Text(stringResource(label)) },
                                    onClick = {
                                        priorityMenuExpanded = false
                                        onSetPriority(file, priority)
                                    },
                                )
                            }
                        }
                    }
                    Column(Modifier.weight(1f).padding(top = 8.dp)) {
                        Text(
                            file.path.joinToString("/"),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            "${formatBytes(file.verifiedBytes)} / ${formatBytes(file.lengthBytes)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                LinearProgressIndicator(
                    progress = { if (length == 0UL) 0f else (done.toDouble() / length.toDouble()).toFloat() },
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    horizontalArrangement = Arrangement.End,
                ) {
                    OutlinedButton(onClick = { onDownloadNow(file) }, enabled = wanted && !complete && !archived) {
                        Text(stringResource(R.string.action_download_now))
                    }
                    if (AndroidMediaPlaybackPolicy.isRecognizedVideo(file.path)) {
                        Spacer(Modifier.padding(4.dp))
                        Button(
                            onClick = { onPlay(file) },
                            enabled =
                                AndroidMediaPlaybackPolicy.isPlayActionEnabled(
                                    file,
                                    mediaLaunchPending,
                                ),
                            modifier = Modifier.testTag("play-${file.fileId}"),
                        ) {
                            Text(stringResource(R.string.action_play))
                        }
                    }
                    Spacer(Modifier.padding(4.dp))
                    OutlinedButton(
                        onClick = { onOpen(file) },
                        enabled = complete,
                        modifier = Modifier.testTag("open-${file.fileId}"),
                    ) {
                        Text(stringResource(R.string.action_open))
                    }
                }
            }
            HorizontalDivider()
        }
    }
}

@Composable
internal fun TrackersScreen(
    catalog: TrackerCatalogViewState?,
    onPage: (UInt) -> Unit,
) {
    if (catalog == null) {
        ProductLoading(stringResource(R.string.tracker_catalog_title))
        return
    }
    val trackers = catalog.trackers.values.sortedWith(compareBy({ it.tier }, { it.url }))
    LazyColumn(Modifier.fillMaxSize()) {
        item("summary") {
            ListItem(
                headlineContent = {
                    Text(
                        pluralStringResource(
                            R.plurals.tracker_count,
                            trackers.size,
                            trackers.size,
                        ),
                    )
                },
                supportingContent = { Text(catalog.state.name.lowercase()) },
            )
            HorizontalDivider()
            CatalogPager(catalog.page, onPage)
        }
        items(trackers, key = { it.trackerId }) { tracker ->
            ListItem(
                headlineContent = {
                    Text(tracker.url, maxLines = 2, overflow = TextOverflow.Ellipsis)
                },
                supportingContent = {
                    Column {
                        Text(
                            stringResource(
                                R.string.tracker_summary,
                                tracker.status.name.lowercase(),
                                tracker.transport.name.lowercase(),
                                tracker.tier.toInt(),
                            ),
                        )
                        Text(
                            tracker.lastError
                                ?: stringResource(
                                    R.string.tracker_attempts,
                                    (tracker.lastPeerCount ?: 0U).toLong(),
                                    tracker.totalAttempts.toLong(),
                                ),
                            color =
                                if (tracker.lastError == null) {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                } else {
                                    MaterialTheme.colorScheme.error
                                },
                        )
                    }
                },
            )
            HorizontalDivider()
        }
    }
}

@Composable
private fun CatalogPager(
    page: org.rstorrent.session.uniffi.CatalogPageView,
    onPage: (UInt) -> Unit,
) {
    if (page.offset == 0U && page.nextOffset == null) return
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        OutlinedButton(
            onClick = { onPage(page.offset - minOf(page.offset, page.limit)) },
            enabled = page.offset > 0U,
        ) { Text(stringResource(R.string.action_previous)) }
        Text(
            stringResource(
                R.string.catalog_page_range,
                (page.offset + 1U).toLong(),
                minOf(page.offset + page.limit, page.total).toLong(),
            ),
            modifier = Modifier.padding(top = 12.dp),
        )
        OutlinedButton(
            onClick = { page.nextOffset?.let(onPage) },
            enabled = page.nextOffset != null,
        ) { Text(stringResource(R.string.action_next)) }
    }
    HorizontalDivider()
}

@Composable
internal fun PeersScreen(
    peers: Collection<PeerView>?,
    swarm: SwarmViewState?,
) {
    if (peers == null && swarm == null) {
        ProductLoading(stringResource(R.string.peer_catalog_title))
        return
    }
    val rows = peers.orEmpty().sortedBy(PeerView::remoteEndpoint)
    LazyColumn(Modifier.fillMaxSize()) {
        item("summary") {
            ListItem(
                headlineContent = {
                    Text(
                        pluralStringResource(
                            R.plurals.connected_peer_count,
                            rows.size,
                            rows.size,
                        ),
                    )
                },
                supportingContent = {
                    Text(
                        swarm?.let {
                            stringResource(
                                R.string.swarm_summary,
                                it.peers.size,
                                it.state.name.lowercase(),
                                it.maximumRecords.toLong(),
                            )
                        } ?: stringResource(R.string.swarm_loading),
                    )
                },
            )
            HorizontalDivider()
        }
        // The summary already reads "0 connected peers" when the list is empty.
        items(rows, key = PeerView::connectionId) { peer -> PeerRow(peer) }
    }
}

@Composable
private fun PeerRow(peer: PeerView) {
    ListItem(
        headlineContent = {
            Text(peer.clientName ?: peer.remoteEndpoint, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        supportingContent = {
            Column {
                Text(
                    stringResource(
                        R.string.peer_summary,
                        peer.remoteEndpoint,
                        peer.direction.name.lowercase(),
                        peer.lifecycle.name.lowercase(),
                    ),
                    fontFamily = FontFamily.Monospace,
                )
                Text(
                    stringResource(
                        R.string.peer_transfer_summary,
                        formatRate(peer.payloadDownloadRateBytes),
                        formatRate(peer.payloadUploadRateBytes),
                        (peer.pendingRequests ?: 0U).toLong(),
                    ),
                )
            }
        },
    )
    HorizontalDivider()
}

@Composable
internal fun DiskSummary(disk: DiskViewState?, torrentId: String) {
    val rows = disk?.pieces?.values?.filter { it.torrentId == torrentId }.orEmpty()
    Card(Modifier.fillMaxWidth().padding(top = 16.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(stringResource(R.string.storage_pipeline), fontWeight = FontWeight.SemiBold)
            if (disk == null) {
                Text(stringResource(R.string.state_loading))
            } else {
                Text(
                    stringResource(
                        R.string.storage_pipeline_summary,
                        disk.pipeline.pressure.name.lowercase(),
                        formatBytes(disk.pipeline.residentBytes),
                        rows.size,
                    ),
                )
                Text(
                    stringResource(
                        R.string.storage_pipeline_rates,
                        formatRate(disk.pipeline.writeRateBytes),
                        formatRate(disk.pipeline.hashRateBytes),
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ProductLoading(label: String) {
    Column(Modifier.fillMaxWidth().padding(24.dp)) {
        Text(label, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.state_loading), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
