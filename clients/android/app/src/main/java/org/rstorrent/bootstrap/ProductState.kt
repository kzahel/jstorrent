package org.rstorrent.bootstrap

import org.rstorrent.session.uniffi.ActivePiece
import org.rstorrent.session.uniffi.ActivePieceFieldUpdate
import org.rstorrent.session.uniffi.ActivePieceUpdate
import org.rstorrent.session.uniffi.ClientSettingsRuntimeView
import org.rstorrent.session.uniffi.CatalogPageView
import org.rstorrent.session.uniffi.DhtInspectionView
import org.rstorrent.session.uniffi.DiagnosticEvent
import org.rstorrent.session.uniffi.DiskPieceView
import org.rstorrent.session.uniffi.DiskPipelineView
import org.rstorrent.session.uniffi.FileCatalogState
import org.rstorrent.session.uniffi.FileFieldUpdate
import org.rstorrent.session.uniffi.FileRowUpdate
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.IndexRange
import org.rstorrent.session.uniffi.MediaCatalogState
import org.rstorrent.session.uniffi.MediaItemView
import org.rstorrent.session.uniffi.PeerView
import org.rstorrent.session.uniffi.PeerFieldUpdate
import org.rstorrent.session.uniffi.PeerRowUpdate
import org.rstorrent.session.uniffi.ProductSummary
import org.rstorrent.session.uniffi.SessionCurrentRatesView
import org.rstorrent.session.uniffi.SpeedHistoryAppend
import org.rstorrent.session.uniffi.SpeedHistoryView
import org.rstorrent.session.uniffi.StorageSettingsSnapshot
import org.rstorrent.session.uniffi.SwarmCatalogState
import org.rstorrent.session.uniffi.SwarmCountsView
import org.rstorrent.session.uniffi.SwarmPeerView
import org.rstorrent.session.uniffi.TrackerCatalogState
import org.rstorrent.session.uniffi.TrackerView
import org.rstorrent.session.uniffi.TorrentView
import org.rstorrent.session.uniffi.TorrentFieldUpdate
import org.rstorrent.session.uniffi.TorrentRowUpdate
import org.rstorrent.session.uniffi.TorrentPreparationView
import org.rstorrent.session.uniffi.TorrentViewChange
import org.rstorrent.session.uniffi.ViewPatch
import org.rstorrent.session.uniffi.ViewSnapshot
import org.rstorrent.session.uniffi.ViewUpdate
import org.rstorrent.session.uniffi.ViewUpdatePayload

data class PieceActivityState(
    val torrentId: String,
    val pieceCount: UInt,
    val verified: List<IndexRange>,
    val active: List<ActivePiece>,
)

data class FileCatalogViewState(
    val state: FileCatalogState,
    val filesystemContentBase: String?,
    val page: CatalogPageView,
    val files: Map<String, FileView>,
)

data class TrackerCatalogViewState(
    val state: TrackerCatalogState,
    val page: CatalogPageView,
    val trackers: Map<String, TrackerView>,
)

data class MediaCatalogViewState(
    val state: MediaCatalogState,
    val totalNonPaddingFiles: UInt,
    val items: Map<String, MediaItemView>,
)

data class SwarmViewState(
    val state: SwarmCatalogState,
    val capturedMillis: String,
    val maximumRecords: UInt,
    val counts: SwarmCountsView,
    val peers: Map<String, SwarmPeerView>,
)

data class DiskViewState(
    val pipeline: DiskPipelineView,
    val pieces: Map<String, DiskPieceView>,
)

data class CompanionPairingState(
    val requestId: String,
    val extensionId: String,
    val extensionName: String,
    val installationId: String,
    val expiresInSeconds: ULong,
)

data class ProductLifecycleState(
    val backgroundDownloadsEnabled: Boolean = false,
    val keepSeedingEnabled: Boolean = false,
    val effectiveBackgroundDownloads: Boolean = false,
    val foreground: Boolean = true,
    val companionConnections: Int = 0,
    val reason: String? = null,
    val preferenceError: ProductError? = null,
)

sealed interface ProductError {
    enum class Code : ProductError {
        SELECT_DOWNLOAD_FOLDER,
        STORAGE_UNAVAILABLE,
        MEDIA_UNAVAILABLE,
        SETTINGS_UPDATE_EMPTY,
        SETTINGS_LOADING,
        POWER_SETTING_SAVE_FAILED,
        TORRENT_SETTINGS_UPDATE_EMPTY,
        TORRENT_MISSING,
        NETWORK_PREFERENCE_SAVE_FAILED,
        NOTIFICATION_PREFERENCE_SAVE_FAILED,
        BACKGROUND_NOTIFICATION_REQUIRED,
        BACKGROUND_DOWNLOADS_REQUIRED,
        BACKGROUND_SETTING_SAVE_FAILED,
        DATA_RESET_IN_PROGRESS,
    }

