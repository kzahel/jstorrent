package org.rstorrent.bootstrap

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.IntentFilter
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.Build
import android.os.CancellationSignal
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.PowerManager
import android.os.SystemClock
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import org.rstorrent.bootstrap.ui.productFailureDetail
import java.io.File
import java.io.FileNotFoundException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.withContext
import org.rstorrent.bootstrap.uniffi.AndroidApplicationClient
import org.rstorrent.bootstrap.uniffi.AndroidApplicationConfig
import org.rstorrent.bootstrap.uniffi.AndroidApplicationNetworkPrerequisite
import org.rstorrent.bootstrap.uniffi.AndroidCompanionRootRequest
import org.rstorrent.bootstrap.uniffi.AndroidCompanionConnectionSubscription
import org.rstorrent.bootstrap.uniffi.AndroidNetworkPolicy
import org.rstorrent.bootstrap.uniffi.AndroidPlatformStorageRoot
import org.rstorrent.bootstrap.uniffi.AndroidViewSubscription
import org.rstorrent.bootstrap.uniffi.SafStorageFailureKind
import org.rstorrent.bootstrap.uniffi.SafStorageOperation
import org.rstorrent.session.uniffi.Command
import org.rstorrent.session.uniffi.CommandResult
import org.rstorrent.session.uniffi.AddTorrentDisposition
import org.rstorrent.session.uniffi.AddTorrentResult
import org.rstorrent.session.uniffi.AddTorrentBytesRequest
import org.rstorrent.session.uniffi.ActiveSeedLimit
import org.rstorrent.session.uniffi.CatalogPageRequest
import org.rstorrent.session.uniffi.ClientSettings
import org.rstorrent.session.uniffi.ClientSettingsPatch
import org.rstorrent.session.uniffi.ClientSettingsApplicationState
import org.rstorrent.session.uniffi.ClientSettingsRuntimeView
import org.rstorrent.session.uniffi.DeliveryPolicy
import org.rstorrent.session.uniffi.DiagnosticCategory
import org.rstorrent.session.uniffi.DiagnosticFilter
import org.rstorrent.session.uniffi.DiagnosticProfile
import org.rstorrent.session.uniffi.DiagnosticSeverity
import org.rstorrent.session.uniffi.DiagnosticValue
import org.rstorrent.session.uniffi.EncryptionPolicy
import org.rstorrent.session.uniffi.FileSelectionIntent
import org.rstorrent.session.uniffi.FileSelectionOverride
import org.rstorrent.session.uniffi.FilePriority
import org.rstorrent.session.uniffi.PendingFileSelectionBase
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.HttpsServerAuthenticationPolicy
import org.rstorrent.session.uniffi.ListenerPolicy
import org.rstorrent.session.uniffi.ListenerStatus
import org.rstorrent.session.uniffi.MediaUrlOutcome
import org.rstorrent.session.uniffi.PortMappingPolicy
import org.rstorrent.session.uniffi.RequestEnvelope
import org.rstorrent.session.uniffi.RemovalState
import org.rstorrent.session.uniffi.RemovalDataPolicy
import org.rstorrent.session.uniffi.ResponseOutcome
import org.rstorrent.session.uniffi.SeedAdmissionView
import org.rstorrent.session.uniffi.SpeedMetric
import org.rstorrent.session.uniffi.SpeedRange
import org.rstorrent.session.uniffi.StorageRootAvailability
import org.rstorrent.session.uniffi.SubscriptionSpec
import org.rstorrent.session.uniffi.TorrentState
import org.rstorrent.session.uniffi.TorrentSettingsPatch
import org.rstorrent.session.uniffi.TorrentTransferLimits
import org.rstorrent.session.uniffi.TransferRateLimit
import org.rstorrent.session.uniffi.ViewProjection
import org.rstorrent.session.uniffi.ViewSelector
import org.rstorrent.session.uniffi.ViewPatch
import org.rstorrent.session.uniffi.ViewSnapshot
import org.rstorrent.session.uniffi.ViewUpdate
import org.rstorrent.session.uniffi.ViewUpdatePayload

private class ProductDataResetInProgressException :
    IllegalStateException("clear data is already in progress")

class ProductEngineService : Service() {
    inner class LocalBinder : Binder() {
        val service: ProductEngineService
            get() = this@ProductEngineService
    }

    private val binder = LocalBinder()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val requestPrefix = UUID.randomUUID().toString()
    private val requestIds = AtomicLong(1)
    private val torrentCommandFailureSequence = AtomicLong()
    private val alreadyPresentSequence = AtomicLong()
    private val stopped = AtomicBoolean(false)
    private val stopRequested = AtomicBoolean(false)
    private val dataResetActive = AtomicBoolean(false)
    private val latestStartId = AtomicInteger(0)
    @Volatile private var startCommandReceived = false
    private val firstStartCommand = CompletableDeferred<Boolean>()
    private val foreground = AtomicBoolean(true)
    private val backgroundAdmitted = AtomicBoolean(false)
    private val recoveryNetworkGateClosed = AtomicBoolean(false)
    private val productQuotaRestartEvidenceArmed = AtomicBoolean(false)
    private var quotaExhaustedStartRejected = false
    private val shutdownComplete = CompletableDeferred<Unit>()
    private val clientReady = CompletableDeferred<Unit>()
    private val presentationReady = CompletableDeferred<Unit>()
    private val mutableState = MutableStateFlow(ProductState())
    val state: StateFlow<ProductState> = mutableState.asStateFlow()

    internal data class ResourceSnapshot(
        val shutdownComplete: Boolean,
        val interactionLeases: Int,
        val notificationReceiverRegistered: Boolean,
        val wakeLockHeld: Boolean,
        val networkCallbackRegistered: Boolean,
        val foreground: Boolean,
        val backgroundAdmitted: Boolean,
        val lifecycleRevision: Long,
        val lifecycleDeadlineScheduled: Boolean,
        val companionConnections: Int,
    )

    @Volatile private lateinit var client: AndroidApplicationClient
    @Volatile private var clientOpen = false
    private lateinit var presentationRepository: AndroidPresentationRepository
    private var initializationJob: Job? = null
    private var powerNotificationJob: Job? = null
    private lateinit var notificationCoordinator: AndroidNotificationCoordinator
    private lateinit var lifecycleCoordinator: ProductLifecycleCoordinator
    private lateinit var lifecyclePreferenceStore: ProductLifecyclePreferenceStore
    @Volatile private var lifecyclePreferences = ProductLifecyclePreferences()
    private val lifecyclePreferenceOwnership = Any()
    private var notificationBlockReceiver: BroadcastReceiver? = null
    private val notificationEligibilityMutation = Mutex()
    private val interactionLeases = ConcurrentHashMap.newKeySet<String>()
    private var trackerEvidenceSubscription: AndroidViewSubscription? = null
    private var trackerEvidenceJob: Job? = null
    private var companionPairingJob: Job? = null
    private var companionRootJob: Job? = null
    private var companionRootRemovalJob: Job? = null
    private var companionConnectionJob: Job? = null
    private var companionConnectionSubscription: AndroidCompanionConnectionSubscription? = null
    private val companionOwnerMutation = Mutex()
    @Volatile private var safStorageJobs: List<Job> = emptyList()
    @Volatile private var defaultSafRootId: String? = null
    private val safRootMutation = Mutex()
    private val safWork = ConcurrentHashMap.newKeySet<String>()
    private val safDirectCompletions = ConcurrentHashMap.newKeySet<String>()
    private val clientSettingsRequestActive = AtomicBoolean(false)
    private val torrentSettingsRequestActive = AtomicBoolean(false)
    private val mediaLaunchGate = MediaLaunchGate()
    private var powerLock: PowerManager.WakeLock? = null
    private lateinit var defaultNetworkObserver: AndroidDefaultNetworkObserver
    private val networkPreferenceMutation = Mutex()
    private val networkNativeMutation = Mutex()
    private val productPrivacyMutation = Mutex()
    private val networkConvergenceWake = Channel<Unit>(Channel.CONFLATED)
    private var networkConvergenceJob: Job? = null
    private val externalIntakeController = ExternalIntakeController()
    private val externalIntakeMutation = Mutex()
    private val externalContentMutation = Mutex()
    private val productCommandMutation = Mutex()
    // Serializes torrent command batches so an Undo cannot interleave with the
    // batch it reverses. Mutex waiters are served in FIFO order.
    private val torrentCommandBatches = Mutex()
    private val dataResetOwnerMutation = Mutex()
    @Volatile private var dataResetJournal: ProductDataResetJournal? = null
    @Volatile private var dataResetProcessKillAfterTorrentsForTest: Int? = null
    private var dataResetJob: Job? = null
    private val externalAdmissionHints = mutableMapOf<Long, ExternalContentHint>()
    private var externalAdmissionJob: Job? = null
    private var externalSubmissionJob: Job? = null
    @Volatile private var externalCancellationSignal: CancellationSignal? = null
    @Volatile private var externalAdmissionCancellationSignal: CancellationSignal? = null
    private var externalNoticeSequence = 0L

    private data class ExternalContentHint(
        val announcedMimeType: String?,
        val pathHasTorrentSuffix: Boolean,
        val pickedInApp: Boolean = false,
    ) {
        val independentlyEligible: Boolean
            get() =
                pickedInApp ||
                    announcedMimeType.equals(BITTORRENT_MIME_TYPE, ignoreCase = true) ||
                    pathHasTorrentSuffix
    }

    private data class ExternalContentMetadata(
        val displayLabel: String?,
        val knownLength: Long?,
        val providerMimeType: String?,
    )

    private sealed interface ExternalMetadataDisposition {
        data class Accepted(
            val displayLabel: String?,
            val knownLength: Long?,
        ) : ExternalMetadataDisposition

        data class Rejected(val reason: String) : ExternalMetadataDisposition
    }

    override fun onCreate() {
        super.onCreate()
        val recoveredDataReset = runCatching { ProductDataResetJournalStore.load(this) }
        val recoveredJournal = recoveredDataReset.getOrNull()
        if (recoveredJournal != null) {
            dataResetJournal = recoveredJournal
            dataResetActive.set(true)
            publishDataReset(recoveredJournal)
        } else if (recoveredDataReset.isFailure) {
            dataResetActive.set(true)
            mutableState.update {
                it.copy(
                    dataReset =
                        ProductDataResetState(
                            operationId = null,
                            phase = null,
                            completedTorrents = 0,
                            totalTorrents = 0,
                            deleteDataRequested = false,
                            downgradedToKeep = false,
                            failure =
                                ProductDataResetFailureState(
                                    "journal_invalid",
                                    boundedDataResetDetail(
                                        recoveredDataReset.exceptionOrNull()?.message
                                            ?: "data reset journal is invalid",
                                    ),
                                ),
                        ),
                    error = ProductError.Code.DATA_RESET_IN_PROGRESS,
                )
            }
        }
        if (ProductDataSyncQuotaFence.isExhausted(this) && !dataResetActive.get()) {
            quotaExhaustedStartRejected = true
            Log.w(TAG, "product_quota_restart blocked=true")
            return
        }
        notificationCoordinator = AndroidNotificationCoordinator(this, mutableState)
        notificationCoordinator.initialize(interactionLeases.size)
        startForeground(
            AndroidNotificationContract.ONGOING_NOTIFICATION_ID,
            notificationCoordinator.ongoingNotification(
                getString(R.string.notification_opening_profile),
            ),
        )
        lifecyclePreferenceStore = ProductLifecyclePreferenceStore(this)
        lifecyclePreferences = lifecyclePreferenceStore.read()
        val initialNotificationEligibility =
            mutableState.value.notifications.eligibility.backgroundNotificationVisible
        lifecycleCoordinator =
            ProductLifecycleCoordinator(
                scope = scope,
                clockMillis = SystemClock::elapsedRealtime,
                initialPreferences = lifecyclePreferences,
                initialNotificationEligible = initialNotificationEligibility,
                onDecision = ::applyLifecycleDecision,
            )
        publishLifecyclePreferences(initialNotificationEligibility)
        ProductInteractionRegistry.attach { leases ->
            interactionLeases.clear()
            interactionLeases.addAll(leases)
            refreshLifecycleInteractions()
            if (startCommandReceived) refreshNotificationEligibility("interaction")
        }
        registerNotificationBlockReceiver()
        lifecycleCoordinator.start()
        initializationJob = scope.launch {
            try {
                val stickyRecovery =
                    withTimeout(PRODUCT_LIFETIME_STARTUP_MILLIS) {
                        firstStartCommand.await()
                    }
                recoveryNetworkGateClosed.set(stickyRecovery)
                ProductLegacyAndroidMigration.run(this@ProductEngineService)
                ensureActive()
                mutableState.update {
                    it.copy(legacyChromeOsMigration = isChromeOs() && ProductLegacyAndroidMigration.hasMigratedSource(this@ProductEngineService))
                }
                lifecyclePreferences = lifecyclePreferenceStore.read()
                lifecycleCoordinator.updatePreferences(lifecyclePreferences)
                publishLifecyclePreferences(initialNotificationEligibility)
                if (stickyRecovery && !stickyRecoveryAllowed()) {
                    Log.i(TAG, "lifecycle_recovery admitted=false")
                    requestStop("sticky_recovery_ineligible")
                    return@launch
                }
                val safRegistry = ProductSafRootRegistry.load(this@ProductEngineService)
                val unmeteredNetworksOnly = ProductNetworkPreference.read(this@ProductEngineService)
                defaultNetworkObserver =
                    AndroidDefaultNetworkObserver(this@ProductEngineService, unmeteredNetworksOnly) observer@{ networkState ->
                        if (
                            desiredNetworkPrerequisite(networkState) ==
                                AndroidApplicationNetworkPrerequisite.WAITING_FOR_UNMETERED_NETWORK &&
                                clientOpen
                        ) {
                            runCatching { client.closeNetworkPrerequisite() }.onFailure { error ->
                                Log.e(TAG, "synchronous network prerequisite close failed", error)
                                mutableState.update {
                                    it.copy(
                                        network =
                                            it.network.copy(
                                                runtimeError =
                                                    ProductError.Technical(
                                                        productFailureDetail(error, getString(R.string.error_operation_failed)),
                                                    ),
                                            ),
                                    )
                                }
                                requestStop("network_prerequisite_close_failed")
                                return@observer
                            }
                        }
                        mutableState.update {
                            it.copy(
                                network =
                                    it.network.copy(
                                        unmeteredNetworksOnly = networkState.unmeteredNetworksOnly,
                                        eligibility = networkState.eligibility,
                                        observationRevision = networkState.revision,
                                    ),
                            )
                        }
                        networkConvergenceWake.trySend(Unit)
                    }
                val callbackRegistered = defaultNetworkObserver.start()
                val initialNetworkState = defaultNetworkObserver.snapshot()
                mutableState.update {
                    it.copy(
                        storageRootReady = false,
                        storageRootLabel = safRegistry.roots.singleOrNull()?.label,
                        preventSleepDuringActiveDownloads = ProductPowerPreference.read(this@ProductEngineService),
                        network =
                            ProductNetworkState(
                                unmeteredNetworksOnly = unmeteredNetworksOnly,
                                eligibility = initialNetworkState.eligibility,
                                observationRevision = initialNetworkState.revision,
                                callbackRegistered = callbackRegistered,
                            ),
                    )
                }

                PlatformTrustBootstrap.ensureInitialized(applicationContext)
                observePowerAndNotification()
                if (recoveredDataReset.isFailure) return@launch
                if (
                    recoveredJournal != null &&
                    recoveredJournal.phase != ProductDataResetPhase.REMOVING_TORRENTS
                ) {
                    resumeDataReset(recoveredJournal)
                    return@launch
                }
                openProductApplication(
                    safRegistry,
                    initialNetworkState,
                    startCompanion = !dataResetActive.get(),
                )
                recoveredJournal?.let { resumeDataReset(it) }
            } catch (error: Throwable) {
                if (error is CancellationException && stopped.get()) return@launch
                if (!clientReady.isCompleted) {
                    clientReady.completeExceptionally(error)
                }
                if (!presentationReady.isCompleted) {
                    presentationReady.completeExceptionally(error)
                }
                Log.e(TAG, "product service initialization failed", error)
                mutableState.update {
                    it.copy(
                        ready = false,
                        storageRootChecking = false,
                        error = ProductError.Technical(productFailureDetail(error, getString(R.string.error_operation_failed))),
                    )
                }
                notificationCoordinator.updateOngoingNotification(
                    getString(R.string.notification_needs_attention),
                )
                lifecycleCoordinator.terminal(ProductLifetimeStopReason.INITIALIZATION_FAILED)
            }
        }
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        if (quotaExhaustedStartRejected) {
            if (!stopSelfResult(startId)) stopSelf()
            return START_NOT_STICKY
        }
        latestStartId.set(startId)
        startCommandReceived = true
        if (!firstStartCommand.isCompleted) firstStartCommand.complete(intent == null)
        if (
            intent?.action != ACTION_BACKGROUND_ADMITTED &&
                intent?.action != ACTION_BACKGROUND_REVOKED &&
                !acknowledgeForegroundServiceStart()
        ) {
            requestStop("foreground_start_acknowledgement_failed", startId)
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_STOP) {
            lifecycleCoordinator.terminal(ProductLifetimeStopReason.EXPLICIT_STOP)
            requestStop("notification_stop", startId)
        } else if (intent?.action == externalIntakeAction(packageName)) {
            if (!rejectMutationDuringDataReset()) admitExternalIntent(intent)
        } else if (intent?.action == ACTION_ENABLE_CHROMEOS_COMPANION) {
            enableChromeOsCompanion()
        } else if (
            intent?.action == ACTION_DEBUG_TORRENT_CONTROL &&
                ProductSafDocuments.isDebuggable(this)
        ) {
            val torrentId = intent.getStringExtra(EXTRA_DEBUG_TORRENT_ID)
            val action = intent.getStringExtra(EXTRA_DEBUG_TORRENT_ACTION)
            if (!torrentId.isNullOrBlank() && !action.isNullOrBlank()) {
                exerciseTorrentActionForTest(torrentId, action)
            }
        }
        refreshNotificationEligibility("start")
        return if (
            backgroundAdmitted.get() &&
                intent?.action != ACTION_BACKGROUND_REVOKED &&
                intent?.action != ACTION_STOP &&
                !stopRequested.get()
        ) {
            START_STICKY
        } else {
            START_NOT_STICKY
        }
    }

    private suspend fun openProductApplication(
        safRegistry: ProductSafRootRegistryState,
        initialNetworkState: AndroidDefaultNetworkState,
        startCompanion: Boolean,
    ) {
        check(!clientOpen) { "Android application client is already open" }
        val startupStarted = SystemClock.elapsedRealtime()
        fun startupCheckpoint(stage: String) {
            Log.i(TAG, "product_startup stage=$stage elapsed_ms=${SystemClock.elapsedRealtime() - startupStarted}")
        }
        startupCheckpoint("opening")
        val profile = File(filesDir, ProductPrivateProfileReset.PROFILE_DIRECTORY)
        check(profile.mkdirs() || profile.isDirectory)
        val openedClient =
            withTimeout(PRODUCT_LIFETIME_STARTUP_MILLIS) {
                AndroidApplicationClient.open(
                    AndroidApplicationConfig(
                        File(noBackupFilesDir, PRODUCT_STATE_DIRECTORY).absolutePath,
                        BuildConfig.VERSION_NAME,
                        profile.absolutePath,
                        "default",
                        "",
                        true,
                        // A root without a grant stays in the engine catalog;
                        // configuring it would let the engine make it current.
                        safRegistry.roots
                            .filter { ProductSafDocuments.hasGrant(this@ProductEngineService, Uri.parse(it.treeUri)) }
                            .map { AndroidPlatformStorageRoot(it.rootId, it.label) },
                        AndroidNetworkPolicy.ONLINE,
                        desiredNetworkPrerequisite(initialNetworkState),
                        15UL,
                        60UL,
                    ),
                )
            }
        startupCheckpoint("native_open")
        val productSummary = openedClient.productSummary()
        startupCheckpoint("product_summary")
        if (
            desiredNetworkPrerequisite(defaultNetworkObserver.snapshot()) ==
                AndroidApplicationNetworkPrerequisite.WAITING_FOR_UNMETERED_NETWORK
        ) {
            openedClient.closeNetworkPrerequisite()
        }
        client = openedClient
        clientOpen = true
        // Restored-torrent maintenance may hold the native service lock while
        // awaiting provider work. Start its responders before subscriptions or
        // network convergence can wait for that same lock during startup.
        safStorageJobs =
            List(SAF_PROVIDER_CONCURRENCY) {
                scope.launch(Dispatchers.IO) { driveSafStorageRequests() }
            }
        startupCheckpoint("provider_responders")
        mutableState.update { it.copy(productSummary = productSummary) }
        networkConvergenceJob =
            scope.launch {
                for (ignored in networkConvergenceWake) {
                    if (!clientOpen) continue
                    val observed = defaultNetworkObserver.snapshot()
                    runCatching {
                        applyNativeNetworkPrerequisite(
                            desiredNetworkPrerequisite(observed),
                        )
                    }.onFailure { error ->
                        if (error is CancellationException && stopped.get()) return@onFailure
                        Log.e(TAG, "network prerequisite convergence failed", error)
                        mutableState.update {
                            it.copy(
                                network =
                                    it.network.copy(
                                        runtimeError =
                                            ProductError.Technical(
                                                productFailureDetail(error, getString(R.string.error_operation_failed)),
                                            ),
                                    ),
                            )
                        }
                    }
                }
            }
        networkConvergenceWake.trySend(Unit)
        presentationRepository =
            AndroidPresentationRepository(
                scope,
                mutableState,
                stopped,
                onUpdate = { update, product, driveSaf ->
                    updateSafRootState(product)
                    traceUpdate(update, product)
                    if (driveSaf) {
                        lifecycleCoordinator.updateWork(
                            classifyProductLifetimeTorrentViews(
                                product.torrents.values,
                            ),
                        )
                        advanceSaf(product)
                    }
                    driveSettingsMutations()
                },
                onTorrentListUpdate = notificationCoordinator::onTorrentListUpdate,
                onTorrentListReset = {
                    notificationCoordinator.onTorrentListReset()
                    lifecycleCoordinator.resetWork()
                },
                onError = ::reportError,
            )
        presentationRepository.start(client)
        startupCheckpoint("presentation")
        if (!presentationReady.isCompleted) presentationReady.complete(Unit)
        reconcileSafRootRegistry()
        startupCheckpoint("root_registry")
        val storageRootHealthy = client.probeSafStorageRoots()
        startupCheckpoint("root_probe")
        Log.i(TAG, "saf_root_health source=startup available=$storageRootHealthy")
        refreshSafRootState()
        startupCheckpoint("root_presentation")
        mutableState.update { it.copy(ready = true, storageRootChecking = false) }
        if (!clientReady.isCompleted) clientReady.complete(Unit)
        if (
            startCompanion &&
            ProductCompanionPreference.shouldStart(
                isChromeOs(),
                ProductCompanionPreference.read(this@ProductEngineService),
            )
        ) {
            startChromeOsCompanionOwners()
        }
        startupCheckpoint("ready")
    }

