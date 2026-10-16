package org.rstorrent.bootstrap

import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.rstorrent.bootstrap.uniffi.AndroidApplicationClient
import org.rstorrent.bootstrap.uniffi.AndroidViewSubscription
import org.rstorrent.session.uniffi.CatalogPageRequest
import org.rstorrent.session.uniffi.DeliveryPolicy
import org.rstorrent.session.uniffi.DiagnosticCategory
import org.rstorrent.session.uniffi.DiagnosticFilter
import org.rstorrent.session.uniffi.DiagnosticProfile
import org.rstorrent.session.uniffi.DiagnosticSeverity
import org.rstorrent.session.uniffi.SpeedMetric
import org.rstorrent.session.uniffi.SpeedRange
import org.rstorrent.session.uniffi.SubscriptionSpec
import org.rstorrent.session.uniffi.ViewProjection
import org.rstorrent.session.uniffi.ViewSelector
import org.rstorrent.session.uniffi.ViewUpdate

/** Keeps UI request order across the service's asynchronous startup dispatch. */
internal class LatestPresentationRequest(
    private val dispatch: ((AndroidPresentationRepository) -> Unit) -> Unit,
) {
    private val ownership = Any()
    private var latestRequest = 0L

    fun submit(action: (AndroidPresentationRepository) -> Unit) {
        // Reserve order before dispatch or readiness waits can reorder callers.
        val request = synchronized(ownership) { ++latestRequest }
        dispatch { repository ->
            synchronized(ownership) {
                if (request == latestRequest) action(repository)
            }
        }
    }
}

internal class PendingSelectionPresentation(
    dispatch: ((AndroidPresentationRepository) -> Unit) -> Unit,
) {
    private val latest = LatestPresentationRequest(dispatch)

    fun present(torrentId: String, offset: UInt) {
        latest.submit { it.presentPendingFileSelection(torrentId, offset) }
    }

    fun clear() {
        latest.submit(AndroidPresentationRepository::clearPendingFileSelection)
    }
}