    data class MediaUnavailable(val reason: org.rstorrent.session.uniffi.MediaFileAvailability) :
        ProductError

    data class Technical(val detail: String) : ProductError
}

enum class ExternalIntakeNoticeKind {
    REJECTED,
    QUEUE_FULL,
    ADDED,
    ALREADY_PRESENT,
    SELECTION_EXPANDED,
    TERMINAL_FAILURE,
}

data class ExternalIntakeNotice(
    val sequence: Long,
    val kind: ExternalIntakeNoticeKind,
)

/** A rejected torrent command, shown once as a transient message. */
data class TorrentCommandFailure(
    val sequence: Long,
    val detail: String,
)

data class ProductState(
    val quickAddsInFlight: Int = 0,
    val ready: Boolean = false,
    /** The service has shut down; a still-bound activity must rebind to a new one. */
    val serviceStopped: Boolean = false,
    val error: ProductError? = null,
    val storageRootReady: Boolean = false,
    val storageRootChecking: Boolean = true,
    val storageRootLabel: String? = null,
    val externalIntake: ExternalIntakePresentation? = null,
    val externalIntakeDepth: Int = 0,
    val externalIntakeNotice: ExternalIntakeNotice? = null,
    val torrentCommandFailure: TorrentCommandFailure? = null,
    val companionPort: UShort? = null,
    val legacyChromeOsMigration: Boolean = false,
    val companionPairing: CompanionPairingState? = null,
    val mediaLaunchPending: Boolean = false,
    val lifecycle: ProductLifecycleState = ProductLifecycleState(),
    val preventSleepDuringActiveDownloads: Boolean = true,
    val network: ProductNetworkState = ProductNetworkState(),
    val notifications: ProductNotificationState = ProductNotificationState(),
    val dataReset: ProductDataResetState? = null,
    val productSummary: ProductSummary? = null,
    val selectedTorrent: String? = null,
    val torrents: Map<String, TorrentView> = emptyMap(),
    val preparations: Map<String, TorrentPreparationView> = emptyMap(),
    val storage: StorageSettingsSnapshot? = null,
    val clientSettings: ClientSettingsRuntimeView? = null,
    internal val clientSettingsDraft: SettingsDraftState<ClientSettingsField> =
        SettingsDraftState(),
    internal val torrentSettingsDraft: SettingsDraftState<TorrentSettingsField> =
        SettingsDraftState(),
    val pieces: Map<String, PieceActivityState> = emptyMap(),
    val files: Map<String, FileCatalogViewState> = emptyMap(),
    val media: Map<String, MediaCatalogViewState> = emptyMap(),
    val trackers: Map<String, TrackerCatalogViewState> = emptyMap(),
    val peers: Map<String, Map<String, PeerView>> = emptyMap(),
    val swarms: Map<String, SwarmViewState> = emptyMap(),
    val disk: DiskViewState? = null,
    val dht: DhtInspectionView? = null,
    val currentRates: SessionCurrentRatesView? = null,
    val speed: SpeedHistoryView? = null,
    val diagnostics: List<DiagnosticEvent> = emptyList(),
    val diagnosticSourceEvicted: String = "0",
    val diagnosticLocalEvicted: ULong = 0UL,
    val diagnosticResets: ULong = 0UL,
    internal val streams: Map<String, StreamPosition> = emptyMap(),
)

data class ProductDataResetFailureState(
    val code: String,
    val detail: String,
    val torrentId: String? = null,
)

data class ProductDataResetState(
    val operationId: String?,
    val phase: ProductDataResetPhase?,
    val completedTorrents: Int,
    val totalTorrents: Int,
    val deleteDataRequested: Boolean,
    val downgradedToKeep: Boolean,
    val failure: ProductDataResetFailureState? = null,
    val complete: Boolean = false,
)

data class StreamPosition(
    val epoch: String,
    val sequence: String,
    val revision: String,
)

internal class ViewContinuityException(message: String) : Exception(message)

internal class ViewResetRequiredException : Exception("view stream requires a snapshot")

