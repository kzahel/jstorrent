package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import org.rstorrent.bootstrap.CatalogRecoveryAction
import org.rstorrent.bootstrap.CatalogRecoveryExportState
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.catalogRecoveryActions
import org.rstorrent.bootstrap.catalogRecoveryCopy
import org.rstorrent.session.uniffi.CatalogRecoveryStatus

/**
 * Tactical 369: shown instead of the library when the torrent list did not
 * open. It says the data is unchanged and never offers to discard it.
 */
@Composable
fun CatalogRecoveryScreen(
    status: CatalogRecoveryStatus,
    exportState: CatalogRecoveryExportState,
    onCheckForUpdates: () -> Unit,
    onExportTorrentList: () -> Unit,
    onCopyDetails: () -> Unit,
    onReportProblem: () -> Unit,
    onClose: () -> Unit,
) {
    val copy = catalogRecoveryCopy(status.reason)
    val actions = catalogRecoveryActions(status)
    var detailsVisible by rememberSaveable { mutableStateOf(false) }
    var detailsCopied by rememberSaveable { mutableStateOf(false) }
    Scaffold(modifier = Modifier.testTag("catalog-recovery")) { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(
                    Icons.Outlined.ErrorOutline,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(40.dp),
                )
                Text(stringResource(copy.title), style = MaterialTheme.typography.headlineSmall)
                Text(
                    stringResource(copy.body),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                actions.forEachIndexed { index, action ->
                    val label =
                        when (action) {
                            CatalogRecoveryAction.CHECK_FOR_UPDATES -> R.string.catalog_recovery_check_updates
                            CatalogRecoveryAction.EXPORT_TORRENT_LIST -> R.string.torrent_list_export
                            CatalogRecoveryAction.COPY_DETAILS -> R.string.catalog_recovery_copy_details
                            CatalogRecoveryAction.REPORT_PROBLEM -> R.string.catalog_recovery_report_problem
                            CatalogRecoveryAction.CLOSE -> R.string.action_close
                        }
                    val onClick =
                        when (action) {
                            CatalogRecoveryAction.CHECK_FOR_UPDATES -> onCheckForUpdates
                            CatalogRecoveryAction.EXPORT_TORRENT_LIST -> onExportTorrentList
                            CatalogRecoveryAction.COPY_DETAILS -> {
                                {
                                    onCopyDetails()
                                    detailsCopied = true
                                }
                            }
                            CatalogRecoveryAction.REPORT_PROBLEM -> onReportProblem
                            CatalogRecoveryAction.CLOSE -> onClose
                        }
                    val enabled =
                        action != CatalogRecoveryAction.EXPORT_TORRENT_LIST ||
                            exportState != CatalogRecoveryExportState.EXPORTING
                    val modifier = Modifier.fillMaxWidth().testTag("catalog-recovery-${action.name}")
                    if (index == 0) {
                        Button(onClick = onClick, enabled = enabled, modifier = modifier) {
                            Text(stringResource(label))
                        }
                    } else {
                        OutlinedButton(onClick = onClick, enabled = enabled, modifier = modifier) {
                            Text(stringResource(label))
                        }
                    }
                }
                exportStatusText(exportState)?.let { message ->
                    Text(
                        stringResource(message),
                        style = MaterialTheme.typography.bodyMedium,
                        color =
                            if (
                                exportState == CatalogRecoveryExportState.READ_FAILED ||
                                exportState == CatalogRecoveryExportState.WRITE_FAILED
                            ) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    )
                }
                if (detailsCopied) {
                    Text(
                        stringResource(R.string.catalog_recovery_details_copied),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(onClick = { detailsVisible = !detailsVisible }) {
                    Text(
                        stringResource(
                            if (detailsVisible) {
                                R.string.catalog_recovery_hide_details
                            } else {
                                R.string.catalog_recovery_show_details
                            },
                        ),
                    )
                }
                if (detailsVisible) {
                    SelectionContainer {
                        Text(
                            status.details,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.testTag("catalog-recovery-details"),
                        )
                    }
                }
            }
        }
    }
}

private fun exportStatusText(state: CatalogRecoveryExportState): Int? =
    when (state) {
        CatalogRecoveryExportState.IDLE -> null
        CatalogRecoveryExportState.EXPORTING -> R.string.torrent_list_exporting
        CatalogRecoveryExportState.SAVED -> R.string.catalog_recovery_exported
        CatalogRecoveryExportState.READ_FAILED -> R.string.catalog_recovery_export_failed
        CatalogRecoveryExportState.WRITE_FAILED -> R.string.torrent_list_export_write_failed
    }