    fun acknowledgeProductDisclosure(statisticsEnabled: Boolean) {
        mutateProductSummary {
            client.acknowledgeProductDisclosure(statisticsEnabled)
        }
    }

    fun setProductStatisticsEnabled(statisticsEnabled: Boolean) {
        mutateProductSummary {
            client.setProductStatisticsEnabled(statisticsEnabled)
        }
    }

    fun resetProductStatistics() {
        mutateProductSummary { client.resetProductStatistics() }
    }

    fun recordProductForegroundSession() {
        mutateProductSummary { client.recordProductForegroundSession() }
    }

    private fun mutateProductSummary(mutation: () -> org.rstorrent.session.uniffi.ProductSummary) {
        if (rejectMutationDuringDataReset()) return
        scope.launch {
            productPrivacyMutation.withLock {
                runCatching {
                    clientReady.await()
                    mutation()
                }.onSuccess { summary ->
                    mutableState.update { it.copy(productSummary = summary, error = null) }
                }.onFailure(::reportError)
            }
        }
    }

    suspend fun productFeedbackPreview(includeStatistics: Boolean) =
        withContext(Dispatchers.IO) {
            clientReady.await()
            client.productFeedbackPreview(
                Build.VERSION.RELEASE,
                "${Build.MANUFACTURER} ${Build.MODEL}",
                includeStatistics,
            )
        }

    suspend fun confirmProductFeedback(
        includeStatistics: Boolean,
        expectedUrl: String,
    ): String =
        withContext(Dispatchers.IO) {
            clientReady.await()
            client.confirmProductFeedback(
                Build.VERSION.RELEASE,
                "${Build.MANUFACTURER} ${Build.MODEL}",
                includeStatistics,
                expectedUrl,
            )
        }

    override fun onBind(intent: Intent?): IBinder? =
        if (quotaExhaustedStartRejected) null else binder

    override fun onDestroy() {
        if (quotaExhaustedStartRejected) {
            scope.cancel()
            super.onDestroy()
            return
        }
        runBlocking(Dispatchers.IO) {
            shutdown("destroy")
        }
        scope.cancel()
        super.onDestroy()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.i(
            TAG,
            "product_task_removed background_admitted=${backgroundAdmitted.get()}",
        )
        super.onTaskRemoved(rootIntent)
    }

    override fun onTimeout(
        startId: Int,
        fgsType: Int,
    ) {
        Log.w(TAG, "product_service_timeout type=data_sync")
        if (!ProductDataSyncQuotaFence.markExhausted(this)) {
            Log.e(TAG, "product_quota_fence persist_failed=true")
        }
        if (productQuotaRestartEvidenceArmed.compareAndSet(true, false)) {
            scheduleProductQuotaRestartEvidence()
        }
        lifecycleCoordinator.terminal(ProductLifetimeStopReason.DATA_SYNC_TIMEOUT)
        requestStop("data_sync_timeout", startId)
    }

    private fun scheduleProductQuotaRestartEvidence() {
        val application = applicationContext
        Handler(Looper.getMainLooper()).postDelayed(
            {
                val outcome =
                    runCatching {
                        application.startForegroundService(
                            Intent(application, ProductEngineService::class.java),
                        )
                        "accepted"
                    }.fold(
                        onSuccess = { it },
                        onFailure = { failure ->
                            "rejected_${failure.javaClass.simpleName}"
                        },
                    )
                Log.i(TAG, "product_quota_restart outcome=$outcome")
            },
            PRODUCT_QUOTA_RESTART_DELAY_MILLIS,
        )
    }

    private fun admitExternalIntent(command: Intent) {
        scope.launch {
            val started = SystemClock.elapsedRealtime()
            externalIntakeMutation.withLock {
                val forwardedRejection =
                    command.getStringExtra(MainActivity.EXTRA_EXTERNAL_REJECTION)
                if (forwardedRejection != null) {
                    val reason =
                        runCatching { ExternalIntentRejection.valueOf(forwardedRejection) }
                            .getOrNull()
                            ?.name
                            ?.lowercase()
                            ?: "invalid_forward"
                    rejectExternalIntent(reason, started)
                    return@withLock
                }
                val sourceValue = command.getStringExtra(MainActivity.EXTRA_EXTERNAL_SOURCE)
                val sourceUri = sourceValue?.let(Uri::parse)
                val classification =
                    ExternalIntentClassifier.classify(
                        ExternalIntentInput(
                            action = EXTERNAL_VIEW_ACTION,
                            data = sourceValue,
                            scheme = sourceUri?.scheme,
                            mimeType =
                                command.getStringExtra(MainActivity.EXTRA_EXTERNAL_MIME_TYPE),
                            path = sourceUri?.path,
                            hasSelector = false,
                            hasClipData = false,
                            packageOverride = null,
                            hasReadGrant =
                                command.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0,
                        ),
                    )
                when (classification) {
                    ExternalIntentClassification.NotExternalView ->
                        rejectExternalIntent("invalid_forward", started)
                    is ExternalIntentClassification.Rejected ->
                        rejectExternalIntent(classification.reason.name.lowercase(), started)
                    is ExternalIntentClassification.Magnet ->
                        admitExternalSource(
                            classification.source,
                            hint = null,
                            started = started,
                        )
                    is ExternalIntentClassification.Content ->
                        admitExternalSource(
                            classification.source,
                            ExternalContentHint(
                                classification.announcedMimeType,
                                classification.pathHasTorrentSuffix,
                            ),
                            started,
                        )
                }
            }
        }
    }

    private fun admitExternalSource(
        source: ExternalIntakeSource,
        hint: ExternalContentHint?,
        started: Long,
        heldInApp: Boolean = false,
        awaitFileSelection: Boolean? = null,
    ) {
        val result =
            externalIntakeController.receive(
                source,
                needsMetadataValidation = hint != null,
                rootReady = currentSafRootForAdd() != null,
                heldInApp = heldInApp,
                awaitFileSelection = awaitFileSelection,
            )
        val intakeId = result.intakeId
        when (result.disposition) {
            ExternalAdmissionDisposition.ADMITTED -> {
                if (hint != null && intakeId != null) externalAdmissionHints[intakeId] = hint
                logExternalIntake(
                    intakeId,
                    source.kind,
                    "received",
                    "accepted",
                    durationMillis = SystemClock.elapsedRealtime() - started,
                    disposition = "admitted",
                )
                publishExternalSnapshot()
                if (hint == null) {
                    if (currentSafRootForAdd() != null) {
                        logExternalIntake(intakeId, source.kind, "presented", "ready")
                    } else {
                        logExternalIntake(intakeId, source.kind, "awaiting_root", "no_root")
                    }
                    submitHeldAddLocked()
                } else {
                    scheduleExternalAdmissionLocked()
                }
            }
            ExternalAdmissionDisposition.COALESCED ->
                logExternalIntake(
                    intakeId,
                    source.kind,
                    "duplicate",
                    "exact_source",
                    durationMillis = SystemClock.elapsedRealtime() - started,
                    disposition = "coalesced",
                )
            ExternalAdmissionDisposition.QUEUE_FULL -> {
                publishExternalNotice(ExternalIntakeNoticeKind.QUEUE_FULL)
                logExternalIntake(
                    null,
                    source.kind,
                    "rejected",
                    "queue_full",
                    durationMillis = SystemClock.elapsedRealtime() - started,
                    disposition = "queue_full",
                )
            }
        }
    }

    /**
     * Queues in-app adds made before a usable download folder exists. The
     * intake dialog asks for the folder; each add then submits with
     * [awaitFileSelection] as if it had been made with the folder ready.
     * Returns false when a source cannot be held, leaving the caller to report.
     */
    private fun holdForStorageRoot(
        kind: ExternalIntakeKind,
        values: List<String>,
        awaitFileSelection: Boolean,
    ): Boolean {
        val sources =
            values.map {
                runCatching { ExternalIntakeSource.create(kind, it.trim()) }.getOrNull()
                    ?: return false
            }
        val hint =
            if (kind == ExternalIntakeKind.TORRENT_FILE) {
                ExternalContentHint(null, pathHasTorrentSuffix = false, pickedInApp = true)
            } else {
                null
            }
        scope.launch {
            val started = SystemClock.elapsedRealtime()
            externalIntakeMutation.withLock {
                for (source in sources) {
                    admitExternalSource(
                        source,
                        hint,
                        started,
                        heldInApp = true,
                        awaitFileSelection = awaitFileSelection,
                    )
                }
            }
        }
        return true
    }

    private fun submitHeldAddLocked() {
        if (externalSubmissionJob?.isActive == true) return
        val work =
            externalIntakeController.takeHeldSubmission(currentSafRootForAdd() != null)
                ?: return
        publishExternalSnapshot()
        scheduleExternalSubmissionLocked(work)
    }

    private fun rejectExternalIntent(
        reason: String,
        started: Long,
    ) {
        publishExternalNotice(ExternalIntakeNoticeKind.REJECTED)
        logExternalIntake(
            null,
            null,
            "rejected",
            reason,
            durationMillis = SystemClock.elapsedRealtime() - started,
            disposition = "rejected",
        )
    }

    private fun scheduleExternalAdmissionLocked() {
        if (externalAdmissionJob?.isActive == true) return
        externalAdmissionJob =
            scope.launch {
                while (true) {
                    val pending =
                        externalIntakeMutation.withLock {
                            val work = externalIntakeController.nextReceived()
                            if (work == null) {
                                externalAdmissionJob = null
                                null
                            } else {
                                work to externalAdmissionHints.getValue(work.intakeId)
                            }
                        } ?: return@launch
                    val started = SystemClock.elapsedRealtime()
                    val disposition = inspectExternalContent(pending.first, pending.second)
                    externalIntakeMutation.withLock {
                        externalAdmissionHints.remove(pending.first.intakeId)
                        when (disposition) {
                            is ExternalMetadataDisposition.Accepted -> {
                                externalIntakeController.completeContentAdmission(
                                    pending.first.intakeId,
                                    accepted = true,
                                    displayLabel = disposition.displayLabel,
                                    knownLength = disposition.knownLength,
                                    rootReady = currentSafRootForAdd() != null,
                                )
                                logExternalIntake(
                                    pending.first.intakeId,
                                    ExternalIntakeKind.TORRENT_FILE,
                                    "presented",
                                    "metadata_accepted",
                                    durationMillis =
                                        SystemClock.elapsedRealtime() - started,
                                    disposition = "admitted",
                                )
                            }
                            is ExternalMetadataDisposition.Rejected -> {
                                externalIntakeController.completeContentAdmission(
                                    pending.first.intakeId,
                                    accepted = false,
                                    displayLabel = null,
                                    knownLength = null,
                                    rootReady = currentSafRootForAdd() != null,
                                )
                                publishExternalNotice(ExternalIntakeNoticeKind.REJECTED)
                                logExternalIntake(
                                    pending.first.intakeId,
                                    ExternalIntakeKind.TORRENT_FILE,
                                    "rejected",
                                    disposition.reason,
                                    durationMillis =
                                        SystemClock.elapsedRealtime() - started,
                                    disposition = "rejected",
                                )
                            }
                        }
                        publishExternalSnapshot()
                        submitHeldAddLocked()
                    }
                }
            }
    }

    private suspend fun inspectExternalContent(
        work: ExternalIntakeWork,
        hint: ExternalContentHint,
    ): ExternalMetadataDisposition =
        externalContentMutation.withLock {
            val metadata =
                try {
                    queryExternalContentMetadata(Uri.parse(work.source.reveal()))
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Throwable) {
                    return@withLock if (hint.independentlyEligible) {
                        ExternalMetadataDisposition.Accepted(null, null)
                    } else {
                        ExternalMetadataDisposition.Rejected("metadata_unavailable")
                    }
                }
            if (metadata.providerMimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
                return@withLock ExternalMetadataDisposition.Rejected("directory")
            }
            val accepted =
                hint.independentlyEligible ||
                    metadata.providerMimeType.equals(
                        BITTORRENT_MIME_TYPE,
                        ignoreCase = true,
                    ) ||
                    hasTorrentSuffix(metadata.displayLabel)
            if (accepted) {
                ExternalMetadataDisposition.Accepted(
                    boundedExternalDisplayLabel(metadata.displayLabel),
                    metadata.knownLength,
                )
            } else {
                ExternalMetadataDisposition.Rejected("unsupported_content")
            }
        }

    private suspend fun queryExternalContentMetadata(uri: Uri): ExternalContentMetadata =
        supervisorScope {
            val cancellation = CancellationSignal()
            externalAdmissionCancellationSignal = cancellation
            val query =
                async(Dispatchers.IO) {
                    runInterruptible {
                        contentResolver
                            .query(
                                uri,
                                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                                null,
                                null,
                                null,
                                cancellation,
                            ).use(::externalContentMetadataFromCursor)
                    }
                }
            try {
                val result =
                    withTimeoutOrNull(EXTERNAL_PROVIDER_TIMEOUT_MILLIS) {
                        query.await()
                    }
                if (result == null) {
                    cancellation.cancel()
                    query.cancelAndJoin()
                    throw TorrentSourceReadTimeoutException()
                }
                result.copy(
                    providerMimeType = runInterruptible(Dispatchers.IO) {
                        contentResolver.getType(uri)
                    },
                )
            } finally {
                externalAdmissionCancellationSignal = null
                cancellation.cancel()
            }
        }

    private fun externalContentMetadataFromCursor(cursor: Cursor?): ExternalContentMetadata {
        if (cursor == null || !cursor.moveToFirst()) {
            return ExternalContentMetadata(null, null, null)
        }
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
        return ExternalContentMetadata(
            displayLabel =
                nameIndex.takeIf { it >= 0 && !cursor.isNull(it) }?.let(cursor::getString),
            knownLength =
                sizeIndex.takeIf { it >= 0 && !cursor.isNull(it) }
                    ?.let(cursor::getLong)
                    ?.takeIf { it >= 0L },
            providerMimeType = null,
        )
    }

    fun setExternalIntakeStartContent(
        intakeId: Long,
        startContent: Boolean,
    ) {
        if (rejectMutationDuringDataReset()) return
        scope.launch {
            externalIntakeMutation.withLock {
                if (externalIntakeController.setStartContent(intakeId, startContent)) {
                    publishExternalSnapshot()
                }
            }
        }
    }

    fun confirmExternalIntake(intakeId: Long, awaitFileSelection: Boolean? = null) {
        if (rejectMutationDuringDataReset()) return
        scope.launch {
            externalIntakeMutation.withLock {
                val work =
                    externalIntakeController.confirm(
                        intakeId,
                        rootReady = currentSafRootForAdd() != null,
                        awaitFileSelection = awaitFileSelection,
                    )
                publishExternalSnapshot()
                if (work != null) scheduleExternalSubmissionLocked(work)
            }
        }
    }

    fun retryExternalIntake(intakeId: Long) {
        if (rejectMutationDuringDataReset()) return
        scope.launch {
            externalIntakeMutation.withLock {
                val work =
                    externalIntakeController.retry(
                        intakeId,
                        rootReady = currentSafRootForAdd() != null,
                    )
                publishExternalSnapshot()
                if (work != null) scheduleExternalSubmissionLocked(work)
            }
        }
    }

    fun cancelExternalIntake(intakeId: Long) {
        if (rejectMutationDuringDataReset()) return
        scope.launch {
            val submission =
                externalIntakeMutation.withLock {
                    if (!externalIntakeController.cancel(intakeId, currentSafRootForAdd() != null)) {
                        return@withLock null
                    }
                    externalAdmissionHints.remove(intakeId)
                    externalCancellationSignal?.cancel()
                    publishExternalSnapshot()
                    externalSubmissionJob
                }
            submission?.cancelAndJoin()
            externalIntakeMutation.withLock { submitHeldAddLocked() }
            logExternalIntake(intakeId, null, "cancelled", "user")
        }
    }

    private fun scheduleExternalSubmissionLocked(work: ExternalIntakeWork) {
        check(externalSubmissionJob?.isActive != true) {
            "external intake already has a submission job"
        }
        externalSubmissionJob =
            scope.launch {
                val started = SystemClock.elapsedRealtime()
                try {
                    clientReady.await()
                    val storageRoot = currentSafRootForAdd()
                    if (storageRoot == null) {
                        externalIntakeMutation.withLock {
                            externalIntakeController.submissionRootUnavailable(work.intakeId)
                            publishExternalSnapshot()
                        }
                        logExternalIntake(
                            work.intakeId,
                            work.source.kind,
                            "awaiting_root",
                            "root_unavailable",
                        )
                        return@launch
                    }
                    val downloadAll = work.startContent && work.awaitFileSelection == false
                    val awaitFileSelection =
                        work.startContent &&
                            (work.awaitFileSelection ?: mutableState.value.storage?.showFileSelection ?: true)
                    val result =
                        when (work.source.kind) {
                            ExternalIntakeKind.MAGNET ->
                                dispatchAddResult(
                                    Command.AddMagnet(
                                        magnet = work.source.reveal().trim(),
                                        storageRoot = storageRoot,
                                        startContent = work.startContent,
                                        awaitFileSelection = awaitFileSelection || downloadAll,
                                        skipFiles = emptyList(),
                                    ),
                                )
                            ExternalIntakeKind.TORRENT_FILE -> {
                                externalContentMutation.withLock {
                                    val source = readExternalTorrentSource(work)
                                    logExternalIntake(
                                        work.intakeId,
                                        work.source.kind,
                                        "source_read",
                                        "complete",
                                        byteCount = source.sourceBytes,
                                        peakSourceBytes = source.peakOwnedBytes,
                                    )
                                    dispatchTorrentSourceResult(
                                        source.bytes,
                                        work.startContent,
                                        FileSelectionIntent.All,
                                        storageRoot,
                                        awaitFileSelection || downloadAll,
                                    )
                                }
                            }
                        }
                    if (downloadAll && result.disposition == AddTorrentDisposition.Added) {
                        downloadAllPendingAwait(result.torrentId)
                    }
                    val notice =
                        when (result.disposition) {
                            AddTorrentDisposition.Added -> ExternalIntakeNoticeKind.ADDED
                            AddTorrentDisposition.AlreadyPresent ->
                                ExternalIntakeNoticeKind.ALREADY_PRESENT
                            is AddTorrentDisposition.SelectionExpanded ->
                                ExternalIntakeNoticeKind.SELECTION_EXPANDED
                        }
                    externalIntakeMutation.withLock {
                        if (currentSafRootForAdd() == null) {
                            if (
                                externalIntakeController.submissionRootUnavailable(
                                    work.intakeId,
                                )
                            ) {
                                publishExternalSnapshot()
                                logExternalIntake(
                                    work.intakeId,
                                    work.source.kind,
                                    "awaiting_root",
                                    "root_unavailable",
                                    durationMillis =
                                        SystemClock.elapsedRealtime() - started,
                                )
                            }
                            return@withLock
                        }
                        if (
                            externalIntakeController.completeSubmission(
                                work.intakeId,
                                currentSafRootForAdd() != null,
                            )
                        ) {
                            // A held in-app add reports like any other in-app add.
                            if (
                                notice == ExternalIntakeNoticeKind.ALREADY_PRESENT &&
                                (work.heldInApp ||
                                    mutableState.value.torrents[result.torrentId]?.archived == true)
                            ) {
                                publishAlreadyPresent(listOf(result.torrentId), work.startContent)
                            } else if (!(work.heldInApp && notice == ExternalIntakeNoticeKind.ADDED)) {
                                publishExternalNotice(notice)
                            }
                            publishExternalSnapshot()
                            logExternalIntake(
                                work.intakeId,
                                work.source.kind,
                                when (notice) {
                                    ExternalIntakeNoticeKind.ALREADY_PRESENT -> "duplicate"
                                    else -> "success"
                                },
                                "complete",
                                durationMillis = SystemClock.elapsedRealtime() - started,
                                disposition = notice.name.lowercase(),
                            )
                        }
                    }
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Throwable) {
                    val retryable =
                        error is SecurityException ||
                            error is FileNotFoundException ||
                            error is TorrentSourceReadTimeoutException ||
                            error is TorrentSourceProviderException
                    val reason =
                        when (error) {
                            is SecurityException -> "permission"
                            is FileNotFoundException -> "provider_missing"
                            is TorrentSourceReadTimeoutException -> "timeout"
                            is TorrentSourceProviderException -> "provider_failure"
                            is EmptyTorrentSourceException -> "empty"
                            is OversizedTorrentSourceException -> "oversized"
                            else -> "invalid_or_engine_failure"
                        }
                    externalIntakeMutation.withLock {
                        val failureDisposition =
                            externalIntakeController.failSubmission(
                                work.intakeId,
                                retryable,
                                currentSafRootForAdd() != null,
                            )
                        if (failureDisposition != null) {
                            if (
                                failureDisposition ==
                                ExternalSubmissionFailureDisposition.TERMINAL
                            ) {
                                publishExternalNotice(
                                    ExternalIntakeNoticeKind.TERMINAL_FAILURE,
                                )
                            }
                            publishExternalSnapshot()
                            logExternalIntake(
                                work.intakeId,
                                work.source.kind,
                                when (failureDisposition) {
                                    ExternalSubmissionFailureDisposition.RETRYABLE -> "retry"
                                    ExternalSubmissionFailureDisposition.TERMINAL -> "terminal"
                                },
                                reason,
                                durationMillis = SystemClock.elapsedRealtime() - started,
                                disposition =
                                    when (failureDisposition) {
                                        ExternalSubmissionFailureDisposition.RETRYABLE -> "retryable"
                                        ExternalSubmissionFailureDisposition.TERMINAL -> "failed"
                                    },
                            )
                        }
                    }
                } finally {
                    externalCancellationSignal = null
                    externalIntakeMutation.withLock {
                        externalSubmissionJob = null
                        submitHeldAddLocked()
                    }
                }
            }
    }

