@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.DiskViewState
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.SwarmViewState
import org.rstorrent.bootstrap.TrackerCatalogViewState
import org.rstorrent.session.uniffi.PeerView

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
internal fun CatalogPager(
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
internal fun ProductLoading(label: String) {
    Column(Modifier.fillMaxWidth().padding(24.dp)) {
        Text(label, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(4.dp))
        Text(stringResource(R.string.state_loading), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