internal object ProductStateReducer {
    fun reduce(
        state: ProductState,
        update: ViewUpdate,
    ): ProductState {
        require(update.contractVersion == 2.toUShort()) {
            "unsupported view contract ${update.contractVersion}"
        }
        val current = state.streams[update.streamId]
        when (val payload = update.payload) {
            is ViewUpdatePayload.ResetRequired -> throw ViewResetRequiredException()
            is ViewUpdatePayload.Patch -> {
                if (
                    current == null ||
                    current.epoch != update.epoch ||
                    update.sequence.toULong() != current.sequence.toULong() + 1UL ||
                    current.revision != update.baseRevision
                ) {
                    throw ViewContinuityException("view patch does not continue its stream")
                }
                return applyPatch(state.withPosition(update), payload.patch, update.revision)
            }
            is ViewUpdatePayload.Snapshot ->
                return applySnapshot(state.withPosition(update), payload.snapshot, update.revision)
        }
    }

    private fun ProductState.withPosition(update: ViewUpdate): ProductState =
        copy(
            ready = true,
            error = null,
            streams =
                streams +
                    (
                        update.streamId to
                            StreamPosition(
                                update.epoch,
                                update.sequence,
                                update.revision,
                            )
                    ),
        )

    private fun applySnapshot(
        state: ProductState,
        snapshot: ViewSnapshot,
        revision: String,
    ): ProductState =
        when (snapshot) {
            is ViewSnapshot.TorrentList -> {
                val torrents = snapshot.torrents.associateBy(TorrentView::torrentId)
                val configured = snapshot.clientSettings?.configured
                val clientDraft =
                    if (configured == null) {
                        state.clientSettingsDraft
                    } else {
                        state.clientSettingsDraft.authority(
                            "client-settings",
                            revision,
                            configured.fieldValues(),
                        )
                    }
                val torrentDraft =
                    reconcileTorrentDraft(
                        state.torrentSettingsDraft,
                        torrents[state.torrentSettingsDraft.resourceKey],
                        revision,
                        removeWhenMissing = true,
                    )
                state.copy(
                    torrents = torrents,
                    storage = snapshot.storage,
                    clientSettings = snapshot.clientSettings,
                    clientSettingsDraft = clientDraft,
                    torrentSettingsDraft = torrentDraft,
                )
            }
            is ViewSnapshot.Torrent -> {
                val torrent = snapshot.torrent
                if (torrent == null) {
                    state
                } else {
                    state.copy(
                        torrents = state.torrents + (torrent.torrentId to torrent),
                        torrentSettingsDraft =
                            reconcileTorrentDraft(
                                state.torrentSettingsDraft,
                                torrent,
                                revision,
                                removeWhenMissing = false,
                            ),
                    )
                }
            }
            is ViewSnapshot.TorrentPreparation -> {
                val preparations = state.preparations.toMutableMap()
                snapshot.preparation?.let { preparations[snapshot.torrentId] = it }
                    ?: preparations.remove(snapshot.torrentId)
                state.copy(preparations = preparations)
            }
            is ViewSnapshot.PieceActivity ->
                state.copy(
                    pieces =
                        state.pieces +
                            (
                                snapshot.torrentId to
                                    PieceActivityState(
                                        snapshot.torrentId,
                                        snapshot.pieceCount,
                                        snapshot.verified,
                                        snapshot.active,
                                    )
                            ),
                )
            is ViewSnapshot.Peers ->
                state.copy(
                    peers = state.peers + (snapshot.torrentId to snapshot.peers.associateBy(PeerView::connectionId)),
                )
            is ViewSnapshot.Swarm ->
                state.copy(
                    swarms =
                        state.swarms +
                            (
                                snapshot.torrentId to
                                    SwarmViewState(
                                        snapshot.state,
                                        snapshot.capturedMillis,
                                        snapshot.maximumRecords,
                                        snapshot.counts,
                                        snapshot.peers.associateBy(SwarmPeerView::peerRecordId),
                                    )
                            ),
                )
            is ViewSnapshot.SessionDisk ->
                state.copy(
                    disk = DiskViewState(snapshot.pipeline, snapshot.pieces.associateBy(DiskPieceView::rowId)),
                )
            is ViewSnapshot.SessionDht -> state.copy(dht = snapshot.inspection)
            is ViewSnapshot.SessionCurrentRates -> state.copy(currentRates = snapshot.rates)
            is ViewSnapshot.SessionSpeedHistory -> state.copy(speed = snapshot.history)
            is ViewSnapshot.Files ->
                state.copy(
                    files =
                        state.files +
                            (
                                snapshot.torrentId to
                                    FileCatalogViewState(
                                        snapshot.state,
                                        snapshot.filesystemContentBase,
                                        snapshot.page,
                                        snapshot.files.associateBy(FileView::fileId),
                                    )
                            ),
                )
            is ViewSnapshot.Media ->
                state.copy(
                    media =
                        state.media +
                            (
                                snapshot.torrentId to
                                    MediaCatalogViewState(
                                        snapshot.state,
                                        snapshot.totalNonPaddingFiles,
                                        snapshot.items.associateBy(MediaItemView::mediaId),
                                    )
                            ),
                )
            is ViewSnapshot.Trackers ->
                state.copy(
                    trackers =
                        state.trackers +
                            (
                                snapshot.torrentId to
                                    TrackerCatalogViewState(
                                        snapshot.state,
                                        snapshot.page,
                                        snapshot.trackers.associateBy(TrackerView::trackerId),
                                    )
                            ),
                )
            is ViewSnapshot.Diagnostics ->
                state.copy(
                    diagnostics = snapshot.events.takeLast(512),
                    diagnosticSourceEvicted = snapshot.retention.sourceEvictedCount,
                    diagnosticLocalEvicted =
                        state.diagnosticLocalEvicted +
                            (snapshot.events.size - 512).coerceAtLeast(0).toULong(),
                )
        }

