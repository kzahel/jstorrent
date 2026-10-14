@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.rstorrent.bootstrap.ui

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.BatterySaver
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.NetworkCheck
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Speed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarData
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.launch
import org.rstorrent.bootstrap.ProductEngineService
import org.rstorrent.bootstrap.ProductDataResetPhase
import org.rstorrent.bootstrap.ProductDataResetState
import org.rstorrent.bootstrap.BuildConfig
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.ProductNotificationNavigation
import org.rstorrent.bootstrap.ProductNotificationPreference
import org.rstorrent.bootstrap.ProductState
import org.rstorrent.bootstrap.ExternalIntakeNoticeKind
import org.rstorrent.bootstrap.ExternalIntakePhase
import org.rstorrent.bootstrap.ExternalIntakePresentation
import org.rstorrent.bootstrap.GlobalPresentation
import org.rstorrent.bootstrap.TorrentListNotice
import org.rstorrent.bootstrap.TorrentPresentation
import org.rstorrent.bootstrap.splitMagnetLinks
import org.rstorrent.bootstrap.clientSettingsPatch
import org.rstorrent.bootstrap.presentedClientSettings
import org.rstorrent.bootstrap.presentedTorrent
import org.rstorrent.bootstrap.seedStopLimits
import org.rstorrent.bootstrap.torrentSettingsPatch
import org.rstorrent.session.uniffi.DiagnosticEvent
import org.rstorrent.session.uniffi.DiagnosticCategory
import org.rstorrent.session.uniffi.DiagnosticProfile
import org.rstorrent.session.uniffi.DiagnosticSeverity
import org.rstorrent.session.uniffi.ClientSettings
import org.rstorrent.session.uniffi.ClientSettingsPatch
import org.rstorrent.session.uniffi.FilePriority
import org.rstorrent.session.uniffi.ProductFeedbackPreview
import org.rstorrent.session.uniffi.RemovalDataPolicy
import org.rstorrent.session.uniffi.SpeedRange
import org.rstorrent.session.uniffi.StorageRootAvailability
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentSettingsPatch
import org.rstorrent.session.uniffi.TorrentView

@Composable
fun ProductApp(
    service: ProductEngineService?,
    onSelectStorage: () -> Unit,
    onBrowseTorrent: (Boolean) -> Unit,
    notificationsGranted: Boolean,
    onRequestNotifications: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    onExportTorrentList: (() -> Unit)? = null,
    onImportTorrentList: (() -> Unit)? = null,
    onOpenFeedback: (Boolean, String) -> Unit = { _, _ -> },
    onPreviewFeedback: (suspend (Boolean) -> ProductFeedbackPreview?)? = null,
    onOpenPrivacy: () -> Unit = {},
    onConnectChromeExtension: (() -> Unit)? = null,
    onShutdown: () -> Unit = { service?.shutdownFromUi() },
    themeMode: ProductThemeMode,
    dynamicColor: Boolean,
    onThemeMode: (ProductThemeMode) -> Unit,
    onDynamicColor: (Boolean) -> Unit,
    stateOverride: ProductState? = null,
    notificationNavigation: ProductNotificationNavigation? = null,
    onNotificationNavigationConsumed: (Long) -> Unit = {},
    onUpdateNotificationPreference: ((ProductNotificationPreference, Boolean) -> Unit)? = null,
    onBackgroundDownloads: ((Boolean) -> Unit)? = null,
    onKeepSeedingInBackground: ((Boolean) -> Unit)? = null,
    onUnmeteredNetworksOnly: ((Boolean) -> Unit)? = null,
    onUpdateClientSettings: ((ClientSettingsPatch) -> Unit)? = null,
    onUpdateTorrentSettings: ((String, TorrentSettingsPatch) -> Unit)? = null,
    onRepairStorage: (String) -> Unit = {},
    onConfirmExternalIntake: ((Long) -> Unit)? = null,
    onChooseExternalFiles: ((Long) -> Unit)? = null,
    onRetryExternalIntake: ((Long) -> Unit)? = null,
    onCancelExternalIntake: ((Long) -> Unit)? = null,
    onResetClientSettings: (() -> Unit)? = null,
    onClearAllData: ((Boolean) -> Unit)? = null,
    onRetryDataReset: (() -> Unit)? = null,
    onFinishDataResetKeepingFiles: (() -> Unit)? = null,
    onDismissCompletedDataReset: (() -> Unit)? = null,
) {
    RstorrentTheme(mode = themeMode, dynamicColor = dynamicColor) {
        val state =
            if (stateOverride != null) {
                stateOverride
            } else if (service == null) {
                ProductState()
            } else {
                val collected by service.state.collectAsStateWithLifecycle()
                collected
            }
        val snackbar = remember { SnackbarHostState() }
        val notificationScope = rememberCoroutineScope()
        val lifecycleControlsEnabled =
            service != null ||
                onBackgroundDownloads != null ||
                onKeepSeedingInBackground != null
        val pendingSelections =
            state.torrents.values
                .filter(TorrentView::awaitingFileSelection)
                .sortedBy { it.pendingFileSelectionPosition ?: UInt.MAX_VALUE }
        val pendingSelection = pendingSelections.firstOrNull()
        val externalIntakeNotice =
            state.externalIntakeNotice?.let { externalIntakeNoticeText(it.kind) }
        DisposableEffect(service, pendingSelection?.torrentId) {
            if (pendingSelection == null) {
                service?.clearPendingFileSelection()
            } else {
                service?.presentPendingFileSelection(pendingSelection.torrentId, 0U)
            }
            onDispose { service?.clearPendingFileSelection() }
        }
        LaunchedEffect(state.externalIntakeNotice?.sequence, externalIntakeNotice) {
            externalIntakeNotice?.let { snackbar.showSnackbar(it) }
        }
        val resources = LocalContext.current.resources
        val restoreLabel = stringResource(R.string.action_restore)
        LaunchedEffect(state.alreadyPresentNotice?.sequence) {
            val notice = state.alreadyPresentNotice ?: return@LaunchedEffect
            // Consume the notice so a recreated UI does not show it again.
            service?.clearAlreadyPresentNotice(notice.sequence)
            notificationScope.launch {
                snackbar.currentSnackbarData?.dismiss()
                val archived = notice.archivedTorrentIds
                if (archived.isEmpty()) {
                    snackbar.showSnackbar(
                        resources.getQuantityString(
                            R.plurals.add_already_present_count,
                            notice.count,
                            notice.count,
                        ),
                    )
                    return@launch
                }
                val result =
                    snackbar.showSnackbar(
                        resources.getQuantityString(
                            R.plurals.add_already_archived_count,
                            archived.size,
                            archived.size,
                        ),
                        actionLabel = restoreLabel,
                        duration = SnackbarDuration.Long,
                    )
                if (result == SnackbarResult.ActionPerformed) {
                    service?.restoreArchive(
                        archived,
                        resume = if (notice.resumeOnRestore) archived else emptyList(),
                    )
                }
            }
        }
        val torrentListNotice = state.torrentListNotice
        val torrentListMessage = torrentListNotice?.let { torrentListNoticeText(it) }
        LaunchedEffect(torrentListNotice?.sequence, torrentListMessage) {
            // Summaries stay until their dialog is dismissed; messages show once.
            val message = torrentListMessage ?: return@LaunchedEffect
            torrentListNotice?.sequence?.let { service?.clearTorrentListNotice(it) }
            notificationScope.launch {
                snackbar.currentSnackbarData?.dismiss()
                snackbar.showSnackbar(
                    message,
                    withDismissAction = true,
                    duration = SnackbarDuration.Long,
                )
            }
        }
        LaunchedEffect(state.torrentCommandFailure?.sequence) {
            val failure = state.torrentCommandFailure ?: return@LaunchedEffect
            // Consume the failure so a recreated UI does not show it again.
            service?.clearTorrentCommandFailure(failure.sequence)
            notificationScope.launch {
                // Replace a shown failure instead of queueing behind it.
                snackbar.currentSnackbarData?.dismiss()
                snackbar.showSnackbar(
                    failure.detail,
                    withDismissAction = true,
                    duration = SnackbarDuration.Long,
                )
            }
        }
        Box(modifier = Modifier.fillMaxSize()) {
            Surface(modifier = Modifier.fillMaxSize()) {
                ProductNavHost(
                    onShutdown = onShutdown,
                    state = state,
                    service = service,
                    onSelectStorage = onSelectStorage,
                    onRepairStorage = onRepairStorage,
                    onBrowseTorrent = onBrowseTorrent,
                    notificationsGranted = notificationsGranted,
                    onRequestNotifications = onRequestNotifications,
                    onOpenNotificationSettings = onOpenNotificationSettings,
                    onExportTorrentList = onExportTorrentList,
                    onImportTorrentList = onImportTorrentList,
                    onOpenFeedback = onOpenFeedback,
                    onPreviewFeedback = onPreviewFeedback,
                    onOpenPrivacy = onOpenPrivacy,
                    onConnectChromeExtension = onConnectChromeExtension,
                    notificationNavigation = notificationNavigation,
                    onNotificationNavigationConsumed = onNotificationNavigationConsumed,
                    onNotificationNavigationFallback = { message ->
                        notificationScope.launch { snackbar.showSnackbar(message) }
                    },
                    onUndoableAction = { message, undoLabel, undo ->
                        notificationScope.launch {
                            snackbar.currentSnackbarData?.dismiss()
                            val result =
                                snackbar.showSnackbar(
                                    message,
                                    actionLabel = undoLabel,
                                    duration = SnackbarDuration.Long,
                                )
                            if (result == SnackbarResult.ActionPerformed) undo()
                        }
                    },
                    onUpdateNotificationPreference =
                        onUpdateNotificationPreference ?: { preference, enabled ->
                            service?.setNotificationPreference(preference, enabled)
                            Unit
                        },
                    onBackgroundDownloads =
                        onBackgroundDownloads ?: {
                            service?.setBackgroundDownloadsEnabled(it)
                            Unit
                        },
                    onKeepSeedingInBackground =
                        onKeepSeedingInBackground ?: {
                            service?.setKeepSeedingInBackground(it)
                            Unit
                        },
                    lifecycleControlsEnabled = lifecycleControlsEnabled,
                    onUnmeteredNetworksOnly =
                        onUnmeteredNetworksOnly ?: {
                            service?.setUnmeteredNetworksOnly(it)
                            Unit
                        },
                    themeMode = themeMode,
                    dynamicColor = dynamicColor,
                    onThemeMode = onThemeMode,
                    onDynamicColor = onDynamicColor,
                    onUpdateClientSettings =
                        onUpdateClientSettings ?: {
                            service?.updateClientSettings(it)
                            Unit
                        },
                    onUpdateTorrentSettings =
                        onUpdateTorrentSettings ?: { torrentId, patch ->
                            service?.updateTorrentSettings(torrentId, patch)
                            Unit
                        },
                    dataManagementEnabled =
                        service != null ||
                            onResetClientSettings != null ||
                            onClearAllData != null,
                    onResetClientSettings =
                        onResetClientSettings ?: {
                            service?.resetClientSettings()
                            Unit
                        },
                    onClearAllData =
                        onClearAllData ?: {
                            service?.clearAllData(it)
                            Unit
                        },
                )
            }
            SnackbarHost(
                hostState = snackbar,
                modifier = Modifier.align(Alignment.BottomCenter),
            ) { data -> SwipeableSnackbar(data) }
        }
        state.productSummary
            ?.takeIf { it.disclosureVersion < 1U }
            ?.let {
                var statisticsEnabled by rememberSaveable { mutableStateOf(true) }
                AlertDialog(
                    onDismissRequest = {},
                    title = { Text(stringResource(R.string.product_statistics_disclosure_title)) },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(stringResource(R.string.product_statistics_disclosure_detail))
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier =
                                    Modifier.fillMaxWidth()
                                        .clickable { statisticsEnabled = !statisticsEnabled }
                                        .semantics(mergeDescendants = true) { role = Role.Checkbox },
                            ) {
                                Checkbox(
                                    checked = statisticsEnabled,
                                    onCheckedChange = { statisticsEnabled = it },
                                )
                                Text(stringResource(R.string.product_statistics_first_use_include))
                            }
                        }
                    },
                    confirmButton = {
                        TextButton(
                            enabled = service != null,
                            onClick = {
                                service?.acknowledgeProductDisclosure(statisticsEnabled)
                            },
                        ) {
                            Text(stringResource(R.string.action_save_continue))
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = onOpenPrivacy) {
                            Text(stringResource(R.string.action_privacy_policy))
                        }
                    },
                )
            }
        state.externalIntake
            ?.takeIf { pendingSelection == null && state.dataReset == null }
            ?.let { intake ->
            ExternalTorrentIntakeDialog(
                intake = intake,
                storageRootReady = state.storageRootReady,
                repairRootId = state.storage?.defaultRoot,
                onSelectStorage = onSelectStorage,
                onRepairStorage = onRepairStorage,
                onConfirm =
                    onConfirmExternalIntake ?: {
                        service?.confirmExternalIntake(it, awaitFileSelection = false)
                        Unit
                    },
                rootLabel = state.storageRootLabel ?: stringResource(R.string.download_folder),
                onChooseFiles = onChooseExternalFiles ?: {
                    service?.confirmExternalIntake(it, awaitFileSelection = true)
                    Unit
                },
                onRetry =
                    onRetryExternalIntake ?: {
                        service?.retryExternalIntake(it)
                        Unit
                    },
                onCancel =
                    onCancelExternalIntake ?: {
                        service?.cancelExternalIntake(it)
                        Unit
                    },
            )
        }
        pendingSelection?.takeIf {
            state.dataReset == null && state.quickAddsInFlight == 0 &&
                state.externalIntake?.phase != ExternalIntakePhase.SUBMITTING
        }?.let { torrent ->
            val root = state.storage?.roots?.singleOrNull { it.rootId == torrent.storageRoot }
            val rootReady =
                root?.availability == StorageRootAvailability.AVAILABLE &&
                    (root.rootId != state.storage?.defaultRoot || state.storageRootReady)
            PendingFileSelectionDialog(
                torrent = torrent,
                files = state.files[torrent.torrentId],
                rootLabel = root?.label ?: state.storageRootLabel ?: stringResource(R.string.download_folder),
                rootReady = rootReady,
                queuedCount = (pendingSelections.size - 1).coerceAtLeast(0),
                error = state.error?.let { productErrorText(it) },
                onPage = { service?.presentPendingFileSelection(torrent.torrentId, it) },
                onRepairRoot = {
                    if (root == null) onSelectStorage() else onRepairStorage(root.rootId)
                },
                onConfirm = { draft, disableFuture ->
                    torrent.fileCatalogId?.let { catalogId ->
                        service?.confirmPendingFileSelection(
                            torrent.torrentId,
                            catalogId,
                            draft.base,
                            draft.compactOverrides(),
                            disableFuture,
                        )
                    }
                },
                onDownloadAll = { disableFuture ->
                    service?.downloadAllPendingAdd(torrent.torrentId, disableFuture)
                },
                onCancel = { service?.cancelPendingAdd(torrent.torrentId) },
            )
        }
        // Shown after any file choices the added torrents asked for.
        (torrentListNotice as? TorrentListNotice.Summary)
            ?.takeIf {
                pendingSelection == null && state.dataReset == null && state.externalIntake == null
            }?.let { notice ->
                TorrentAddSummaryDialog(
                    summary = notice.summary,
                    onDismiss = { service?.clearTorrentListNotice(notice.sequence) },
                )
            }
        state.companionPairing?.takeIf { state.dataReset == null }?.let { pairing ->
            AlertDialog(
                onDismissRequest = {},
                title = { Text(stringResource(R.string.pairing_title)) },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(pairing.extensionName)
                        Text(
                            stringResource(
                                R.string.pairing_identifiers,
                                pairing.extensionId,
                                pairing.installationId,
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                },
                confirmButton = {
                    TextButton(
                        onClick = { service?.approveCompanionPairing(pairing.requestId) },
                    ) {
                        Text(stringResource(R.string.action_approve))
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = { service?.rejectCompanionPairing(pairing.requestId) },
                    ) {
                        Text(stringResource(R.string.action_reject))
                    }
                },
            )
        }
        state.dataReset?.let { reset ->
            ProductDataResetDialog(
                reset = reset,
                onRetry =
                    onRetryDataReset ?: {
                        service?.retryDataReset()
                        Unit
                    },
                onFinishKeepingFiles =
                    onFinishDataResetKeepingFiles ?: {
                        service?.finishDataResetKeepingRemainingFiles()
                        Unit
                    },
                onDone =
                    onDismissCompletedDataReset ?: {
                        service?.dismissCompletedDataReset()
                        Unit
                    },
            )
        }
    }
}