/** Owns the bounded set of subscriptions that feed the Android product surface. */
internal class AndroidPresentationRepository(
    private val scope: CoroutineScope,
    private val state: MutableStateFlow<ProductState>,
    private val stopped: AtomicBoolean,
    private val onUpdate: (ViewUpdate, ProductState, Boolean) -> Unit,
    private val onTorrentListUpdate: (ViewUpdate, ProductState) -> Unit = { _, _ -> },
    private val onTorrentListReset: () -> Unit = {},
    private val onError: (Throwable) -> Unit,
) {
    private val ownership = Mutex()
    private var closed = false
    private lateinit var client: AndroidApplicationClient
    private var list: OwnedSubscription? = null
    // Session rates feed the library status line and the Speed screen, so
    // they live as long as the list instead of with the Speed screen.
    private var rates: OwnedSubscription? = null
    private val detail = mutableListOf<OwnedSubscription>()
    private var pendingSelection: OwnedSubscription? = null
    private var pendingSelectionTorrent: String? = null
    private val global = mutableListOf<OwnedSubscription>()
    private var library: OwnedSubscription? = null
    private var diagnostics: OwnedSubscription? = null
    private var selectedTorrent: String? = null
    private var diagnosticProfile = DiagnosticProfile.NORMAL
    private var diagnosticSeverity = DiagnosticSeverity.INFO
    private var diagnosticCategories: List<DiagnosticCategory> = emptyList()
    private var diagnosticTorrentOnly = false
    private val detailRequest = AtomicLong()
    private val pendingSelectionRequest = AtomicLong()
    private val globalRequest = AtomicLong()
    private val libraryRequest = AtomicLong()
    private val diagnosticRequest = AtomicLong()

    suspend fun start(client: AndroidApplicationClient) {
        ownership.withLock {
            check(!closed) { "presentation repository is closed" }
            this.client = client
            list =
                subscribe(
                    SubscriptionSpec(
                        ViewSelector.TorrentList,
                        ViewProjection.SUMMARY,
                        DeliveryPolicy(250U, 256U * 1024U),
                        null,
                        null,
                    ),
                    driveSaf = true,
                )
            rates = subscribe(currentRatesSpec(), false)
            replaceDiagnostics()
        }
    }

    fun selectTorrent(torrentId: String) {
        launchPresentation {
            if (selectedTorrent == torrentId) return@launchPresentation
            selectedTorrent = torrentId
            state.update { it.copy(selectedTorrent = torrentId) }
            if (diagnosticTorrentOnly) replaceDiagnostics()
        }
    }

    fun presentTorrent(
        torrentId: String,
        presentation: TorrentPresentation,
    ) {
        val request = detailRequest.incrementAndGet()
        launchPresentation {
            if (request != detailRequest.get()) return@launchPresentation
            selectedTorrent = torrentId
            closeAll(detail)
            state.update {
                it.copy(
                    selectedTorrent = torrentId,
                    files = it.files.filterKeys { id -> id == torrentId },
                    trackers = it.trackers.filterKeys { id -> id == torrentId },
                    peers = it.peers.filterKeys { id -> id == torrentId },
                    swarms = it.swarms.filterKeys { id -> id == torrentId },
                )
            }
            acquireGroup(detail, torrentSpecs(torrentId, presentation))
            if (diagnosticTorrentOnly) replaceDiagnostics()
        }
    }

    fun clearTorrent(torrentId: String) {
        val request = detailRequest.incrementAndGet()
        launchPresentation {
            if (request != detailRequest.get()) return@launchPresentation
            if (selectedTorrent != torrentId) return@launchPresentation
            closeAll(detail)
        }
    }

    fun presentCatalogPage(
        torrentId: String,
        presentation: TorrentPresentation,
        offset: UInt,
    ) {
        require(
            presentation == TorrentPresentation.FILES ||
                presentation == TorrentPresentation.TRACKERS,
        ) { "only paged catalog presentations accept an offset" }
        val request = detailRequest.incrementAndGet()
        launchPresentation {
            if (request != detailRequest.get()) return@launchPresentation
            selectedTorrent = torrentId
            closeAll(detail)
            val projection =
                if (presentation == TorrentPresentation.FILES) {
                    ViewProjection.FILES
                } else {
                    ViewProjection.TRACKERS
                }
            detail += subscribe(catalogSpec(torrentId, projection, offset), false)
        }
    }

    fun presentPendingFileSelection(
        torrentId: String,
        offset: UInt,
    ) {
        val request = pendingSelectionRequest.incrementAndGet()
        launchPresentation {
            if (request != pendingSelectionRequest.get()) return@launchPresentation
            pendingSelection?.close()
            val previousTorrent = pendingSelectionTorrent
            pendingSelectionTorrent = torrentId
            state.update {
                it.copy(
                    files =
                        it.files - torrentId - listOfNotNull(previousTorrent).toSet(),
                )
            }
            pendingSelection =
                subscribe(catalogSpec(torrentId, ViewProjection.FILES, offset), false)
        }
    }

    fun clearPendingFileSelection() {
        val request = pendingSelectionRequest.incrementAndGet()
        launchPresentation {
            if (request != pendingSelectionRequest.get()) return@launchPresentation
            pendingSelection?.close()
            pendingSelection = null
            val torrentId = pendingSelectionTorrent
            pendingSelectionTorrent = null
            if (torrentId != null) state.update { it.copy(files = it.files - torrentId) }
        }
    }

    fun presentGlobal(
        presentation: GlobalPresentation,
        speedRange: SpeedRange = SpeedRange.MINUTES2,
    ) {
        val request = globalRequest.incrementAndGet()
        launchPresentation {
            if (request != globalRequest.get()) return@launchPresentation
            closeAll(global)
            acquireGroup(
                global,
                when (presentation) {
                    GlobalPresentation.NONE -> emptyList()
                    GlobalPresentation.SPEED -> listOf(speedHistorySpec(speedRange))
                    GlobalPresentation.DHT -> listOf(dhtSpec())
                },
            )
        }
    }

    /** Leases one Library page; null releases it. */
    fun presentLibrary(request: LibraryMediaRequest?) {
        val epoch = libraryRequest.incrementAndGet()
        launchPresentation {
            if (epoch != libraryRequest.get()) return@launchPresentation
            library?.close()
            library = null
            // The previous collector has stopped, so its page cannot return.
            state.update { it.copy(libraryMedia = null) }
            if (request == null) return@launchPresentation
            library =
                subscribe(libraryMediaSpec(request), false) { reduced ->
                    reduced.copy(
                        libraryMedia = reduced.libraryMedia?.copy(request = request),
                    )
                }
        }
    }

    fun configureDiagnostics(
        profile: DiagnosticProfile,
        severity: DiagnosticSeverity,
        categories: List<DiagnosticCategory>,
        torrentOnly: Boolean,
    ) {
        val request = diagnosticRequest.incrementAndGet()
        launchPresentation {
            if (request != diagnosticRequest.get()) return@launchPresentation
            diagnosticProfile = profile
            diagnosticSeverity = severity
            diagnosticCategories = categories
            diagnosticTorrentOnly = torrentOnly
            if (::client.isInitialized) replaceDiagnostics()
        }
    }

    suspend fun close() {
        detailRequest.incrementAndGet()
        pendingSelectionRequest.incrementAndGet()
        globalRequest.incrementAndGet()
        libraryRequest.incrementAndGet()
        diagnosticRequest.incrementAndGet()
        ownership.withLock {
            closed = true
            list?.close()
            list = null
            rates?.close()
            rates = null
            closeAll(detail)
            pendingSelection?.close()
            pendingSelection = null
            pendingSelectionTorrent = null
            closeAll(global)
            library?.close()
            library = null
            diagnostics?.close()
            diagnostics = null
        }
    }

    private fun launchPresentation(action: suspend () -> Unit) {
        scope.launch {
            try {
                ownership.withLock {
                    // Closure and acquisition share one barrier. Request epochs
                    // alone cannot fence a request submitted after close().
                    if (closed || stopped.get()) return@withLock
                    action()
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                if (!stopped.get() && currentCoroutineContext().isActive) onError(error)
            }
        }
    }

    private suspend fun acquireGroup(
        subscriptions: MutableList<OwnedSubscription>,
        specs: List<SubscriptionSpec>,
    ) {
        try {
            for (spec in specs) subscriptions += subscribe(spec, false)
        } catch (error: Throwable) {
            // Keep each acquisition owned immediately, including when a later
            // acquisition fails or is cancelled before the group is complete.
            withContext(NonCancellable) {
                try {
                    closeAll(subscriptions)
                } catch (cleanup: Throwable) {
                    error.addSuppressed(cleanup)
                }
            }
            throw error
        }
    }

    private suspend fun replaceDiagnostics() {
        diagnostics?.close()
        val selector =
            if (diagnosticTorrentOnly && selectedTorrent != null) {
                ViewSelector.Torrent(requireNotNull(selectedTorrent))
            } else {
                ViewSelector.TorrentList
            }
        diagnostics =
            subscribe(
                SubscriptionSpec(
                    selector,
                    ViewProjection.DIAGNOSTICS,
                    // Retention is bounded to 2 MiB plus the snapshot envelope.
                    // Use the existing 4-MiB subscription bound so resync can
                    // restore the full retained history after queue overflow.
                    DeliveryPolicy(100U, 4U * 1024U * 1024U),
                    DiagnosticFilter(
                        diagnosticProfile,
                        diagnosticSeverity,
                        diagnosticCategories,
                    ),
                    null,
                ),
                false,
            )
    }

    private suspend fun subscribe(
        spec: SubscriptionSpec,
        driveSaf: Boolean,
        // Applied in the same state update as the reduction.
        annotate: (ProductState) -> ProductState = { it },
    ): OwnedSubscription {
        val subscription = client.subscribe(spec)
        val job =
            scope.launch {
                try {
                    while (true) {
                        val update = subscription.nextUpdate() ?: break
                        try {
                            var reduced: ProductState? = null
                            state.update { current ->
                                annotate(ProductStateReducer.reduce(current, update))
                                    .also { reduced = it }
                            }
                            val product = requireNotNull(reduced)
                            if (driveSaf) onTorrentListUpdate(update, product)
                            onUpdate(update, product, driveSaf)
                        } catch (_: ViewResetRequiredException) {
                            if (driveSaf) onTorrentListReset()
                            state.update { it.copy(diagnosticResets = it.diagnosticResets + 1UL) }
                            subscription.resync()
                        } catch (_: ViewContinuityException) {
                            if (driveSaf) onTorrentListReset()
                            state.update { it.copy(diagnosticResets = it.diagnosticResets + 1UL) }
                            subscription.resync()
                        }
                    }
                } catch (error: Throwable) {
                    if (
                        !stopped.get() &&
                            currentCoroutineContext().isActive &&
                            error !is CancellationException
                    ) {
                        onError(error)
                    }
                } finally {
                    subscription.close()
                }
            }
        return OwnedSubscription(subscription, job)
    }

    private suspend fun closeAll(subscriptions: MutableList<OwnedSubscription>) {
        subscriptions.forEach { it.close() }
        subscriptions.clear()
    }

    private fun torrentSpecs(
        torrentId: String,
        presentation: TorrentPresentation,
    ): List<SubscriptionSpec> =
        when (presentation) {
            TorrentPresentation.SUMMARY -> emptyList()
            TorrentPresentation.FILES ->
                listOf(catalogSpec(torrentId, ViewProjection.FILES, 0U))
            TorrentPresentation.TRACKERS ->
                listOf(catalogSpec(torrentId, ViewProjection.TRACKERS, 0U))
            TorrentPresentation.PEERS ->
                listOf(
                    torrentSpec(torrentId, ViewProjection.PEERS, 250U),
                    torrentSpec(torrentId, ViewProjection.SWARM, 500U),
                )
            TorrentPresentation.PIECES ->
                listOf(
                    torrentSpec(torrentId, ViewProjection.PIECE_ACTIVITY, 100U),
                    SubscriptionSpec(
                        ViewSelector.TorrentList,
                        ViewProjection.DISK,
                        DeliveryPolicy(250U, 512U * 1024U),
                        null,
                        null,
                    ),
                )
        }

    private fun torrentSpec(
        torrentId: String,
        projection: ViewProjection,
        interval: UInt,
    ) = SubscriptionSpec(
        ViewSelector.Torrent(torrentId),
        projection,
        DeliveryPolicy(interval, 512U * 1024U),
        null,
        null,
    )

    private fun catalogSpec(
        torrentId: String,
        projection: ViewProjection,
        offset: UInt,
    ) = SubscriptionSpec(
        ViewSelector.Torrent(torrentId),
        projection,
        DeliveryPolicy(250U, 512U * 1024U),
        null,
        CatalogPageRequest(offset, 1_024U),
    )

    private fun libraryMediaSpec(request: LibraryMediaRequest) =
        SubscriptionSpec(
            ViewSelector.Library(request.query),
            ViewProjection.LIBRARY_MEDIA,
            DeliveryPolicy(250U, 512U * 1024U),
            null,
            CatalogPageRequest(request.offset, request.limit),
        )

    private val speedMetrics =
        listOf(
            SpeedMetric.PAYLOAD_RECEIVED,
            SpeedMetric.PAYLOAD_UPLOADED,
            SpeedMetric.STAGED_WRITE,
            SpeedMetric.PAYLOAD_VERIFIED,
            SpeedMetric.PEER_WIRE_RECEIVED,
            SpeedMetric.PEER_WIRE_SENT,
        )

    private fun currentRatesSpec() =
        SubscriptionSpec(
            ViewSelector.SessionCurrentRates(speedMetrics),
            ViewProjection.CURRENT_RATES,
            DeliveryPolicy(500U, 512U * 1024U),
            null,
            null,
        )

    private fun speedHistorySpec(range: SpeedRange) =
        SubscriptionSpec(
            ViewSelector.SessionSpeedHistory(range, speedMetrics),
            ViewProjection.SPEED_HISTORY,
            DeliveryPolicy(500U, 512U * 1024U),
            null,
            null,
        )

    private fun dhtSpec() =
        SubscriptionSpec(
            ViewSelector.SessionDht,
            ViewProjection.DHT,
            DeliveryPolicy(500U, 512U * 1024U),
            null,
            null,
        )

    private data class OwnedSubscription(
        val subscription: AndroidViewSubscription,
        val job: Job,
    ) {
        suspend fun close() {
            job.cancel()
            subscription.close()
            job.join()
        }
    }
}