    private fun applyPatch(
        state: ProductState,
        patch: ViewPatch,
        revision: String,
    ): ProductState =
        when (patch) {
            is ViewPatch.TorrentList -> {
                val torrents = state.torrents.toMutableMap()
                patch.removed.forEach(torrents::remove)
                patch.upsert.forEach { torrents[it.torrentId] = it }
                patch.updates.forEach { update ->
                    val current =
                        torrents[update.torrentId]
                            ?: throw ViewContinuityException(
                                "torrent update has no existing row ${update.torrentId}",
                            )
                    torrents[update.torrentId] = applyTorrentUpdate(current, update)
                }
                val configured = patch.clientSettings?.configured
                val clientDraft =
                    if (configured == null) {
                        state.clientSettingsDraft
                    } else {
                        state.clientSettingsDraft.authority(
                            "client-settings",
                            revision,
                            configured.fieldValues(),
                        )
                    }
                val draftKey = state.torrentSettingsDraft.resourceKey
                val matching = torrents[draftKey]
                val torrentDraft =
                    if (draftKey != null && draftKey in patch.removed) {
                        SettingsDraftState()
                    } else {
                        reconcileTorrentDraft(
                            state.torrentSettingsDraft,
                            matching,
                            revision,
                            removeWhenMissing = false,
                        )
                    }
                state.copy(
                    torrents = torrents,
                    storage = patch.storage ?: state.storage,
                    clientSettings = patch.clientSettings ?: state.clientSettings,
                    clientSettingsDraft = clientDraft,
                    torrentSettingsDraft = torrentDraft,
                )
            }
            is ViewPatch.Torrent -> {
                when (val change = patch.change) {
                    is TorrentViewChange.Replace -> {
                        val torrent = change.torrent
                        if (torrent == null) {
                            state
                        } else {
                            state.copy(
                                torrents = state.torrents + (torrent.torrentId to torrent),
                                torrentSettingsDraft =
                                    reconcileTorrentDraft(
                                        state.torrentSettingsDraft,
                                        torrent,
                                        revision,
                                        removeWhenMissing = false,
                                    ),
                            )
                        }
                    }
                    is TorrentViewChange.Update -> {
                        val current =
                            state.torrents[change.update.torrentId]
                                ?: throw ViewContinuityException("selected torrent update has no row")
                        val torrent = applyTorrentUpdate(current, change.update)
                        state.copy(
                            torrents = state.torrents + (torrent.torrentId to torrent),
                            torrentSettingsDraft =
                                reconcileTorrentDraft(
                                    state.torrentSettingsDraft,
                                    torrent,
                                    revision,
                                    removeWhenMissing = false,
                                ),
                        )
                    }
                }
            }
            is ViewPatch.TorrentPreparation -> {
                val preparations = state.preparations.toMutableMap()
                patch.preparation?.let { preparations[patch.torrentId] = it }
                    ?: preparations.remove(patch.torrentId)
                state.copy(preparations = preparations)
            }
            is ViewPatch.PieceActivity -> {
                var verified = state.pieces[patch.torrentId]?.verified.orEmpty()
                patch.cleared.forEach { verified = removeRange(verified, it) }
                patch.verified.forEach { verified = insertRange(verified, it) }
                val active =
                    state.pieces[patch.torrentId]
                        ?.active
                        .orEmpty()
                        .associateByTo(mutableMapOf(), ActivePiece::pieceId)
                patch.activeRemoved.forEach(active::remove)
                patch.activeUpsert.forEach { active[it.pieceId] = it }
                patch.activeUpdates.forEach { update ->
                    val current =
                        active[update.pieceId]
                            ?: throw ViewContinuityException("active piece update has no row")
                    active[update.pieceId] = applyActivePieceUpdate(current, update)
                }
                state.copy(
                    pieces =
                        state.pieces +
                            (
                                patch.torrentId to
                                    PieceActivityState(
                                        patch.torrentId,
                                        patch.pieceCount,
                                        verified,
                                        active.values.sortedWith(
                                            compareBy(ActivePiece::pieceIndex)
                                                .thenBy(ActivePiece::attempt),
                                        ),
                                    )
                            ),
                )
            }
            is ViewPatch.Peers -> {
                val peers = state.peers[patch.torrentId].orEmpty().toMutableMap()
                patch.removed.forEach(peers::remove)
                patch.upsert.forEach { peers[it.connectionId] = it }
                patch.updates.forEach { update ->
                    val current =
                        peers[update.connectionId]
                            ?: throw ViewContinuityException("peer update has no row")
                    peers[update.connectionId] = applyPeerUpdate(current, update)
                }
                state.copy(peers = state.peers + (patch.torrentId to peers))
            }
            is ViewPatch.Swarm -> {
                val peers = state.swarms[patch.torrentId]?.peers.orEmpty().toMutableMap()
                patch.removed.forEach(peers::remove)
                patch.upsert.forEach { peers[it.peerRecordId] = it }
                state.copy(
                    swarms =
                        state.swarms +
                            (
                                patch.torrentId to
                                    SwarmViewState(
                                        patch.state,
                                        patch.capturedMillis,
                                        patch.maximumRecords,
                                        patch.counts,
                                        peers,
                                    )
                            ),
                )
            }
            is ViewPatch.SessionDisk -> {
                val pieces = state.disk?.pieces.orEmpty().toMutableMap()
                patch.removed.forEach(pieces::remove)
                patch.upsert.forEach { pieces[it.rowId] = it }
                state.copy(disk = DiskViewState(patch.pipeline, pieces))
            }
            is ViewPatch.SessionDht -> state.copy(dht = patch.inspection)
            is ViewPatch.SessionCurrentRates -> state.copy(currentRates = patch.rates)
            is ViewPatch.SessionSpeedHistory ->
                state.copy(
                    speed = applySpeedHistoryAppend(
                        state.speed
                            ?: throw ViewContinuityException("speed append has no snapshot"),
                        patch.append,
                    ),
                )
            is ViewPatch.Files -> {
                val current = state.files[patch.torrentId] ?: return state
                val files = current.files.toMutableMap()
                patch.removed.forEach(files::remove)
                patch.upsert.forEach { files[it.fileId] = it }
                patch.updates.forEach { update ->
                    val file =
                        files[update.fileId]
                            ?: throw ViewContinuityException("file update has no row")
                    files[update.fileId] = applyFileUpdate(file, update)
                }
                state.copy(files = state.files + (patch.torrentId to current.copy(files = files)))
            }
            is ViewPatch.Media -> {
                val current = state.media[patch.torrentId] ?: return state
                val items = current.items.toMutableMap()
                patch.removed.forEach(items::remove)
                patch.upsert.forEach { items[it.mediaId] = it }
                state.copy(media = state.media + (patch.torrentId to current.copy(items = items)))
            }
            is ViewPatch.Trackers -> {
                val current = state.trackers[patch.torrentId] ?: return state
                val trackers = current.trackers.toMutableMap()
                patch.removed.forEach(trackers::remove)
                patch.upsert.forEach { trackers[it.trackerId] = it }
                state.copy(
                    trackers = state.trackers + (patch.torrentId to current.copy(trackers = trackers)),
                )
            }
            is ViewPatch.Diagnostics -> {
                val events =
                    (state.diagnostics + patch.events)
                        .associateBy(DiagnosticEvent::sequence)
                        .values
                        .sortedBy { it.sequence.toULong() }
                val retained = events.takeLast(512)
                state.copy(
                    diagnostics = retained,
                    diagnosticSourceEvicted = patch.retention.sourceEvictedCount,
                    diagnosticLocalEvicted =
                        state.diagnosticLocalEvicted + (events.size - retained.size).toULong(),
                )
            }
        }