    private suspend fun readExternalTorrentSource(work: ExternalIntakeWork): BoundedTorrentSource {
        val cancellation = CancellationSignal()
        externalCancellationSignal = cancellation
        val uri = Uri.parse(work.source.reveal())
        return BoundedTorrentSourceReader.read(
            openInput = {
                val descriptor =
                    contentResolver.openFileDescriptor(uri, "r", cancellation)
                        ?: throw FileNotFoundException()
                ParcelFileDescriptor.AutoCloseInputStream(descriptor)
            },
            knownLength = work.knownLength,
            cancelled = { cancellation.isCanceled },
            onCancel = cancellation::cancel,
        )
    }

    private fun publishExternalSnapshot() {
        val snapshot = externalIntakeController.snapshot()
        mutableState.update {
            it.copy(
                externalIntake = snapshot.presentation,
                externalIntakeDepth = snapshot.descriptorCount,
            )
        }
    }

    private fun publishExternalNotice(kind: ExternalIntakeNoticeKind) {
        externalNoticeSequence += 1
        mutableState.update {
            it.copy(
                externalIntakeNotice = ExternalIntakeNotice(externalNoticeSequence, kind),
            )
        }
    }

    private fun logExternalIntake(
        intakeId: Long?,
        kind: ExternalIntakeKind?,
        phase: String,
        reason: String,
        durationMillis: Long = 0L,
        disposition: String = "none",
        byteCount: Int = 0,
        peakSourceBytes: Int = 0,
    ) {
        Log.i(
            TAG,
            "external_intake id=${intakeId ?: 0L} " +
                "kind=${kind?.name?.lowercase() ?: "unknown"} phase=$phase " +
                "reason=$reason count=1 depth=${externalIntakeController.descriptorCount()} " +
                "duration_ms=$durationMillis disposition=$disposition " +
                "bytes=$byteCount peak_source_bytes=$peakSourceBytes",
        )
    }

    fun addMagnet(
        magnet: String,
        skipFiles: List<UInt> = emptyList(),
        startContent: Boolean = true,
        awaitFileSelection: Boolean = false,
        downloadAll: Boolean = false,
    ) {
        addMagnets(listOf(magnet), skipFiles, startContent, awaitFileSelection, downloadAll)
    }

    /**
     * Adds [magnets] in order. A failed add does not stop later ones, and
     * matches already in the session are reported together once the batch ends.
     */
    fun addMagnets(
        magnets: List<String>,
        skipFiles: List<UInt> = emptyList(),
        startContent: Boolean = true,
        awaitFileSelection: Boolean = false,
        downloadAll: Boolean = false,
    ) {
        if (magnets.isEmpty() || rejectMutationDuringDataReset()) return
        val storageRoot = currentSafRootForAdd()
        if (storageRoot == null) {
            val held =
                startContent && skipFiles.isEmpty() &&
                    holdForStorageRoot(
                        ExternalIntakeKind.MAGNET,
                        magnets,
                        awaitFileSelection = awaitFileSelection && !downloadAll,
                    )
            if (!held) {
                mutableState.update { it.copy(error = ProductError.Code.SELECT_DOWNLOAD_FOLDER) }
            }
            return
        }
        if (downloadAll) mutableState.update { it.copy(quickAddsInFlight = it.quickAddsInFlight + 1) }
        scope.launch {
            try {
                clientReady.await()
                val alreadyPresent = mutableListOf<String>()
                for (magnet in magnets) {
                    try {
                        val result = dispatchAddResult(
                            Command.AddMagnet(
                                magnet = magnet.trim(),
                                storageRoot = storageRoot,
                                startContent = startContent,
                                awaitFileSelection = awaitFileSelection || downloadAll,
                                skipFiles = skipFiles,
                            ),
                        )
                        if (downloadAll && result.disposition == AddTorrentDisposition.Added) {
                            downloadAllPendingAwait(result.torrentId)
                        }
                        if (result.disposition == AddTorrentDisposition.AlreadyPresent) {
                            alreadyPresent += result.torrentId
                        }
                        logAddResult(result, magnetV1(magnet), magnetV2(magnet))
                    } catch (error: Throwable) {
                        if (error is CancellationException) throw error
                        reportError(error)
                    }
                }
                publishAlreadyPresent(alreadyPresent, startContent)
            } catch (error: Throwable) {
                reportError(error)
            } finally {
                if (downloadAll) mutableState.update { it.copy(quickAddsInFlight = it.quickAddsInFlight - 1) }
            }
        }
    }

    private fun publishAlreadyPresent(torrentIds: List<String>, resumeOnRestore: Boolean) {
        if (torrentIds.isEmpty()) return
        val sequence = alreadyPresentSequence.incrementAndGet()
        mutableState.update { state ->
            state.copy(
                alreadyPresentNotice =
                    alreadyPresentNotice(sequence, torrentIds, state.torrents, resumeOnRestore),
            )
        }
    }

    fun clearAlreadyPresentNotice(sequence: Long) {
        mutableState.update {
            if (it.alreadyPresentNotice?.sequence == sequence) it.copy(alreadyPresentNotice = null)
            else it
        }
    }

