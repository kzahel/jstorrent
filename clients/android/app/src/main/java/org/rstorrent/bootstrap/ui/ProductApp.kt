@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.rstorrent.bootstrap.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Card
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
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
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
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.ProductNotificationNavigation
import org.rstorrent.bootstrap.ProductNotificationPreference
import org.rstorrent.bootstrap.ProductState
import org.rstorrent.bootstrap.ExternalIntakeNoticeKind
import org.rstorrent.bootstrap.ExternalIntakePhase
import org.rstorrent.bootstrap.ExternalIntakePresentation
import org.rstorrent.bootstrap.GlobalPresentation
import org.rstorrent.bootstrap.TorrentPresentation
import org.rstorrent.bootstrap.clientSettingsPatch
import org.rstorrent.bootstrap.presentedClientSettings
import org.rstorrent.bootstrap.presentedTorrent
import org.rstorrent.bootstrap.torrentSettingsPatch
import org.rstorrent.session.uniffi.DiagnosticEvent
import org.rstorrent.session.uniffi.DiagnosticCategory
import org.rstorrent.session.uniffi.DiagnosticProfile
import org.rstorrent.session.uniffi.DiagnosticSeverity
import org.rstorrent.session.uniffi.ClientSettingsPatch
import org.rstorrent.session.uniffi.FilePriority
import org.rstorrent.session.uniffi.ProductFeedbackPreview
import org.rstorrent.session.uniffi.RemovalDataPolicy
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
    onOpenFeedback: (Boolean, String) -> Unit = { _, _ -> },
    onPreviewFeedback: (suspend (Boolean) -> ProductFeedbackPreview?)? = null,
    onOpenPrivacy: () -> Unit = {},
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
                    onOpenFeedback = onOpenFeedback,
                    onPreviewFeedback = onPreviewFeedback,
                    onOpenPrivacy = onOpenPrivacy,
                    notificationNavigation = notificationNavigation,
                    onNotificationNavigationConsumed = onNotificationNavigationConsumed,
                    onNotificationNavigationFallback = { message ->
                        notificationScope.launch { snackbar.showSnackbar(message) }
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
            )
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
                onDownloadAll = { service?.downloadAllPendingAdd(torrent.torrentId) },
                onCancel = { service?.cancelPendingAdd(torrent.torrentId) },
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
            ProductDataResetPhase.RESETTING_PROFILE -> R.string.data_reset_phase_profile
            ProductDataResetPhase.RELEASING_ROOTS -> R.string.data_reset_phase_folders
            ProductDataResetPhase.RESETTING_PREFERENCES -> R.string.data_reset_phase_preferences
            ProductDataResetPhase.RESTARTING_APPLICATION -> R.string.data_reset_phase_restarting
            ProductDataResetPhase.VERIFYING_APPLICATION -> R.string.data_reset_phase_verifying
            null -> R.string.data_reset_phase_starting
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
                Text(
                    stringResource(R.string.file_selection_folder, rootLabel),
                    style = MaterialTheme.typography.bodySmall,
                )
                if (!storageRootReady) {
                    Text(stringResource(R.string.intake_folder_required))
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
            TextButton(
                onClick = {
                    if (intake.phase == ExternalIntakePhase.RETRYABLE_FAILURE) {
                        onRetry(intake.intakeId)
                    } else {
                        onConfirm(intake.intakeId)
                    }
                },
                enabled =
                    storageRootReady &&
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
    onOpenFeedback: (Boolean, String) -> Unit,
    onPreviewFeedback: (suspend (Boolean) -> ProductFeedbackPreview?)?,
    onOpenPrivacy: () -> Unit,
    notificationNavigation: ProductNotificationNavigation?,
    onNotificationNavigationConsumed: (Long) -> Unit,
    onNotificationNavigationFallback: (String) -> Unit,
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
    var removeTargets by remember { mutableStateOf(emptySet<String>()) }
    var removeStorageRoot by remember { mutableStateOf<String?>(null) }
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
                onAddMagnet = { magnet, chooseFiles ->
                    service?.addMagnet(
                        magnet,
                        startContent = true,
                        awaitFileSelection = chooseFiles,
                        downloadAll = !chooseFiles,
                    )
                },
                onBrowseTorrent = {
                    onBrowseTorrent(state.storage?.showFileSelection ?: true)
                },
                onPause = { service?.pause(it) },
                onResume = { service?.resume(it) },
                onMoveTop = { service?.moveDownloadToTop(it) },
                onMoveBottom = { service?.moveDownloadToBottom(it) },
                onArchive = { id ->
                    if (state.torrents[id]?.archived == true) service?.restoreArchive(id)
                    else service?.archive(id)
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
            DisposableEffect(torrentId) {
                service?.selectTorrent(torrentId)
                onDispose { service?.clearTorrentPresentation(torrentId) }
            }
            TorrentDetailScreen(
                torrent = torrent,
                state = state,
                onBack = navController::popBackStack,
                onPause = { service?.pause(torrentId) },
                onResume = { service?.resume(torrentId) },
                onForceRecheck = { service?.forceRecheck(torrentId) },
                onMoveTop = { service?.moveDownloadToTop(torrentId) },
                onMoveBottom = { service?.moveDownloadToBottom(torrentId) },
                onArchive = { service?.archive(torrentId) },
                onRestore = { service?.restoreArchive(torrentId) },
                onRemove = { removeTargets = setOf(torrentId) },
                onCopyMagnet = { service?.copyMagnet(torrentId) },
                onTransferLimits = { onUpdateTorrentSettings(torrentId, it) },
                onSpeed = { navController.navigate(ProductRoutes.SPEED) },
                onDht = { navController.navigate(ProductRoutes.DHT) },
                onLogs = { navController.navigate(ProductRoutes.LOGS) },
                onSettings = { navController.navigate(ProductRoutes.SETTINGS) },
                onPresent = { service?.presentTorrent(torrentId, it) },
                onSetFilePriority = { file, priority ->
                    service?.setFilePriority(torrentId, file.fileIndex, priority)
                },
                onDownloadFile = { service?.downloadFileNow(torrentId, it.fileIndex) },
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
            DisposableEffect(service) {
                service?.presentGlobal(GlobalPresentation.SPEED)
                onDispose { service?.presentGlobal(GlobalPresentation.NONE) }
            }
            SpeedScreen(state.speed, state.currentRates, navController::popBackStack)
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
                SettingAction(
                    title = state.storageRootLabel ?: stringResource(R.string.download_folder),
                    detail =
                        stringResource(
                            if (state.storageRootReady) {
                                R.string.storage_available
                            } else {
                                R.string.storage_unavailable
                            },
                        ),
                    onClick = onSelectStorage,
                    action =
                        stringResource(
                            if (state.storageRootReady) R.string.action_change else R.string.action_select,
                        ),
                )
                NotificationToggleSetting(
                    title = stringResource(R.string.storage_show_file_selection),
                    detail = stringResource(R.string.storage_show_file_selection_detail),
                    checked = state.storage?.showFileSelection ?: true,
                    onChecked = { service?.setShowFileSelection(it) },
                )
                state.storage?.roots.orEmpty().forEach { root ->
                    val isCurrent = root.rootId == state.storage?.defaultRoot
                    val isReferenced = state.torrents.values.any { it.storageRoot == root.rootId }
                    val title =
                        if (isCurrent) {
                            stringResource(R.string.storage_current_suffix, root.label)
                        } else {
                            root.label
                        }
                    val detail =
                        root.displayPath?.let {
                            stringResource(
                                R.string.storage_path_detail,
                                root.availability.name.lowercase(),
                                it,
                            )
                        } ?: stringResource(
                            R.string.storage_provider_detail,
                            root.availability.name.lowercase(),
                        )
                    if (root.availability == StorageRootAvailability.UNAVAILABLE) {
                        SettingAction(
                            title = title,
                            detail = detail,
                            onClick = { onRepairStorage(root.rootId) },
                            action = stringResource(R.string.action_repair),
                        )
                    } else if (!isCurrent) {
                        SettingAction(
                            title = title,
                            detail = detail,
                            onClick = { service?.makeSafRootCurrent(root.rootId) },
                            action = stringResource(R.string.action_use),
                        )
                    } else {
                        ReadOnlySettingsRow(title, detail)
                    }
                    if (!isCurrent && !isReferenced) {
                        SettingAction(
                            title = stringResource(R.string.forget_folder_action, root.label),
                            detail = stringResource(R.string.forget_folder_detail),
                            onClick = { removeStorageRoot = root.rootId },
                            action = stringResource(R.string.action_remove),
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
                        onShareRatioLimit = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(shareRatioLimitPercent = value),
                            )
                        },
                        onFinishedDownloadRatioLimit = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(
                                    finishedDownloadRatioLimitPercent = value,
                                ),
                            )
                        },
                        onFinishedTimeLimit = { value ->
                            onUpdateClientSettings(
                                clientSettingsPatch(finishedTimeLimitSeconds = value),
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
                    )
                }
            }
        }
        composable(ProductRoutes.SETTINGS_NOTIFICATIONS) {
            SettingsPage(stringResource(R.string.settings_notifications), navController::popBackStack) {
                val notificationState = state.notifications
                val backgroundVisible =
                    notificationsGranted &&
                        notificationState.appNotificationsEnabled &&
                        notificationState.backgroundChannelEnabled
                SettingAction(
                    title =
                        when {
                            !notificationsGranted -> stringResource(R.string.notifications_disabled)
                            !notificationState.appNotificationsEnabled -> stringResource(R.string.notifications_blocked)
                            !notificationState.backgroundChannelEnabled ->
                                stringResource(R.string.notifications_background_blocked)
                            else -> stringResource(R.string.notifications_enabled)
                        },
                    detail =
                        if (backgroundVisible) {
                            stringResource(R.string.notifications_foreground_status)
                        } else {
                            stringResource(R.string.library_background_unavailable)
                        },
                    onClick = if (notificationsGranted) onOpenNotificationSettings else onRequestNotifications,
                    action =
                        stringResource(
                            if (notificationsGranted) R.string.action_manage else R.string.action_enable,
                        ),
                )
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
                SettingAction(
                    title = stringResource(R.string.notifications_manage_system),
                    detail = stringResource(R.string.notifications_manage_system_detail),
                    onClick = onOpenNotificationSettings,
                    action = stringResource(R.string.action_open),
                )
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
                ListItem(
                    headlineContent = { Text(stringResource(R.string.power_continue_background)) },
                    supportingContent = {
                        Text(
                            when {
                                lifecycle.effectiveBackgroundDownloads ->
                                    stringResource(R.string.power_continue_effective)
                                lifecycle.backgroundDownloadsEnabled ->
                                    stringResource(R.string.power_continue_blocked)
                                else ->
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
                ListItem(
                    headlineContent = { Text(stringResource(R.string.power_keep_seeding_background)) },
                    supportingContent = {
                        Text(
                            if (lifecycle.backgroundDownloadsEnabled) {
                                stringResource(R.string.power_keep_seeding_detail_enabled)
                            } else {
                                stringResource(R.string.power_keep_seeding_requires_background)
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
                ReadOnlySetting(
                    stringResource(R.string.power_background_limits),
                    stringResource(R.string.power_background_limits_detail),
                )
                lifecycle.preferenceError?.let {
                    ReadOnlySetting(stringResource(R.string.setting_not_saved), productErrorText(it))
                }
                UnavailableSetting(stringResource(R.string.power_low_battery_shutdown))
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
                Text(stringResource(R.string.settings_theme), modifier = Modifier.padding(16.dp), fontWeight = FontWeight.SemiBold)
                ProductThemeMode.entries.forEach { mode ->
                    ListItem(
                        headlineContent = { Text(productThemeModeLabel(mode)) },
                        leadingContent = {
                            RadioButton(selected = themeMode == mode, onClick = { onThemeMode(mode) })
                        },
                        modifier = Modifier.semantics { role = Role.RadioButton },
                    )
                }
                ListItem(
                    headlineContent = { Text(stringResource(R.string.theme_use_system_colors)) },
                    supportingContent = { Text(stringResource(R.string.theme_system_colors_requirement)) },
                    trailingContent = {
                        Switch(checked = dynamicColor, onCheckedChange = onDynamicColor)
                    },
                )
                HorizontalDivider()
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
                    ReadOnlySetting(
                        stringResource(R.string.product_statistics_summary),
                        stringResource(
                            R.string.product_statistics_summary_values,
                            summary.daysSinceFirstUse.toString(),
                            summary.torrentsAdded,
                            summary.downloadsCompleted,
                            summary.foregroundSessions,
                        ),
                    )
                    SettingAction(
                        title = stringResource(R.string.product_statistics_reset),
                        detail = stringResource(R.string.product_statistics_reset_detail),
                        onClick = { confirmResetStatistics = true },
                        action = stringResource(R.string.action_reset),
                        enabled = service != null,
                    )
                }
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
                SettingAction(
                    title = stringResource(R.string.action_privacy_policy),
                    detail = stringResource(R.string.product_privacy_policy_detail),
                    onClick = onOpenPrivacy,
                    action = stringResource(R.string.action_open),
                )
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
                UnavailableSetting(stringResource(R.string.settings_search_plugins))
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
                                .clickable(enabled = preview.statisticsAvailable) {
                                    val include = !feedbackIncludeStatistics
                                    feedbackIncludeStatistics = include
                                    feedbackBusy = true
                                    productPrivacyScope.launch {
                                        runCatching {
                                            onPreviewFeedback?.invoke(include)
                                                ?: service?.productFeedbackPreview(include)
                                        }
                                            .onSuccess { feedbackPreview = it }
                                            .onFailure {
                                                feedbackError = it.message ?: feedbackPreviewFailedMessage
                                            }
                                        feedbackBusy = false
                                    }
                                }.semantics(mergeDescendants = true) { role = Role.Checkbox },
                    ) {
                        Checkbox(
                            checked = feedbackIncludeStatistics && preview.statisticsAvailable,
                            onCheckedChange = null,
                            enabled = preview.statisticsAvailable,
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
                    Text(
                        stringResource(
                            if (deleteDownloadedFiles) {
                                R.string.clear_all_data_delete_scope
                            } else {
                                R.string.clear_all_data_keep_scope
                            },
                        ),
                        style = MaterialTheme.typography.bodySmall,
                    )
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
        RemoveDialog(
            count = removeTargets.size,
            onDismiss = { removeTargets = emptySet() },
            onKeep = {
                removeTargets.forEach { service?.removeTorrent(it, RemovalDataPolicy.KEEP) }
                removeTargets = emptySet()
            },
            onDelete = {
                removeTargets.forEach { service?.removeTorrent(it, RemovalDataPolicy.DELETE_DATA) }
                removeTargets = emptySet()
            },
        )
    }
    removeStorageRoot?.let { rootId ->
        val label = state.storage?.roots?.singleOrNull { it.rootId == rootId }?.label ?: rootId
        AlertDialog(
            onDismissRequest = { removeStorageRoot = null },
            title = { Text(stringResource(R.string.remove_folder_title, label)) },
            text = {
                Text(
                    stringResource(R.string.remove_folder_detail),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        service?.removeSafRoot(rootId)
                        removeStorageRoot = null
                    },
                ) {
                    Text(stringResource(R.string.action_remove))
                }
            },
            dismissButton = {
                TextButton(onClick = { removeStorageRoot = null }) {
                    Text(stringResource(R.string.action_cancel))
                }
            },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TorrentDetailScreen(
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
    onSetFilePriority: (org.rstorrent.session.uniffi.FileView, FilePriority) -> Unit,
    onDownloadFile: (org.rstorrent.session.uniffi.FileView) -> Unit,
    onPlayFile: (org.rstorrent.session.uniffi.FileView) -> Unit,
    onOpenFile: (org.rstorrent.session.uniffi.FileView) -> Unit,
    onFilePage: (UInt) -> Unit,
    onTrackerPage: (UInt) -> Unit,
) {
    var overflow by remember { mutableStateOf(false) }
    val pager = rememberPagerState(pageCount = { TorrentDetailTab.entries.size })
    val scope = rememberCoroutineScope()
    LaunchedEffect(pager.currentPage) {
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
                    val paused = torrent?.operationalState == TorrentOperationalState.PAUSED
                    IconButton(onClick = if (paused) onResume else onPause, enabled = torrent != null) {
                        Icon(
                            if (paused) Icons.Default.PlayArrow else Icons.Default.Pause,
                            contentDescription =
                                stringResource(
                                    if (paused) R.string.action_resume else R.string.action_pause,
                                ),
                        )
                    }
                    Box {
                        IconButton(onClick = { overflow = true }) {
                            Icon(
                                Icons.Outlined.MoreVert,
                                contentDescription = stringResource(R.string.a11y_more_options),
                            )
                        }
                        DropdownMenu(expanded = overflow, onDismissRequest = { overflow = false }) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.action_force_recheck)) },
                                enabled = torrent?.forceRecheckAvailable == true,
                                onClick = { overflow = false; onForceRecheck() },
                            )
                            DropdownMenuItem(text = { Text(stringResource(R.string.action_move_top)) }, onClick = { overflow = false; onMoveTop() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.action_move_bottom)) }, onClick = { overflow = false; onMoveBottom() })
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        stringResource(
                                            if (torrent?.archived == true) {
                                                R.string.action_restore_archive
                                            } else {
                                                R.string.action_archive
                                            },
                                        ),
                                    )
                                },
                                onClick = { overflow = false; if (torrent?.archived == true) onRestore() else onArchive() },
                            )
                            DropdownMenuItem(text = { Text(stringResource(R.string.action_remove_torrent)) }, onClick = { overflow = false; onRemove() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.action_copy_magnet)) }, onClick = { overflow = false; onCopyMagnet() })
                            HorizontalDivider()
                            DropdownMenuItem(text = { Text(stringResource(R.string.library_menu_speed)) }, onClick = { overflow = false; onSpeed() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.library_menu_dht)) }, onClick = { overflow = false; onDht() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.logs_title)) }, onClick = { overflow = false; onLogs() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.settings_title)) }, onClick = { overflow = false; onSettings() })
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            ScrollableTabRow(selectedTabIndex = pager.currentPage, edgePadding = 8.dp) {
                TorrentDetailTab.entries.forEachIndexed { index, tab ->
                    Tab(
                        selected = pager.currentPage == index,
                        onClick = { scope.launch { pager.animateScrollToPage(index) } },
                        text = { Text(stringResource(tab.labelRes)) },
                    )
                }
            }
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
                DetailTabContent(
                    TorrentDetailTab.entries[page],
                    torrent,
                    state,
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
    onSetFilePriority: (org.rstorrent.session.uniffi.FileView, FilePriority) -> Unit,
    onDownloadFile: (org.rstorrent.session.uniffi.FileView) -> Unit,
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
                    add(stringResource(R.string.detail_state) to operationalLabel(torrent.operationalState))
                    add(stringResource(R.string.detail_required) to formatBytes(torrent.requiredPayloadBytes))
                    add(stringResource(R.string.detail_remaining) to formatBytes(torrent.remainingPayloadBytes))
                    add(stringResource(R.string.detail_pieces) to "${torrent.verifiedPieceCount} / ${torrent.pieceCount}")
                    add(stringResource(R.string.detail_trackers) to (torrent.configuredTrackerCount?.toString() ?: "—"))
                    add(stringResource(R.string.detail_lifetime_downloaded) to formatBytes(torrent.lifetime.downloadedPayloadBytes))
                    add(stringResource(R.string.detail_lifetime_uploaded) to formatBytes(torrent.lifetime.uploadedPayloadBytes))
                    add(stringResource(R.string.detail_share_ratio) to formatShareRatio(torrent.lifetime.shareRatioHundredths))
                    add(stringResource(R.string.detail_active_time) to formatDuration(torrent.lifetime.activeSeconds))
                    add(stringResource(R.string.detail_finished_time) to formatDuration(torrent.lifetime.finishedSeconds))
                    add(stringResource(R.string.detail_seeding_time) to formatDuration(torrent.lifetime.seedingSeconds))
                    if (torrent.seeding.goal != null) {
                        add(stringResource(R.string.detail_seed_admission) to seedAdmissionLabel(torrent.seeding.admission))
                        add(stringResource(R.string.detail_seeding_priority_goal) to seedGoalLabel(torrent.seeding.goal))
                        add(
                            stringResource(R.string.detail_goal_behavior) to
                                stringResource(R.string.detail_goal_behavior_value),
                        )
                    }
                }.toTypedArray(),
            )
        TorrentDetailTab.STATUS ->
            DetailList(
                stringResource(R.string.detail_download) to formatRate(torrent.payloadDownloadRateBytes),
                stringResource(R.string.detail_peers) to torrent.activePeerConnections.toString(),
                stringResource(R.string.detail_eta) to torrentEta(torrent),
                stringResource(R.string.detail_storage) to torrent.storageState.name.lowercase(),
                stringResource(R.string.detail_progress) to torrent.progress.reason.name.lowercase(),
                stringResource(R.string.detail_error) to (torrent.error ?: stringResource(R.string.detail_none)),
            )
        TorrentDetailTab.PIECES -> {
            val pieces = state.pieces[torrent.torrentId]
            if (pieces == null) {
                CenterMessage(stringResource(R.string.piece_activity_loading))
            } else {
                Column(Modifier.padding(16.dp)) {
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
                state.files[torrent.torrentId],
                onSetFilePriority,
                onDownloadFile,
                onPlayFile,
                onOpenFile,
                state.mediaLaunchPending,
                onFilePage,
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
    onTransferLimits: (TorrentSettingsPatch) -> Unit,
    vararg rows: Pair<String, String>,
) {
    LazyColumn(
        modifier = Modifier.testTag("torrent-details"),
        contentPadding = PaddingValues(vertical = 8.dp),
    ) {
        items(rows.toList()) { (label, value) -> ReadOnlySetting(label, value) }
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
            events.takeLast(200).forEach { event ->
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
    detail: String,
    checked: Boolean,
    onChecked: (Boolean) -> Unit,
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(detail) },
        trailingContent = { Switch(checked = checked, onCheckedChange = null) },
        modifier =
            Modifier.clickable { onChecked(!checked) }
                .semantics(mergeDescendants = true) { role = Role.Switch },
    )
    HorizontalDivider()
}

@Composable
private fun UnavailableSetting(title: String) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(stringResource(R.string.setting_not_available)) },
        colors = androidx.compose.material3.ListItemDefaults.colors(
            headlineColor = MaterialTheme.colorScheme.onSurfaceVariant,
            supportingColor = MaterialTheme.colorScheme.outline,
        ),
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
    detail: String,
    onClick: () -> Unit,
    action: String,
    enabled: Boolean = true,
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(detail) },
        trailingContent = { TextButton(onClick = onClick, enabled = enabled) { Text(action) } },
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