    private fun requireUniqueFields(
        fields: List<Any>,
        label: String,
    ) {
        if (fields.isEmpty() || fields.map { it::class }.toSet().size != fields.size) {
            throw ViewContinuityException("$label update has empty or duplicate fields")
        }
    }

    private fun applySpeedHistoryAppend(
        history: SpeedHistoryView,
        append: SpeedHistoryAppend,
    ): SpeedHistoryView {
        if (
            history.historyEpoch != append.historyEpoch ||
            history.completeThroughMillis != append.baseCompleteThroughMillis
        ) {
            throw ViewContinuityException("speed append does not continue its history")
        }
        val bucket = history.bucketMillis.toULongOrNull()
            ?: throw ViewContinuityException("speed history bucket is invalid")
        val base = append.baseCompleteThroughMillis.toULongOrNull()
            ?: throw ViewContinuityException("speed append base is invalid")
        val through = append.completeThroughMillis.toULongOrNull()
            ?: throw ViewContinuityException("speed append position is invalid")
        if (bucket == 0UL || through < base || (through - base) % bucket != 0UL) {
            throw ViewContinuityException("speed append range is invalid")
        }
        val countLong = (through - base) / bucket
        if (countLong > Int.MAX_VALUE.toULong()) {
            throw ViewContinuityException("speed append is too large")
        }
        val count = countLong.toInt()
        val window = history.series.firstOrNull()?.values?.size ?: 0
        val historySpan = bucket * (window - 1).coerceAtLeast(0).toULong()
        val expectedStart = if (through > historySpan) through - historySpan else 0UL
        if (
            count > window ||
            append.startMillis.toULongOrNull() != expectedStart ||
            (count == 0 && (append.persistence == null || append.series.isNotEmpty())) ||
            (count != 0 && append.series.size != history.series.size)
        ) {
            throw ViewContinuityException("speed append shape is invalid")
        }
        if (
            count != 0 && history.series.indices.any { index ->
                val current = history.series[index]
                val update = append.series[index]
                current.metric != update.metric || update.values.size != count
            }
        ) {
            throw ViewContinuityException("speed append series are incompatible")
        }
        return history.copy(
            capturedMillis = append.capturedMillis,
            startMillis = append.startMillis,
            completeThroughMillis = append.completeThroughMillis,
            persistence = append.persistence ?: history.persistence,
            series =
                history.series.mapIndexed { index, series ->
                    series.copy(
                        values =
                            if (count == 0) {
                                series.values.toList()
                            } else {
                                series.values.drop(count) + append.series[index].values
                            },
                    )
                },
        )
    }