    fun addTorrentFile(
        uri: Uri,
        startContent: Boolean = true,
        awaitFileSelection: Boolean = false,
    ) {
        if (rejectMutationDuringDataReset()) return
        val storageRoot = currentSafRootForAdd()
        if (storageRoot == null) {
            val held =
                startContent &&
                    holdForStorageRoot(
                        ExternalIntakeKind.TORRENT_FILE,
                        listOf(uri.toString()),
                        awaitFileSelection,
                    )
            if (!held) {
                mutableState.update { it.copy(error = ProductError.Code.SELECT_DOWNLOAD_FOLDER) }
            }
            return
        }
        scope.launch(Dispatchers.IO) {
            try {
                clientReady.await()
                val source = readTorrentSource(uri)
                dispatchTorrentSource(
                    source,
                    startContent,
                    storageRoot = storageRoot,
                    awaitFileSelection = awaitFileSelection,
                )
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    fun addTorrentBytes(
        source: ByteArray,
        startContent: Boolean = true,
        selection: FileSelectionIntent = FileSelectionIntent.All,
        awaitFileSelection: Boolean = false,
    ) {
        if (rejectMutationDuringDataReset()) return
        val storageRoot = currentSafRootForAdd()
        if (storageRoot == null) {
            mutableState.update { it.copy(error = ProductError.Code.SELECT_DOWNLOAD_FOLDER) }
            return
        }
        scope.launch(Dispatchers.IO) {
            try {
                clientReady.await()
                require(source.isNotEmpty()) { "Torrent file is empty" }
                require(source.size <= MAX_TORRENT_SOURCE_BYTES) {
                    "Torrent file exceeds the ${MAX_TORRENT_SOURCE_BYTES / (1024 * 1024)} MiB limit"
                }
                dispatchTorrentSource(
                    source,
                    startContent,
                    selection,
                    storageRoot,
                    awaitFileSelection,
                )
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    private suspend fun dispatchTorrentSource(
        source: ByteArray,
        startContent: Boolean,
        selection: FileSelectionIntent = FileSelectionIntent.All,
        storageRoot: String = requireNotNull(currentSafRootForAdd()) {
            "Select a download folder first"
        },
        awaitFileSelection: Boolean = false,
    ) {
        val add =
            dispatchTorrentSourceResult(
                source,
                startContent,
                selection,
                storageRoot,
                awaitFileSelection,
            )
        if (add.disposition == AddTorrentDisposition.AlreadyPresent) {
            publishAlreadyPresent(listOf(add.torrentId), startContent)
        }
        logAddResult(add, null)
    }

    private suspend fun dispatchTorrentSourceResult(
        source: ByteArray,
        startContent: Boolean,
        selection: FileSelectionIntent,
        storageRoot: String,
        awaitFileSelection: Boolean = false,
    ): AddTorrentResult {
        val request =
            AddTorrentBytesRequest(
                version = 1U.toUShort(),
                requestId = "android-$requestPrefix-${requestIds.getAndIncrement()}",
                expectedRevision = null,
                storageRoot = storageRoot,
                startContent = startContent,
                awaitFileSelection = awaitFileSelection,
                selection = selection,
                sourceLength = source.size.toUInt(),
            )
        val response =
            productCommandMutation.withLock {
                if (dataResetActive.get()) throw ProductDataResetInProgressException()
                client.addTorrentBytes(request, source)
            }
        val outcome = response.outcome
        if (outcome is ResponseOutcome.Error) error(outcome.error.message)
        return addResult(response)
    }

    private suspend fun readTorrentSource(uri: Uri): ByteArray =
        BoundedTorrentSourceReader.read(
            openInput = {
                contentResolver.openInputStream(uri) ?: throw FileNotFoundException()
            },
        ).bytes

    fun addMagnetWithTrackerPolicyForTest(
        magnet: String,
        policyName: String,
        startContent: Boolean,
    ) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "tracker authentication injection is debug-only"
        }
        val storageRoot = currentSafRootForAdd()
        if (storageRoot == null) {
            mutableState.update { it.copy(error = ProductError.Code.SELECT_DOWNLOAD_FOLDER) }
            return
        }
        val policy =
            when (policyName) {
                "system_trust" -> HttpsServerAuthenticationPolicy.SYSTEM_TRUST
                "disabled" -> HttpsServerAuthenticationPolicy.DISABLED
                else -> error("unknown tracker HTTPS authentication policy")
            }
        val v1InfoHash = magnetV1(magnet)
        scope.launch {
            try {
                clientReady.await()
                dispatchAwait(
                    Command.UpdateClientSettings(
                        ClientSettings(
                            listener = ListenerPolicy.Disabled,
                            preferredListenPort = 6_881U.toUShort(),
                            portMapping = PortMappingPolicy.DISABLED,
                            peerConnectionLimit = 200U,
                            uploadSlots = 8U.toUShort(),
                            activeDownloads = 3U.toUShort(),
                            activeSeeds = ActiveSeedLimit.Limited(5U.toUShort()),
                            shareRatioLimitPercent = 200U,
                            finishedDownloadRatioLimitPercent = 700U,
                            finishedTimeLimitSeconds = 86_400U,
                            seedStopRatioPercent = org.rstorrent.session.uniffi.SeedStopLimit.Off,
                            seedStopTimeSeconds = org.rstorrent.session.uniffi.SeedStopLimit.Off,
                            uploadRateLimit = TransferRateLimit.Unlimited,
                            downloadRateLimit = TransferRateLimit.Unlimited,
                            encryption = EncryptionPolicy.ALLOW,
                            ipv6Enabled = true,
                            dhtEnabled = true,
                            peerExchangeEnabled = true,
                            trackerHttpsServerAuthentication = policy,
                        ).asPatch(),
                    ),
                )
                awaitTrackerPolicy(policy)
                val torrentId = dispatchAddAwait(
                    Command.AddMagnet(
                        magnet.trim(),
                        storageRoot,
                        startContent,
                        false,
                        emptyList(),
                    ),
                    v1InfoHash,
                )
                subscribeTrackerEvidenceForTest(torrentId)
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    fun addMagnetWithEncryptionPolicyForTest(
        magnet: String,
        policyName: String,
        skipFiles: List<UInt> = emptyList(),
    ) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "peer encryption injection is debug-only"
        }
        val storageRoot = currentSafRootForAdd()
        if (storageRoot == null) {
            mutableState.update { it.copy(error = ProductError.Code.SELECT_DOWNLOAD_FOLDER) }
            return
        }
        val policy =
            when (policyName) {
                "disabled" -> EncryptionPolicy.DISABLED
                "allow" -> EncryptionPolicy.ALLOW
                "prefer" -> EncryptionPolicy.PREFER
                "required" -> EncryptionPolicy.REQUIRED
                else -> error("unknown peer encryption policy")
            }
        scope.launch {
            try {
                clientReady.await()
                dispatchAwait(
                    Command.UpdateClientSettings(
                        ClientSettings(
                            listener = ListenerPolicy.Disabled,
                            preferredListenPort = 6_881U.toUShort(),
                            portMapping = PortMappingPolicy.DISABLED,
                            peerConnectionLimit = 200U,
                            uploadSlots = 8U.toUShort(),
                            activeDownloads = 3U.toUShort(),
                            activeSeeds = ActiveSeedLimit.Limited(5U.toUShort()),
                            shareRatioLimitPercent = 200U,
                            finishedDownloadRatioLimitPercent = 700U,
                            finishedTimeLimitSeconds = 86_400U,
                            seedStopRatioPercent = org.rstorrent.session.uniffi.SeedStopLimit.Off,
                            seedStopTimeSeconds = org.rstorrent.session.uniffi.SeedStopLimit.Off,
                            uploadRateLimit = TransferRateLimit.Unlimited,
                            downloadRateLimit = TransferRateLimit.Unlimited,
                            encryption = policy,
                            ipv6Enabled = true,
                            dhtEnabled = true,
                            peerExchangeEnabled = true,
                            trackerHttpsServerAuthentication =
                                HttpsServerAuthenticationPolicy.SYSTEM_TRUST,
                        ).asPatch(),
                    ),
                )
                awaitEncryptionPolicy(policy)
                dispatchAddAwait(
                    Command.AddMagnet(magnet.trim(), storageRoot, true, false, skipFiles),
                    magnetV1(magnet),
                )
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    fun logMseDhEvidenceForTest() {
        check(ProductSafDocuments.isDebuggable(this)) {
            "MSE DH evidence is debug-only"
        }
        scope.launch {
            try {
                clientReady.await()
                val snapshot = client.mseDhWorkSnapshot()
                Log.i(
                    TAG,
                    "mse_dh_work waiting=${snapshot.waiting} active=${snapshot.active} " +
                        "high_water=${snapshot.highWater} tracked=${snapshot.tracked} " +
                        "closed=${snapshot.closed}",
                )
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    fun logDownloadAdmissionEvidenceForTest(mode: String) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "download admission evidence is debug-only"
        }
        scope.launch {
            try {
                clientReady.await()
                val expectedActive =
                    when (mode) {
                        "active" -> 2U.toUShort()
                        "terminal" -> 0U.toUShort()
                        else -> error("unknown download admission evidence mode")
                    }
                val settings = awaitDownloadAdmission(expectedActive)
                val queued =
                    withTimeout(10_000) {
                        while (true) {
                            val count =
                                mutableState.value.torrents.values.count {
                                    it.operationalState.name == "QUEUED"
                                }
                            if ((mode == "active" && count >= 1) || (mode == "terminal" && count == 0)) {
                                return@withTimeout count
                            }
                            delay(25)
                        }
                        error("unreachable")
                    }
                val resources =
                    withTimeout(10_000) {
                        while (true) {
                            val snapshot = client.downloadResourceSnapshot()
                            if (mode != "terminal" || snapshot.registeredGenerations == 0UL) {
                                return@withTimeout snapshot
                            }
                            delay(25)
                        }
                        error("unreachable")
                    }
                Log.i(
                    TAG,
                    "download_admission mode=$mode " +
                        "configured=${settings.configured.activeDownloads} " +
                        "effective=${settings.effectiveActiveDownloads} " +
                        "active=${settings.activeDownloadCount} queued=$queued " +
                        "registered=${resources.registeredGenerations} " +
                        "registered_high=${resources.registeredGenerationsHighWater} " +
                        "request_high=${resources.outstandingRequestHighWater} " +
                        "payload_high=${resources.bufferedPayloadHighWater} " +
                        "piece_bytes_high=${resources.activePieceBytesHighWater} " +
                        "pieces_high=${resources.activePiecesHighWater} " +
                        "writes_high=${resources.activeStorageWritesHighWater} " +
                        "hashes_high=${resources.activeStorageHashesHighWater}",
                )
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    fun logSeedAdmissionEvidenceForTest(mode: String) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "seed admission evidence is debug-only"
        }
        scope.launch {
            try {
                clientReady.await()
                val expected = ActiveSeedLimit.Limited(1U.toUShort())
                when (mode) {
                    "configure_one" ->
                        dispatchAwait(
                            Command.UpdateClientSettings(
                                clientSettingsPatch(activeSeeds = expected),
                            ),
                        )
                    "reopened_one", "background_one" -> Unit
                    else -> error("unknown seed admission evidence mode")
                }
                val (settings, admissions) =
                    awaitSeedAdmission(expected, active = 1, queued = 2)
                Log.i(
                    TAG,
                    "seed_admission mode=$mode configured=1 effective=1 " +
                        "share=${settings.configured.shareRatioLimitPercent} " +
                        "finished_ratio=${settings.configured.finishedDownloadRatioLimitPercent} " +
                        "finished_time=${settings.configured.finishedTimeLimitSeconds} " +
                        "active=${admissions.active} queued=${admissions.queued} " +
                        "inactive=${admissions.inactive} ineligible=${admissions.ineligible} " +
                        "counted=${settings.activeSeedCount} exempt=${settings.inactiveSeedCount}",
                )
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    private data class SeedAdmissionCounts(
        val active: Int,
        val queued: Int,
        val inactive: Int,
        val ineligible: Int,
    )

    private suspend fun awaitSeedAdmission(
        expected: ActiveSeedLimit,
        active: Int,
        queued: Int,
    ): Pair<ClientSettingsRuntimeView, SeedAdmissionCounts> =
        withTimeout(10_000) {
            while (true) {
                val product = mutableState.value
                val settings = product.clientSettings
                val admissions =
                    SeedAdmissionCounts(
                        active =
                            product.torrents.values.count {
                                it.seeding.admission == SeedAdmissionView.ACTIVE
                            },
                        queued =
                            product.torrents.values.count {
                                it.seeding.admission == SeedAdmissionView.QUEUED
                            },
                        inactive =
                            product.torrents.values.count {
                                it.seeding.admission == SeedAdmissionView.INACTIVE_EXEMPT
                            },
                        ineligible =
                            product.torrents.values.count {
                                it.seeding.admission == SeedAdmissionView.INELIGIBLE
                            },
                    )
                if (
                    settings?.configured?.activeSeeds == expected &&
                    settings.effectiveActiveSeeds == expected &&
                    settings.activeSeedCount.toInt() == active &&
                    admissions.active == active &&
                    admissions.queued == queued
                ) {
                    return@withTimeout settings to admissions
                }
                delay(25)
            }
            error("unreachable")
        }

    private suspend fun awaitDownloadAdmission(active: UShort): ClientSettingsRuntimeView {
        val subscription =
            client.subscribe(
                SubscriptionSpec(
                    ViewSelector.TorrentList,
                    ViewProjection.SUMMARY,
                    DeliveryPolicy(0U, 256U * 1024U),
                    null,
                    null,
                ),
            )
        try {
            return withTimeout(10_000) {
                while (true) {
                    val update = subscription.nextUpdate() ?: error("settings view closed")
                    val settings =
                        when (val payload = update.payload) {
                            is ViewUpdatePayload.Snapshot ->
                                (payload.snapshot as? ViewSnapshot.TorrentList)?.clientSettings
                            is ViewUpdatePayload.Patch ->
                                (payload.patch as? ViewPatch.TorrentList)?.clientSettings
                            is ViewUpdatePayload.ResetRequired -> {
                                subscription.resync()
                                null
                            }
                        }
                    if (settings != null && settings.activeDownloadCount == active) {
                        return@withTimeout settings
                    }
                }
                error("unreachable")
            }
        } finally {
            subscription.close()
        }
    }

    fun exerciseIpv6PolicyForTest(mode: String) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "IPv6 policy evidence is debug-only"
        }
        Log.i(TAG, "ipv6_settings_begin mode=$mode")
        scope.launch {
            try {
                clientReady.await()
                val current = awaitIpv6Policy(null)
                if (mode == "disable_sequence") {
                    logIpv6Evidence("initial", current)
                    dispatchAwait(
                        Command.UpdateClientSettings(
                            clientSettingsPatch(ipv6Enabled = false),
                        ),
                    )
                    logIpv6Evidence("disabled", awaitIpv6Policy(false))
                    return@launch
                }
                if (mode == "enable_sequence") {
                    logIpv6Evidence("restarted", current)
                    dispatchAwait(
                        Command.UpdateClientSettings(
                            clientSettingsPatch(ipv6Enabled = true),
                        ),
                    )
                    logIpv6Evidence("reenabled", awaitIpv6Policy(true))
                    return@launch
                }
                val desired =
                    when (mode) {
                        "observe" -> null
                        "disable" -> false
                        "enable" -> true
                        else -> error("unknown IPv6 policy evidence mode")
                    }
                val observed =
                    if (desired == null) {
                        current
                    } else {
                        dispatchAwait(
                            Command.UpdateClientSettings(
                                clientSettingsPatch(ipv6Enabled = desired),
                            ),
                        )
                        awaitIpv6Policy(desired)
                    }
                logIpv6Evidence(mode, observed)
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    fun exerciseUnmeteredNetworkPolicyForTest(mode: String) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "unmetered network policy evidence is debug-only"
        }
        scope.launch {
            try {
                clientReady.await()
                val (expectedEnabled, expectedAllowed) =
                    when (mode) {
                        "default" -> false to true
                        "enable" -> true to true
                        "metered", "restart_metered" -> true to false
                        "unmetered" -> true to true
                        "disable" -> false to true
                        else -> error("unknown unmetered network policy evidence mode")
                    }
                when (mode) {
                    "enable" -> setUnmeteredNetworksOnly(true)
                    "disable" -> setUnmeteredNetworksOnly(false)
                }
                val observed = awaitUnmeteredNetworkPolicy(expectedEnabled, expectedAllowed)
                logUnmeteredNetworkPolicyEvidence(mode, observed)
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    fun exerciseProductLifecycleForTest(mode: String) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "product lifecycle evidence is debug-only"
        }
        when (mode) {
            "observe" -> Unit
            "enable_background" -> setBackgroundDownloadsEnabled(true)
            "disable_background" -> setBackgroundDownloadsEnabled(false)
            "enable_seeding" -> setKeepSeedingInBackground(true)
            "disable_seeding" -> setKeepSeedingInBackground(false)
            else -> error("unknown product lifecycle evidence mode")
        }
        val lifecycle = lifecycleCoordinator.snapshot()
        val product = mutableState.value
        Log.i(
            TAG,
            "lifecycle_evidence mode=$mode " +
                "background=${product.lifecycle.backgroundDownloadsEnabled} " +
                "effective=${product.lifecycle.effectiveBackgroundDownloads} " +
                "keep_seeding=${product.lifecycle.keepSeedingEnabled} " +
                "foreground=${foreground.get()} admitted=${backgroundAdmitted.get()} " +
                "revision=${lifecycle?.revision ?: 0} " +
                "deadline=${lifecycle?.scheduledDeadlineMillis ?: "none"} " +
                "reason=${product.lifecycle.reason ?: "none"}",
        )
    }

    fun armProductQuotaRestartEvidenceForTest() {
        check(ProductSafDocuments.isDebuggable(this)) {
            "product quota restart evidence is debug-only"
        }
        productQuotaRestartEvidenceArmed.set(true)
        Log.i(TAG, "product_quota_restart armed=true")
    }

    fun exerciseBandwidthPolicyForTest(mode: String) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "bandwidth policy evidence is debug-only"
        }
        scope.launch {
            try {
                clientReady.await()
                if (mode == "configure") {
                    val current = awaitIpv6Policy(null)
                    val limit = TransferRateLimit.Limited(ANDROID_RATE_BYTES_PER_SECOND.toUInt())
                    dispatchAwait(
                        Command.UpdateClientSettings(
                            clientSettingsPatch(
                                uploadRateLimit = limit,
                                downloadRateLimit = limit,
                            ),
                        ),
                    )
                }
                logBandwidthEvidence(mode, awaitBandwidthPolicy(mode))
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    private suspend fun awaitBandwidthPolicy(mode: String): ClientSettingsRuntimeView =
        withTimeout(30_000) {
            while (true) {
                val settings = mutableState.value.clientSettings
                val configured =
                    (settings?.configured?.downloadRateLimit as? TransferRateLimit.Limited)
                        ?.bytesPerSecond
                val effective =
                    (settings?.effectiveDownloadRateLimit as? TransferRateLimit.Limited)
                        ?.bytesPerSecond
                val download = settings?.bandwidth?.download
                val policyApplied =
                    configured == ANDROID_RATE_BYTES_PER_SECOND.toUInt() &&
                        effective == ANDROID_RATE_BYTES_PER_SECOND.toUInt() &&
                        settings?.bandwidthApplication is ClientSettingsApplicationState.Applied
                val ready =
                    when (mode) {
                        "configured", "configure" -> policyApplied
                        "active" ->
                            policyApplied &&
                                settings?.activeDownloadCount == 2U.toUShort() &&
                                download != null &&
                                download.grantedBytes.toULong() > 0UL &&
                                download.throttleWaitHighWaterMicros.toULong() > 0UL
                        "terminal" ->
                            policyApplied &&
                                settings?.activeDownloadCount == 0U.toUShort() &&
                                download != null &&
                                download.grantedBytes.toULong() > 0UL &&
                                download.activeWaiters == 0U &&
                                download.queuedRequestedBytes.toULong() == 0UL
                        else -> error("unknown bandwidth policy evidence mode")
                    }
                if (ready) return@withTimeout requireNotNull(settings)
                delay(25)
            }
            error("unreachable")
        }

    private fun logBandwidthEvidence(
        mode: String,
        settings: ClientSettingsRuntimeView,
    ) {
        val configured =
            (settings.configured.downloadRateLimit as TransferRateLimit.Limited).bytesPerSecond
        val effective =
            (settings.effectiveDownloadRateLimit as TransferRateLimit.Limited).bytesPerSecond
        val download = settings.bandwidth.download
        Log.i(
            TAG,
            "bandwidth_policy mode=$mode configured=$configured effective=$effective " +
                "application=APPLIED registered=${download.registeredTorrents} " +
                "active_downloads=${settings.activeDownloadCount} " +
                "active_waiters=${download.activeWaiters} " +
                "queued=${download.queuedRequestedBytes} granted=${download.grantedBytes} " +
                "returned=${download.returnedBytes} " +
                "wait_high=${download.throttleWaitHighWaterMicros} " +
                "burst=${download.currentBurstCreditBytes}",
        )
    }

    private fun logIpv6Evidence(mode: String, observed: ClientSettingsRuntimeView) {
        val application =
            when (observed.ipv6Application) {
                is ClientSettingsApplicationState.Applied -> "APPLIED"
                is ClientSettingsApplicationState.Applying -> "APPLYING"
                is ClientSettingsApplicationState.Degraded -> "DEGRADED"
            }
        val ipv6 = observed.transportFamilies.firstOrNull { it.family.name == "IPV6" }
        Log.i(
            TAG,
            "ipv6_settings mode=$mode configured=${observed.configured.ipv6Enabled} " +
                "effective=${observed.effectiveIpv6Enabled} application=$application " +
                "tcp=${ipv6?.tcpEndpoint ?: "none"} udp=${ipv6?.udpEndpoint ?: "none"}",
        )
    }

    private suspend fun awaitUnmeteredNetworkPolicy(
        expectedEnabled: Boolean,
        expectedAllowed: Boolean,
    ): ProductState =
        withTimeout(30_000) {
            while (true) {
                val product = mutableState.value
                val application = product.clientSettings?.applicationNetwork
                val expectedState = if (expectedAllowed) "ALLOWED" else "BLOCKED"
                if (
                    product.ready &&
                        product.network.unmeteredNetworksOnly == expectedEnabled &&
                        product.network.effectiveNetworkAllowed == expectedAllowed &&
                        application?.state?.name == expectedState
                ) {
                    return@withTimeout product
                }
                delay(25)
            }
            error("unreachable")
        }

    private fun logUnmeteredNetworkPolicyEvidence(
        mode: String,
        product: ProductState,
    ) {
        val network = product.network
        val settings = requireNotNull(product.clientSettings)
        val application = settings.applicationNetwork
        val tcpEndpoints =
            settings.transportFamilies.count { it.tcpEndpoint != null }
        val udpEndpoints =
            settings.transportFamilies.count { it.udpEndpoint != null }
        val connectedPeers =
            product.peers.values.sumOf { peers ->
                peers.values.count { it.lifecycle.name == "CONNECTED" }
            }
        Log.i(
            TAG,
            "network_policy mode=$mode enabled=${network.unmeteredNetworksOnly} " +
                "eligibility=${network.eligibility} allowed=${network.effectiveNetworkAllowed} " +
                "generation=${network.effectiveGeneration} callback=${network.callbackRegistered} " +
                "application=${application.state} requested=${application.requestedPrerequisite} " +
                "effective=${application.effectivePrerequisite} tcp=$tcpEndpoints udp=$udpEndpoints " +
                "listener=${settings.listenerStatus} mapping=${settings.portMappingStatus} " +
                "udp_mapping=${settings.udpPortMappingStatus} dht=${product.dht?.lifecycle} " +
                "connected_peers=$connectedPeers",
        )
    }

    private suspend fun awaitIpv6Policy(configured: Boolean?): ClientSettingsRuntimeView {
        val subscription =
            client.subscribe(
                SubscriptionSpec(
                    ViewSelector.TorrentList,
                    ViewProjection.SUMMARY,
                    DeliveryPolicy(0U, 256U * 1024U),
                    null,
                    null,
                ),
            )
        try {
            return withTimeout(10_000) {
                while (true) {
                    val update = subscription.nextUpdate() ?: error("settings view closed")
                    val settings =
                        when (val payload = update.payload) {
                            is ViewUpdatePayload.Snapshot ->
                                (payload.snapshot as? ViewSnapshot.TorrentList)?.clientSettings
                            is ViewUpdatePayload.Patch ->
                                (payload.patch as? ViewPatch.TorrentList)?.clientSettings
                            is ViewUpdatePayload.ResetRequired -> {
                                subscription.resync()
                                null
                            }
                        }
                    if (
                        settings != null &&
                        (configured == null || settings.configured.ipv6Enabled == configured) &&
                        settings.ipv6Application !is ClientSettingsApplicationState.Applying
                    ) {
                        return@withTimeout settings
                    }
                }
                error("unreachable")
            }
        } finally {
            subscription.close()
        }
    }

    fun setSafTree(
        treeUri: Uri,
        repairRootId: String? = null,
        companionRequestId: String? = null,
    ) {
        if (rejectMutationDuringDataReset()) return
        ProductSafRootRegistry.recordSelectionCandidate(this, treeUri, repairRootId)
        scope.launch {
            try {
                clientReady.await()
                reconcileSafRootRegistry()
                val storageRootHealthy = client.probeSafStorageRoots()
                refreshSafRootState()
                Log.i(TAG, "saf_root_health source=selection available=$storageRootHealthy")
                Log.i(TAG, "saf_tree_ready root=${defaultSafRootId ?: "none"}")
                if (companionRequestId != null) {
                    completeCompanionRootSelection(companionRequestId, repairRootId)
                }
                if (!storageRootHealthy) return@launch
                // The native probe reconciles durable run intent. A delayed
                // AwaitingStorage view must not become a new Resume request.
                advanceSaf(mutableState.value)
            } catch (error: Throwable) {
                if (companionRequestId != null && clientOpen) {
                    client.failCompanionRootRequest(
                        companionRequestId,
                        error.message ?: "Unable to use the selected download folder",
                    )
                    cancelCompanionRootNotification()
                }
                reportError(error)
            }
        }
    }

    fun cancelCompanionRootRequest(requestId: String) {
        if (rejectMutationDuringDataReset()) return
        scope.launch {
            try {
                clientReady.await()
                client.completeCompanionRootRequest(requestId, null)
                cancelCompanionRootNotification()
            } catch (error: Throwable) {
                if (!stopped.get()) reportError(error)
            }
        }
    }

    fun approveCompanionPairing(requestId: String) {
        if (rejectMutationDuringDataReset()) return
        resolveCompanionPairing(requestId, approve = true)
    }

    fun rejectCompanionPairing(requestId: String) {
        if (rejectMutationDuringDataReset()) return
        resolveCompanionPairing(requestId, approve = false)
    }

    private fun resolveCompanionPairing(requestId: String, approve: Boolean) {
        scope.launch {
            try {
                clientReady.await()
                if (approve) client.approveCompanionPairing(requestId)
                else client.rejectCompanionPairing(requestId)
                mutableState.update {
                    if (it.companionPairing?.requestId == requestId) {
                        it.copy(companionPairing = null)
                    } else {
                        it
                    }
                }
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    private fun enableChromeOsCompanion() {
        if (rejectMutationDuringDataReset()) return
        if (!isChromeOs()) {
            Log.w(TAG, "ignored ChromeOS companion enable request on a non-ChromeOS device")
            return
        }
        ProductCompanionPreference.enable(this)
        scope.launch {
            try {
                clientReady.await()
                startChromeOsCompanionOwners()
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    suspend fun prepareChromeExtensionSetup() {
        check(!rejectMutationDuringDataReset()) { "Data reset is in progress" }
        check(isChromeOs()) { "Chrome extension setup requires ChromeOS" }
        ProductCompanionPreference.enable(this)
        clientReady.await()
        notificationEligibilityMutation.withLock {
            val eligibility = notificationCoordinator.refreshPlatformState(interactionLeases.size)
            check(eligibility.backgroundNotificationVisible) { "Chrome requires visible Android notifications" }
            lifecycleCoordinator.updateNotificationEligibility(true)
            publishLifecyclePreferences(true)
        }
        startChromeOsCompanionOwners()
        lifecycleCoordinator.companionSetupRequested()
    }

    private suspend fun startChromeOsCompanionOwners() {
        companionOwnerMutation.withLock {
            check(isChromeOs()) { "ChromeOS companion listener is unavailable on this device" }
            val port = client.startChromeosCompanion()
            mutableState.update { it.copy(companionPort = port) }
            if (companionConnectionJob?.isActive != true) {
                val subscription = client.observeChromeosCompanionConnections()
                companionConnectionSubscription = subscription
                companionConnectionJob =
                    scope.launch {
                        while (!stopped.get()) {
                            val count = subscription.nextCount() ?: return@launch
                            lifecycleCoordinator.updateCompanionConnections(count.toInt())
                        }
                    }
            }
            lifecycleCoordinator.companionStarted()
            if (companionPairingJob?.isActive != true) {
                companionPairingJob =
                    scope.launch {
                        while (!stopped.get()) {
                            val pending = client.pendingCompanionPairing()
                            mutableState.update {
                                it.copy(
                                    companionPairing =
                                        pending?.let { request ->
                                            CompanionPairingState(
                                                request.requestId,
                                                request.extensionId,
                                                request.extensionName,
                                                request.installationId,
                                                request.expiresInSeconds,
                                            )
                                        },
                                )
                            }
                            delay(COMPANION_PAIRING_POLL_MILLIS)
                        }
                    }
            }
            if (companionRootJob?.isActive != true) {
                companionRootJob =
                    scope.launch {
                        while (!stopped.get()) {
                            val request = client.nextCompanionRootRequest() ?: return@launch
                            presentCompanionRootRequest(request)
                        }
                    }
            }
            if (companionRootRemovalJob?.isActive != true) {
                companionRootRemovalJob =
                    scope.launch {
                        while (!stopped.get()) {
                            val request =
                                client.nextCompanionRootRemovalRequest() ?: return@launch
                            executeCompanionRootRemoval(request)
                        }
                    }
            }
            Log.i(TAG, "chromeos_companion_ready port=$port")
        }
    }

    private suspend fun completeCompanionRootSelection(
        requestId: String,
        repairRootId: String?,
    ) {
        val storage = client.safStorageSnapshot()
        val selectedRootId = repairRootId ?: storage.defaultRoot
        val root = storage.roots.singleOrNull { it.rootId == selectedRootId }
        if (root?.availability != StorageRootAvailability.AVAILABLE) {
            client.failCompanionRootRequest(
                requestId,
                "The selected download folder is unavailable",
            )
        } else {
            client.completeCompanionRootRequest(requestId, root)
        }
        cancelCompanionRootNotification()
    }

    private fun presentCompanionRootRequest(request: AndroidCompanionRootRequest) {
        val open =
            Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(MainActivity.EXTRA_COMPANION_ROOT_REQUEST, request.requestId)
                request.repairRoot?.let {
                    putExtra(MainActivity.EXTRA_COMPANION_REPAIR_ROOT, it)
                }
            }
        val pending =
            PendingIntent.getActivity(
                this,
                COMPANION_ROOT_PENDING_INTENT_ID,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val posted = notificationCoordinator.showCompanionRootNotification(pending)
        runCatching { startActivity(open) }
            .onFailure {
                if (posted) {
                    Log.i(TAG, "companion root picker waits for notification action")
                } else {
                    Log.i(TAG, "companion root picker requires visible Android interaction")
                }
            }
    }

    private fun cancelCompanionRootNotification() {
        notificationCoordinator.cancelCompanionRootNotification()
    }

    private fun isChromeOs(): Boolean =
        packageManager.hasSystemFeature("org.chromium.arc") ||
            packageManager.hasSystemFeature("org.chromium.arc.device_management")

    fun makeSafRootCurrent(rootId: String) {
        if (rejectMutationDuringDataReset()) return
        scope.launch {
            try {
                clientReady.await()
                safRootMutation.withLock {
                    val storage = client.safStorageSnapshot()
                    val root = requireNotNull(storage.roots.singleOrNull { it.rootId == rootId }) {
                        "Download folder is not registered"
                    }
                    require(root.availability == StorageRootAvailability.AVAILABLE) {
                        "Repair this download folder before making it current"
                    }
                    if (storage.defaultRoot == rootId) return@withLock
                    executeSafRootOperation(
                        ProductSafRootRegistry.beginSetDefault(
                            this@ProductEngineService,
                            rootId,
                        ),
                    )
                    refreshSafRootState()
                }
                mutableState.update { it.copy(error = null) }
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    /**
     * Stops using a download folder and releases Android's access to it. Files
     * are kept unless [deleteData], which first removes the torrents using the
     * folder with their data. Otherwise those torrents wait for the folder to
     * be chosen again.
     */
    fun removeSafRoot(rootId: String, deleteData: Boolean = false) {
        if (rejectMutationDuringDataReset()) return
        scope.launch {
            try {
                clientReady.await()
                if (deleteData) removeRootTorrentsWithData(rootId)
                safRootMutation.withLock {
                    require(client.safStorageSnapshot().roots.any { it.rootId == rootId }) {
                        "Download folder is not registered"
                    }
                    executeSafRootOperation(
                        ProductSafRootRegistry.beginDetach(
                            this@ProductEngineService,
                            rootId,
                        ),
                    )
                    refreshSafRootState()
                }
                mutableState.update { it.copy(error = null) }
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    private suspend fun removeRootTorrentsWithData(rootId: String) {
        val torrentIds =
            mutableState.value.torrents.values
                .filter { it.storageRoot == rootId }
                .map { it.torrentId }
        if (torrentIds.isEmpty()) return
        torrentCommandBatches.withLock {
            torrentIds.forEach {
                dispatchAwait(Command.RemoveTorrent(it, RemovalDataPolicy.DELETE_DATA))
            }
        }
        val settled =
            withTimeoutOrNull(ROOT_DATA_REMOVAL_TIMEOUT_MILLIS) {
                mutableState.first { state ->
                    torrentIds.none { it in state.torrents } ||
                        torrentIds.any { state.torrents[it]?.removalState == RemovalState.FAILED }
                }
            } ?: error("Deleting this folder's downloads is taking too long")
        // The folder keeps its access so a failed deletion can be retried.
        check(torrentIds.none { it in settled.torrents }) {
            "Some downloaded files could not be deleted"
        }
    }

    private suspend fun reconcileSafRootRegistry() {
        safRootMutation.withLock {
            var state = ProductSafRootRegistry.load(this@ProductEngineService)
            if (state.pending != null) executeSafRootOperation(state.pending)
            state = ProductSafRootRegistry.load(this@ProductEngineService)
            if (state.selectionCandidate != null) {
                val candidate = Uri.parse(state.selectionCandidate)
                val label = ProductSafDocuments.treeLabel(this@ProductEngineService, candidate)
                val operation =
                    state.selectionRepairRootId?.let { rootId ->
                        ProductSafRootRegistry.beginRepair(
                            this@ProductEngineService,
                            rootId,
                            candidate,
                            label,
                        )
                    } ?: ProductSafRootRegistry.beginSelection(
                        this@ProductEngineService,
                        client.allocateSafStorageRootId(),
                        label,
                    )
                executeSafRootOperation(operation)
            }
            refreshSafRootState()
        }
    }

    private suspend fun executeCompanionRootRemoval(
        request: org.rstorrent.bootstrap.uniffi.AndroidCompanionRootRemovalRequest,
    ) {
        val command = request.applicationRequest.command as? Command.RemoveStorageRoot
        if (command == null) {
            client.failCompanionRootRemovalRequest(
                request.requestId,
                "Companion root-removal request has the wrong command",
            )
            return
        }
        var nativeMutationComplete = false
        try {
            safRootMutation.withLock {
                val operation =
                    ProductSafRootRegistry.beginRemoval(
                        this@ProductEngineService,
                        command.storageRoot,
                    )
                val response = client.dispatch(request.applicationRequest)
                if (response.outcome is ResponseOutcome.Error) {
                    ProductSafRootRegistry.abandonPendingRemoval(this@ProductEngineService)
                } else {
                    nativeMutationComplete = true
                    ProductSafRootRegistry.completePending(this@ProductEngineService)
                    operation.previous?.let { previous ->
                        runCatching {
                            ProductSafDocuments.releaseGrantIfUnregistered(
                                this@ProductEngineService,
                                Uri.parse(previous.treeUri),
                            )
                        }.onFailure { releaseError ->
                            Log.w(TAG, "could not release removed SAF grant", releaseError)
                        }
                    }
                    refreshSafRootState()
                }
                client.completeCompanionRootRemovalRequest(request.requestId, response)
            }
        } catch (error: Throwable) {
            runCatching {
                if (
                    !nativeMutationComplete &&
                    ProductSafRootRegistry.load(this@ProductEngineService)
                        .pending?.kind == ProductSafRootOperationKind.REMOVE
                ) {
                    ProductSafRootRegistry.abandonPendingRemoval(this@ProductEngineService)
                }
            }.onFailure(error::addSuppressed)
            client.failCompanionRootRemovalRequest(
                request.requestId,
                error.message ?: "Android root removal failed",
            )
            reportError(error)
        }
    }

    private suspend fun executeSafRootOperation(operation: ProductSafRootOperation) {
        var nativeMutationComplete = false
        try {
            when (operation.kind) {
                ProductSafRootOperationKind.ADD,
                ProductSafRootOperationKind.SET_DEFAULT,
                -> client.installSafStorageRoot(
                    operation.rootId,
                    operation.label,
                    operation.makeDefault,
                )
                ProductSafRootOperationKind.REPAIR -> {
                    val mutation =
                        client.repairSafStorageRoot(operation.rootId, operation.label)
                    mutation.restartTorrentIds.forEach(::resume)
                }
                ProductSafRootOperationKind.REMOVE -> {
                    if (
                        client.safStorageSnapshot().roots.any {
                            it.rootId == operation.rootId
                        }
                    ) {
                        dispatchAwait(Command.RemoveStorageRoot(operation.rootId))
                    }
                }
                ProductSafRootOperationKind.DETACH -> {
                    // A replay after process death finds the root already gone.
                    val removed =
                        if (client.safStorageSnapshot().roots.any { it.rootId == operation.rootId }) {
                            client.detachSafStorageRoot(operation.rootId).removed
                        } else {
                            true
                        }
                    ProductSafRootRegistry.completeDetach(this, removed)
                    ProductSafDocuments.releaseGrant(this, Uri.parse(operation.treeUri))
                }
            }
            nativeMutationComplete = true
            ProductSafRootRegistry.completePending(this)
            operation.previous?.let { previous ->
                runCatching {
                    ProductSafDocuments.releaseGrantIfUnregistered(
                        this,
                        Uri.parse(previous.treeUri),
                    )
                }.onFailure { releaseError ->
                    Log.w(TAG, "could not release replaced SAF grant", releaseError)
                }
            }
            Log.i(
                TAG,
                "saf_root_operation kind=${operation.kind.name.lowercase()} " +
                    "root=${operation.rootId} result=complete",
            )
        } catch (error: Throwable) {
            if (nativeMutationComplete) throw error
            when (operation.kind) {
                ProductSafRootOperationKind.ADD -> {
                    ProductSafRootRegistry.rollbackAdd(this)
                    releaseFailedSafSelection(operation)
                }
                ProductSafRootOperationKind.REPAIR -> {
                    ProductSafRootRegistry.rollbackRepair(this)
                    releaseFailedSafSelection(operation)
                    client.probeSafStorageRoots()
                }
                ProductSafRootOperationKind.SET_DEFAULT ->
                    ProductSafRootRegistry.abandonPendingDefault(this)
                ProductSafRootOperationKind.REMOVE,
                ProductSafRootOperationKind.DETACH,
                -> ProductSafRootRegistry.abandonPendingRemoval(this)
            }
            throw error
        }
    }

    private fun releaseFailedSafSelection(operation: ProductSafRootOperation) {
        runCatching {
            ProductSafDocuments.releaseGrantIfUnregistered(this, Uri.parse(operation.treeUri))
        }.onFailure { releaseError ->
            Log.w(TAG, "could not release rejected SAF grant", releaseError)
        }
    }

    private suspend fun refreshSafRootState() {
        val storage = client.safStorageSnapshot()
        defaultSafRootId = storage.defaultRoot
        val current = storage.roots.singleOrNull { it.rootId == storage.defaultRoot }
        val ready =
            current?.availability == StorageRootAvailability.AVAILABLE &&
                ProductSafRootRegistry.treeForRoot(this, current.rootId) != null
        mutableState.update {
            it.copy(
                storage = storage,
                storageRootReady = ready,
                storageRootLabel = current?.label,
                error =
                    when {
                        current == null -> null
                        ready -> it.error?.takeUnless {
                            it == ProductError.Code.STORAGE_UNAVAILABLE
                        }
                        else -> ProductError.Code.STORAGE_UNAVAILABLE
                    },
            )
        }
        notifyExternalRootAvailability(ready)
    }

    private fun updateSafRootState(product: ProductState) {
        val storage = product.storage ?: return
        defaultSafRootId = storage.defaultRoot
        val current = storage.roots.singleOrNull { it.rootId == storage.defaultRoot }
        val ready =
            current?.availability == StorageRootAvailability.AVAILABLE &&
                ProductSafRootRegistry.treeForRoot(this, current.rootId) != null
        mutableState.update {
            it.copy(
                storageRootReady = ready,
                storageRootLabel = current?.label,
            )
        }
        notifyExternalRootAvailability(ready)
    }

    private fun notifyExternalRootAvailability(ready: Boolean) {
        scope.launch {
            externalIntakeMutation.withLock {
                externalIntakeController.rootAvailabilityChanged(ready)
                publishExternalSnapshot()
                submitHeldAddLocked()
            }
        }
    }

    private fun currentSafRootForAdd(): String? {
        val rootId = defaultSafRootId ?: return null
        val root = mutableState.value.storage?.roots?.singleOrNull { it.rootId == rootId }
        return rootId.takeIf {
            root?.availability == StorageRootAvailability.AVAILABLE &&
                ProductSafRootRegistry.treeForRoot(this, rootId) != null
        }
    }

    fun exerciseTorrentActionForTest(
        torrentId: String,
        action: String,
    ) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "torrent lifecycle injection is debug-only"
        }
        scope.launch {
            try {
                clientReady.await()
                when {
                    action.startsWith("download_file:") -> {
                        val fileIndex =
                            action.substringAfter(':').toUIntOrNull()
                                ?: error("download-file action has an invalid index")
                        dispatchAwait(Command.DownloadFiles(torrentId, listOf(fileIndex)))
                    }
                    action.startsWith("play_file:") -> {
                        val fileIndex =
                            action.substringAfter(':').toUIntOrNull()
                                ?: error("play-file action has an invalid index")
                        startMediaPlayback(torrentId, fileIndex, "Controlled media")
                    }
                    action.startsWith("seek_media:") -> {
                        val positionMillis =
                            action.substringAfter(':').toLongOrNull()?.takeIf { it >= 0L }
                                ?: error("media-seek action has an invalid position")
                        withContext(Dispatchers.Main.immediate) {
                            startActivity(
                                PlayerActivity.controlIntent(
                                    this@ProductEngineService,
                                    positionMillis,
                                ),
                            )
                        }
                    }
                    action == "close_media" ->
                        withContext(Dispatchers.Main.immediate) {
                            startActivity(
                                PlayerActivity.controlIntent(
                                    this@ProductEngineService,
                                    positionMillis = null,
                                ),
                            )
                        }
                    action == "pause" -> dispatchAwait(Command.Pause(torrentId))
                    action == "resume" -> dispatchAwait(Command.Resume(torrentId))
                    action == "observe" -> {
                        val torrent =
                            withTimeout(10_000) {
                                while (true) {
                                    mutableState.value.torrents[torrentId]?.let {
                                        return@withTimeout it
                                    }
                                    delay(25)
                                }
                                error("unreachable")
                            }
                        Log.i(
                            TAG,
                            "torrent_state torrent=$torrentId state=${torrent.state} " +
                                "operational=${torrent.operationalState} " +
                                "progress=${torrent.progress.reason}",
                        )
                    }
                    action == "observe_incoming" -> {
                        val snapshot = withTimeout(10_000) { client.incomingPeerSnapshot() }
                        if (snapshot == null) {
                            Log.i(TAG, "incoming_peer_snapshot torrent=$torrentId available=false")
                        } else {
                            val counts = snapshot.rejectionCounts.joinToString(",") { "${it.reason}:${it.count}" }
                            val recent = snapshot.recentRejections.joinToString(",") { "${it.reason}:${it.infoHash ?: "none"}" }
                            Log.i(TAG, "incoming_peer_snapshot torrent=$torrentId available=true " +
                                "port=${snapshot.listenPort} registrations=${snapshot.registrations} " +
                                "pending=${snapshot.pending} established=${snapshot.established} " +
                                "payload=${snapshot.payloadBytesSent} rejections=$counts " +
                                "recent=$recent counts_truncated=${snapshot.rejectionCountsTruncated} " +
                                "recent_truncated=${snapshot.recentRejectionsTruncated}")
                        }
                    }
                    action == "force_recheck" -> forceRecheckAndAwaitForTest(torrentId)
                    action == "remove" ->
                        dispatchAwait(
                            Command.RemoveTorrent(
                                torrentId,
                                RemovalDataPolicy.DELETE_DATA,
                            ),
                        )
                    action == "enable_upload" -> {
                        val current = awaitIpv6Policy(null)
                        dispatchAwait(
                            Command.UpdateClientSettings(
                                clientSettingsPatch(
                                    listener = ListenerPolicy.FixedLocalNetwork(6_881U.toUShort()),
                                    preferredListenPort = 6_881U.toUShort(),
                                    portMapping = PortMappingPolicy.DISABLED,
                                ),
                            ),
                        )
                        awaitFixedListener(6_881U.toUShort())
                    }
                    else -> error("unknown torrent lifecycle action")
                }
                Log.i(TAG, "torrent_action_completed torrent=$torrentId action=$action")
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    private suspend fun awaitFixedListener(port: UShort): ClientSettingsRuntimeView {
        val subscription =
            client.subscribe(
                SubscriptionSpec(
                    ViewSelector.TorrentList,
                    ViewProjection.SUMMARY,
                    DeliveryPolicy(0U, 256U * 1024U),
                    null,
                    null,
                ),
            )
        try {
            return withTimeout(10_000) {
                while (true) {
                    val update = subscription.nextUpdate() ?: error("settings view closed")
                    val settings =
                        when (val payload = update.payload) {
                            is ViewUpdatePayload.Snapshot ->
                                (payload.snapshot as? ViewSnapshot.TorrentList)?.clientSettings
                            is ViewUpdatePayload.Patch ->
                                (payload.patch as? ViewPatch.TorrentList)?.clientSettings
                            is ViewUpdatePayload.ResetRequired -> {
                                subscription.resync()
                                null
                            }
                        }
                    val listener = settings?.listenerStatus
                    if (listener is ListenerStatus.Listening && listener.port == port) {
                        return@withTimeout settings
                    }
                    if (listener is ListenerStatus.BindFailed) {
                        error("fixed upload listener failed: ${listener.detail}")
                    }
                }
                error("unreachable")
            }
        } finally {
            subscription.close()
        }
    }

    private suspend fun forceRecheckAndAwaitForTest(torrentId: String) {
        val subscription =
            client.subscribe(
                SubscriptionSpec(
                    ViewSelector.Torrent(torrentId),
                    ViewProjection.SUMMARY,
                    DeliveryPolicy(0U, 256U * 1024U),
                    null,
                    null,
                ),
            )
        try {
            dispatchAwait(Command.ForceRecheck(torrentId))
            withTimeout(10_000) {
                var sawChecking = false
                var productState = ProductState()
                while (true) {
                    val update = subscription.nextUpdate() ?: error("torrent view closed")
                    val torrent =
                        when (update.payload) {
                            is ViewUpdatePayload.ResetRequired -> {
                                subscription.resync()
                                productState = ProductState()
                                null
                            }
                            else -> {
                                productState = ProductStateReducer.reduce(productState, update)
                                productState.torrents[torrentId]
                            }
                        }
                    when (torrent?.state) {
                        TorrentState.CHECKING -> {
                            sawChecking = true
                            torrent.checking?.let { progress ->
                                Log.i(
                                    TAG,
                                    "force_recheck_progress torrent=$torrentId " +
                                        "processed=${progress.piecesProcessed} " +
                                        "matched=${progress.piecesMatched} " +
                                        "absent=${progress.piecesAbsent} " +
                                        "mismatched=${progress.piecesMismatched}",
                                )
                            }
                        }
                        TorrentState.COMPLETE -> if (sawChecking) return@withTimeout
                        else -> {}
                    }
                }
            }
        } finally {
            subscription.close()
        }
    }

    fun pause(torrentId: String) {
        dispatchTorrentCommands(listOf(Command.Pause(torrentId)))
    }

    fun resume(torrentId: String) {
        dispatchTorrentCommands(listOf(Command.Resume(torrentId)))
    }

    fun forceRecheck(torrentId: String) {
        dispatchTorrentCommands(listOf(Command.ForceRecheck(torrentId)))
    }

    fun moveDownloadToTop(torrentId: String) {
        dispatchTorrentCommands(listOf(Command.MoveDownloadToTop(torrentId)))
    }

    fun moveDownloadToBottom(torrentId: String) {
        dispatchTorrentCommands(listOf(Command.MoveDownloadToBottom(torrentId)))
    }

    fun archive(torrentIds: Collection<String>) {
        dispatchTorrentCommands(torrentIds.map(Command::Archive))
    }

    /** Restores in order, then resumes [resume] (used to undo an archive). */
    fun restoreArchive(
        torrentIds: Collection<String>,
        resume: Collection<String> = emptyList(),
    ) {
        dispatchTorrentCommands(
            torrentIds.map(Command::RestoreArchive) + resume.map(Command::Resume),
        )
    }

    fun removeTorrent(
        torrentId: String,
        policy: RemovalDataPolicy,
    ) {
        dispatchTorrentCommands(listOf(Command.RemoveTorrent(torrentId, policy)))
    }

    fun moveDownloadsToTop(torrentIds: List<String>) {
        // Moving each to the top in reverse keeps the selection's list order.
        dispatchTorrentCommands(torrentIds.reversed().map(Command::MoveDownloadToTop))
    }

    fun moveDownloadsToBottom(torrentIds: List<String>) {
        dispatchTorrentCommands(torrentIds.map(Command::MoveDownloadToBottom))
    }

    fun clearTorrentCommandFailure(sequence: Long) {
        mutableState.update {
            if (it.torrentCommandFailure?.sequence == sequence) it.copy(torrentCommandFailure = null)
            else it
        }
    }

    /**
     * Runs torrent commands in order, one batch at a time, so dependent
     * commands and later batches keep their order. A rejected command is
     * reported as a transient failure rather than the library error card, and
     * later commands still run.
     */
    private fun dispatchTorrentCommands(commands: List<Command>) {
        if (commands.isEmpty()) return
        scope.launch {
            try {
                clientReady.await()
            } catch (error: Throwable) {
                reportError(error)
                return@launch
            }
            torrentCommandBatches.withLock {
                for (command in commands) {
                    try {
                        dispatchAwait(command)
                    } catch (error: Throwable) {
                        if (error is CancellationException) throw error
                        reportTorrentCommandFailure(error)
                    }
                }
            }
        }
    }

    private fun reportTorrentCommandFailure(error: Throwable) {
        if (error is ProductDataResetInProgressException) {
            reportError(error)
            return
        }
        Log.e(TAG, "torrent command failed", error)
        val sequence = torrentCommandFailureSequence.incrementAndGet()
        mutableState.update {
            it.copy(
                torrentCommandFailure =
                    TorrentCommandFailure(
                        sequence,
                        productFailureDetail(error, getString(R.string.error_operation_failed)),
                    ),
            )
        }
    }

    fun setShowFileSelection(show: Boolean) {
        dispatch(Command.SetShowFileSelection(show))
    }

    fun confirmPendingFileSelection(
        torrentId: String,
        catalogId: String,
        base: PendingFileSelectionBase,
        overrides: List<FileSelectionOverride>,
        disableFuture: Boolean,
    ) {
        dispatch(
            Command.ConfirmPendingFileSelection(
                torrentId,
                catalogId,
                base,
                overrides,
                disableFuture,
            ),
        )
    }

    fun downloadAllPendingAdd(
        torrentId: String,
        disableFuture: Boolean,
    ) {
        dispatch(Command.DownloadAllPendingAdd(torrentId, disableFuture))
    }

    fun cancelPendingAdd(torrentId: String) {
        dispatch(Command.CancelPendingAdd(torrentId))
    }

    fun setFilePriority(
        torrentId: String,
        fileIndices: List<UInt>,
        priority: FilePriority,
    ) {
        if (fileIndices.isEmpty()) return
        dispatchTorrentCommands(
            listOf(
                Command.SetFilePriority(
                    torrentId,
                    fileIndices,
                    priority,
                ),
            ),
        )
    }

    fun downloadFilesNow(
        torrentId: String,
        fileIndices: List<UInt>,
    ) {
        if (fileIndices.isEmpty()) return
        dispatchTorrentCommands(listOf(Command.DownloadFiles(torrentId, fileIndices)))
    }

    fun openCompletedFile(
        storageRoot: String,
        torrentName: String,
        file: FileView,
    ) {
        if (rejectMutationDuringDataReset()) return
        scope.launch(Dispatchers.IO) {
            try {
                require(file.verifiedBytes == file.lengthBytes) { "File is not complete" }
                val tree =
                    ProductSafRootRegistry.treeForRoot(this@ProductEngineService, storageRoot)
                        ?: error("Download folder is unavailable")
                val path =
                    if (file.path.firstOrNull() == torrentName) {
                        file.path
                    } else {
                        listOf(torrentName) + file.path
                    }
                val document =
                    ProductSafDocuments.contentDocument(this@ProductEngineService, tree, path)
                        ?: error("Completed file is unavailable")
                val mime = contentResolver.getType(document) ?: "application/octet-stream"
                startActivity(
                    Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(document, mime)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    },
                )
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    fun playMedia(
        torrentId: String,
        file: FileView,
    ) {
        if (rejectMutationDuringDataReset()) return
        if (!AndroidMediaPlaybackPolicy.isPlayActionEnabled(file, launchPending = false)) {
            mutableState.update {
                it.copy(error = ProductError.MediaUnavailable(file.mediaAvailability))
            }
            return
        }
        startMediaPlayback(
            torrentId,
            file.fileIndex,
            file.path.lastOrNull() ?: getString(R.string.media_fallback_title),
        )
    }

    private fun startMediaPlayback(
        torrentId: String,
        fileIndex: UInt,
        title: String,
    ) {
        if (!mediaLaunchGate.tryAcquire()) return
        mutableState.update { it.copy(mediaLaunchPending = true, error = null) }
        scope.launch {
            try {
                clientReady.await()
                val response = client.createMediaUrl(torrentId, fileIndex)
                check(response.torrentId == torrentId && response.fileIndex == fileIndex) {
                    "Playback response did not match the requested file"
                }
                when (val outcome = response.outcome) {
                    is MediaUrlOutcome.Created -> {
                        Log.i(
                            TAG,
                            "media_playback_capability torrent=$torrentId file=$fileIndex " +
                                "outcome=created",
                        )
                        val launch =
                            PlayerActivity.launchIntent(
                                this@ProductEngineService,
                                outcome.url,
                                title,
                            )
                        withContext(Dispatchers.Main.immediate) {
                            try {
                                startActivity(launch)
                            } catch (_: Throwable) {
                                throw IllegalStateException("The player could not be opened")
                            }
                        }
                    }
                    is MediaUrlOutcome.Unavailable -> {
                        Log.i(
                            TAG,
                            "media_playback_capability torrent=$torrentId file=$fileIndex " +
                                "outcome=unavailable reason=${outcome.reason}",
                        )
                        mutableState.update {
                            it.copy(error = ProductError.MediaUnavailable(outcome.reason))
                        }
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                reportError(error)
            } finally {
                mediaLaunchGate.release()
                mutableState.update { it.copy(mediaLaunchPending = false) }
            }
        }
    }

    fun resetClientSettings() {
        if (rejectMutationDuringDataReset()) return
        dispatch(Command.ResetClientSettings)
    }

    fun clearAllData(deleteDownloadedFiles: Boolean) {
        if (!dataResetActive.compareAndSet(false, true)) {
            rejectMutationDuringDataReset()
            return
        }
        Log.i(TAG, "data_reset_requested delete=$deleteDownloadedFiles")
        refreshLifecycleInteractions()
        scope.launch {
            try {
                clientReady.await()
                productCommandMutation.withLock { }
                val snapshot = dataResetSnapshot()
                check(snapshot.torrents.none { it.removalState != null }) {
                    "wait for the current torrent removal to finish before clearing data"
                }
                val roots =
                    safRootMutation.withLock {
                        val registry = ProductSafRootRegistry.load(this@ProductEngineService)
                        check(registry.pending == null) {
                            "wait for the current download-folder operation to finish"
                        }
                        check(
                            registry.selectionCandidate == null &&
                                registry.selectionRepairRootId == null,
                        ) { "finish or cancel the current download-folder selection" }
                        check(
                            registry.roots.map(ProductSafRootGrant::rootId).sorted() ==
                                snapshot.storage.roots.map { it.rootId }.sorted(),
                        ) { "Android and application download-folder registries differ" }
                        registry.roots.sortedBy(ProductSafRootGrant::rootId)
                    }
                val journal =
                    ProductDataResetJournal.capture(
                        deleteData = deleteDownloadedFiles,
                        torrentIds = snapshot.torrents.map { it.torrentId },
                        roots = roots,
                    )
                ProductDataResetJournalStore.persist(this@ProductEngineService, journal)
                dataResetJournal = journal
                publishDataReset(journal)
                resumeDataReset(journal)
            } catch (error: Throwable) {
                if (dataResetJournal == null) {
                    dataResetActive.set(false)
                    refreshLifecycleInteractions()
                    Log.e(
                        TAG,
                        "data_reset_start_failed delete=$deleteDownloadedFiles",
                        error,
                    )
                }
                reportError(error)
            }
        }
    }

    fun clearAllDataWithProcessKillForTest(
        deleteDownloadedFiles: Boolean,
        completedTorrents: Int,
    ) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "data reset process-kill injection is debug-only"
        }
        require(completedTorrents > 0) { "process-kill cursor must be positive" }
        dataResetProcessKillAfterTorrentsForTest = completedTorrents
        clearAllData(deleteDownloadedFiles)
    }

    fun retryDataReset() {
        val current = dataResetJournal ?: return
        if (current.failure == null) return
        runCatching {
            val resumed =
                current.copy(
                    retryCurrentTorrent =
                        current.phase == ProductDataResetPhase.REMOVING_TORRENTS &&
                            current.failure.torrentId != null,
                    failure = null,
                )
            ProductDataResetJournalStore.persist(this, resumed)
            dataResetJournal = resumed
            publishDataReset(resumed)
            resumeDataReset(resumed)
        }.onFailure(::reportError)
    }

    fun finishDataResetKeepingRemainingFiles() {
        val current = dataResetJournal ?: return
        if (
            current.phase != ProductDataResetPhase.REMOVING_TORRENTS ||
            current.failure == null ||
            !current.deleteRemainingData
        ) {
            return
        }
        runCatching {
            val resumed =
                current.copy(
                    deleteRemainingData = false,
                    retryCurrentTorrent = true,
                    failure = null,
                )
            ProductDataResetJournalStore.persist(this, resumed)
            dataResetJournal = resumed
            publishDataReset(resumed)
            resumeDataReset(resumed)
        }.onFailure(::reportError)
    }

    fun dismissCompletedDataReset() {
        if (dataResetActive.get()) return
        mutableState.update { it.copy(dataReset = null) }
    }

    private fun resumeDataReset(journal: ProductDataResetJournal) {
        dataResetJournal = journal
        dataResetActive.set(true)
        publishDataReset(journal)
        refreshLifecycleInteractions()
        if (dataResetJob?.isActive == true) return
        dataResetJob =
            scope.launch {
                dataResetOwnerMutation.withLock {
                    driveDataReset()
                }
            }
    }

    private suspend fun driveDataReset() {
        val starting = dataResetJournal ?: return
        if (starting.failure != null) return
        try {
            var journal = starting
            while (true) {
                when (journal.phase) {
                    ProductDataResetPhase.REMOVING_TORRENTS -> {
                        if (!clientOpen) {
                            openProductApplication(
                                ProductSafRootRegistry.load(this),
                                defaultNetworkObserver.snapshot(),
                                startCompanion = false,
                            )
                        }
                        stopCompanionForDataReset()
                        while (journal.nextTorrentIndex < journal.torrentIds.size) {
                            val torrentId = journal.torrentIds[journal.nextTorrentIndex]
                            removeDataResetTorrent(journal, torrentId)
                            journal = requireNotNull(dataResetJournal)
                            journal =
                                persistDataReset(
                                    journal.copy(
                                        nextTorrentIndex = journal.nextTorrentIndex + 1,
                                        failure = null,
                                    ),
                                )
                            maybeKillDataResetProcessForTest(journal)
                        }
                        closeClientForDataReset()
                        journal =
                            persistDataReset(
                                journal.copy(
                                    phase = ProductDataResetPhase.RESETTING_PROFILE,
                                    failure = null,
                                ),
                            )
                    }
                    ProductDataResetPhase.RESETTING_PROFILE -> {
                        check(!clientOpen) { "application client still owns the private profile" }
                        withContext(Dispatchers.IO) {
                            ProductPrivateProfileReset.reset(filesDir)
                            ProductPrivateProductStateReset.reset(noBackupFilesDir)
                        }
                        journal =
                            persistDataReset(
                                journal.copy(
                                    phase = ProductDataResetPhase.RELEASING_ROOTS,
                                    failure = null,
                                ),
                            )
                    }
                    ProductDataResetPhase.RELEASING_ROOTS -> {
                        releaseDataResetRoots(journal)
                        journal = requireNotNull(dataResetJournal)
                        journal =
                            persistDataReset(
                                journal.copy(
                                    phase = ProductDataResetPhase.RESETTING_PREFERENCES,
                                    failure = null,
                                ),
                            )
                    }
                    ProductDataResetPhase.RESETTING_PREFERENCES -> {
                        resetProductPreferencesForDataReset()
                        resetPresentationStateForDataReset()
                        journal =
                            persistDataReset(
                                journal.copy(
                                    phase = ProductDataResetPhase.RESTARTING_APPLICATION,
                                    failure = null,
                                ),
                            )
                    }
                    ProductDataResetPhase.RESTARTING_APPLICATION -> {
                        recoveryNetworkGateClosed.set(false)
                        if (!clientOpen) {
                            openProductApplication(
                                ProductSafRootRegistry.load(this),
                                defaultNetworkObserver.snapshot(),
                                startCompanion = false,
                            )
                        }
                        journal =
                            persistDataReset(
                                journal.copy(
                                    phase = ProductDataResetPhase.VERIFYING_APPLICATION,
                                    failure = null,
                                ),
                            )
                    }
                    ProductDataResetPhase.VERIFYING_APPLICATION -> {
                        recoveryNetworkGateClosed.set(false)
                        if (!clientOpen) {
                            openProductApplication(
                                ProductSafRootRegistry.load(this),
                                defaultNetworkObserver.snapshot(),
                                startCompanion = false,
                            )
                        }
                        val snapshot = dataResetSnapshot()
                        check(snapshot.revision == "0") { "fresh profile revision is not zero" }
                        check(snapshot.torrents.isEmpty()) { "fresh profile still contains torrents" }
                        check(snapshot.storage.roots.isEmpty()) {
                            "fresh profile still contains download folders"
                        }
                        check(snapshot.storage.defaultRoot == null) {
                            "fresh profile still has a default download folder"
                        }
                        check(snapshot.storage.showAddOptions && snapshot.storage.showFileSelection) {
                            "fresh profile add preferences are not defaults"
                        }
                        ProductDataResetJournalStore.clear(this)
                        dataResetJournal = null
                        dataResetActive.set(false)
                        refreshLifecycleInteractions()
                        Log.i(
                            TAG,
                            "data_reset_completed operation=${journal.operationId} " +
                                "torrents=${journal.torrentIds.size} " +
                                "delete=${journal.deleteDataRequested} " +
                                "downgraded=${journal.downgradedToKeep}",
                        )
                        mutableState.update {
                            it.copy(
                                ready = true,
                                error = null,
                                dataReset =
                                    ProductDataResetState(
                                        operationId = journal.operationId,
                                        phase = ProductDataResetPhase.VERIFYING_APPLICATION,
                                        completedTorrents = journal.torrentIds.size,
                                        totalTorrents = journal.torrentIds.size,
                                        deleteDataRequested = journal.deleteDataRequested,
                                        downgradedToKeep = journal.downgradedToKeep,
                                        complete = true,
                                    ),
                            )
                        }
                        return
                    }
                }
            }
        } catch (error: Throwable) {
            if (error is CancellationException && stopped.get()) return
            val current = dataResetJournal ?: return
            val failure =
                ProductDataResetFailure(
                    code = dataResetFailureCode(error),
                    detail = boundedDataResetDetail(productFailureDetail(error, getString(R.string.error_operation_failed))),
                    torrentId =
                        current.torrentIds.getOrNull(current.nextTorrentIndex)
                            ?.takeIf {
                                current.phase == ProductDataResetPhase.REMOVING_TORRENTS
                            },
                )
            runCatching {
                persistDataReset(
                    current.copy(retryCurrentTorrent = false, failure = failure),
                )
            }
                .onFailure(error::addSuppressed)
            Log.e(TAG, "product data reset failed phase=${current.phase}", error)
            mutableState.update { it.copy(error = null) }
        }
    }

    private fun maybeKillDataResetProcessForTest(journal: ProductDataResetJournal) {
        val completed = dataResetProcessKillAfterTorrentsForTest ?: return
        if (journal.completedTorrentCount != completed) return
        dataResetProcessKillAfterTorrentsForTest = null
        Log.i(
            TAG,
            "data_reset_process_kill operation=${journal.operationId} " +
                "completed=${journal.completedTorrentCount} total=${journal.torrentIds.size}",
        )
        android.os.Process.killProcess(android.os.Process.myPid())
    }

    private suspend fun removeDataResetTorrent(
        journal: ProductDataResetJournal,
        torrentId: String,
    ) {
        withTimeout(DATA_RESET_TORRENT_TIMEOUT_MILLIS) {
            var currentJournal = journal
            while (true) {
                val torrent = dataResetSnapshot().torrents.singleOrNull { it.torrentId == torrentId }
                if (torrent == null) {
                    if (currentJournal.retryCurrentTorrent) {
                        persistDataReset(currentJournal.copy(retryCurrentTorrent = false))
                    }
                    return@withTimeout
                }
                if (currentJournal.retryCurrentTorrent) {
                    when (torrent.removalState) {
                        RemovalState.FAILED -> {
                            dispatchForResponse(
                                Command.RemoveTorrent(
                                    torrentId,
                                    if (currentJournal.deleteRemainingData) {
                                        RemovalDataPolicy.DELETE_DATA
                                    } else {
                                        RemovalDataPolicy.KEEP
                                    },
                                ),
                                dataResetOwner = true,
                            )
                            currentJournal =
                                persistDataReset(currentJournal.copy(retryCurrentTorrent = false))
                            continue
                        }
                        RemovalState.AWAITING_PLATFORM -> {
                            if (!currentJournal.deleteRemainingData) {
                                val plan = client.safRemovalPlan(torrentId)
                                client.failSafRemoval(
                                    torrentId,
                                    plan.operationId,
                                    "clear data explicitly continued without deleting files",
                                )
                                dispatchForResponse(
                                    Command.RemoveTorrent(torrentId, RemovalDataPolicy.KEEP),
                                    dataResetOwner = true,
                                )
                                currentJournal =
                                    persistDataReset(
                                        currentJournal.copy(retryCurrentTorrent = false),
                                    )
                                continue
                            }
                        }
                        else -> Unit
                    }
                    currentJournal =
                        persistDataReset(currentJournal.copy(retryCurrentTorrent = false))
                }
                when (torrent.removalState) {
                    RemovalState.FAILED -> error(torrent.error ?: "torrent removal failed")
                    RemovalState.AWAITING_PLATFORM -> {
                        check(currentJournal.deleteRemainingData) {
                            "keep-files clear unexpectedly requested platform deletion"
                        }
                        val plan = client.safRemovalPlan(torrentId)
                        try {
                            val treeUri =
                                ProductSafRootRegistry.treeForRoot(
                                    this@ProductEngineService,
                                    plan.storageRoot,
                                ) ?: throw SafStorageRequestException(
                                    SafStorageFailureKind.GRANT_UNAVAILABLE,
                                    "persisted SAF grant is unavailable for the torrent root",
                                )
                            withContext(Dispatchers.IO) {
                                ProductSafDocuments.deleteData(
                                    this@ProductEngineService,
                                    treeUri,
                                    plan,
                                )
                            }
                            client.confirmSafRemoval(torrentId, plan.operationId)
                        } catch (error: Throwable) {
                            runCatching {
                                client.failSafRemoval(
                                    torrentId,
                                    plan.operationId,
                                    boundedDataResetDetail(productFailureDetail(error, getString(R.string.error_operation_failed))),
                                )
                            }.onFailure(error::addSuppressed)
                            throw error
                        }
                    }
                    null -> {
                        dispatchForResponse(
                            Command.RemoveTorrent(
                                torrentId,
                                if (currentJournal.deleteRemainingData) {
                                    RemovalDataPolicy.DELETE_DATA
                                } else {
                                    RemovalDataPolicy.KEEP
                                },
                            ),
                            dataResetOwner = true,
                        )
                    }
                    else -> delay(DATA_RESET_POLL_MILLIS)
                }
            }
        }
    }

    private suspend fun stopCompanionForDataReset() {
        companionOwnerMutation.withLock {
            companionConnectionSubscription?.close()
            companionConnectionJob?.cancelAndJoin()
            companionPairingJob?.cancelAndJoin()
            companionRootJob?.cancelAndJoin()
            companionRootRemovalJob?.cancelAndJoin()
            companionConnectionSubscription = null
            companionConnectionJob = null
            companionPairingJob = null
            companionRootJob = null
            companionRootRemovalJob = null
            client.stopChromeosCompanion()
            lifecycleCoordinator.updateCompanionConnections(0)
            mutableState.update { it.copy(companionPort = null, companionPairing = null) }
        }
    }

    private suspend fun closeClientForDataReset() {
        if (!clientOpen) return
        networkConvergenceJob?.cancelAndJoin()
        networkConvergenceJob = null
        if (::presentationRepository.isInitialized) presentationRepository.close()
        trackerEvidenceJob?.cancel()
        trackerEvidenceSubscription?.close()
        trackerEvidenceJob?.join()
        trackerEvidenceJob = null
        trackerEvidenceSubscription = null
        try {
            client.shutdown()
        } finally {
            safStorageJobs.forEach { it.join() }
            safStorageJobs = emptyList()
            client.close()
            clientOpen = false
        }
        mutableState.update { it.copy(ready = false) }
    }

    private fun releaseDataResetRoots(starting: ProductDataResetJournal) {
        var journal = starting
        val currentRegistry = ProductSafRootRegistry.load(this)
        if (currentRegistry.roots.isNotEmpty()) {
            ProductSafRootRegistry.clearCaptured(this, journal.roots)
        } else {
            check(currentRegistry.pending == null && currentRegistry.selectionCandidate == null) {
                "empty SAF registry retains a pending operation"
            }
        }
        while (journal.nextRootIndex < journal.roots.size) {
            val root = journal.roots[journal.nextRootIndex]
            ProductSafDocuments.releaseGrantIfUnregistered(this, Uri.parse(root.treeUri))
            journal =
                persistDataReset(
                    journal.copy(nextRootIndex = journal.nextRootIndex + 1, failure = null),
                )
        }
    }

    private fun resetProductPreferencesForDataReset() {
        check(lifecyclePreferenceStore.reset()) { "could not reset lifecycle preferences" }
        check(ProductNetworkPreference.reset(this)) { "could not reset network preferences" }
        check(ProductPowerPreference.reset(this)) { "could not reset power preferences" }
        check(ProductCompanionPreference.reset(this)) { "could not reset companion preference" }
        check(ProductDataSyncQuotaFence.clearForUserVisibleStart(this)) {
            "could not reset data-sync quota state"
        }
        check(notificationCoordinator.resetProductPreferencesAndEvents(interactionLeases.size)) {
            "could not reset notification preferences or posted product notifications"
        }
        lifecyclePreferences = ProductLifecyclePreferences()
        lifecycleCoordinator.updatePreferences(lifecyclePreferences)
        val network = defaultNetworkObserver.setUnmeteredNetworksOnly(false)
        mutableState.update {
            it.copy(
                preventSleepDuringActiveDownloads = true,
                lifecycle =
                    it.lifecycle.copy(
                        backgroundDownloadsEnabled = false,
                        keepSeedingEnabled = false,
                        effectiveBackgroundDownloads = false,
                        companionConnections = 0,
                        preferenceError = null,
                    ),
                network =
                    it.network.copy(
                        unmeteredNetworksOnly = false,
                        eligibility = network.eligibility,
                        observationRevision = network.revision,
                        preferenceError = null,
                        runtimeError = null,
                    ),
            )
        }
    }

    private fun resetPresentationStateForDataReset() {
        mutableState.update { current ->
            ProductState(
                ready = false,
                dataReset = current.dataReset,
                lifecycle = current.lifecycle,
                preventSleepDuringActiveDownloads = current.preventSleepDuringActiveDownloads,
                network = current.network,
                notifications = current.notifications,
            )
        }
    }

    private suspend fun dataResetSnapshot(): org.rstorrent.session.uniffi.ServiceSnapshot {
        val outcome =
            dispatchForResponse(Command.Snapshot, dataResetOwner = true).outcome
                as? ResponseOutcome.Success
                ?: error("data reset snapshot failed")
        return outcome.snapshot
    }

    private fun persistDataReset(journal: ProductDataResetJournal): ProductDataResetJournal {
        ProductDataResetJournalStore.persist(this, journal)
        dataResetJournal = journal
        publishDataReset(journal)
        return journal
    }

    private fun publishDataReset(journal: ProductDataResetJournal) {
        mutableState.update {
            it.copy(
                dataReset =
                    ProductDataResetState(
                        operationId = journal.operationId,
                        phase = journal.phase,
                        completedTorrents = journal.completedTorrentCount,
                        totalTorrents = journal.torrentIds.size,
                        deleteDataRequested = journal.deleteDataRequested,
                        downgradedToKeep = journal.downgradedToKeep,
                        failure =
                            journal.failure?.let { failure ->
                                ProductDataResetFailureState(
                                    failure.code,
                                    failure.detail,
                                    failure.torrentId,
                                )
                            },
                    ),
                error = null,
            )
        }
    }

    private fun rejectMutationDuringDataReset(): Boolean {
        if (!dataResetActive.get()) return false
        mutableState.update { it.copy(error = ProductError.Code.DATA_RESET_IN_PROGRESS) }
        return true
    }

    private fun refreshLifecycleInteractions() {
        lifecycleCoordinator.updateInteractions(
            visible = INTERACTION_ACTIVITY in interactionLeases,
            workflowLeaseCount =
                interactionLeases.count { it != INTERACTION_ACTIVITY } +
                    if (dataResetActive.get()) 1 else 0,
        )
    }

    private fun boundedDataResetDetail(detail: String): String {
        if (detail.toByteArray(Charsets.UTF_8).size <= ProductDataResetJournal.MAX_FAILURE_DETAIL_BYTES) {
            return detail
        }
        var bytes = 0
        var boundary = 0
        while (boundary < detail.length) {
            val codePoint = detail.codePointAt(boundary)
            val encodedBytes = String(Character.toChars(codePoint)).toByteArray(Charsets.UTF_8).size
            if (bytes + encodedBytes > ProductDataResetJournal.MAX_FAILURE_DETAIL_BYTES) break
            bytes += encodedBytes
            boundary += Character.charCount(codePoint)
        }
        return detail.substring(0, boundary)
    }

    private fun dataResetFailureCode(error: Throwable): String =
        when (error) {
            is SafStorageRequestException -> error.kind.name.lowercase()
            is kotlinx.coroutines.TimeoutCancellationException -> "torrent_timeout"
            is SecurityException -> "security_rejected"
            is IllegalArgumentException -> "unsafe_state"
            is IllegalStateException -> "operation_failed"
            else -> "internal_failure"
        }

    fun updateClientSettings(patch: ClientSettingsPatch) {
        if (rejectMutationDuringDataReset()) return
        val changes = patch.fieldValues()
        if (changes.isEmpty()) {
            mutableState.update { it.copy(error = ProductError.Code.SETTINGS_UPDATE_EMPTY) }
            return
        }
        mutableState.update { product ->
            val configured = product.clientSettings?.configured
                ?: return@update product.copy(error = ProductError.Code.SETTINGS_LOADING)
            val initialized =
                if (product.clientSettingsDraft.resourceKey == null) {
                    product.clientSettingsDraft.authority(
                        "client-settings",
                        product.latestDurableRevision(),
                        configured.fieldValues(),
                    )
                } else {
                    product.clientSettingsDraft
                }
            product.copy(clientSettingsDraft = initialized.edit(changes), error = null)
        }
        driveClientSettingsMutation()
    }

    fun setPreventSleepDuringActiveDownloads(enabled: Boolean) {
        if (rejectMutationDuringDataReset()) return
        if (!ProductPowerPreference.persist(this, enabled)) {
            mutableState.update {
                it.copy(error = ProductError.Code.POWER_SETTING_SAVE_FAILED)
            }
            return
        }
        mutableState.update {
            it.copy(
                preventSleepDuringActiveDownloads = enabled,
                error = null,
            )
        }
        Log.i(TAG, "prevent_sleep_setting enabled=$enabled")
    }

    fun updateTorrentSettings(
        torrentId: String,
        patch: TorrentSettingsPatch,
    ) {
        if (rejectMutationDuringDataReset()) return
        val changes = patch.fieldValues()
        if (changes.isEmpty()) {
            mutableState.update {
                it.copy(error = ProductError.Code.TORRENT_SETTINGS_UPDATE_EMPTY)
            }
            return
        }
        mutableState.update { product ->
            val torrent = product.torrents[torrentId]
                ?: return@update product.copy(error = ProductError.Code.TORRENT_MISSING)
            val initialized =
                if (product.torrentSettingsDraft.resourceKey != torrentId) {
                    product.torrentSettingsDraft.authority(
                        torrentId,
                        product.latestDurableRevision(),
                        torrent.settingsFieldValues(),
                    )
                } else {
                    product.torrentSettingsDraft
                }
            product.copy(torrentSettingsDraft = initialized.edit(changes), error = null)
        }
        driveTorrentSettingsMutation()
    }

    private fun driveSettingsMutations() {
        driveClientSettingsMutation()
        driveTorrentSettingsMutation()
    }

    private fun driveClientSettingsMutation() {
        if (!clientSettingsRequestActive.compareAndSet(false, true)) return
        var request: SettingsDraftRequest<ClientSettingsField>? = null
        mutableState.update { product ->
            val captured = captureSettingsDraftRequest(product.clientSettingsDraft)
            request = captured.request
            product.copy(clientSettingsDraft = captured.draft)
        }
        val outbound = request
        if (outbound == null) {
            clientSettingsRequestActive.set(false)
            if (mutableState.value.clientSettingsDraft.hasDispatchableSettingsDraft()) {
                driveClientSettingsMutation()
            }
            return
        }
        scope.launch {
            try {
                clientReady.await()
                val response =
                    dispatchForResponse(
                        Command.UpdateClientSettings(outbound.values.toClientSettingsPatch()),
                        outbound.expectedRevision,
                    )
                mutableState.update {
                    it.copy(
                        clientSettingsDraft =
                            it.clientSettingsDraft.accepted(
                                outbound.resourceKey,
                                response.revision,
                            ),
                    )
                }
            } catch (error: Throwable) {
                mutableState.update {
                    it.copy(
                        clientSettingsDraft =
                            it.clientSettingsDraft.failed(
                                outbound.resourceKey,
                                productFailureDetail(error, getString(R.string.error_operation_failed)),
                            ),
                    )
                }
                reportError(error)
            } finally {
                clientSettingsRequestActive.set(false)
                driveClientSettingsMutation()
            }
        }
    }

    private fun driveTorrentSettingsMutation() {
        if (!torrentSettingsRequestActive.compareAndSet(false, true)) return
        var request: SettingsDraftRequest<TorrentSettingsField>? = null
        mutableState.update { product ->
            val captured = captureSettingsDraftRequest(product.torrentSettingsDraft)
            request = captured.request
            product.copy(torrentSettingsDraft = captured.draft)
        }
        val outbound = request
        if (outbound == null) {
            torrentSettingsRequestActive.set(false)
            if (mutableState.value.torrentSettingsDraft.hasDispatchableSettingsDraft()) {
                driveTorrentSettingsMutation()
            }
            return
        }
        scope.launch {
            try {
                clientReady.await()
                val response =
                    dispatchForResponse(
                        Command.UpdateTorrentSettings(
                            outbound.resourceKey,
                            outbound.values.toTorrentSettingsPatch(),
                        ),
                        outbound.expectedRevision,
                    )
                mutableState.update {
                    it.copy(
                        torrentSettingsDraft =
                            it.torrentSettingsDraft.accepted(
                                outbound.resourceKey,
                                response.revision,
                            ),
                    )
                }
            } catch (error: Throwable) {
                mutableState.update {
                    it.copy(
                        torrentSettingsDraft =
                            it.torrentSettingsDraft.failed(
                                outbound.resourceKey,
                                productFailureDetail(error, getString(R.string.error_operation_failed)),
                            ),
                    )
                }
                reportError(error)
            } finally {
                torrentSettingsRequestActive.set(false)
                driveTorrentSettingsMutation()
            }
        }
    }

    /** Copies one magnet link per torrent, newline-separated, in the given order. */
    fun copyMagnets(torrentIds: List<String>) {
        if (torrentIds.isEmpty()) return
        scope.launch {
            try {
                clientReady.await()
                val magnets =
                    torrentIds.map { torrentId ->
                        val response = dispatchForResponse(Command.ExportMagnet(torrentId))
                        val result = response.result as? CommandResult.ExportMagnet
                            ?: error("Magnet export returned no value")
                        result.result.magnet
                    }
                val clipboard = getSystemService(ClipboardManager::class.java)
                clipboard.setPrimaryClip(
                    ClipData.newPlainText(
                        getString(R.string.add_magnet_label),
                        magnets.joinToString("\n"),
                    ),
                )
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                reportTorrentCommandFailure(error)
            }
        }
    }

    fun shutdownFromUi() {
        lifecycleCoordinator.terminal(ProductLifetimeStopReason.EXPLICIT_STOP)
        requestStop("ui_stop")
    }

    fun refreshNotificationEligibility() {
        refreshNotificationEligibility("activity_result")
    }

    internal fun setNotificationPreference(
        preference: ProductNotificationPreference,
        enabled: Boolean,
    ) {
        if (rejectMutationDuringDataReset()) return
        notificationCoordinator.setPreference(preference, enabled, interactionLeases.size)
    }

    internal fun setUnmeteredNetworksOnly(enabled: Boolean) {
        if (rejectMutationDuringDataReset()) return
        scope.launch {
            networkPreferenceMutation.withLock {
                if (stopped.get()) return@withLock
                val current = mutableState.value.network
                if (enabled == current.unmeteredNetworksOnly) return@withLock
                clientReady.await()
                if (enabled) {
                    applyNativeNetworkPrerequisite(
                        AndroidApplicationNetworkPrerequisite.WAITING_FOR_UNMETERED_NETWORK,
                    )
                }
                if (!ProductNetworkPreference.persist(this@ProductEngineService, enabled)) {
                    if (enabled) {
                        applyNativeNetworkPrerequisite(
                            AndroidApplicationNetworkPrerequisite.ALLOWED,
                        )
                    }
                    mutableState.update {
                        it.copy(
                            network =
                                it.network.copy(
                                    preferenceError =
                                        ProductError.Code.NETWORK_PREFERENCE_SAVE_FAILED,
                                ),
                        )
                    }
                    return@withLock
                }
                val updated = defaultNetworkObserver.setUnmeteredNetworksOnly(enabled)
                applyNativeNetworkPrerequisite(desiredNetworkPrerequisite(updated))
                mutableState.update {
                    it.copy(
                        network =
                            it.network.copy(
                                unmeteredNetworksOnly = enabled,
                                eligibility = updated.eligibility,
                                observationRevision = updated.revision,
                                preferenceError = null,
                                runtimeError = null,
                            ),
                    )
                }
            }
        }
    }

    private fun desiredNetworkPrerequisite(
        state: AndroidDefaultNetworkState,
    ): AndroidApplicationNetworkPrerequisite =
        if (recoveryNetworkGateClosed.get()) {
            AndroidApplicationNetworkPrerequisite.WAITING_FOR_UNMETERED_NETWORK
        } else if (
            state.unmeteredNetworksOnly &&
                state.eligibility != AndroidNetworkEligibility.UNRESTRICTED
        ) {
            AndroidApplicationNetworkPrerequisite.WAITING_FOR_UNMETERED_NETWORK
        } else {
            AndroidApplicationNetworkPrerequisite.ALLOWED
        }

    private suspend fun applyNativeNetworkPrerequisite(
        prerequisite: AndroidApplicationNetworkPrerequisite,
    ) {
        networkNativeMutation.withLock {
            val result = client.setNetworkPrerequisite(prerequisite)
            mutableState.update {
                it.copy(
                    network =
                        it.network.copy(
                            effectiveNetworkAllowed = result.allowed,
                            effectiveGeneration = result.effectiveGeneration,
                            runtimeError = null,
                        ),
                )
            }
        }
    }

    internal fun resourceSnapshotForTest(): ResourceSnapshot {
        check(ProductSafDocuments.isDebuggable(this)) { "resource snapshot is debug-only" }
        val lifecycle = lifecycleCoordinator.snapshot()
        return ResourceSnapshot(
            shutdownComplete = shutdownComplete.isCompleted,
            interactionLeases = interactionLeases.size,
            notificationReceiverRegistered = notificationBlockReceiver != null,
            wakeLockHeld = powerLock?.isHeld == true,
            networkCallbackRegistered =
                ::defaultNetworkObserver.isInitialized && defaultNetworkObserver.isRegistered(),
            foreground = foreground.get(),
            backgroundAdmitted = backgroundAdmitted.get(),
            lifecycleRevision = lifecycle?.revision ?: 0,
            lifecycleDeadlineScheduled = lifecycle?.scheduledDeadlineMillis != null,
            companionConnections = lifecycle?.companionConnections ?: 0,
        )
    }

    fun selectTorrent(torrentId: String) {
        withPresentation { it.selectTorrent(torrentId) }
    }

    fun presentTorrent(
        torrentId: String,
        presentation: TorrentPresentation,
    ) {
        withPresentation { it.presentTorrent(torrentId, presentation) }
    }

    fun clearTorrentPresentation(torrentId: String) {
        withPresentation { it.clearTorrent(torrentId) }
    }

    fun presentCatalogPage(
        torrentId: String,
        presentation: TorrentPresentation,
        offset: UInt,
    ) {
        withPresentation { it.presentCatalogPage(torrentId, presentation, offset) }
    }

    fun presentPendingFileSelection(
        torrentId: String,
        offset: UInt,
    ) {
        withPresentation { it.presentPendingFileSelection(torrentId, offset) }
    }

    fun clearPendingFileSelection() {
        withPresentation(AndroidPresentationRepository::clearPendingFileSelection)
    }

    fun presentGlobal(
        presentation: GlobalPresentation,
        speedRange: SpeedRange = SpeedRange.MINUTES2,
    ) {
        withPresentation { it.presentGlobal(presentation, speedRange) }
    }

    fun configureDiagnostics(
        profile: DiagnosticProfile,
        severity: DiagnosticSeverity,
        categories: List<DiagnosticCategory>,
        torrentOnly: Boolean,
    ) {
        withPresentation { it.configureDiagnostics(profile, severity, categories, torrentOnly) }
    }

    private fun withPresentation(action: (AndroidPresentationRepository) -> Unit) {
        scope.launch {
            try {
                presentationReady.await()
                action(presentationRepository)
            } catch (error: Throwable) {
                if (!stopped.get() && error !is CancellationException) reportError(error)
            }
        }
    }

    private fun dispatch(command: Command) {
        scope.launch {
            try {
                clientReady.await()
                dispatchAwait(command)
            } catch (error: Throwable) {
                reportError(error)
            }
        }
    }

    private suspend fun dispatchAwait(command: Command) {
        dispatchForResponse(command)
    }

    private fun magnetV1(magnet: String): String? =
        Regex("(?i)urn:btih:([0-9a-f]{40})")
            .find(magnet)
            ?.groupValues
            ?.get(1)
            ?.lowercase()

    private fun magnetV2(magnet: String): String? =
        Regex("(?i)urn:btmh:1220([0-9a-f]{64})")
            .find(magnet)
            ?.groupValues
            ?.get(1)
            ?.lowercase()

    private suspend fun dispatchAddAwait(
        command: Command,
        v1InfoHash: String?,
        v2InfoHash: String? = null,
    ): String = logAddResult(dispatchAddResult(command), v1InfoHash, v2InfoHash)

    private suspend fun downloadAllPendingAwait(torrentId: String) {
        // Add-time Download all is per-add consent; the preference is untouched.
        dispatchForResponse(Command.DownloadAllPendingAdd(torrentId, disableFuture = false))
        // Keep the intermediate pending add off screen until its authoritative
        // summary catches up with the durable receipt.
        withTimeout(5_000) {
            state.first { it.torrents[torrentId]?.awaitingFileSelection == false }
        }
    }

    private suspend fun dispatchAddResult(command: Command): AddTorrentResult =
        addResult(dispatchForResponse(command))

    private fun addResult(
        response: org.rstorrent.session.uniffi.ResponseEnvelope,
    ): AddTorrentResult =
        (response.result as? CommandResult.AddTorrent)?.result
            ?: error("add response omitted its result")

    private fun logAddResult(
        add: AddTorrentResult,
        v1InfoHash: String?,
        v2InfoHash: String? = null,
    ): String {
        Log.i(
            TAG,
            "torrent_added torrent=${add.torrentId} " +
                "protocol_v1=${v1InfoHash ?: "unknown"} " +
                "protocol_v2=${v2InfoHash ?: "unknown"} " +
                "disposition=${add.disposition::class.simpleName}",
        )
        return add.torrentId
    }

    private suspend fun dispatchForResponse(
        command: Command,
        expectedRevision: String? = null,
        dataResetOwner: Boolean = false,
    ): org.rstorrent.session.uniffi.ResponseEnvelope {
        if (dataResetActive.get() && !dataResetOwner) {
            throw ProductDataResetInProgressException()
        }
        val request =
            RequestEnvelope(
                1U.toUShort(),
                "android-$requestPrefix-${requestIds.getAndIncrement()}",
                expectedRevision,
                command,
            )
        val response =
            if (dataResetOwner) {
                client.dispatch(request)
            } else {
                productCommandMutation.withLock {
                    if (dataResetActive.get()) throw ProductDataResetInProgressException()
                    client.dispatch(request)
                }
            }
        val outcome = response.outcome
        if (outcome is ResponseOutcome.Error) {
            error(outcome.error.message)
        }
        return response
    }

    private suspend fun awaitTrackerPolicy(policy: HttpsServerAuthenticationPolicy) {
        val subscription =
            client.subscribe(
                SubscriptionSpec(
                    ViewSelector.TorrentList,
                    ViewProjection.SUMMARY,
                    DeliveryPolicy(0U, 256U * 1024U),
                    null,
                    null,
                ),
            )
        try {
            withTimeout(10_000) {
                while (true) {
                    val update = subscription.nextUpdate() ?: error("settings view closed")
                    val settings =
                        when (val payload = update.payload) {
                            is ViewUpdatePayload.Snapshot ->
                                (payload.snapshot as? ViewSnapshot.TorrentList)?.clientSettings
                            is ViewUpdatePayload.Patch ->
                                (payload.patch as? ViewPatch.TorrentList)?.clientSettings
                            is ViewUpdatePayload.ResetRequired -> {
                                subscription.resync()
                                null
                            }
                        }
                    if (
                        settings?.configured?.trackerHttpsServerAuthentication == policy &&
                        settings.effectiveTrackerHttpsServerAuthentication == policy &&
                        settings.trackerHttpsAuthenticationApplication is
                            ClientSettingsApplicationState.Applied
                    ) {
                        Log.i(
                            TAG,
                            "tracker_https_settings configured=$policy effective=$policy " +
                                "application=APPLIED",
                        )
                        return@withTimeout
                    }
                }
            }
        } finally {
            subscription.close()
        }
    }

    private suspend fun awaitEncryptionPolicy(policy: EncryptionPolicy) {
        val subscription =
            client.subscribe(
                SubscriptionSpec(
                    ViewSelector.TorrentList,
                    ViewProjection.SUMMARY,
                    DeliveryPolicy(0U, 256U * 1024U),
                    null,
                    null,
                ),
            )
        try {
            withTimeout(10_000) {
                while (true) {
                    val update = subscription.nextUpdate() ?: error("settings view closed")
                    val settings =
                        when (val payload = update.payload) {
                            is ViewUpdatePayload.Snapshot ->
                                (payload.snapshot as? ViewSnapshot.TorrentList)?.clientSettings
                            is ViewUpdatePayload.Patch ->
                                (payload.patch as? ViewPatch.TorrentList)?.clientSettings
                            is ViewUpdatePayload.ResetRequired -> {
                                subscription.resync()
                                null
                            }
                        }
                    if (
                        settings?.configured?.encryption == policy &&
                        settings.effectiveEncryption == policy &&
                        settings.encryptionApplication is ClientSettingsApplicationState.Applied
                    ) {
                        Log.i(
                            TAG,
                            "mse_settings configured=$policy effective=$policy application=APPLIED",
                        )
                        return@withTimeout
                    }
                }
            }
        } finally {
            subscription.close()
        }
    }

    fun subscribeTrackerEvidenceForTest(torrentId: String) {
        check(ProductSafDocuments.isDebuggable(this)) {
            "tracker evidence subscription is debug-only"
        }
        trackerEvidenceJob?.cancel()
        trackerEvidenceSubscription?.close()
        trackerEvidenceJob = null
        trackerEvidenceSubscription = null
        trackerEvidenceJob =
            scope.launch {
                val subscription =
                    client.subscribe(
                        SubscriptionSpec(
                            ViewSelector.Torrent(torrentId),
                            ViewProjection.TRACKERS,
                            DeliveryPolicy(0U, 256U * 1024U),
                            null,
                            CatalogPageRequest(0U, 1_024U),
                        ),
                    )
                trackerEvidenceSubscription = subscription
                try {
                    while (true) {
                        val update = subscription.nextUpdate() ?: break
                        val trackers =
                            when (val payload = update.payload) {
                                is ViewUpdatePayload.Snapshot ->
                                    (payload.snapshot as? ViewSnapshot.Trackers)?.trackers.orEmpty()
                                is ViewUpdatePayload.Patch ->
                                    (payload.patch as? ViewPatch.Trackers)?.upsert.orEmpty()
                                is ViewUpdatePayload.ResetRequired -> {
                                    subscription.resync()
                                    emptyList()
                                }
                            }
                        trackers.forEach { tracker ->
                            Log.i(
                                TAG,
                                "tracker_evidence torrent=$torrentId security=${tracker.security} " +
                                    "status=${tracker.status} attempts=${tracker.totalAttempts} " +
                                    "failures=${tracker.consecutiveFailures} " +
                                    "peer_count=${tracker.lastPeerCount ?: -1} " +
                                    "error=${tracker.lastError != null} " +
                                    "error_detail=${tracker.lastError ?: "none"}",
                            )
                        }
                    }
                } catch (error: Throwable) {
                    if (!stopped.get() && error !is CancellationException) reportError(error)
                } finally {
                    subscription.close()
                }
            }
    }

    private fun advanceSaf(product: ProductState) {
        safDirectCompletions.retainAll(product.torrents.keys)
        for (torrent in product.torrents.values) {
            if (torrent.state == TorrentState.COMPLETE && torrent.removalState == null) {
                if (safDirectCompletions.add(torrent.torrentId)) {
                    scope.launch {
                        try {
                            val snapshot = client.safStoragePoolSnapshot()
                            Log.i(
                                TAG,
                                "saf_direct_complete torrent=${torrent.torrentId} " +
                                    "limit=${snapshot.limit} " +
                                    "owned_high_water=${snapshot.ownedHighWater} " +
                                    "pending_high_water=${snapshot.platformPendingHighWater}",
                            )
                        } catch (error: Throwable) {
                            safDirectCompletions.remove(torrent.torrentId)
                            reportError(error)
                        }
                    }
                }
            }
            if (torrent.removalState != RemovalState.AWAITING_PLATFORM) continue
            if (dataResetActive.get()) continue
            val action = "removal"
            val key = "${torrent.torrentId}:$action"
            if (!safWork.add(key)) continue
            scope.launch {
                try {
                    when (action) {
                        "removal" -> {
                            Log.i(TAG, "saf_removal_begin torrent=${torrent.torrentId}")
                            val plan = client.safRemovalPlan(torrent.torrentId)
                            val treeUri =
                                ProductSafRootRegistry.treeForRoot(
                                    this@ProductEngineService,
                                    plan.storageRoot,
                                ) ?: throw SafStorageRequestException(
                                    SafStorageFailureKind.GRANT_UNAVAILABLE,
                                    "persisted SAF grant is unavailable for the torrent root",
                                )
                            ProductSafDocuments.deleteData(
                                this@ProductEngineService,
                                treeUri,
                                plan,
                            )
                            client.confirmSafRemoval(torrent.torrentId, plan.operationId)
                            safDirectCompletions.remove(torrent.torrentId)
                            Log.i(TAG, "saf_removal_confirmed torrent=${torrent.torrentId}")
                        }
                        else -> error("unknown SAF action $action")
                    }
                } catch (error: Throwable) {
                    if (action == "removal") {
                        try {
                            val plan = client.safRemovalPlan(torrent.torrentId)
                            client.failSafRemoval(
                                torrent.torrentId,
                                plan.operationId,
                                productFailureDetail(error, getString(R.string.error_operation_failed)),
                            )
                        } catch (markError: Throwable) {
                            error.addSuppressed(markError)
                        }
                    }
                    reportError(error)
                } finally {
                    safWork.remove(key)
                }
            }
        }
    }

    private suspend fun driveSafStorageRequests() {
        while (!stopped.get()) {
            val request = client.nextSafStorageRequest() ?: return
            val startupRequest = BuildConfig.DEBUG && !clientReady.isCompleted
            val requestStarted = SystemClock.elapsedRealtime()
            val cancellation = CancellationSignal()
            try {
                withTimeout(request.timeoutMillis.toLong()) {
                    val treeUri =
                        ProductSafRootRegistry.treeForRoot(
                            this@ProductEngineService,
                            request.rootId,
                        )
                            ?: throw SafStorageRequestException(
                                SafStorageFailureKind.GRANT_UNAVAILABLE,
                                "persisted SAF grant is unavailable",
                            )
                    when (request.operation) {
                        SafStorageOperation.DELETE -> {
                            ProductSafDocuments.deleteDynamic(
                                this@ProductEngineService,
                                treeUri,
                                request,
                            )
                            client.completeSafStorageDelete(request.requestId)
                        }
                        SafStorageOperation.OBSERVE -> {
                            val observation =
                                ProductSafDocuments.observeDynamic(
                                    this@ProductEngineService,
                                    treeUri,
                                    request,
                                )
                            client.completeSafStorageObservation(request.requestId, observation)
                        }
                        SafStorageOperation.OPEN -> {
                            ProductSafDocuments
                                .openDynamic(
                                    this@ProductEngineService,
                                    treeUri,
                                    request,
                                    cancellation,
                                ).use { descriptor ->
                                    client.completeSafStorageRequest(
                                        request.requestId,
                                        descriptor.fd,
                                        request.access,
                                    )
                                }
                        }
                    }
                }
            } catch (error: kotlinx.coroutines.TimeoutCancellationException) {
                cancellation.cancel()
                client.failSafStorageRequest(
                    request.requestId,
                    SafStorageFailureKind.DEADLINE_EXCEEDED,
                    "SAF provider request exceeded its deadline",
                )
            } catch (error: SafStorageRequestException) {
                client.failSafStorageRequest(request.requestId, error.kind, error.message ?: "")
            } catch (error: SecurityException) {
                client.failSafStorageRequest(
                    request.requestId,
                    SafStorageFailureKind.GRANT_UNAVAILABLE,
                    error.message ?: "SAF grant is unavailable",
                )
            } catch (error: Throwable) {
                client.failSafStorageRequest(
                    request.requestId,
                    SafStorageFailureKind.PROVIDER_REFUSED,
                    productFailureDetail(error, getString(R.string.error_operation_failed)),
                )
            } finally {
                cancellation.cancel()
                if (startupRequest) {
                    Log.i(TAG, "saf_startup_request operation=${request.operation} elapsed_ms=${SystemClock.elapsedRealtime() - requestStarted}")
                }
            }
        }
    }

    private fun traceUpdate(
        update: ViewUpdate,
        product: ProductState,
    ) {
        // Session rates arrive every 500 ms for the library header; tracing
        // them would flood the log without describing any torrent.
        val payload = update.payload
        if (
            (payload is ViewUpdatePayload.Snapshot && payload.snapshot is ViewSnapshot.SessionCurrentRates) ||
            (payload is ViewUpdatePayload.Patch && payload.patch is ViewPatch.SessionCurrentRates)
        ) {
            return
        }
        val kind =
            when (update.payload) {
                is ViewUpdatePayload.Snapshot -> "snapshot"
                is ViewUpdatePayload.Patch -> "patch"
                is ViewUpdatePayload.ResetRequired -> "reset"
            }
        val torrent =
            product.selectedTorrent?.let(product.torrents::get)
                ?: product.torrents.values.firstOrNull()
        val active = product.selectedTorrent?.let(product.pieces::get)?.active?.firstOrNull()
        val diagnostic = product.diagnostics.lastOrNull()
        val diagnosticDetail =
            diagnostic
                ?.fields
                ?.firstOrNull { it.key == "detail" }
                ?.value
                ?.let { it as? DiagnosticValue.Text }
                ?.value
                ?.replace(Regex("\\s+"), "_")
                ?: "none"
        Log.i(
            TAG,
            "view_update stream=${update.streamId} sequence=${update.sequence} " +
                "torrent=${torrent?.torrentId ?: "none"} " +
                "v1=${torrent?.protocolIdentities?.v1 ?: "none"} " +
                "v2=${torrent?.protocolIdentities?.v2 ?: "none"} " +
                "kind=$kind state=${torrent?.state?.name ?: "none"} " +
                "storage=${torrent?.storageState?.name ?: "none"} " +
                "metadata=${torrent?.metadataAvailable ?: false} " +
                "awaiting_selection=${torrent?.awaitingFileSelection ?: false} " +
                "catalog=${torrent?.fileCatalogId ?: "none"} " +
                "selected_files=${torrent?.selectedFileCount ?: 0U}/" +
                "${torrent?.selectableFileCount ?: 0U} " +
                "progress=${torrent?.progress?.disposition?.name ?: "none"} " +
                "reason=${torrent?.progress?.reason?.name ?: "none"} " +
                "diagnostic=${diagnostic?.code ?: "none"} " +
                "diagnostic_detail=$diagnosticDetail " +
                "verified=${torrent?.verifiedPieceCount ?: 0U} " +
                "check=${torrent?.checking?.let { progress ->
                    "${progress.piecesMatched},${progress.piecesAbsent},${progress.piecesMismatched}"
                } ?: "none"} " +
                "piece=${active?.pieceIndex?.toString() ?: "none"} " +
                "requested=${active?.requested?.sumOf(::rangeBytes) ?: 0UL} " +
                "received=${active?.received?.sumOf(::rangeBytes) ?: 0UL} " +
                "stored=${active?.stored?.sumOf(::rangeBytes) ?: 0UL}",
        )
    }

    private fun rangeBytes(range: org.rstorrent.session.uniffi.IndexRange): ULong =
        (range.endExclusive - range.start).toULong()

    internal fun setBackgroundDownloadsEnabled(enabled: Boolean) {
        if (rejectMutationDuringDataReset()) return
        synchronized(lifecyclePreferenceOwnership) {
            val eligible =
                notificationCoordinator
                    .refreshPlatformState(interactionLeases.size)
                    .backgroundNotificationVisible
            lifecycleCoordinator.updateNotificationEligibility(eligible)
            publishLifecyclePreferences(eligible)
            if (enabled && !eligible) {
                mutableState.update {
                    it.copy(
                        lifecycle =
                            it.lifecycle.copy(
                                preferenceError =
                                    ProductError.Code.BACKGROUND_NOTIFICATION_REQUIRED,
                            ),
                    )
                }
                return
            }
            persistLifecyclePreferences(
                lifecyclePreferences.copy(backgroundDownloadsEnabled = enabled),
            )
        }
    }

    internal fun setKeepSeedingInBackground(enabled: Boolean) {
        if (rejectMutationDuringDataReset()) return
        synchronized(lifecyclePreferenceOwnership) {
            if (enabled && !lifecyclePreferences.backgroundDownloadsEnabled) {
                mutableState.update {
                    it.copy(
                        lifecycle =
                            it.lifecycle.copy(
                                preferenceError =
                                    ProductError.Code.BACKGROUND_DOWNLOADS_REQUIRED,
                            ),
                    )
                }
                return
            }
            persistLifecyclePreferences(
                lifecyclePreferences.copy(
                    completionPolicy =
                        if (enabled) {
                            ProductBackgroundCompletionPolicy.KEEP_SEEDING
                        } else {
                            ProductBackgroundCompletionPolicy.STOP_WHEN_DOWNLOADS_COMPLETE
                        },
                ),
            )
        }
    }

    private fun persistLifecyclePreferences(requested: ProductLifecyclePreferences) {
        when (
            val result =
                persistProductLifecyclePreferences(
                    lifecyclePreferences,
                    requested,
                    lifecyclePreferenceStore::write,
                )
        ) {
            is ProductLifecyclePreferenceResult.Applied -> {
                lifecyclePreferences = result.preferences
                publishLifecyclePreferences(
                    mutableState.value.notifications.eligibility.backgroundNotificationVisible,
                    preferenceError = null,
                )
                lifecycleCoordinator.updatePreferences(result.preferences)
                Log.i(
                    TAG,
                    "lifecycle_preferences background=" +
                        "${result.preferences.backgroundDownloadsEnabled} " +
                        "keep_seeding=${result.preferences.keepSeedingEnabled}",
                )
            }
            ProductLifecyclePreferenceResult.Failed ->
                mutableState.update {
                    it.copy(
                        lifecycle =
                            it.lifecycle.copy(
                                preferenceError =
                                    ProductError.Code.BACKGROUND_SETTING_SAVE_FAILED,
                            ),
                    )
                }
        }
    }

    private fun disableBackgroundAfterPermissionRevocation() {
        synchronized(lifecyclePreferenceOwnership) {
            if (!lifecyclePreferences.backgroundDownloadsEnabled) return
            persistLifecyclePreferences(
                lifecyclePreferences.copy(backgroundDownloadsEnabled = false),
            )
        }
    }

    private fun publishLifecyclePreferences(
        notificationEligible: Boolean,
        preferenceError: ProductError? = mutableState.value.lifecycle.preferenceError,
    ) {
        mutableState.update {
            it.copy(
                lifecycle =
                    it.lifecycle.copy(
                        backgroundDownloadsEnabled =
                            lifecyclePreferences.backgroundDownloadsEnabled,
                        keepSeedingEnabled =
                            lifecyclePreferences.completionPolicy ==
                                ProductBackgroundCompletionPolicy.KEEP_SEEDING,
                        effectiveBackgroundDownloads =
                            lifecyclePreferences.backgroundDownloadsEnabled &&
                                notificationEligible,
                        preferenceError = preferenceError,
                    ),
            )
        }
    }

    private fun stickyRecoveryAllowed(): Boolean {
        val notifications = mutableState.value.notifications.eligibility
        if (!notifications.backgroundNotificationVisible) return false
        return lifecyclePreferences.backgroundDownloadsEnabled ||
            ProductCompanionPreference.shouldStart(
                isChromeOs(),
                ProductCompanionPreference.read(this),
            )
    }

    private fun applyLifecycleDecision(snapshot: ProductLifecycleCoordinatorSnapshot) {
        if (stopped.get() || stopRequested.get()) return
        val decision = snapshot.decision
        mutableState.update {
            it.copy(
                lifecycle =
                    it.lifecycle.copy(
                        foreground = foreground.get(),
                        companionConnections = snapshot.companionConnections,
                        reason = lifecycleDecisionReason(decision),
                    ),
            )
        }
        Log.i(
            TAG,
            "lifecycle_decision revision=${snapshot.revision} " +
                "decision=${lifecycleDecisionReason(decision)} " +
                "deadline=${snapshot.scheduledDeadlineMillis ?: "none"}",
        )
        when (decision) {
            is ProductLifetimeDecision.Retain -> {
                if (decision.foregroundRequired && !promoteForeground(snapshot)) return
                if (!decision.foregroundRequired) demoteForeground()
                updateStickyAdmission(decision.stickyAllowed)
                if (decision.stickyAllowed) openRecoveryNetwork(decision.reason)
            }
            is ProductLifetimeDecision.Wait -> {
                if (decision.foregroundRequired && !promoteForeground(snapshot)) return
                updateStickyAdmission(false)
            }
            is ProductLifetimeDecision.Stop -> {
                updateStickyAdmission(false)
                requestStop("lifecycle_${decision.reason.name.lowercase()}")
            }
        }
    }

    private fun promoteForeground(snapshot: ProductLifecycleCoordinatorSnapshot): Boolean {
        if (foreground.get()) return true
        return runCatching {
            startForeground(
                AndroidNotificationContract.ONGOING_NOTIFICATION_ID,
                notificationCoordinator.ongoingNotification(
                    lifecycleNotificationText(snapshot),
                ),
            )
            foreground.set(true)
            mutableState.update { it.copy(lifecycle = it.lifecycle.copy(foreground = true)) }
            Log.i(TAG, "product_foreground active=true")
            true
        }.getOrElse { error ->
            Log.e(TAG, "foreground promotion failed", error)
            recoveryNetworkGateClosed.set(true)
            if (clientOpen) runCatching { client.closeNetworkPrerequisite() }
            lifecycleCoordinator.terminal(
                ProductLifetimeStopReason.FOREGROUND_PROMOTION_FAILED,
            )
            false
        }
    }

    private fun acknowledgeForegroundServiceStart(): Boolean {
        val snapshot = lifecycleCoordinator.snapshot() ?: return true
        if (!promoteForeground(snapshot)) return false
        Handler(Looper.getMainLooper()).post {
            lifecycleCoordinator.snapshot()?.let(::applyLifecycleDecision)
        }
        return true
    }

    private fun demoteForeground() {
        if (!foreground.compareAndSet(true, false)) return
        stopForeground(STOP_FOREGROUND_REMOVE)
        mutableState.update { it.copy(lifecycle = it.lifecycle.copy(foreground = false)) }
        Log.i(TAG, "product_foreground active=false")
    }

    private fun updateStickyAdmission(admitted: Boolean) {
        if (!backgroundAdmitted.compareAndSet(!admitted, admitted)) return
        val action =
            if (admitted) ACTION_BACKGROUND_ADMITTED else ACTION_BACKGROUND_REVOKED
        runCatching {
            startService(
                Intent(this, ProductEngineService::class.java)
                    .setPackage(packageName)
                    .setAction(action),
            )
        }.onFailure { error ->
            backgroundAdmitted.set(false)
            Log.e(TAG, "background start admission failed", error)
            recoveryNetworkGateClosed.set(true)
            if (clientOpen) runCatching { client.closeNetworkPrerequisite() }
            lifecycleCoordinator.terminal(
                ProductLifetimeStopReason.FOREGROUND_PROMOTION_FAILED,
            )
        }
    }

    private fun openRecoveryNetwork(reason: ProductLifetimeRetentionReason) {
        if (
            reason == ProductLifetimeRetentionReason.CHROMEOS_RECONNECT_GRACE ||
                !recoveryNetworkGateClosed.compareAndSet(true, false)
        ) {
            return
        }
        Log.i(TAG, "lifecycle_recovery network_admitted=true reason=${reason.name.lowercase()}")
        networkConvergenceWake.trySend(Unit)
    }

    private fun lifecycleDecisionReason(decision: ProductLifetimeDecision): String =
        when (decision) {
            is ProductLifetimeDecision.Retain -> "retain_${decision.reason.name.lowercase()}"
            is ProductLifetimeDecision.Wait -> "wait_${decision.reason.name.lowercase()}"
            is ProductLifetimeDecision.Stop -> "stop_${decision.reason.name.lowercase()}"
        }

    private fun lifecycleNotificationText(snapshot: ProductLifecycleCoordinatorSnapshot): String =
        when ((snapshot.decision as? ProductLifetimeDecision.Retain)?.reason) {
            ProductLifetimeRetentionReason.ACTIVE_DOWNLOAD -> {
                val work = snapshot.work ?: ProductLifetimeWork()
                when {
                    work.downloading > 0 ->
                        resources.getQuantityString(
                            R.plurals.notification_downloading_torrents,
                            work.downloading,
                            work.downloading,
                        )
                    work.checking > 0 -> getString(R.string.notification_checking_downloads)
                    else -> getString(R.string.notification_starting_downloads)
                }
            }
            ProductLifetimeRetentionReason.WAITING_FOR_UNMETERED_NETWORK ->
                getString(R.string.notification_waiting_unmetered)
            ProductLifetimeRetentionReason.BACKGROUND_SEEDING ->
                getString(R.string.notification_seeding_background)
            ProductLifetimeRetentionReason.CHROMEOS_COMPANION ->
                getString(R.string.notification_chrome_connected)
            ProductLifetimeRetentionReason.CHROMEOS_RECONNECT_GRACE ->
                getString(R.string.notification_chrome_reconnect)
            else -> productOngoingNotificationText(mutableState.value)
        }

    private fun observePowerAndNotification() {
        powerNotificationJob = scope.launch {
            launch {
                state.collect { product ->
                    val active =
                        product.preventSleepDuringActiveDownloads &&
                            requiresSleepInhibition(product.torrents.values)
                    updatePowerLock(active)
                }
            }
            // The only steady-state writer of the ongoing notification; a newer
            // emission cancels a pending rate post and the throttle recomputes it.
            val throttle = ProductOngoingNotificationThrottle()
            state.collectLatest { product ->
                if (!foreground.get()) {
                    throttle.forget()
                    return@collectLatest
                }
                val content = productOngoingNotificationContent(product)
                val wait =
                    throttle.delayMillis(content, SystemClock.elapsedRealtime())
                        ?: return@collectLatest
                if (wait > 0L) delay(wait)
                if (!foreground.get()) return@collectLatest
                notificationCoordinator.updateOngoingNotification(content)
                throttle.posted(content, SystemClock.elapsedRealtime())
            }
        }
    }

    private fun updatePowerLock(active: Boolean) {
        if (active) {
            if (powerLock == null) {
                val power = getSystemService(Context.POWER_SERVICE) as PowerManager
                powerLock =
                    power
                        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:download")
                        .apply {
                            setReferenceCounted(false)
                            acquire()
                        }
                Log.i(TAG, "partial_wake_lock acquired=true")
            }
        } else {
            releasePowerLock()
        }
    }

    private fun releasePowerLock() {
        powerLock?.let {
            if (it.isHeld) {
                it.release()
                Log.i(TAG, "partial_wake_lock acquired=false")
            }
        }
        powerLock = null
    }

    private fun requestStop(
        reason: String,
        startId: Int? = null,
    ) {
        if (!stopRequested.compareAndSet(false, true)) return
        recoveryNetworkGateClosed.set(true)
        if (clientOpen) {
            runCatching { client.closeNetworkPrerequisite() }.onFailure { error ->
                Log.w(TAG, "lifecycle network close failed", error)
            }
        }
        scope.launch {
            try {
                shutdown(reason)
            } finally {
                val safeStartId = maxOf(startId ?: 0, latestStartId.get())
                if (safeStartId == 0 || !stopSelfResult(safeStartId)) stopSelf()
                // Published after stopSelf so a bound activity that unbinds in
                // response lets this instance be destroyed before it restarts.
                mutableState.update { it.copy(ready = false, serviceStopped = true) }
            }
        }
    }

    private suspend fun shutdown(reason: String) {
        if (!stopped.compareAndSet(false, true)) {
            shutdownComplete.await()
            return
        }
        Log.i(TAG, "product_shutdown_begin reason=$reason")
        var clientCleanupFailed = false
        try {
            initializationJob?.cancelAndJoin()
            lifecycleCoordinator.close()
            if (::defaultNetworkObserver.isInitialized) defaultNetworkObserver.close()
            unregisterNotificationBlockReceiver()
            ProductInteractionRegistry.detach()
            interactionLeases.clear()
            dataResetJob?.cancelAndJoin()
            networkConvergenceJob?.cancelAndJoin()
            powerNotificationJob?.cancelAndJoin()
            externalAdmissionCancellationSignal?.cancel()
            externalCancellationSignal?.cancel()
            externalAdmissionJob?.cancelAndJoin()
            externalSubmissionJob?.cancelAndJoin()
            if (::presentationRepository.isInitialized) presentationRepository.close()
            trackerEvidenceJob?.cancel()
            trackerEvidenceSubscription?.close()
            trackerEvidenceJob?.join()
            companionConnectionJob?.cancel()
            companionConnectionSubscription?.close()
            companionPairingJob?.cancel()
            companionRootJob?.cancel()
            companionRootRemovalJob?.cancel()
            if (foreground.get()) {
                notificationCoordinator.updateOngoingNotification(
                    getString(R.string.notification_finishing_shutdown),
                )
            }
            notificationCoordinator.close()
            if (clientOpen) {
                val failure =
                    joinProductClientShutdown(
                        shutdown = {
                            Log.i(TAG, "product_shutdown_client_begin")
                            client.shutdown()
                            Log.i(TAG, "product_shutdown_client_complete")
                        },
                        release = {
                            companionConnectionJob?.join()
                            companionPairingJob?.join()
                            companionRootJob?.join()
                            companionRootRemovalJob?.join()
                            safStorageJobs.forEach { it.join() }
                            client.close()
                            clientOpen = false
                        },
                    )
                if (failure != null) {
                    clientCleanupFailed = true
                    reportError(failure)
                }
            }
            Log.i(
                TAG,
                "product_shutdown_complete reason=$reason cleanup_failed=$clientCleanupFailed",
            )
        } finally {
            releasePowerLock()
            stopForeground(STOP_FOREGROUND_REMOVE)
            foreground.set(false)
            backgroundAdmitted.set(false)
            shutdownComplete.complete(Unit)
        }
    }

    private fun reportError(error: Throwable) {
        Log.e(TAG, "product control failed", error)
        mutableState.update {
            it.copy(
                error =
                    if (error is ProductDataResetInProgressException) {
                        ProductError.Code.DATA_RESET_IN_PROGRESS
                    } else {
                        ProductError.Technical(productFailureDetail(error, getString(R.string.error_operation_failed)))
                    },
            )
        }
    }

    private fun refreshNotificationEligibility(reason: String) {
        if (stopped.get()) return
        scope.launch {
            notificationEligibilityMutation.withLock {
                if (stopped.get()) return@withLock
                val eligibility =
                    notificationCoordinator.refreshPlatformState(interactionLeases.size)
                if (!eligibility.permissionGranted) {
                    disableBackgroundAfterPermissionRevocation()
                }
                lifecycleCoordinator.updateNotificationEligibility(
                    eligibility.backgroundNotificationVisible,
                )
                publishLifecyclePreferences(eligibility.backgroundNotificationVisible)
                Log.i(
                    TAG,
                    "notification_eligibility reason=$reason visible=" +
                        "${eligibility.backgroundNotificationVisible} " +
                        "interaction=${eligibility.interactionLeaseCount > 0}",
                )
            }
        }
    }

    private fun registerNotificationBlockReceiver() {
        val receiver =
            object : BroadcastReceiver() {
                override fun onReceive(
                    context: Context?,
                    intent: Intent?,
                ) {
                    refreshNotificationEligibility("block_state")
                }
            }
        val filter =
            IntentFilter().apply {
                addAction(NotificationManager.ACTION_APP_BLOCK_STATE_CHANGED)
                addAction(NotificationManager.ACTION_NOTIFICATION_CHANNEL_BLOCK_STATE_CHANGED)
            }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(receiver, filter)
        }
        notificationBlockReceiver = receiver
    }

    private fun unregisterNotificationBlockReceiver() {
        notificationBlockReceiver?.let { receiver ->
            runCatching { unregisterReceiver(receiver) }
        }
        notificationBlockReceiver = null
    }

    companion object {
        const val ACTION_STOP = "org.rstorrent.bootstrap.PRODUCT_STOP"
        const val ACTION_ENABLE_CHROMEOS_COMPANION =
            "org.rstorrent.bootstrap.ENABLE_CHROMEOS_COMPANION"
        const val ACTION_DEBUG_TORRENT_CONTROL =
            "org.rstorrent.bootstrap.PRODUCT_DEBUG_TORRENT_CONTROL"
        const val EXTRA_DEBUG_TORRENT_ID = "torrent_id"
        const val EXTRA_DEBUG_TORRENT_ACTION = "torrent_action"
        private const val ACTION_BACKGROUND_ADMITTED =
            "org.rstorrent.bootstrap.BACKGROUND_ADMITTED"
        private const val ACTION_BACKGROUND_REVOKED =
            "org.rstorrent.bootstrap.BACKGROUND_REVOKED"
        fun externalIntakeAction(packageName: String): String =
            "$packageName.action.EXTERNAL_TORRENT_INTAKE"
        private const val COMPANION_ROOT_PENDING_INTENT_ID = 43
        const val INTERACTION_ACTIVITY = "activity"
        const val INTERACTION_NOTIFICATION_PERMISSION = "notification_permission"
        const val INTERACTION_NOTIFICATION_SETTINGS = "notification_settings"
        const val INTERACTION_PLAYBACK = "playback"
        const val INTERACTION_SAF_PICKER = "saf_picker"
        const val INTERACTION_TORRENT_PICKER = "torrent_picker"
        private const val COMPANION_PAIRING_POLL_MILLIS = 250L
        private const val EXTERNAL_PROVIDER_TIMEOUT_MILLIS = 30_000L
        private const val DATA_RESET_POLL_MILLIS = 50L
        private const val DATA_RESET_TORRENT_TIMEOUT_MILLIS = 120_000L
        private const val ROOT_DATA_REMOVAL_TIMEOUT_MILLIS = 300_000L
        private const val SAF_PROVIDER_CONCURRENCY = 4
        private const val ANDROID_RATE_BYTES_PER_SECOND = 24 * 1024
        private const val PRODUCT_QUOTA_RESTART_DELAY_MILLIS = 3_000L
        private const val PRODUCT_STATE_DIRECTORY = "product-state"
        private const val TAG = "RSTorrentProduct"
    }
}