@Composable
private fun ProductDataResetDialog(
    reset: ProductDataResetState,
    onRetry: () -> Unit,
    onFinishKeepingFiles: () -> Unit,
    onDone: () -> Unit,
) {
    var confirmKeepRemaining by remember(reset.operationId) { mutableStateOf(false) }
    val failure = reset.failure
    val canKeepRemaining =
        failure != null &&
            reset.phase == ProductDataResetPhase.REMOVING_TORRENTS &&
            reset.deleteDataRequested &&
            !reset.downgradedToKeep
    AlertDialog(
        onDismissRequest = {},
        title = {
            Text(
                stringResource(
                    when {
                        reset.complete -> R.string.data_reset_complete_title
                        failure != null -> R.string.data_reset_failed_title
                        else -> R.string.data_reset_progress_title
                    },
                ),
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    reset.complete ->
                        Text(
                            stringResource(
                                when {
                                    reset.downgradedToKeep ->
                                        R.string.data_reset_complete_downgraded
                                    reset.deleteDataRequested ->
                                        R.string.data_reset_complete_deleted
                                    else -> R.string.data_reset_complete_kept
                                },
                            ),
                        )
                    failure != null -> {
                        Text(
                            if (reset.phase == null) {
                                stringResource(R.string.data_reset_invalid_journal)
                            } else {
                                stringResource(R.string.data_reset_failure_detail, failure.detail)
                            },
                        )
                        failure.torrentId?.let {
                            Text(
                                stringResource(R.string.data_reset_failure_torrent, it),
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                            )
                        }
                        if (canKeepRemaining) {
                            Text(stringResource(R.string.data_reset_failure_keep_available))
                        }
                    }
                    else -> {
                        Text(dataResetPhaseText(reset.phase))
                        Text(
                            stringResource(
                                R.string.data_reset_progress_count,
                                reset.completedTorrents,
                                reset.totalTorrents,
                            ),
                        )
                    }
                }
            }
        },
        confirmButton = {
            when {
                reset.complete ->
                    TextButton(onClick = onDone) {
                        Text(stringResource(R.string.action_done))
                    }
                failure != null && reset.phase != null ->
                    TextButton(onClick = onRetry) {
                        Text(stringResource(R.string.action_retry))
                    }
            }
        },
        dismissButton = {
            if (canKeepRemaining) {
                TextButton(onClick = { confirmKeepRemaining = true }) {
                    Text(stringResource(R.string.action_finish_keep_remaining))
                }
            }
        },
    )
    if (confirmKeepRemaining) {
        AlertDialog(
            onDismissRequest = { confirmKeepRemaining = false },
            title = { Text(stringResource(R.string.data_reset_keep_remaining_title)) },
            text = { Text(stringResource(R.string.data_reset_keep_remaining_detail)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmKeepRemaining = false
                        onFinishKeepingFiles()
                    },
                ) {
                    Text(stringResource(R.string.action_finish_keep_remaining))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmKeepRemaining = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
}

@Composable
private fun dataResetPhaseText(phase: ProductDataResetPhase?): String =
    stringResource(
        when (phase) {
            ProductDataResetPhase.REMOVING_TORRENTS -> R.string.data_reset_phase_torrents
            null -> R.string.data_reset_phase_starting
            else -> R.string.data_reset_phase_finishing
        },
    )

@Composable
private fun ExternalTorrentIntakeDialog(
    intake: ExternalIntakePresentation,
    storageRootReady: Boolean,
    repairRootId: String?,
    onSelectStorage: () -> Unit,
    onRepairStorage: (String) -> Unit,
    onConfirm: (Long) -> Unit,
    onRetry: (Long) -> Unit,
    onCancel: (Long) -> Unit,
    rootLabel: String,
    onChooseFiles: (Long) -> Unit,
) {
    AlertDialog(
        onDismissRequest = { onCancel(intake.intakeId) },
        title = { Text(stringResource(R.string.add_torrent_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                intake.displayLabel?.let { Text(it) }
                if (storageRootReady) {
                    Text(
                        stringResource(R.string.file_selection_folder, rootLabel),
                        style = MaterialTheme.typography.bodySmall,
                    )
                } else {
                    Text(
                        stringResource(
                            if (repairRootId == null) {
                                R.string.intake_folder_required
                            } else {
                                R.string.intake_folder_repair_required
                            },
                        ),
                    )
                }
                when (intake.phase) {
                    ExternalIntakePhase.AWAITING_ROOT -> Unit
                    ExternalIntakePhase.SUBMITTING -> Text(stringResource(R.string.intake_adding))
                    ExternalIntakePhase.RETRYABLE_FAILURE ->
                        Text(stringResource(R.string.intake_retryable_failure))
                    else -> Unit
                }
            }
        },
        confirmButton = {
            if (!storageRootReady) {
                TextButton(
                    onClick = {
                        if (repairRootId == null) onSelectStorage()
                        else onRepairStorage(repairRootId)
                    },
                ) {
                    Text(
                        stringResource(
                            if (repairRootId == null) {
                                R.string.action_select_folder
                            } else {
                                R.string.action_repair_folder
                            },
                        ),
                    )
                }
            } else {
                TextButton(
                    onClick = {
                        if (intake.phase == ExternalIntakePhase.RETRYABLE_FAILURE) {
                            onRetry(intake.intakeId)
                        } else {
                            onConfirm(intake.intakeId)
                        }
                    },
                    enabled =
                        intake.phase in
                            setOf(
                                ExternalIntakePhase.PRESENTED,
                                ExternalIntakePhase.RETRYABLE_FAILURE,
                            ),
                ) {
                    Text(
                        if (intake.phase == ExternalIntakePhase.RETRYABLE_FAILURE) {
                            stringResource(R.string.action_retry)
                        } else {
                            stringResource(R.string.action_download_all)
                        },
                    )
                }
            }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { onCancel(intake.intakeId) }) {
                    Text(stringResource(R.string.action_cancel))
                }
                if (intake.phase == ExternalIntakePhase.PRESENTED && storageRootReady) {
                    TextButton(onClick = { onChooseFiles(intake.intakeId) }) {
                        Text(stringResource(R.string.action_choose_files))
                    }
                }
            }
        },
    )
}

@Composable
private fun externalIntakeNoticeText(kind: ExternalIntakeNoticeKind): String =
    when (kind) {
        ExternalIntakeNoticeKind.REJECTED -> stringResource(R.string.intake_rejected)
        ExternalIntakeNoticeKind.QUEUE_FULL -> stringResource(R.string.intake_queue_full)
        ExternalIntakeNoticeKind.ADDED -> stringResource(R.string.intake_added)
        ExternalIntakeNoticeKind.ALREADY_PRESENT -> stringResource(R.string.intake_already_present)
        ExternalIntakeNoticeKind.SELECTION_EXPANDED -> stringResource(R.string.intake_selection_updated)
        ExternalIntakeNoticeKind.TERMINAL_FAILURE -> stringResource(R.string.intake_terminal_failure)
    }

@Composable
private fun ProductNavHost(
    onShutdown: () -> Unit,
    state: ProductState,
    service: ProductEngineService?,
    onSelectStorage: () -> Unit,
    onRepairStorage: (String) -> Unit,
    onBrowseTorrent: (Boolean) -> Unit,
    notificationsGranted: Boolean,
    onRequestNotifications: () -> Unit,
    onOpenNotificationSettings: () -> Unit,
    onExportTorrentList: (() -> Unit)?,
    onImportTorrentList: (() -> Unit)?,
    onOpenFeedback: (Boolean, String) -> Unit,
    onPreviewFeedback: (suspend (Boolean) -> ProductFeedbackPreview?)?,
    onOpenPrivacy: () -> Unit,
    onConnectChromeExtension: (() -> Unit)?,
    notificationNavigation: ProductNotificationNavigation?,
    onNotificationNavigationConsumed: (Long) -> Unit,
    onNotificationNavigationFallback: (String) -> Unit,
    onUndoableAction: (message: String, undoLabel: String, undo: () -> Unit) -> Unit,
    onUpdateNotificationPreference: (ProductNotificationPreference, Boolean) -> Unit,
    onBackgroundDownloads: (Boolean) -> Unit,
    onKeepSeedingInBackground: (Boolean) -> Unit,
    lifecycleControlsEnabled: Boolean,
    onUnmeteredNetworksOnly: (Boolean) -> Unit,
    themeMode: ProductThemeMode,
    dynamicColor: Boolean,
    onThemeMode: (ProductThemeMode) -> Unit,
    onDynamicColor: (Boolean) -> Unit,
    onUpdateClientSettings: (ClientSettingsPatch) -> Unit,
    onUpdateTorrentSettings: (String, TorrentSettingsPatch) -> Unit,
    dataManagementEnabled: Boolean,
    onResetClientSettings: () -> Unit,
    onClearAllData: (Boolean) -> Unit,
) {
    val navController = rememberNavController()
    val resources = LocalContext.current.resources
    val undoLabel = stringResource(R.string.action_undo)
    var removeTargets by remember { mutableStateOf(emptySet<String>()) }
    var removeStorageRoot by remember { mutableStateOf<String?>(null) }
    var deleteFolderData by remember { mutableStateOf(false) }
    var confirmKeepSeeding by remember { mutableStateOf(false) }
    var confirmResetEngine by remember { mutableStateOf(false) }
    var confirmClearAllData by remember { mutableStateOf(false) }
    var deleteDownloadedFiles by remember { mutableStateOf(false) }
    var confirmResetStatistics by remember { mutableStateOf(false) }
    var feedbackPreview by remember { mutableStateOf<ProductFeedbackPreview?>(null) }
    var feedbackIncludeStatistics by remember { mutableStateOf(false) }
    var feedbackBusy by remember { mutableStateOf(false) }
    var feedbackError by remember { mutableStateOf<String?>(null) }
    val productPrivacyScope = rememberCoroutineScope()
    val feedbackPreviewFailedMessage = stringResource(R.string.feedback_preview_failed)
    val torrentMissingMessage = stringResource(R.string.notification_torrent_missing)
    val folderMissingMessage = stringResource(R.string.notification_folder_missing)
    val backgroundDownloadsDescription =
        stringResource(R.string.a11y_continue_background_downloads)
    val keepSeedingDescription = stringResource(R.string.a11y_keep_seeding_background)
    LaunchedEffect(
        notificationNavigation?.sequence,
        state.ready,
        torrentMissingMessage,
        folderMissingMessage,
    ) {
        val target = notificationNavigation ?: return@LaunchedEffect
        if (!state.ready) return@LaunchedEffect
        when (target) {
            is ProductNotificationNavigation.Torrent -> {
                if (target.torrentId in state.torrents) {
                    navController.navigate(ProductRoutes.detail(target.torrentId)) {
                        launchSingleTop = true
                    }
                } else {
                    if (!navController.popBackStack(ProductRoutes.LIBRARY, inclusive = false)) {
                        navController.navigate(ProductRoutes.LIBRARY) { launchSingleTop = true }
                    }
                    onNotificationNavigationFallback(torrentMissingMessage)
                }
            }
            is ProductNotificationNavigation.StorageRepair -> {
                navController.navigate(ProductRoutes.SETTINGS_STORAGE) { launchSingleTop = true }
                if (
                    target.rootId != null &&
                    state.storage?.roots?.none { it.rootId == target.rootId } == true
                ) {
                    onNotificationNavigationFallback(folderMissingMessage)
                }
            }
        }
        onNotificationNavigationConsumed(target.sequence)
    }
    LaunchedEffect(state.externalIntake?.intakeId) {
        if (state.externalIntake != null) {
            if (!navController.popBackStack(ProductRoutes.LIBRARY, inclusive = false)) {
                navController.navigate(ProductRoutes.LIBRARY) { launchSingleTop = true }
            }
        }
    }
    NavHost(navController = navController, startDestination = ProductRoutes.LIBRARY) {
        composable(ProductRoutes.LIBRARY) {
            LibraryScreen(
                state = state,
                notificationsGranted =
                    notificationsGranted &&
                        state.notifications.appNotificationsEnabled &&
                        state.notifications.backgroundChannelEnabled,
                onEnableBackgroundDownloads = { onBackgroundDownloads(true) },
                backgroundControlsEnabled = lifecycleControlsEnabled,
                onSelectStorage = onSelectStorage,
                onRepairStorage = onRepairStorage,
                onOpenTorrent = { navController.navigate(ProductRoutes.detail(it)) },
                onAddMagnet = { text, chooseFiles ->
                    val magnets = splitMagnetLinks(text)
                    if (magnets.size <= 1) {
                        service?.addMagnet(
                            text,
                            startContent = true,
                            awaitFileSelection = chooseFiles,
                            downloadAll = !chooseFiles,
                        )
                    } else {
                        service?.addMagnets(
                            magnets,
                            startContent = true,
                            awaitFileSelection = chooseFiles,
                            downloadAll = !chooseFiles,
                            summarize = true,
                        )
                    }
                },
                onBrowseTorrent = {
                    onBrowseTorrent(state.storage?.showFileSelection ?: true)
                },
                onAddTestTorrents =
                    if (BuildConfig.DEBUG) {
                        { torrents ->
                            // Follow the file selection setting like any other add.
                            val chooseFiles = state.storage?.showFileSelection ?: true
                            service?.addMagnets(
                                torrents.map { it.magnet },
                                awaitFileSelection = chooseFiles,
                                downloadAll = !chooseFiles,
                            )
                            Unit
                        }
                    } else {
                        null
                    },
                onPause = { service?.pause(it) },
                onResume = { service?.resume(it) },
                onMoveTop = { service?.moveDownloadsToTop(it) },
                onMoveBottom = { service?.moveDownloadsToBottom(it) },
                onForceRecheck = { service?.forceRecheck(it) },
                onCopyMagnets = { service?.copyMagnets(it) },
                onArchive = { ids ->
                    // Archiving pauses; undo resumes the torrents that were running.
                    val wasRunning = ids.filter { state.torrents[it]?.runningBeforeArchive() == true }
                    service?.archive(ids)
                    onUndoableAction(
                        resources.getQuantityString(R.plurals.library_archived_count, ids.size, ids.size),
                        undoLabel,
                    ) { service?.restoreArchive(ids, resume = wasRunning) }
                },
                onRestore = { ids ->
                    service?.restoreArchive(ids)
                    onUndoableAction(
                        resources.getQuantityString(R.plurals.library_restored_count, ids.size, ids.size),
                        undoLabel,
                    ) { service?.archive(ids) }
                },
                onRemove = { removeTargets = it },
                onSpeed = { navController.navigate(ProductRoutes.SPEED) },
                onDht = { navController.navigate(ProductRoutes.DHT) },
                onLogs = { navController.navigate(ProductRoutes.LOGS) },
                onSettings = { navController.navigate(ProductRoutes.SETTINGS) },
                onShutdown = onShutdown,
            )
        }
        composable(ProductRoutes.DETAIL) { entry ->
            val torrentId = requireNotNull(entry.arguments?.getString("torrentId"))
            val torrent = state.presentedTorrent(state.torrents[torrentId])
            // The service is replaced when the activity returns after a
            // lifecycle stop; select on each owner and clear on the current one.
            val currentService by rememberUpdatedState(service)
            LaunchedEffect(torrentId, service) { service?.selectTorrent(torrentId) }
            DisposableEffect(torrentId) {
                onDispose { currentService?.clearTorrentPresentation(torrentId) }
            }
            // Leave once the loaded library no longer has this torrent, however
            // it was removed. Skip while not loaded so a reconnect stays here.
            val gone = state.ready && torrentId !in state.torrents
            LaunchedEffect(gone) {
                if (gone) navController.popBackStack(ProductRoutes.DETAIL, inclusive = true)
            }
            TorrentDetailScreen(
                presentationOwner = service,
                torrent = torrent,
                state = state,
                onBack = navController::popBackStack,
                onPause = { service?.pause(torrentId) },
                onResume = { service?.resume(torrentId) },
                onForceRecheck = { service?.forceRecheck(torrentId) },
                onMoveTop = { service?.moveDownloadToTop(torrentId) },
                onMoveBottom = { service?.moveDownloadToBottom(torrentId) },
                onArchive = { service?.archive(listOf(torrentId)) },
                onRestore = { service?.restoreArchive(listOf(torrentId)) },
                onRemove = { removeTargets = setOf(torrentId) },
                onCopyMagnet = { service?.copyMagnets(listOf(torrentId)) },
                onTransferLimits = { onUpdateTorrentSettings(torrentId, it) },
                onSpeed = { navController.navigate(ProductRoutes.SPEED) },
                onDht = { navController.navigate(ProductRoutes.DHT) },
                onLogs = { navController.navigate(ProductRoutes.LOGS) },
                onSettings = { navController.navigate(ProductRoutes.SETTINGS) },
                onPresent = { service?.presentTorrent(torrentId, it) },
                onSetFilePriority = { files, priority ->
                    service?.setFilePriority(torrentId, files.map { it.fileIndex }, priority)
                },
                onDownloadFile = { files ->
                    service?.downloadFilesNow(torrentId, files.map { it.fileIndex })
                },
                onPlayFile = { file -> service?.playMedia(torrentId, file) },
                onOpenFile = { file ->
                    torrent?.displayName?.let {
                        service?.openCompletedFile(torrent.storageRoot, it, file)
                    }
                },
                onFilePage = {
                    service?.presentCatalogPage(torrentId, TorrentPresentation.FILES, it)
                },
                onTrackerPage = {
                    service?.presentCatalogPage(torrentId, TorrentPresentation.TRACKERS, it)
                },
            )
        }
        composable(ProductRoutes.SPEED) {
            var speedRange by rememberSaveable { mutableStateOf(SpeedRange.MINUTES2) }
            DisposableEffect(service, speedRange) {
                service?.presentGlobal(GlobalPresentation.SPEED, speedRange)
                onDispose { service?.presentGlobal(GlobalPresentation.NONE) }
            }
            SpeedScreen(
                state.speed,
                state.currentRates,
                speedRange,
                { speedRange = it },
                navController::popBackStack,
            )
        }
        composable(ProductRoutes.DHT) {
            DisposableEffect(service) {
                service?.presentGlobal(GlobalPresentation.DHT)
                onDispose { service?.presentGlobal(GlobalPresentation.NONE) }
            }
            DhtScreen(state.dht, navController::popBackStack)
        }
        composable(ProductRoutes.LOGS) {
            LogsShell(
                events = state.diagnostics,
                sourceEvicted = state.diagnosticSourceEvicted,
                localEvicted = state.diagnosticLocalEvicted,
                resets = state.diagnosticResets,
                selectedTorrent = state.selectedTorrent,
                service = service,
                onBack = navController::popBackStack,
            )
        }
        composable(ProductRoutes.SETTINGS) {
            SettingsHub(navController)
        }
        composable(ProductRoutes.SETTINGS_STORAGE) {
            SettingsPage(stringResource(R.string.settings_storage), navController::popBackStack) {
                SettingsSection(stringResource(R.string.settings_section_download_folders))
                Text(
                    stringResource(R.string.storage_explanation),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
                state.storage?.roots.orEmpty().forEach { root ->
                    StorageRootRow(
                        label = root.label,
                        path = root.displayPath,
                        isDefault = root.rootId == state.storage?.defaultRoot,
                        available = root.availability != StorageRootAvailability.UNAVAILABLE,
                        onRepair = { onRepairStorage(root.rootId) },
                        onMakeDefault = { service?.makeSafRootCurrent(root.rootId) },
                        onRemove = { removeStorageRoot = root.rootId },
                    )
                }
                ListItem(
                    headlineContent = { Text(stringResource(R.string.storage_add_folder)) },
                    leadingContent = { Icon(Icons.Outlined.Add, contentDescription = null) },
                    modifier =
                        Modifier.clickable(onClick = onSelectStorage)
                            .semantics(mergeDescendants = true) { role = Role.Button },
                )
                HorizontalDivider()
                SettingsSection(stringResource(R.string.settings_section_adding))
                NotificationToggleSetting(
                    title = stringResource(R.string.storage_show_file_selection),
                    detail = stringResource(R.string.storage_show_file_selection_detail),
                    checked = state.storage?.showFileSelection ?: true,
                    onChecked = { service?.setShowFileSelection(it) },
                )
                if (onExportTorrentList != null || onImportTorrentList != null) {
                    val idle = service != null && state.torrentListActivity == null
                    SettingsSection(stringResource(R.string.settings_section_torrent_list))
                    onExportTorrentList?.let { exportList ->
                        SettingAction(
                            title = stringResource(R.string.torrent_list_export),
                            detail = stringResource(R.string.torrent_list_export_detail),
                            onClick = exportList,
                            action = stringResource(R.string.action_export),
                            enabled = idle,
                        )
                    }
                    onImportTorrentList?.let { importList ->
                        SettingAction(
                            title = stringResource(R.string.torrent_list_import),
                            detail =
                                stringResource(
                                    if (state.storageRootReady) {
                                        R.string.torrent_list_import_detail
                                    } else {
                                        R.string.torrent_list_import_needs_folder
                                    },
                                ),
                            onClick = importList,
                            action = stringResource(R.string.action_import),
                            enabled = idle && state.storageRootReady,
                        )
                    }
                    state.torrentListActivity?.let {
                        Text(
                            torrentListActivityText(it),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        )
                    }
                }
            }
        }
        composable(ProductRoutes.SETTINGS_SPEED) {
            SettingsPage(stringResource(R.string.settings_speed_limits), navController::popBackStack) {
                val settings = state.presentedClientSettings()
                if (settings == null) {
                    Text(stringResource(R.string.settings_loading), modifier = Modifier.padding(16.dp))
                } else {
                    ConnectionLimitsSettings(
                        settings,
                        onPeerConnections = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(peerConnectionLimit = value),
                            )
                        },
                        onUploadSlots = { value ->
                            onUpdateClientSettings(clientSettingsPatch(uploadSlots = value))
                        },
                        onActiveDownloads = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(activeDownloads = value),
                            )
                        },
                        onActiveSeeds = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(activeSeeds = value),
                            )
                        },
                        onUploadRateLimit = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(uploadRateLimit = value),
                            )
                        },
                        onDownloadRateLimit = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(downloadRateLimit = value),
                            )
                        },
                        onSeedStopRatio = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(seedStopRatioPercent = value),
                            )
                        },
                        onSeedStopTime = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(seedStopTimeSeconds = value),
                            )
                        },
                    )
                }
            }
        }
        composable(ProductRoutes.SETTINGS_NOTIFICATIONS) {
            SettingsPage(stringResource(R.string.settings_notifications), navController::popBackStack) {
                val notificationState = state.notifications
                SettingsSection(stringResource(R.string.settings_section_permission))
                SettingAction(
                    title =
                        when {
                            !notificationsGranted -> stringResource(R.string.notifications_disabled)
                            !notificationState.appNotificationsEnabled -> stringResource(R.string.notifications_blocked)
                            !notificationState.backgroundChannelEnabled ->
                                stringResource(R.string.notifications_background_blocked)
                            else -> stringResource(R.string.notifications_enabled)
                        },
                    detail = stringResource(R.string.notifications_required_for_background),
                    onClick = onOpenNotificationSettings,
                    action =
                        stringResource(
                            if (notificationsGranted) R.string.action_manage else R.string.action_enable,
                        ),
                )
                SettingsSection(stringResource(R.string.settings_section_alerts))
                NotificationToggleSetting(
                    title = stringResource(R.string.notifications_download_completed),
                    detail =
                        if (notificationState.completionChannelEnabled) {
                            stringResource(R.string.notifications_download_completed_detail)
                        } else {
                            stringResource(R.string.notifications_system_blocked)
                        },
                    checked = notificationState.preferences.downloadComplete,
                    onChecked = {
                        onUpdateNotificationPreference(
                            ProductNotificationPreference.DOWNLOAD_COMPLETE,
                            it,
                        )
                    },
                )
                NotificationToggleSetting(
                    title = stringResource(R.string.notifications_needs_attention),
                    detail =
                        if (notificationState.attentionChannelEnabled) {
                            stringResource(R.string.notifications_needs_attention_detail)
                        } else {
                            stringResource(R.string.notifications_system_blocked)
                        },
                    checked = notificationState.preferences.needsAttention,
                    onChecked = {
                        onUpdateNotificationPreference(
                            ProductNotificationPreference.NEEDS_ATTENTION,
                            it,
                        )
                    },
                )
                notificationState.preferenceError?.let {
                    ReadOnlySetting(stringResource(R.string.setting_not_saved), productErrorText(it))
                }
            }
        }
        composable(ProductRoutes.SETTINGS_NETWORK) {
            SettingsPage(stringResource(R.string.settings_network_privacy), navController::popBackStack) {
                state.presentedClientSettings()?.let { settings ->
                    NetworkSettings(
                        settings,
                        network = state.network,
                        onUnmeteredNetworksOnly = onUnmeteredNetworksOnly,
                        onListener = { enabled ->
                            onUpdateClientSettings(
                                clientSettingsPatch(
                                    listener =
                                        if (enabled) {
                                            org.rstorrent.session.uniffi.ListenerPolicy.AutomaticLocalNetwork
                                        } else {
                                            org.rstorrent.session.uniffi.ListenerPolicy.Disabled
                                        },
                                ),
                            )
                        },
                        onPortMapping = { enabled ->
                            onUpdateClientSettings(
                                clientSettingsPatch(
                                    portMapping =
                                        if (enabled) {
                                            org.rstorrent.session.uniffi.PortMappingPolicy.UPNP
                                        } else {
                                            org.rstorrent.session.uniffi.PortMappingPolicy.DISABLED
                                        },
                                ),
                            )
                        },
                        onIpv6 = { enabled ->
                            onUpdateClientSettings(clientSettingsPatch(ipv6Enabled = enabled))
                        },
                        onDht = { enabled ->
                            onUpdateClientSettings(clientSettingsPatch(dhtEnabled = enabled))
                        },
                        onPeerExchange = { enabled ->
                            onUpdateClientSettings(
                                clientSettingsPatch(peerExchangeEnabled = enabled),
                            )
                        },
                        onEncryption = { policy ->
                            onUpdateClientSettings(clientSettingsPatch(encryption = policy))
                        },
                    )
                } ?: Text(stringResource(R.string.settings_loading), modifier = Modifier.padding(16.dp))
            }
        }
        composable(ProductRoutes.SETTINGS_POWER) {
            SettingsPage(stringResource(R.string.settings_power_management), navController::popBackStack) {
                val lifecycle = state.lifecycle
                SettingsSection(stringResource(R.string.settings_section_background))
                ListItem(
                    headlineContent = { Text(stringResource(R.string.power_continue_background)) },
                    supportingContent = {
                        Text(
                            if (lifecycle.backgroundDownloadsEnabled && !lifecycle.effectiveBackgroundDownloads) {
                                stringResource(R.string.power_continue_blocked)
                            } else {
                                stringResource(R.string.power_continue_detail)
                            },
                        )
                    },
                    trailingContent = {
                        Switch(
                            checked = lifecycle.backgroundDownloadsEnabled,
                            onCheckedChange = onBackgroundDownloads,
                            enabled = lifecycleControlsEnabled,
                            modifier =
                                Modifier.semantics {
                                    contentDescription = backgroundDownloadsDescription
                                },
                        )
                    },
                )
                HorizontalDivider()
                ListItem(
                    headlineContent = { Text(stringResource(R.string.power_keep_seeding_background)) },
                    supportingContent = {
                        Text(
                            if (lifecycle.backgroundDownloadsEnabled) {
                                stringResource(R.string.power_keep_seeding_detail_enabled)
                            } else {
                                stringResource(R.string.error_background_downloads_required)
                            },
                        )
                    },
                    trailingContent = {
                        Switch(
                            checked = lifecycle.keepSeedingEnabled,
                            onCheckedChange = { enabled ->
                                if (enabled) confirmKeepSeeding = true
                                else onKeepSeedingInBackground(false)
                            },
                            enabled =
                                lifecycleControlsEnabled &&
                                    lifecycle.backgroundDownloadsEnabled,
                            modifier =
                                Modifier.semantics {
                                    contentDescription = keepSeedingDescription
                                },
                        )
                    },
                )
                HorizontalDivider()
                ListItem(
                    headlineContent = {
                        Text(stringResource(R.string.power_prevent_sleep))
                    },
                    supportingContent = {
                        Text(
                            stringResource(R.string.power_prevent_sleep_detail),
                        )
                    },
                    trailingContent = {
                        Switch(
                            checked = state.preventSleepDuringActiveDownloads,
                            onCheckedChange = {
                                service?.setPreventSleepDuringActiveDownloads(it)
                            },
                            enabled = service != null,
                        )
                    },
                )
                HorizontalDivider()
                lifecycle.preferenceError?.let {
                    ReadOnlySetting(stringResource(R.string.setting_not_saved), productErrorText(it))
                }
                Text(
                    stringResource(R.string.power_background_limits_detail),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            }
            if (confirmKeepSeeding) {
                AlertDialog(
                    onDismissRequest = { confirmKeepSeeding = false },
                    title = { Text(stringResource(R.string.power_keep_seeding_title)) },
                    text = {
                        Text(
                            stringResource(R.string.power_keep_seeding_detail),
                        )
                    },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                confirmKeepSeeding = false
                                onKeepSeedingInBackground(true)
                            },
                        ) {
                            Text(stringResource(R.string.action_keep_seeding))
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { confirmKeepSeeding = false }) {
                            Text(stringResource(R.string.action_cancel))
                        }
                    },
                )
            }
        }
        composable(ProductRoutes.SETTINGS_ADVANCED) {
            SettingsPage(stringResource(R.string.settings_advanced), navController::popBackStack) {
                SettingsSection(stringResource(R.string.settings_section_appearance))
                ChoiceSetting(
                    title = stringResource(R.string.settings_theme),
                    selected = themeMode,
                    values = ProductThemeMode.entries,
                    label = { productThemeModeLabel(it) },
                    onSelected = onThemeMode,
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    NotificationToggleSetting(
                        title = stringResource(R.string.theme_use_system_colors),
                        detail = null,
                        checked = dynamicColor,
                        onChecked = onDynamicColor,
                    )
                }
                onConnectChromeExtension?.let { connect ->
                    SettingsSection(stringResource(R.string.settings_section_chrome))
                    SettingAction(
                        title = stringResource(R.string.chrome_extension_setup_action),
                        detail = stringResource(R.string.chrome_extension_setup_settings_detail),
                        onClick = connect,
                        action = stringResource(R.string.action_open),
                        enabled = service != null,
                    )
                }
                SettingsSection(stringResource(R.string.settings_section_privacy))
                state.productSummary?.let { summary ->
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.product_statistics_include)) },
                        supportingContent = { Text(stringResource(R.string.product_statistics_preference_detail)) },
                        trailingContent = {
                            Switch(
                                checked = summary.statisticsEnabled,
                                onCheckedChange = { service?.setProductStatisticsEnabled(it) },
                                enabled = service != null,
                            )
                        },
                    )
                    HorizontalDivider()
                    SettingAction(
                        title = stringResource(R.string.product_statistics_reset),
                        detail = null,
                        onClick = { confirmResetStatistics = true },
                        action = stringResource(R.string.action_reset),
                        enabled = service != null,
                    )
                }
                SettingAction(
                    title = stringResource(R.string.action_privacy_policy),
                    detail = null,
                    onClick = onOpenPrivacy,
                    action = stringResource(R.string.action_open),
                )
                SettingsSection(stringResource(R.string.settings_section_support))
                FeedbackSetting {
                    val include = state.productSummary?.statisticsEnabled == true
                    feedbackIncludeStatistics = include
                    feedbackBusy = true
                    feedbackError = null
                    productPrivacyScope.launch {
                        runCatching {
                            onPreviewFeedback?.invoke(include)
                                ?: service?.productFeedbackPreview(include)
                        }
                            .onSuccess { feedbackPreview = it }
                            .onFailure { feedbackError = it.message ?: feedbackPreviewFailedMessage }
                        feedbackBusy = false
                    }
                }
                if (feedbackBusy) {
                    ReadOnlySetting(
                        stringResource(R.string.feedback_preview_title),
                        stringResource(R.string.feedback_preview_loading),
                    )
                }
                feedbackError?.let {
                    ReadOnlySetting(
                        stringResource(R.string.feedback_preview_failed),
                        it,
                    )
                }
                SettingsSection(stringResource(R.string.settings_section_reset))
                SettingAction(
                    title = stringResource(R.string.settings_reset_engine),
                    detail = stringResource(R.string.settings_reset_engine_detail),
                    onClick = { confirmResetEngine = true },
                    action = stringResource(R.string.action_reset),
                    enabled = dataManagementEnabled,
                )
                SettingAction(
                    title = stringResource(R.string.settings_clear_all_data),
                    detail = stringResource(R.string.settings_clear_all_data_detail),
                    onClick = {
                        deleteDownloadedFiles = false
                        confirmClearAllData = true
                    },
                    action = stringResource(R.string.action_clear),
                    enabled = dataManagementEnabled,
                )
            }
        }
    }
    if (confirmResetStatistics) {
        AlertDialog(
            onDismissRequest = { confirmResetStatistics = false },
            title = { Text(stringResource(R.string.product_statistics_reset_title)) },
            text = { Text(stringResource(R.string.product_statistics_reset_warning)) },
            confirmButton = {
                TextButton(
                    enabled = service != null,
                    onClick = {
                        confirmResetStatistics = false
                        service?.resetProductStatistics()
                    },
                ) {
                    Text(stringResource(R.string.action_reset))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmResetStatistics = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
    feedbackPreview?.let { preview ->
        AlertDialog(
            onDismissRequest = { if (!feedbackBusy) feedbackPreview = null },
            title = { Text(stringResource(R.string.feedback_preview_title)) },
            text = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                ) {
                    Text(
                        stringResource(R.string.feedback_preview_destination, preview.destination),
                    )
                    Text(
                        stringResource(R.string.feedback_recipient_warning),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    preview.fields.forEach { field ->
                        Text(
                            "${field.name}: ${field.value}",
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier =
                            Modifier.fillMaxWidth()
                                .toggleable(
                                    value = feedbackIncludeStatistics && preview.statisticsAvailable,
                                    enabled = preview.statisticsAvailable && !feedbackBusy,
                                    role = Role.Checkbox,
                                ) { include ->
                                    val previousInclude = feedbackIncludeStatistics
                                    feedbackIncludeStatistics = include
                                    feedbackBusy = true
                                    feedbackError = null
                                    productPrivacyScope.launch {
                                        runCatching {
                                            onPreviewFeedback?.invoke(include)
                                                ?: service?.productFeedbackPreview(include)
                                        }
                                            .onSuccess { feedbackPreview = it }
                                            .onFailure {
                                                feedbackIncludeStatistics = previousInclude
                                                feedbackError = it.message ?: feedbackPreviewFailedMessage
                                            }
                                        feedbackBusy = false
                                    }
                                },
                    ) {
                        Checkbox(
                            checked = feedbackIncludeStatistics && preview.statisticsAvailable,
                            onCheckedChange = null,
                            enabled = preview.statisticsAvailable && !feedbackBusy,
                        )
                        Text(stringResource(R.string.feedback_include_statistics_once))
                    }
                    if (!preview.hostedContextReady) {
                        Text(
                            stringResource(R.string.feedback_hosted_context_pending),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    feedbackError?.let {
                        Text(it, color = MaterialTheme.colorScheme.error)
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !feedbackBusy,
                    onClick = {
                        onOpenFeedback(feedbackIncludeStatistics, preview.url)
                        feedbackPreview = null
                    },
                ) {
                    Text(stringResource(R.string.feedback_open_page))
                }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = onOpenPrivacy) {
                        Text(stringResource(R.string.action_privacy_policy))
                    }
                    TextButton(onClick = { feedbackPreview = null }) {
                        Text(stringResource(R.string.action_cancel))
                    }
                }
            },
        )
    }
    if (confirmResetEngine) {
        AlertDialog(
            onDismissRequest = { confirmResetEngine = false },
            title = { Text(stringResource(R.string.reset_engine_title)) },
            text = { Text(stringResource(R.string.reset_engine_detail)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmResetEngine = false
                        onResetClientSettings()
                    },
                ) {
                    Text(stringResource(R.string.action_reset))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmResetEngine = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
    if (confirmClearAllData) {
        AlertDialog(
            onDismissRequest = { confirmClearAllData = false },
            title = { Text(stringResource(R.string.clear_all_data_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.clear_all_data_detail))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier =
                            Modifier.fillMaxWidth()
                                .clickable { deleteDownloadedFiles = !deleteDownloadedFiles }
                                .semantics(mergeDescendants = true) { role = Role.Checkbox },
                    ) {
                        Checkbox(
                            checked = deleteDownloadedFiles,
                            onCheckedChange = { deleteDownloadedFiles = it },
                        )
                        Text(stringResource(R.string.clear_all_data_delete_files))
                    }
                    if (deleteDownloadedFiles) {
                        Text(
                            stringResource(R.string.clear_all_data_delete_scope),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val delete = deleteDownloadedFiles
                        confirmClearAllData = false
                        deleteDownloadedFiles = false
                        onClearAllData(delete)
                    },
                ) {
                    Text(stringResource(R.string.action_clear_all_data))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        confirmClearAllData = false
                        deleteDownloadedFiles = false
                    },
                ) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
    if (removeTargets.isNotEmpty()) {
        val remove = { policy: RemovalDataPolicy ->
            removeTargets.forEach { service?.removeTorrent(it, policy) }
            // Deleting data can keep the torrent listed for a while, so leave
            // its detail now; the library shows the removal and any failure.
            val shown = navController.currentBackStackEntry?.arguments?.getString("torrentId")
            if (shown in removeTargets) navController.popBackStack()
            removeTargets = emptySet()
        }
        RemoveDialog(
            count = removeTargets.size,
            onDismiss = { removeTargets = emptySet() },
            onKeep = { remove(RemovalDataPolicy.KEEP) },
            onDelete = { remove(RemovalDataPolicy.DELETE_DATA) },
        )
    }
    removeStorageRoot?.let { rootId ->
        val roots = state.storage?.roots.orEmpty()
        val label = roots.singleOrNull { it.rootId == rootId }?.label ?: rootId
        val using = state.torrents.values.filter { it.storageRoot == rootId }
        val archived = using.count { it.archived }
        // The engine makes the first other available folder current.
        val replacement =
            roots
                .filter { it.rootId != rootId && it.availability == StorageRootAvailability.AVAILABLE }
                .minByOrNull { it.rootId }
                ?.takeIf { state.storage?.defaultRoot == rootId }
        val isCurrent = state.storage?.defaultRoot == rootId
        AlertDialog(
            onDismissRequest = { removeStorageRoot = null },
            title = { Text(stringResource(R.string.remove_folder_title, label)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (using.isNotEmpty()) {
                        Text(
                            pluralStringResource(
                                R.plurals.remove_folder_torrents,
                                using.size,
                                using.size,
                            ),
                        )
                        if (!deleteFolderData) {
                            Text(pluralStringResource(R.plurals.remove_folder_torrents_wait, using.size))
                        }
                        if (archived > 0) {
                            Text(
                                pluralStringResource(
                                    R.plurals.remove_folder_archived,
                                    archived,
                                    archived,
                                ),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                    if (isCurrent) {
                        Text(
                            if (replacement != null) {
                                stringResource(R.string.remove_folder_next_current, replacement.label)
                            } else {
                                stringResource(R.string.remove_folder_no_current)
                            },
                        )
                    }
                    Text(
                        stringResource(
                            if (deleteFolderData) {
                                R.string.remove_folder_delete_scope
                            } else {
                                R.string.remove_folder_detail
                            },
                        ),
                    )
                    if (using.isNotEmpty()) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier =
                                Modifier.fillMaxWidth()
                                    .clickable { deleteFolderData = !deleteFolderData }
                                    .semantics(mergeDescendants = true) { role = Role.Checkbox },
                        ) {
                            Checkbox(
                                checked = deleteFolderData,
                                onCheckedChange = { deleteFolderData = it },
                            )
                            Text(stringResource(R.string.remove_folder_delete_files))
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        service?.removeSafRoot(rootId, deleteData = deleteFolderData && using.isNotEmpty())
                        removeStorageRoot = null
                        deleteFolderData = false
                    },
                ) {
                    Text(stringResource(R.string.action_remove))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        removeStorageRoot = null
                        deleteFolderData = false
                    },
                ) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TorrentDetailScreen(
    presentationOwner: Any?,
    torrent: TorrentView?,
    state: ProductState,
    onBack: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onForceRecheck: () -> Unit,
    onMoveTop: () -> Unit,
    onMoveBottom: () -> Unit,
    onArchive: () -> Unit,
    onRestore: () -> Unit,
    onRemove: () -> Unit,
    onCopyMagnet: () -> Unit,
    onTransferLimits: (TorrentSettingsPatch) -> Unit,
    onSpeed: () -> Unit,
    onDht: () -> Unit,
    onLogs: () -> Unit,
    onSettings: () -> Unit,
    onPresent: (TorrentPresentation) -> Unit,
    onSetFilePriority: (List<org.rstorrent.session.uniffi.FileView>, FilePriority) -> Unit,
    onDownloadFile: (List<org.rstorrent.session.uniffi.FileView>) -> Unit,
    onPlayFile: (org.rstorrent.session.uniffi.FileView) -> Unit,
    onOpenFile: (org.rstorrent.session.uniffi.FileView) -> Unit,
    onFilePage: (UInt) -> Unit,
    onTrackerPage: (UInt) -> Unit,
) {
    var overflow by remember { mutableStateOf(false) }
    val pager = rememberPagerState(pageCount = { TorrentDetailTab.entries.size })
    val scope = rememberCoroutineScope()
    // File selection lives here so its bars can replace this screen's app bar,
    // with the same mechanics as the Library selection.
    var fileSelection by rememberSaveable { mutableStateOf(emptySet<String>()) }
    val fileCatalog = torrent?.let { state.files[it.torrentId] }
    val files = remember(fileCatalog?.files) { presentedFiles(fileCatalog) }
    val selectedFiles = files.filter { it.fileId in fileSelection }
    LaunchedEffect(selectedFiles.size, fileSelection.size, fileCatalog != null) {
        // Skip while the catalog is not loaded so a reconnect keeps the selection.
        if (fileCatalog != null && selectedFiles.size != fileSelection.size) {
            fileSelection = selectedFiles.mapTo(mutableSetOf()) { it.fileId }
        }
    }
    LaunchedEffect(pager.currentPage) {
        if (TorrentDetailTab.entries[pager.currentPage] != TorrentDetailTab.FILES) {
            fileSelection = emptySet()
        }
    }
    BackHandler(enabled = fileSelection.isNotEmpty()) { fileSelection = emptySet() }
    // A stopped activity can return to a new service whose presentation
    // repository has never been told which tab is showing.
    LaunchedEffect(pager.currentPage, presentationOwner) {
        val presentation =
            when (TorrentDetailTab.entries[pager.currentPage]) {
                TorrentDetailTab.DETAILS,
                TorrentDetailTab.STATUS,
                -> TorrentPresentation.SUMMARY
                TorrentDetailTab.FILES -> TorrentPresentation.FILES
                TorrentDetailTab.TRACKERS -> TorrentPresentation.TRACKERS
                TorrentDetailTab.PEERS -> TorrentPresentation.PEERS
                TorrentDetailTab.PIECES -> TorrentPresentation.PIECES
            }
        onPresent(presentation)
    }
    Scaffold(
        topBar = {
            if (fileSelection.isNotEmpty()) {
                SelectionTopBar(
                    count = fileSelection.size,
                    allSelected = selectedFiles.size == files.size,
                    onClear = { fileSelection = emptySet() },
                    onSelectAll = { fileSelection = files.mapTo(mutableSetOf()) { it.fileId } },
                )
            } else {
                TopAppBar(
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                contentDescription = stringResource(R.string.action_back),
                            )
                        }
                    },
                    title = {
                        Text(
                            torrent?.let(::torrentPresentationName)
                                ?: stringResource(R.string.torrent_fallback_name),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    actions = {
                        if (torrent != null && !torrent.archived) {
                            val paused = torrent.operationalState == TorrentOperationalState.PAUSED
                            IconButton(onClick = if (paused) onResume else onPause) {
                                Icon(
                                    if (paused) Icons.Default.PlayArrow else Icons.Default.Pause,
                                    contentDescription = stringResource(torrent.pauseResumeLabelRes()),
                                )
                            }
                        }
                        Box {
                            IconButton(onClick = { overflow = true }) {
                                Icon(
                                    Icons.Outlined.MoreVert,
                                    contentDescription = stringResource(R.string.a11y_more_options),
                                )
                            }
                            DropdownMenu(expanded = overflow, onDismissRequest = { overflow = false }) {
                                val dismiss = { overflow = false }
                                if (torrent?.allows(TorrentAction.START) == true) {
                                    TorrentMenuItem(torrent.pauseResumeLabelRes(), torrent, TorrentAction.START, dismiss, onResume)
                                } else if (torrent?.allows(TorrentAction.PAUSE) == true) {
                                    TorrentMenuItem(R.string.action_pause, torrent, TorrentAction.PAUSE, dismiss, onPause)
                                }
                                TorrentMenuItem(R.string.action_move_top, torrent, TorrentAction.MOVE_TOP, dismiss, onMoveTop)
                                TorrentMenuItem(R.string.action_move_bottom, torrent, TorrentAction.MOVE_BOTTOM, dismiss, onMoveBottom)
                                TorrentMenuItem(R.string.action_force_recheck, torrent, TorrentAction.FORCE_RECHECK, dismiss, onForceRecheck)
                                if (torrent?.archived == true) {
                                    TorrentMenuItem(R.string.action_restore, torrent, TorrentAction.RESTORE, dismiss, onRestore)
                                } else {
                                    TorrentMenuItem(R.string.action_archive, torrent, TorrentAction.ARCHIVE, dismiss, onArchive)
                                }
                                TorrentMenuItem(R.string.action_copy_magnet, torrent, TorrentAction.COPY_MAGNET, dismiss, onCopyMagnet)
                                TorrentMenuItem(R.string.action_remove, torrent, TorrentAction.REMOVE, dismiss, onRemove)
                                HorizontalDivider()
                                DropdownMenuItem(text = { Text(stringResource(R.string.library_menu_speed)) }, onClick = { overflow = false; onSpeed() })
                                DropdownMenuItem(text = { Text(stringResource(R.string.library_menu_dht)) }, onClick = { overflow = false; onDht() })
                                DropdownMenuItem(text = { Text(stringResource(R.string.logs_title)) }, onClick = { overflow = false; onLogs() })
                                DropdownMenuItem(text = { Text(stringResource(R.string.settings_title)) }, onClick = { overflow = false; onSettings() })
                            }
                        }
                    },
                )
            }
        },
        bottomBar = {
            if (fileSelection.isNotEmpty()) {
                FileSelectionBottomBar(
                    selected = selectedFiles,
                    archived = torrent?.archived == true,
                    onSetPriority = onSetFilePriority,
                    onDownloadNow = onDownloadFile,
                )
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (torrent?.archived == true) {
                ArchivedBanner(onRestore)
            }
            ScrollableTabRow(selectedTabIndex = pager.currentPage, edgePadding = 8.dp) {
                TorrentDetailTab.entries.forEachIndexed { index, tab ->
                    Tab(
                        selected = pager.currentPage == index,
                        onClick = { scope.launch { pager.animateScrollToPage(index) } },
                        text = { Text(stringResource(tab.labelRes)) },
                    )
                }
            }
            // Pages start at the top; the pager would otherwise center short pages.
            HorizontalPager(
                state = pager,
                modifier = Modifier.fillMaxSize(),
                verticalAlignment = Alignment.Top,
            ) { page ->
                DetailTabContent(
                    TorrentDetailTab.entries[page],
                    torrent,
                    state,
                    fileSelection,
                    { fileSelection = it },
                    onSetFilePriority,
                    onDownloadFile,
                    onPlayFile,
                    onOpenFile,
                    onFilePage,
                    onTrackerPage,
                    onTransferLimits,
                )
            }
        }
    }
}

@Composable
private fun DetailTabContent(
    tab: TorrentDetailTab,
    torrent: TorrentView?,
    state: ProductState,
    fileSelection: Set<String>,
    onFileSelectionChange: (Set<String>) -> Unit,
    onSetFilePriority: (List<org.rstorrent.session.uniffi.FileView>, FilePriority) -> Unit,
    onDownloadFile: (List<org.rstorrent.session.uniffi.FileView>) -> Unit,
    onPlayFile: (org.rstorrent.session.uniffi.FileView) -> Unit,
    onOpenFile: (org.rstorrent.session.uniffi.FileView) -> Unit,
    onFilePage: (UInt) -> Unit,
    onTrackerPage: (UInt) -> Unit,
    onTransferLimits: (TorrentSettingsPatch) -> Unit,
) {
    if (torrent == null) {
        CenterMessage(stringResource(R.string.torrent_unavailable))
        return
    }
    when (tab) {
        TorrentDetailTab.DETAILS ->
            TorrentDetails(
                torrent,
                state.presentedClientSettings()?.configured,
                onTransferLimits,
                *buildList {
                    val v1 = torrent.protocolIdentities.v1
                    val v2 = torrent.protocolIdentities.v2
                    if (v1 != null && v2 != null) {
                        add(stringResource(R.string.detail_info_hash_v1) to v1)
                        add(stringResource(R.string.detail_info_hash_v2) to v2)
                    } else {
                        add(stringResource(R.string.detail_info_hash) to (v1 ?: v2 ?: "—"))
                    }
                    add(stringResource(R.string.detail_size) to formatBytes(torrent.totalSizeBytes))
                    state.storage?.roots?.firstOrNull { it.rootId == torrent.storageRoot }?.let {
                        add(stringResource(R.string.detail_save_location) to it.label)
                    }
                    add(stringResource(R.string.detail_downloaded) to formatBytes(torrent.lifetime.downloadedPayloadBytes))
                    add(stringResource(R.string.detail_uploaded) to formatBytes(torrent.lifetime.uploadedPayloadBytes))
                    add(stringResource(R.string.detail_share_ratio) to formatShareRatio(torrent.lifetime.shareRatioHundredths))
                    add(stringResource(R.string.detail_seeding_time) to formatDuration(torrent.lifetime.seedingSeconds))
                    seedStopProgress(torrent, state.presentedClientSettings()?.configured)?.let {
                        add(stringResource(R.string.detail_stop_seeding) to seedStopProgressText(it))
                    }
                }.toTypedArray(),
            )
        TorrentDetailTab.STATUS ->
            DetailList(
                *buildList {
                    val state = torrentStatusLabel(torrent)
                    val activity = torrentActivityLabel(torrent)
                    add(stringResource(R.string.detail_state) to state)
                    if (activity != state) add(stringResource(R.string.detail_activity) to activity)
                    add(stringResource(R.string.detail_download) to formatRate(torrent.payloadDownloadRateBytes))
                    add(stringResource(R.string.detail_peers) to torrent.activePeerConnections.toString())
                    add(stringResource(R.string.detail_eta) to torrentEta(torrent))
                    torrent.error?.let { add(stringResource(R.string.detail_error) to it) }
                }.toTypedArray(),
            )
        TorrentDetailTab.PIECES -> {
            val pieces = state.pieces[torrent.torrentId]
            if (pieces == null) {
                CenterMessage(stringResource(R.string.piece_activity_loading))
            } else {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
                    Text(
                        stringResource(
                            R.string.pieces_verified,
                            pieces.verified.sumOf { (it.endExclusive - it.start).toInt() },
                            pieces.pieceCount.toLong(),
                        ),
                    )
                    Spacer(Modifier.height(12.dp))
                    PieceMap(pieces.pieceCount, pieces.verified, pieces.active)
                    DiskSummary(state.disk, torrent.torrentId)
                }
            }
        }
        TorrentDetailTab.FILES ->
            FilesScreen(
                catalog = state.files[torrent.torrentId],
                archived = torrent.archived,
                selection = fileSelection,
                onSelectionChange = onFileSelectionChange,
                onSetPriority = onSetFilePriority,
                onDownloadNow = onDownloadFile,
                onPlay = onPlayFile,
                onOpen = onOpenFile,
                mediaLaunchPending = state.mediaLaunchPending,
                onPage = onFilePage,
            )
        TorrentDetailTab.TRACKERS ->
            TrackersScreen(state.trackers[torrent.torrentId], onTrackerPage)
        TorrentDetailTab.PEERS ->
            PeersScreen(
                state.peers[torrent.torrentId]?.values,
                state.swarms[torrent.torrentId],
            )
    }
}

@Composable
private fun TorrentDetails(
    torrent: TorrentView,
    global: ClientSettings?,
    onTransferLimits: (TorrentSettingsPatch) -> Unit,
    vararg rows: Pair<String, String>,
) {
    LazyColumn(
        modifier = Modifier.testTag("torrent-details"),
        contentPadding = PaddingValues(vertical = 8.dp),
    ) {
        items(rows.toList()) { (label, value) -> ReadOnlySetting(label, value) }
        item("speed-limits") { SettingsSection(stringResource(R.string.settings_section_speed_limits)) }
        item("download-rate-limit") {
            RateLimitSetting(
                title = stringResource(R.string.torrent_download_limit),
                configured = torrent.transferLimits.download,
                onValue = { limit ->
                    onTransferLimits(torrentSettingsPatch(downloadRateLimit = limit))
                },
            )
        }
        item("upload-rate-limit") {
            RateLimitSetting(
                title = stringResource(R.string.torrent_upload_limit),
                configured = torrent.transferLimits.upload,
                onValue = { limit ->
                    onTransferLimits(torrentSettingsPatch(uploadRateLimit = limit))
                },
            )
        }
        item("stop-seeding") { SettingsSection(stringResource(R.string.settings_section_stop_seeding)) }
        val stop = torrent.seedStopLimits()
        item("seed-stop-ratio") {
            SeedStopRatioSetting(
                configured = stop.ratioPercent,
                global = global?.seedStopRatioPercent,
                perTorrent = true,
                onValue = { limit ->
                    onTransferLimits(torrentSettingsPatch(seedStopRatioPercent = limit))
                },
            )
        }
        item("seed-stop-time") {
            SeedStopTimeSetting(
                configured = stop.timeSeconds,
                global = global?.seedStopTimeSeconds,
                perTorrent = true,
                onValue = { limit ->
                    onTransferLimits(torrentSettingsPatch(seedStopTimeSeconds = limit))
                },
            )
        }
    }
}

@Composable
private fun DetailList(vararg rows: Pair<String, String>) {
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        items(rows.toList()) { (label, value) -> ReadOnlySetting(label, value) }
    }
}

@Composable
private fun LogsShell(
    events: List<DiagnosticEvent>,
    sourceEvicted: String,
    localEvicted: ULong,
    resets: ULong,
    selectedTorrent: String?,
    service: ProductEngineService?,
    onBack: () -> Unit,
) {
    var profileName by rememberSaveable { mutableStateOf(DiagnosticProfile.NORMAL.name) }
    var severityName by rememberSaveable { mutableStateOf(DiagnosticSeverity.INFO.name) }
    var category by rememberSaveable { mutableStateOf("") }
    var torrentOnly by rememberSaveable { mutableStateOf(false) }
    var profileMenu by remember { mutableStateOf(false) }
    var severityMenu by remember { mutableStateOf(false) }
    var categoryMenu by remember { mutableStateOf(false) }
    LaunchedEffect(profileName, severityName, category, torrentOnly, selectedTorrent, service) {
        service?.configureDiagnostics(
            DiagnosticProfile.valueOf(profileName),
            DiagnosticSeverity.valueOf(severityName),
            category.takeIf(String::isNotEmpty)?.let { listOf(DiagnosticCategory(it)) }.orEmpty(),
            torrentOnly && selectedTorrent != null,
        )
    }
    SettingsPage(stringResource(R.string.logs_title), onBack) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Box {
                TextButton(onClick = { profileMenu = true }) {
                    Text(stringResource(R.string.logs_profile, profileName.lowercase()))
                }
                DropdownMenu(profileMenu, onDismissRequest = { profileMenu = false }) {
                    DiagnosticProfile.entries.forEach { profile ->
                        DropdownMenuItem(
                            text = { Text(profile.name.lowercase()) },
                            onClick = { profileName = profile.name; profileMenu = false },
                        )
                    }
                }
            }
            Box {
                TextButton(onClick = { severityMenu = true }) {
                    Text(stringResource(R.string.logs_minimum, severityName.lowercase()))
                }
                DropdownMenu(severityMenu, onDismissRequest = { severityMenu = false }) {
                    DiagnosticSeverity.entries.forEach { severity ->
                        DropdownMenuItem(
                            text = { Text(severity.name.lowercase()) },
                            onClick = { severityName = severity.name; severityMenu = false },
                        )
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                TextButton(onClick = { categoryMenu = true }) {
                    Text(
                        stringResource(
                            R.string.logs_category,
                            category.ifEmpty { stringResource(R.string.logs_all) },
                        ),
                    )
                }
                DropdownMenu(categoryMenu, onDismissRequest = { categoryMenu = false }) {
                    LOG_CATEGORIES.forEach { option ->
                        DropdownMenuItem(
                            text = {
                                Text(option.ifEmpty { stringResource(R.string.logs_all) })
                            },
                            onClick = { category = option; categoryMenu = false },
                        )
                    }
                }
            }
            Text(stringResource(R.string.logs_current_torrent))
            Switch(
                checked = torrentOnly && selectedTorrent != null,
                onCheckedChange = { torrentOnly = it },
                enabled = selectedTorrent != null,
            )
        }
        HorizontalDivider()
        ListItem(
            headlineContent = { Text(stringResource(R.string.logs_delivery_health)) },
            supportingContent = {
                Text(
                    stringResource(
                        R.string.logs_delivery_summary,
                        sourceEvicted,
                        localEvicted.toLong(),
                        resets.toLong(),
                    ),
                )
            },
        )
        HorizontalDivider()
        if (events.isEmpty()) {
            Text(
                stringResource(R.string.logs_empty),
                modifier = Modifier.padding(24.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            // Newest first: the latest event is visible without scrolling.
            events.takeLast(200).asReversed().forEach { event ->
                ListItem(
                    headlineContent = { Text(event.code, fontFamily = FontFamily.Monospace) },
                    supportingContent = {
                        Column {
                            Text(
                                "${event.severity.name.lowercase()} · ${event.category.value}",
                                fontFamily = FontFamily.Monospace,
                            )
                            Text(event.message)
                        }
                    },
                )
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun SettingsHub(navController: NavHostController) {
    SettingsPage(stringResource(R.string.settings_title), navController::popBackStack) {
        SettingsDestination(stringResource(R.string.settings_storage), stringResource(R.string.settings_storage_detail), Icons.Outlined.Folder) {
            navController.navigate(ProductRoutes.SETTINGS_STORAGE)
        }
        SettingsDestination(stringResource(R.string.settings_speed_limits), stringResource(R.string.settings_speed_limits_detail), Icons.Outlined.Speed) {
            navController.navigate(ProductRoutes.SETTINGS_SPEED)
        }
        SettingsDestination(stringResource(R.string.settings_notifications), stringResource(R.string.settings_notifications_detail), Icons.Outlined.Notifications) {
            navController.navigate(ProductRoutes.SETTINGS_NOTIFICATIONS)
        }
        SettingsDestination(stringResource(R.string.settings_network_privacy), stringResource(R.string.settings_network_privacy_detail), Icons.Outlined.NetworkCheck) {
            navController.navigate(ProductRoutes.SETTINGS_NETWORK)
        }
        SettingsDestination(stringResource(R.string.settings_power_management), stringResource(R.string.settings_power_management_detail), Icons.Outlined.BatterySaver) {
            navController.navigate(ProductRoutes.SETTINGS_POWER)
        }
        SettingsDestination(stringResource(R.string.settings_advanced), stringResource(R.string.settings_advanced_detail), Icons.Outlined.Settings) {
            navController.navigate(ProductRoutes.SETTINGS_ADVANCED)
        }
    }
}

@Composable
private fun SettingsDestination(
    title: String,
    detail: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(detail) },
        leadingContent = { Icon(icon, contentDescription = null) },
        trailingContent = { Text(stringResource(R.string.navigation_disclosure)) },
        modifier =
            Modifier.clickable(onClick = onClick)
                .semantics(mergeDescendants = true) { role = Role.Button },
    )
    HorizontalDivider()
}

@Composable
private fun SimpleRouteScreen(
    title: String,
    onBack: () -> Unit,
    description: String,
) {
    SettingsPage(title, onBack) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, modifier = Modifier.size(48.dp))
            Spacer(Modifier.height(12.dp))
            Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SettingsPage(
    title: String,
    onBack: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.action_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()),
            content = content,
        )
    }
}

private val LOG_CATEGORIES =
    listOf(
        "",
        "lifecycle",
        "discovery",
        "tracker",
        "peer",
        "metadata",
        "scheduler",
        "piece",
        "storage",
        "integrity",
        "platform",
        "performance",
    )

@Composable
private fun productThemeModeLabel(mode: ProductThemeMode): String =
    stringResource(
        when (mode) {
            ProductThemeMode.SYSTEM -> R.string.theme_system
            ProductThemeMode.LIGHT -> R.string.theme_light
            ProductThemeMode.DARK -> R.string.theme_dark
        },
    )

@Composable
private fun ReadOnlySetting(
    title: String,
    detail: String,
) {
    ListItem(headlineContent = { Text(title) }, supportingContent = { Text(detail) })
    HorizontalDivider()
}

@Composable
private fun NotificationToggleSetting(
    title: String,
    detail: String?,
    checked: Boolean,
    onChecked: (Boolean) -> Unit,
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = detail?.let { { Text(it) } },
        trailingContent = { Switch(checked = checked, onCheckedChange = null) },
        modifier =
            Modifier.clickable { onChecked(!checked) }
                .semantics(mergeDescendants = true) { role = Role.Switch },
    )
    HorizontalDivider()
}

@Composable
private fun FeedbackSetting(onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(stringResource(R.string.settings_report_bug)) },
        supportingContent = { Text(stringResource(R.string.settings_report_bug_detail)) },
        leadingContent = { Icon(Icons.Outlined.BugReport, contentDescription = null) },
        trailingContent = { Text(stringResource(R.string.navigation_disclosure)) },
        modifier =
            Modifier.clickable(onClick = onClick)
                .semantics(mergeDescendants = true) { role = Role.Button },
    )
    HorizontalDivider()
}

@Composable
private fun SettingAction(
    title: String,
    detail: String?,
    onClick: () -> Unit,
    action: String,
    enabled: Boolean = true,
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = detail?.let { { Text(it) } },
        trailingContent = { TextButton(onClick = onClick, enabled = enabled) { Text(action) } },
    )
    HorizontalDivider()
}

/** One download folder: a star marks the default; the menu holds the less common actions. */
@Composable
private fun StorageRootRow(
    label: String,
    path: String?,
    isDefault: Boolean,
    available: Boolean,
    onRepair: () -> Unit,
    onMakeDefault: () -> Unit,
    onRemove: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val defaultDescription = stringResource(R.string.storage_default)
    val supporting = if (available) path else stringResource(R.string.storage_unavailable)
    ListItem(
        headlineContent = { Text(label) },
        supportingContent = supporting?.let { { Text(it) } },
        leadingContent = {
            if (isDefault) {
                Icon(Icons.Filled.Star, contentDescription = defaultDescription)
            } else {
                Icon(Icons.Outlined.Folder, contentDescription = null)
            }
        },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (!available) {
                    TextButton(onClick = onRepair) { Text(stringResource(R.string.action_repair)) }
                }
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(
                            Icons.Outlined.MoreVert,
                            contentDescription = stringResource(R.string.storage_folder_actions, label),
                        )
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        if (!isDefault && available) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.storage_set_default)) },
                                onClick = { menu = false; onMakeDefault() },
                            )
                        }
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.storage_remove_folder)) },
                            onClick = { menu = false; onRemove() },
                        )
                    }
                }
            }
        },
    )
    HorizontalDivider()
}