    private fun applyTorrentUpdate(
        current: TorrentView,
        update: TorrentRowUpdate,
    ): TorrentView {
        if (current.torrentId != update.torrentId) {
            throw ViewContinuityException("torrent update identity mismatch")
        }
        requireUniqueFields(update.fields, "torrent")
        val next = current.copy()
        update.fields.forEach { field ->
            when (field) {
                is TorrentFieldUpdate.ProtocolIdentities -> next.protocolIdentities = field.value
                is TorrentFieldUpdate.DisplayName -> next.displayName = field.value
                is TorrentFieldUpdate.SourceDisplayName -> next.sourceDisplayName = field.value
                is TorrentFieldUpdate.State -> next.state = field.value
                is TorrentFieldUpdate.OperationalState -> next.operationalState = field.value
                is TorrentFieldUpdate.DownloadQueuePosition -> next.downloadQueuePosition = field.value
                is TorrentFieldUpdate.TransferLimits -> next.transferLimits = field.value
                is TorrentFieldUpdate.StorageState -> next.storageState = field.value
                is TorrentFieldUpdate.MetadataAvailable -> next.metadataAvailable = field.value
                is TorrentFieldUpdate.AwaitingFileSelection ->
                    next.awaitingFileSelection = field.value
                is TorrentFieldUpdate.PendingFileSelectionPosition ->
                    next.pendingFileSelectionPosition = field.value
                is TorrentFieldUpdate.FileCatalogId -> next.fileCatalogId = field.value
                is TorrentFieldUpdate.SelectableFileCount -> next.selectableFileCount = field.value
                is TorrentFieldUpdate.SelectedFileCount -> next.selectedFileCount = field.value
                is TorrentFieldUpdate.SelectableFileBytes -> next.selectableFileBytes = field.value
                is TorrentFieldUpdate.SelectedFileBytes -> next.selectedFileBytes = field.value
                is TorrentFieldUpdate.PieceCount -> next.pieceCount = field.value
                is TorrentFieldUpdate.TotalSizeBytes -> next.totalSizeBytes = field.value
                is TorrentFieldUpdate.VerifiedPieceCount -> next.verifiedPieceCount = field.value
                is TorrentFieldUpdate.RequestedBytes -> next.requestedBytes = field.value
                is TorrentFieldUpdate.ReceivedBytes -> next.receivedBytes = field.value
                is TorrentFieldUpdate.StoredBytes -> next.storedBytes = field.value
                is TorrentFieldUpdate.ActivePeerConnections -> next.activePeerConnections = field.value
                is TorrentFieldUpdate.ConfiguredTrackerCount -> next.configuredTrackerCount = field.value
                is TorrentFieldUpdate.PayloadDownloadRateBytes -> next.payloadDownloadRateBytes = field.value
                is TorrentFieldUpdate.RequiredPayloadBytes -> next.requiredPayloadBytes = field.value
                is TorrentFieldUpdate.RemainingPayloadBytes -> next.remainingPayloadBytes = field.value
                is TorrentFieldUpdate.EtaPayloadDownloadRateBytes ->
                    next.etaPayloadDownloadRateBytes = field.value
                is TorrentFieldUpdate.Eta -> next.eta = field.value
                is TorrentFieldUpdate.Lifetime -> next.lifetime = field.value
                is TorrentFieldUpdate.Seeding -> next.seeding = field.value
                is TorrentFieldUpdate.Progress -> next.progress = field.value
                is TorrentFieldUpdate.Checking -> next.checking = field.value
                is TorrentFieldUpdate.Archived -> next.archived = field.value
                is TorrentFieldUpdate.RemovalState -> next.removalState = field.value
                is TorrentFieldUpdate.DeleteDataSupported ->
                    next.deleteDataSupported = field.value
                is TorrentFieldUpdate.ForceRecheckAvailable -> next.forceRecheckAvailable = field.value
                is TorrentFieldUpdate.Error -> next.error = field.value
            }
        }
        return next
    }

