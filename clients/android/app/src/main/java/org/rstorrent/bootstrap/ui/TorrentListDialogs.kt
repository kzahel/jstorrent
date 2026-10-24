package org.rstorrent.bootstrap.ui

import android.content.res.Resources
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.TorrentAddSummary
import org.rstorrent.bootstrap.TorrentAddSummaryText
import org.rstorrent.bootstrap.TorrentListActivity
import org.rstorrent.bootstrap.TorrentListFailure
import org.rstorrent.bootstrap.TorrentListNotice
import org.rstorrent.bootstrap.torrentAddSummaryLines

/** Catalog text for an add summary. */
private class ResourceTorrentAddSummaryText(
    private val resources: Resources,
) : TorrentAddSummaryText {
    override fun added(count: Int): String =
        resources.getQuantityString(R.plurals.add_summary_added, count, count)

    override fun alreadyPresent(count: Int): String =
        resources.getQuantityString(R.plurals.add_summary_already_present, count, count)

    override fun failedHeader(count: Int): String =
        resources.getQuantityString(R.plurals.add_summary_failed, count, count)

    override fun failure(
        name: String,
        reason: String,
    ): String = resources.getString(R.string.add_summary_failure_line, name, reason)

    override fun moreFailures(count: Int): String =
        resources.getQuantityString(R.plurals.add_summary_more_failures, count, count)
}

/** The result of an import or of adding several torrents at once. */
@Composable
internal fun TorrentAddSummaryDialog(
    summary: TorrentAddSummary,
    onDismiss: () -> Unit,
) {
    val resources = LocalContext.current.resources
    val lines =
        remember(summary, resources) {
            torrentAddSummaryLines(summary, ResourceTorrentAddSummaryText(resources))
        }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_summary_title)) },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                Text(lines.headline)
                lines.failureHeader?.let { Text(it) }
                lines.failures.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                lines.moreFailures?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_done)) }
        },
    )
}

/** A one-line message for an export result or a failed torrent list task. */
@Composable
internal fun torrentListNoticeText(notice: TorrentListNotice): String? =
    when (notice) {
        is TorrentListNotice.Exported -> stringResource(R.string.torrent_list_exported)
        is TorrentListNotice.Summary -> null
        is TorrentListNotice.Failed ->
            when (notice.failure) {
                TorrentListFailure.NO_DOWNLOAD_FOLDER ->
                    stringResource(R.string.torrent_list_import_needs_folder)
                TorrentListFailure.BUSY -> stringResource(R.string.torrent_list_busy)
                TorrentListFailure.TOO_LARGE -> stringResource(R.string.torrent_list_import_too_large)
                TorrentListFailure.EMPTY -> stringResource(R.string.torrent_list_import_empty)
                TorrentListFailure.READ_FAILED -> stringResource(R.string.torrent_list_import_read_failed)
                TorrentListFailure.WRITE_FAILED -> stringResource(R.string.torrent_list_export_write_failed)
                TorrentListFailure.ENGINE -> {
                    val detail = notice.detail ?: stringResource(R.string.error_operation_failed)
                    if (notice.export) {
                        stringResource(R.string.torrent_list_export_failed, detail)
                    } else {
                        stringResource(R.string.torrent_list_import_failed, detail)
                    }
                }
            }
    }

@Composable
internal fun torrentListActivityText(activity: TorrentListActivity): String =
    stringResource(
        when (activity) {
            TorrentListActivity.EXPORTING -> R.string.torrent_list_exporting
            TorrentListActivity.IMPORTING -> R.string.torrent_list_importing
            TorrentListActivity.ADDING -> R.string.torrent_list_adding
        },
    )