@Composable
private fun CenterMessage(message: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun TorrentMenuItem(
    @StringRes label: Int,
    torrent: TorrentView?,
    action: TorrentAction,
    dismiss: () -> Unit,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = { Text(stringResource(label)) },
        enabled = torrent?.allows(action) == true,
        onClick = {
            dismiss()
            onClick()
        },
    )
}

@Composable
private fun ArchivedBanner(onRestore: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        colors = CardDefaults.cardColors(MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.Archive,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(
                    stringResource(R.string.detail_archived_title),
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
                Text(
                    stringResource(R.string.detail_archived_detail),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
            Button(onClick = onRestore) { Text(stringResource(R.string.action_restore)) }
        }
    }
}

@Composable
private fun RemoveDialog(
    count: Int,
    onDismiss: () -> Unit,
    onKeep: () -> Unit,
    onDelete: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(pluralStringResource(R.plurals.remove_torrent_title, count, count)) },
        text = { Text(stringResource(R.string.remove_torrent_detail)) },
        confirmButton = { TextButton(onClick = onDelete) { Text(stringResource(R.string.action_delete_data)) } },
        dismissButton = {
            Row {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) }
                TextButton(onClick = onKeep) { Text(stringResource(R.string.action_keep_data)) }
            }
        },
    )
}

/**
 * Material snackbars cannot be swiped away on their own. A sideways swipe
 * dismisses this one, which also declines its action, and lets the next
 * queued message show at once.
 */
@Composable
private fun SwipeableSnackbar(data: SnackbarData) {
    key(data) {
        val dismissState =
            rememberSwipeToDismissBoxState(
                confirmValueChange = { value ->
                    if (value != SwipeToDismissBoxValue.Settled) data.dismiss()
                    true
                },
            )
        SwipeToDismissBox(state = dismissState, backgroundContent = {}) {
            Snackbar(data)
        }
    }
}