    private fun applyFileUpdate(
        current: FileView,
        update: FileRowUpdate,
    ): FileView {
        if (current.fileId != update.fileId) {
            throw ViewContinuityException("file update identity mismatch")
        }
        requireUniqueFields(update.fields, "file")
        val next = current.copy()
        update.fields.forEach { field ->
            when (field) {
                is FileFieldUpdate.Selection -> next.selection = field.value
                is FileFieldUpdate.DoneBytes -> next.doneBytes = field.value
                is FileFieldUpdate.VerifiedBytes -> next.verifiedBytes = field.value
                is FileFieldUpdate.MediaAvailability -> next.mediaAvailability = field.value
            }
        }
        return next
    }

    private fun applyPeerUpdate(
        current: PeerView,
        update: PeerRowUpdate,
    ): PeerView {
        if (current.connectionId != update.connectionId) {
            throw ViewContinuityException("peer update identity mismatch")
        }
        requireUniqueFields(update.fields, "peer")
        val next = current.copy()
        update.fields.forEach { field ->
            when (field) {
                is PeerFieldUpdate.PeerRecordId -> next.peerRecordId = field.value
                is PeerFieldUpdate.Direction -> next.direction = field.value
                is PeerFieldUpdate.Transport -> next.transport = field.value
                is PeerFieldUpdate.Lifecycle -> next.lifecycle = field.value
                is PeerFieldUpdate.Role -> next.role = field.value
                is PeerFieldUpdate.PeerFlags -> next.peerFlags = field.value
                is PeerFieldUpdate.MseMethod -> next.mseMethod = field.value
                is PeerFieldUpdate.LifecycleAgeMillis -> next.lifecycleAgeMillis = field.value
                is PeerFieldUpdate.RemoteEndpoint -> next.remoteEndpoint = field.value
                is PeerFieldUpdate.LocalEndpoint -> next.localEndpoint = field.value
                is PeerFieldUpdate.Sources -> next.sources = field.value
                is PeerFieldUpdate.PeerId -> next.peerId = field.value
                is PeerFieldUpdate.ClientName -> next.clientName = field.value
                is PeerFieldUpdate.SupportsExtensions -> next.supportsExtensions = field.value
                is PeerFieldUpdate.SupportsUtMetadata -> next.supportsUtMetadata = field.value
                is PeerFieldUpdate.LocalInterested -> next.localInterested = field.value
                is PeerFieldUpdate.RemoteInterested -> next.remoteInterested = field.value
                is PeerFieldUpdate.RemoteChoking -> next.remoteChoking = field.value
                is PeerFieldUpdate.LocalChoking -> next.localChoking = field.value
                is PeerFieldUpdate.AvailablePieceCount -> next.availablePieceCount = field.value
                is PeerFieldUpdate.WantedPieceCount -> next.wantedPieceCount = field.value
                is PeerFieldUpdate.PayloadDownloadRateBytes -> next.payloadDownloadRateBytes = field.value
                is PeerFieldUpdate.PayloadDownloadedBytes -> next.payloadDownloadedBytes = field.value
                is PeerFieldUpdate.ProtocolDownloadRateBytes -> next.protocolDownloadRateBytes = field.value
                is PeerFieldUpdate.ProtocolDownloadedBytes -> next.protocolDownloadedBytes = field.value
                is PeerFieldUpdate.PayloadUploadRateBytes -> next.payloadUploadRateBytes = field.value
                is PeerFieldUpdate.PayloadUploadedBytes -> next.payloadUploadedBytes = field.value
                is PeerFieldUpdate.PendingRequests -> next.pendingRequests = field.value
                is PeerFieldUpdate.TargetRequests -> next.targetRequests = field.value
                is PeerFieldUpdate.QueuedPayloadBytes -> next.queuedPayloadBytes = field.value
                is PeerFieldUpdate.OldestRequestAgeMillis -> next.oldestRequestAgeMillis = field.value
                is PeerFieldUpdate.RequestTimeoutMillis -> next.requestTimeoutMillis = field.value
                is PeerFieldUpdate.RequestPhase -> next.requestPhase = field.value
                is PeerFieldUpdate.ConnectedAgeMillis -> next.connectedAgeMillis = field.value
                is PeerFieldUpdate.LastUsefulAgeMillis -> next.lastUsefulAgeMillis = field.value
                is PeerFieldUpdate.LastPayloadAgeMillis -> next.lastPayloadAgeMillis = field.value
                is PeerFieldUpdate.DisconnectReason -> next.disconnectReason = field.value
                is PeerFieldUpdate.Capabilities -> next.capabilities = field.value
            }
        }
        return next
    }

    private fun applyActivePieceUpdate(
        current: ActivePiece,
        update: ActivePieceUpdate,
    ): ActivePiece {
        if (current.pieceId != update.pieceId) {
            throw ViewContinuityException("active piece update identity mismatch")
        }
        requireUniqueFields(update.fields, "active piece")
        val next = current.copy()
        update.fields.forEach { field ->
            when (field) {
                is ActivePieceFieldUpdate.Stage -> next.stage = field.value
                is ActivePieceFieldUpdate.Requested -> next.requested = field.value
                is ActivePieceFieldUpdate.Received -> next.received = field.value
                is ActivePieceFieldUpdate.Stored -> next.stored = field.value
                is ActivePieceFieldUpdate.AgeMillis -> next.ageMillis = field.value
                is ActivePieceFieldUpdate.Error -> next.error = field.value
            }
        }
        return next
    }

    private fun reconcileTorrentDraft(
        draft: SettingsDraftState<TorrentSettingsField>,
        torrent: TorrentView?,
        revision: String,
        removeWhenMissing: Boolean,
    ): SettingsDraftState<TorrentSettingsField> {
        val key = draft.resourceKey ?: return draft
        if (torrent == null) {
            return if (removeWhenMissing) SettingsDraftState() else draft
        }
        if (torrent.torrentId != key) return draft
        return draft.authority(
            key,
            revision,
            torrent.transferLimits.fieldValues(),
        )
    }

    private fun insertRange(
        ranges: List<IndexRange>,
        inserted: IndexRange,
    ): List<IndexRange> {
        val output = mutableListOf<IndexRange>()
        var start = inserted.start
        var end = inserted.endExclusive
        var placed = false
        for (range in ranges) {
            when {
                range.endExclusive < start -> output += range
                end < range.start -> {
                    if (!placed) {
                        output += IndexRange(start, end)
                        placed = true
                    }
                    output += range
                }
                else -> {
                    start = minOf(start, range.start)
                    end = maxOf(end, range.endExclusive)
                }
            }
        }
        if (!placed) output += IndexRange(start, end)
        return output
    }

    private fun removeRange(
        ranges: List<IndexRange>,
        removed: IndexRange,
    ): List<IndexRange> =
        buildList {
            for (range in ranges) {
                if (
                    range.endExclusive <= removed.start ||
                    range.start >= removed.endExclusive
                ) {
                    add(range)
                    continue
                }
                if (range.start < removed.start) {
                    add(IndexRange(range.start, removed.start))
                }
                if (range.endExclusive > removed.endExclusive) {
                    add(IndexRange(removed.endExclusive, range.endExclusive))
                }
            }
        }
}

/** Startup has not established folder health; do not offer repair yet. */
val ProductState.checkingStorage: Boolean
    get() = storageRootChecking && (error == null ||
        error == ProductError.Code.SELECT_DOWNLOAD_FOLDER ||
        error == ProductError.Code.STORAGE_UNAVAILABLE)
