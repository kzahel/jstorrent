package org.rstorrent.bootstrap

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.net.Uri
import android.provider.Settings
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.rstorrent.bootstrap.ui.ChromeExtensionSetupDialog
import org.rstorrent.bootstrap.ui.ProductApp
import org.rstorrent.bootstrap.ui.ProductThemeMode
import org.rstorrent.session.uniffi.FileIndexRange
import org.rstorrent.session.uniffi.FileSelectionIntent

class MainActivity : ComponentActivity() {
    private var pendingCommand: Intent? = null
    private val productService = mutableStateOf<ProductEngineService?>(null)
    private val notificationsGranted = mutableStateOf(false)
    private val notificationNavigation = mutableStateOf<ProductNotificationNavigation?>(null)
    private val themeMode = mutableStateOf(ProductThemeMode.SYSTEM)
    private val dynamicColor = mutableStateOf(true)
    private val chromeExtensionSetupVisible = mutableStateOf(false)
    private val chromeExtensionSetupBusy = mutableStateOf(false)
    private val chromeExtensionSetupFailed = mutableStateOf(false)
    private var chromeExtensionSetupJob: Job? = null
    private var productBound = false
    private var serviceStopWatch: Job? = null
    private var productMode = false
    private var productStartRequested = false
    private var pendingProductMagnet: String? = null
    private var pendingProductTorrentUri: String? = null
    private var pendingProductTorrentBase64: String? = null
    private var pendingProductTorrentSelection: FileSelectionIntent = FileSelectionIntent.All
    private var pendingProductTorrentStartContent = true
    private var pendingProductTorrentAwaitFileSelection = false
    private var pendingProductRepairRootId: String? = null
    private var pendingProductCompanionRootRequestId: String? = null
    private var pendingProductCompanionCancelledRequestId: String? = null
    private var pendingProductTrackerPolicy: String? = null
    private var pendingProductEncryptionPolicy: String? = null
    private var pendingProductStartContent = true
    private var pendingProductAwaitFileSelection = false
    private var pendingProductSkipFiles: List<UInt> = emptyList()
    private var pendingProductTrackerEvidenceTorrent: String? = null
    private var pendingProductMseEvidence = false
    private var pendingProductDownloadAdmissionEvidence: String? = null
    private var pendingProductSeedAdmissionEvidence: String? = null
    private var pendingProductBandwidthPolicy: String? = null
    private var pendingProductIpv6Policy: String? = null
    private var pendingProductUnmeteredNetworkPolicy: String? = null
    private var pendingProductLifecycleEvidence: String? = null
    private var pendingProductQuotaRestartEvidence = false
    private var pendingProductTorrentAction: Pair<String, String>? = null
    private var pendingProductDataReset: Pair<Boolean, Int?>? = null
    private var pendingNotificationSettingsReturn = false
    private var pendingBackgroundEnable = false
    private var notificationNavigationSequence = 0L
    private val productTreePicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            ProductInteractionRegistry.setLease(
                ProductEngineService.INTERACTION_SAF_PICKER,
                false,
            )
            val data = result.data
            val treeUri = data?.data
            val companionRequestId = pendingProductCompanionRootRequestId
            val repairRootId = pendingProductRepairRootId
            pendingProductRepairRootId = null
            if (result.resultCode != RESULT_OK || treeUri == null) {
                pendingProductCompanionRootRequestId = null
                if (companionRequestId != null) {
                    val service = productService.value
                    if (service == null) {
                        pendingProductCompanionCancelledRequestId = companionRequestId
                    } else {
                        service.cancelCompanionRootRequest(companionRequestId)
                    }
                }
                return@registerForActivityResult
            }
            val flags = data.flags and ProductSafDocuments.GRANT_FLAGS
            contentResolver.takePersistableUriPermission(treeUri, flags)
            ProductSafDocuments.persistTree(this, treeUri, repairRootId)
            val service = productService.value
            if (service != null) {
                pendingProductCompanionRootRequestId = null
                service.setSafTree(treeUri, repairRootId, companionRequestId)
            }
        }
    private val productTorrentPicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            ProductInteractionRegistry.setLease(
                ProductEngineService.INTERACTION_TORRENT_PICKER,
                false,
            )
            val data = result.data
            val torrentUri = data?.data
            if (result.resultCode != RESULT_OK || torrentUri == null) {
                return@registerForActivityResult
            }
            val flags = data.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION
            runCatching { contentResolver.takePersistableUriPermission(torrentUri, flags) }
            val service = productService.value
            if (service == null) {
                pendingProductTorrentUri = torrentUri.toString()
            } else {
                service.addTorrentFile(
                    torrentUri,
                    startContent = true,
                    awaitFileSelection = pendingProductTorrentAwaitFileSelection,
                )
                pendingProductTorrentStartContent = true
                pendingProductTorrentAwaitFileSelection = false
            }
        }
    private val notificationPermissionRequest =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            notificationsGranted.value = notificationPermissionGranted()
            ProductInteractionRegistry.setLease(
                ProductEngineService.INTERACTION_NOTIFICATION_PERMISSION,
                false,
            )
            productService.value?.refreshNotificationEligibility()
            if (pendingBackgroundEnable && notificationsGranted.value) {
                productService.value?.let { service ->
                    pendingBackgroundEnable = false
                    service.setBackgroundDownloadsEnabled(true)
                }
            } else if (!notificationsGranted.value) {
                pendingBackgroundEnable = false
            }
        }
    private val productConnection =
        object : ServiceConnection {
            override fun onServiceConnected(
                name: ComponentName,
                binder: IBinder,
            ) {
                val service = (binder as ProductEngineService.LocalBinder).service
                if (
                    pendingBackgroundEnable && !pendingNotificationSettingsReturn &&
                        notificationPermissionGranted()
                ) {
                    pendingBackgroundEnable = false
                    service.setBackgroundDownloadsEnabled(true)
                }
                ProductSafRootRegistry.load(this@MainActivity).let { registry ->
                    registry.selectionCandidate?.let { encoded ->
                        service.setSafTree(
                            android.net.Uri.parse(encoded),
                            registry.selectionRepairRootId,
                            pendingProductCompanionRootRequestId,
                        )
                        pendingProductCompanionRootRequestId = null
                    }
                }
                pendingProductCompanionCancelledRequestId?.let {
                    pendingProductCompanionCancelledRequestId = null
                    service.cancelCompanionRootRequest(it)
                }
                productService.value = service
                serviceStopWatch?.cancel()
                serviceStopWatch =
                    lifecycleScope.launch {
                        service.state.first { it.serviceStopped }
                        reconnectStoppedProductService(service)
                    }
                recordProductForegroundIfPending(service)
                pendingProductMagnet?.let {
                    pendingProductMagnet = null
                    val policy = pendingProductTrackerPolicy
                    pendingProductTrackerPolicy = null
                    val encryption = pendingProductEncryptionPolicy
                    pendingProductEncryptionPolicy = null
                    when {
                        policy != null -> service.addMagnetWithTrackerPolicyForTest(
                            it,
                            policy,
                            pendingProductStartContent,
                        )
                        encryption != null ->
                            service.addMagnetWithEncryptionPolicyForTest(
                                it,
                                encryption,
                                pendingProductSkipFiles,
                            )
                        else ->
                            service.addMagnet(
                                it,
                                pendingProductSkipFiles,
                                pendingProductStartContent,
                                pendingProductAwaitFileSelection,
                            )
                    }
                    pendingProductStartContent = true
                    pendingProductAwaitFileSelection = false
                    pendingProductSkipFiles = emptyList()
                }
                pendingProductTorrentUri?.let { encoded ->
                    pendingProductTorrentUri = null
                    service.addTorrentFile(
                        android.net.Uri.parse(encoded),
                        startContent = true,
                        awaitFileSelection = pendingProductTorrentAwaitFileSelection,
                    )
                    pendingProductTorrentStartContent = true
                    pendingProductTorrentAwaitFileSelection = false
                }
                pendingProductTorrentBase64?.let { encoded ->
                    pendingProductTorrentBase64 = null
                    service.addTorrentBytes(
                        android.util.Base64.decode(encoded, android.util.Base64.DEFAULT),
                        pendingProductTorrentStartContent,
                        pendingProductTorrentSelection,
                        pendingProductTorrentAwaitFileSelection,
                    )
                    pendingProductTorrentStartContent = true
                    pendingProductTorrentAwaitFileSelection = false
                    pendingProductTorrentSelection = FileSelectionIntent.All
                }
                pendingProductTrackerEvidenceTorrent?.let {
                    pendingProductTrackerEvidenceTorrent = null
                    service.subscribeTrackerEvidenceForTest(it)
                }
                if (pendingProductMseEvidence) {
                    pendingProductMseEvidence = false
                    service.logMseDhEvidenceForTest()
                }
                pendingProductDownloadAdmissionEvidence?.let {
                    pendingProductDownloadAdmissionEvidence = null
                    service.logDownloadAdmissionEvidenceForTest(it)
                }
                pendingProductSeedAdmissionEvidence?.let {
                    pendingProductSeedAdmissionEvidence = null
                    service.logSeedAdmissionEvidenceForTest(it)
                }
                pendingProductBandwidthPolicy?.let {
                    pendingProductBandwidthPolicy = null
                    service.exerciseBandwidthPolicyForTest(it)
                }
                pendingProductIpv6Policy?.let {
                    pendingProductIpv6Policy = null
                    android.util.Log.i("RSTorrentProduct", "ipv6_settings_bound mode=$it")
                    service.exerciseIpv6PolicyForTest(it)
                }
                pendingProductUnmeteredNetworkPolicy?.let {
                    pendingProductUnmeteredNetworkPolicy = null
                    android.util.Log.i("RSTorrentProduct", "network_policy_bound mode=$it")
                    service.exerciseUnmeteredNetworkPolicyForTest(it)
                }
                pendingProductLifecycleEvidence?.let {
                    pendingProductLifecycleEvidence = null
                    service.exerciseProductLifecycleForTest(it)
                }
                if (pendingProductQuotaRestartEvidence) {
                    pendingProductQuotaRestartEvidence = false
                    service.armProductQuotaRestartEvidenceForTest()
                }
                pendingProductTorrentAction?.let { (torrentId, action) ->
                    pendingProductTorrentAction = null
                    service.exerciseTorrentActionForTest(torrentId, action)
                }
                pendingProductDataReset?.let { (deleteData, killAfterTorrents) ->
                    pendingProductDataReset = null
                    if (killAfterTorrents == null) {
                        service.clearAllData(deleteData)
                    } else {
                        service.clearAllDataWithProcessKillForTest(
                            deleteData,
                            killAfterTorrents,
                        )
                    }
                }
            }

            override fun onServiceDisconnected(name: ComponentName) {
                serviceStopWatch?.cancel()
                serviceStopWatch = null
                productService.value = null
            }
        }

    /**
     * The service can stop itself while this activity is still bound, for
     * example after a lifecycle stop decision. Its engine client is closed by
     * then, so rebind to a fresh service instead of showing stale state that
     * rejects every command.
     */
    private fun reconnectStoppedProductService(stopped: ProductEngineService) {
        if (
            productService.value !== stopped ||
            !productBound ||
            isFinishing ||
            !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)
        ) {
            return
        }
        android.util.Log.i("RSTorrentProduct", "product_service_reconnect")
        serviceStopWatch = null
        unbindService(productConnection)
        productBound = false
        productService.value = null
        startProductService()
        bindProductService()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        notificationsGranted.value = notificationPermissionGranted()
        val preferences = getSharedPreferences(PRODUCT_PREFERENCES, Context.MODE_PRIVATE)
        themeMode.value =
            runCatching {
                ProductThemeMode.valueOf(
                    preferences.getString(PREFERENCE_THEME_MODE, ProductThemeMode.SYSTEM.name)
                        ?: ProductThemeMode.SYSTEM.name,
                )
            }.getOrDefault(ProductThemeMode.SYSTEM)
        dynamicColor.value = preferences.getBoolean(PREFERENCE_DYNAMIC_COLOR, true)
        pendingProductTorrentUri = savedInstanceState?.getString(STATE_PENDING_TORRENT_URI)
        pendingProductCompanionRootRequestId =
            savedInstanceState?.getString(STATE_PENDING_COMPANION_ROOT_REQUEST)
        pendingProductRepairRootId =
            savedInstanceState?.getString(STATE_PENDING_COMPANION_REPAIR_ROOT)
        pendingProductCompanionCancelledRequestId =
            savedInstanceState?.getString(STATE_PENDING_COMPANION_ROOT_CANCELLED)
        pendingProductTorrentStartContent =
            savedInstanceState?.getBoolean(STATE_PENDING_TORRENT_START, true) ?: true
        pendingProductTorrentAwaitFileSelection =
            savedInstanceState?.getBoolean(STATE_PENDING_TORRENT_FILE_SELECTION, false) ?: false
        pendingBackgroundEnable =
            savedInstanceState?.getBoolean(STATE_PENDING_BACKGROUND_ENABLE, false) ?: false
        notificationNavigationSequence =
            savedInstanceState?.getLong(STATE_NOTIFICATION_SEQUENCE, 0L) ?: 0L
        notificationNavigation.value = restoreNotificationNavigation(savedInstanceState)
        route(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        pendingProductTorrentUri?.let { outState.putString(STATE_PENDING_TORRENT_URI, it) }
        pendingProductCompanionRootRequestId?.let {
            outState.putString(STATE_PENDING_COMPANION_ROOT_REQUEST, it)
        }
        pendingProductRepairRootId?.let {
            outState.putString(STATE_PENDING_COMPANION_REPAIR_ROOT, it)
        }
        pendingProductCompanionCancelledRequestId?.let {
            outState.putString(STATE_PENDING_COMPANION_ROOT_CANCELLED, it)
        }
        outState.putBoolean(STATE_PENDING_TORRENT_START, pendingProductTorrentStartContent)
        outState.putBoolean(
            STATE_PENDING_TORRENT_FILE_SELECTION,
            pendingProductTorrentAwaitFileSelection,
        )
        outState.putBoolean(STATE_PENDING_BACKGROUND_ENABLE, pendingBackgroundEnable)
        notificationNavigation.value?.let { target ->
            outState.putLong(STATE_NOTIFICATION_SEQUENCE, target.sequence)
            when (target) {
                is ProductNotificationNavigation.Torrent -> {
                    outState.putString(
                        STATE_NOTIFICATION_ROUTE,
                        AndroidNotificationContract.ROUTE_TORRENT,
                    )
                    outState.putString(STATE_NOTIFICATION_TORRENT_ID, target.torrentId)
                }
                is ProductNotificationNavigation.StorageRepair -> {
                    outState.putString(
                        STATE_NOTIFICATION_ROUTE,
                        AndroidNotificationContract.ROUTE_STORAGE_REPAIR,
                    )
                    target.rootId?.let {
                        outState.putString(STATE_NOTIFICATION_STORAGE_ROOT_ID, it)
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        route(intent)
    }

    override fun onStart() {
        super.onStart()
        ProductInteractionRegistry.setActivityVisible(this, true)
        if (productMode) {
            if (!productStartRequested) startProductService()
            bindProductService()
        }
    }

    override fun onResume() {
        super.onResume()
        notificationsGranted.value = notificationPermissionGranted()
        if (pendingNotificationSettingsReturn) {
            pendingNotificationSettingsReturn = false
            ProductInteractionRegistry.setLease(
                ProductEngineService.INTERACTION_NOTIFICATION_SETTINGS,
                false,
            )
            if (pendingBackgroundEnable && !notificationPermissionGranted()) {
                pendingBackgroundEnable = false
                productService.value?.setBackgroundDownloadsEnabled(true)
            } else if (pendingBackgroundEnable) {
                productService.value?.let { service ->
                    pendingBackgroundEnable = false
                    service.setBackgroundDownloadsEnabled(true)
                }
            }
        }
        productService.value?.refreshNotificationEligibility()
    }

    override fun onStop() {
        ProductInteractionRegistry.setActivityVisible(this, false)
        serviceStopWatch?.cancel()
        serviceStopWatch = null
        if (productBound) {
            unbindService(productConnection)
            productBound = false
            productService.value = null
        }
        productStartRequested = false
        super.onStop()
    }

    @SuppressLint("WrongConstant")
    override fun onActivityResult(
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
    ) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != TREE_REQUEST) return
        val command = pendingCommand ?: error("SAF command was not retained")
        val treeUri = data?.data
        if (resultCode != RESULT_OK || treeUri == null) {
            finish()
            return
        }
        val flags =
            data.flags and (
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        contentResolver.takePersistableUriPermission(treeUri, flags)
        command.putExtra("tree_uri", treeUri.toString())
        dispatch(command)
        pendingCommand = null
        finishIfRequested(command)
    }

    private fun route(command: Intent) {
        val routed = consumeNotificationRoute(command) ?: command
        if (isDiagnostic(routed)) {
            showDiagnosticSurface()
            handleDiagnostic(routed)
        } else {
            val productCommand = consumeExternalView(routed) ?: routed
            showProductSurface(productCommand)
        }
    }

    private fun restoreNotificationNavigation(state: Bundle?): ProductNotificationNavigation? =
        when (state?.getString(STATE_NOTIFICATION_ROUTE)) {
            AndroidNotificationContract.ROUTE_TORRENT ->
                state
                    .getString(STATE_NOTIFICATION_TORRENT_ID)
                    ?.takeIf(TORRENT_ID_PATTERN::matches)
                    ?.let {
                        ProductNotificationNavigation.Torrent(
                            notificationNavigationSequence,
                            it,
                        )
                    }
            AndroidNotificationContract.ROUTE_STORAGE_REPAIR ->
                ProductNotificationNavigation.StorageRepair(
                    notificationNavigationSequence,
                    state
                        .getString(STATE_NOTIFICATION_STORAGE_ROOT_ID)
                        ?.takeIf(::validRootId),
                )
            else -> null
        }

    private fun consumeNotificationRoute(command: Intent): Intent? {
        val action = command.action ?: return null
        val notification =
            AndroidNotificationContract.routedNotification(packageName, action) ?: return null
        getSystemService(NotificationManager::class.java).cancel(notification.tag, notification.id)
        notificationNavigationSequence += 1
        notificationNavigation.value =
            when (command.getStringExtra(AndroidNotificationContract.EXTRA_ROUTE)) {
                AndroidNotificationContract.ROUTE_TORRENT -> {
                    val torrentId =
                        command
                            .getStringExtra(AndroidNotificationContract.EXTRA_TORRENT_ID)
                            ?.takeIf(TORRENT_ID_PATTERN::matches)
                            ?: return sanitizeProductIntent()
                    ProductNotificationNavigation.Torrent(
                        notificationNavigationSequence,
                        torrentId,
                    )
                }
                AndroidNotificationContract.ROUTE_STORAGE_REPAIR ->
                    ProductNotificationNavigation.StorageRepair(
                        notificationNavigationSequence,
                        command
                            .getStringExtra(AndroidNotificationContract.EXTRA_STORAGE_ROOT_ID)
                            ?.takeIf(::validRootId),
                    )
                else -> return sanitizeProductIntent()
            }
        return sanitizeProductIntent()
    }

    private fun sanitizeProductIntent(): Intent =
        Intent(this, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addCategory(Intent.CATEGORY_LAUNCHER)
            this@MainActivity.setIntent(this)
        }

    private fun validRootId(value: String): Boolean = value.isNotBlank() && value.length <= 128

    private fun consumeExternalView(command: Intent): Intent? {
        if (command.action != Intent.ACTION_VIEW || isChromeOsCompanionLaunch(command)) {
            return null
        }
        val input =
            ExternalIntentInput(
                action = command.action,
                data = command.dataString,
                scheme = command.scheme,
                mimeType = command.type,
                path = command.data?.path,
                hasSelector = command.selector != null,
                hasClipData = command.clipData != null,
                packageOverride = command.`package`,
                hasReadGrant =
                    command.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0,
            )
        val classification = ExternalIntentClassifier.classify(input)
        if (classification == ExternalIntentClassification.NotExternalView) return null

        val serviceIntent =
            Intent(this, ProductEngineService::class.java).apply {
                action = ProductEngineService.externalIntakeAction(packageName)
                addFlags(command.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION)
                when (classification) {
                    ExternalIntentClassification.NotExternalView -> Unit
                    is ExternalIntentClassification.Rejected ->
                        putExtra(EXTRA_EXTERNAL_REJECTION, classification.reason.name)
                    is ExternalIntentClassification.Magnet ->
                        putExtra(EXTRA_EXTERNAL_SOURCE, classification.source.reveal())
                    is ExternalIntentClassification.Content -> {
                        putExtra(EXTRA_EXTERNAL_SOURCE, classification.source.reveal())
                        putExtra(EXTRA_EXTERNAL_MIME_TYPE, classification.announcedMimeType)
                    }
                }
            }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }

        val sanitized =
            Intent(this, MainActivity::class.java).apply {
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
            }
        setIntent(sanitized)
        return sanitized
    }

    private fun showProductSurface(command: Intent) {
        if (isChromeOs() && isChromeOsCompanionLaunch(command)) {
            chromeExtensionSetupVisible.value = true
            chromeExtensionSetupFailed.value = false
        }
        ProductForegroundSessionEpoch.showProductSurface()
        productService.value?.let(::recordProductForegroundIfPending)
        if (!ProductDataSyncQuotaFence.clearForUserVisibleStart(this)) {
            android.util.Log.w(
                "RSTorrentProduct",
                "product_quota_fence clear_failed=true",
            )
        }
        if (
            ProductSafDocuments.isDebuggable(this) &&
            command.getBooleanExtra(EXTRA_PRODUCT_RELEASE_SAF_GRANT, false)
        ) {
            command.removeExtra(EXTRA_PRODUCT_RELEASE_SAF_GRANT)
            ProductSafDocuments.releaseSelectedTreeForTest(this)
        }
        if (ProductSafDocuments.isDebuggable(this)) {
            command.getStringExtra(EXTRA_PRODUCT_RELEASE_SAF_ROOT)?.let { rootId ->
                command.removeExtra(EXTRA_PRODUCT_RELEASE_SAF_ROOT)
                ProductSafDocuments.releaseTreeForTest(this, rootId)
            }
        }
        if (!productMode) {
            productMode = true
            setContent {
                ProductApp(
                    service = productService.value,
                    onSelectStorage = { launchProductTreePicker() },
                    onRepairStorage = { launchProductTreePicker(it) },
                    onBrowseTorrent = ::launchProductTorrentPicker,
                    notificationsGranted = notificationsGranted.value,
                    onRequestNotifications = ::requestNotificationPermission,
                    onOpenNotificationSettings = ::openNotificationSettings,
                    onOpenFeedback = ::openFeedback,
                    onOpenPrivacy = ::openPrivacy,
                    onConnectChromeExtension = if (isChromeOs()) {
                        { chromeExtensionSetupVisible.value = true }
                    } else {
                        null
                    },
                    onShutdown = {
                        productService.value?.shutdownFromUi()
                        finishAndRemoveTask()
                    },
                    onBackgroundDownloads = ::setBackgroundDownloads,
                    notificationNavigation = notificationNavigation.value,
                    onNotificationNavigationConsumed = { sequence ->
                        if (notificationNavigation.value?.sequence == sequence) {
                            notificationNavigation.value = null
                        }
                    },
                    themeMode = themeMode.value,
                    dynamicColor = dynamicColor.value,
                    onThemeMode = ::setThemeMode,
                    onDynamicColor = ::setDynamicColor,
                )
                if (chromeExtensionSetupVisible.value) {
                    val notifications = productService.value?.state
                        ?.collectAsStateWithLifecycle()?.value?.notifications ?: ProductNotificationState()
                    ChromeExtensionSetupDialog(
                        ready = productService.value != null,
                        busy = chromeExtensionSetupBusy.value,
                        failed = chromeExtensionSetupFailed.value,
                        onOpenChrome = ::openChromeExtension,
                        notificationAction = ProductChromeExtensionSetup.notificationAction(notifications),
                        onAllowNotifications = ::requestNotificationPermission,
                        onOpenNotificationSettings = ::openNotificationSettings,
                        onDismiss = {
                            chromeExtensionSetupJob?.cancel()
                            chromeExtensionSetupVisible.value = false
                        },
                    )
                }
            }
        }
        if (ProductSafDocuments.isDebuggable(this)) {
            if (command.getBooleanExtra(EXTRA_PRODUCT_QUOTA_RESTART_EVIDENCE, false)) {
                command.removeExtra(EXTRA_PRODUCT_QUOTA_RESTART_EVIDENCE)
                val service = productService.value
                if (service == null) {
                    pendingProductQuotaRestartEvidence = true
                } else {
                    service.armProductQuotaRestartEvidenceForTest()
                }
            }
            command
                .getStringExtra(EXTRA_PRODUCT_TRACKER_HTTPS_POLICY)
                ?.takeIf(String::isNotBlank)
                ?.let {
                    command.removeExtra(EXTRA_PRODUCT_TRACKER_HTTPS_POLICY)
                    pendingProductTrackerPolicy = it
                }
            command
                .getStringExtra(EXTRA_PRODUCT_TRACKER_EVIDENCE_TORRENT)
                ?.takeIf(String::isNotBlank)
                ?.let {
                    command.removeExtra(EXTRA_PRODUCT_TRACKER_EVIDENCE_TORRENT)
                    val service = productService.value
                    if (service == null) {
                        pendingProductTrackerEvidenceTorrent = it
                    } else {
                        service.subscribeTrackerEvidenceForTest(it)
                    }
                }
            command
                .getStringExtra(EXTRA_PRODUCT_ENCRYPTION_POLICY)
                ?.takeIf(String::isNotBlank)
                ?.let {
                    command.removeExtra(EXTRA_PRODUCT_ENCRYPTION_POLICY)
                    pendingProductEncryptionPolicy = it
                }
            if (command.getBooleanExtra(EXTRA_PRODUCT_MSE_EVIDENCE, false)) {
                command.removeExtra(EXTRA_PRODUCT_MSE_EVIDENCE)
                val service = productService.value
                if (service == null) {
                    pendingProductMseEvidence = true
                } else {
                    service.logMseDhEvidenceForTest()
                }
            }
            command
                .getStringExtra(EXTRA_PRODUCT_DOWNLOAD_ADMISSION_EVIDENCE)
                ?.takeIf(String::isNotBlank)
                ?.let {
                    command.removeExtra(EXTRA_PRODUCT_DOWNLOAD_ADMISSION_EVIDENCE)
                    val service = productService.value
                    if (service == null) {
                        pendingProductDownloadAdmissionEvidence = it
                    } else {
                        service.logDownloadAdmissionEvidenceForTest(it)
                    }
                }
            command
                .getStringExtra(EXTRA_PRODUCT_SEED_ADMISSION_EVIDENCE)
                ?.takeIf(String::isNotBlank)
                ?.let {
                    command.removeExtra(EXTRA_PRODUCT_SEED_ADMISSION_EVIDENCE)
                    val service = productService.value
                    if (service == null) {
                        pendingProductSeedAdmissionEvidence = it
                    } else {
                        service.logSeedAdmissionEvidenceForTest(it)
                    }
                }
            command
                .getStringExtra(EXTRA_PRODUCT_BANDWIDTH_POLICY)
                ?.takeIf(String::isNotBlank)
                ?.let {
                    command.removeExtra(EXTRA_PRODUCT_BANDWIDTH_POLICY)
                    val service = productService.value
                    if (service == null) {
                        pendingProductBandwidthPolicy = it
                    } else {
                        service.exerciseBandwidthPolicyForTest(it)
                    }
                }
            command
                .getStringExtra(EXTRA_PRODUCT_IPV6_POLICY)
                ?.takeIf(String::isNotBlank)
                ?.let {
                    command.removeExtra(EXTRA_PRODUCT_IPV6_POLICY)
                    android.util.Log.i("RSTorrentProduct", "ipv6_settings_intent mode=$it")
                    val service = productService.value
                    if (service == null) {
                        pendingProductIpv6Policy = it
                    } else {
                        service.exerciseIpv6PolicyForTest(it)
                    }
                }
            command
                .getStringExtra(EXTRA_PRODUCT_UNMETERED_NETWORK_POLICY)
                ?.takeIf(String::isNotBlank)
                ?.let {
                    command.removeExtra(EXTRA_PRODUCT_UNMETERED_NETWORK_POLICY)
                    android.util.Log.i("RSTorrentProduct", "network_policy_intent mode=$it")
                    val service = productService.value
                    if (service == null) {
                        pendingProductUnmeteredNetworkPolicy = it
                    } else {
                        service.exerciseUnmeteredNetworkPolicyForTest(it)
                    }
                }
            command
                .getStringExtra(EXTRA_PRODUCT_LIFECYCLE_EVIDENCE)
                ?.takeIf(String::isNotBlank)
                ?.let {
                    command.removeExtra(EXTRA_PRODUCT_LIFECYCLE_EVIDENCE)
                    val service = productService.value
                    if (service == null) {
                        pendingProductLifecycleEvidence = it
                    } else {
                        service.exerciseProductLifecycleForTest(it)
                    }
                }
            command
                .getStringExtra(EXTRA_PRODUCT_TORRENT_ACTION)
                ?.takeIf(String::isNotBlank)
                ?.let { action ->
                    command.removeExtra(EXTRA_PRODUCT_TORRENT_ACTION)
                    val torrentId =
                        requireNotNull(command.getStringExtra(EXTRA_PRODUCT_TORRENT_ID)) {
                            "product torrent action has no torrent identity"
                        }
                    command.removeExtra(EXTRA_PRODUCT_TORRENT_ID)
                    val service = productService.value
                    if (service == null) {
                        pendingProductTorrentAction = torrentId to action
                    } else {
                        service.exerciseTorrentActionForTest(torrentId, action)
                    }
                }
            command
                .getStringExtra(EXTRA_PRODUCT_DATA_RESET)
                ?.let { mode ->
                    command.removeExtra(EXTRA_PRODUCT_DATA_RESET)
                    val request =
                        when (mode) {
                            "keep" -> false to null
                            "delete" -> true to null
                            "delete-kill-after-first" -> true to 1
                            else -> error("unknown product data reset mode")
                        }
                    val service = productService.value
                    if (service == null) {
                        pendingProductDataReset = request
                    } else if (request.second == null) {
                        service.clearAllData(request.first)
                    } else {
                        service.clearAllDataWithProcessKillForTest(
                            request.first,
                            requireNotNull(request.second),
                        )
                    }
                }
            command
                .getStringExtra(EXTRA_PRODUCT_TORRENT_BASE64)
                ?.takeIf(String::isNotBlank)
                ?.let { encoded ->
                    command.removeExtra(EXTRA_PRODUCT_TORRENT_BASE64)
                    val startContent =
                        command.getBooleanExtra(EXTRA_PRODUCT_START_CONTENT, true)
                    command.removeExtra(EXTRA_PRODUCT_START_CONTENT)
                    val awaitFileSelection =
                        command.getBooleanExtra(EXTRA_PRODUCT_AWAIT_FILE_SELECTION, false)
                    command.removeExtra(EXTRA_PRODUCT_AWAIT_FILE_SELECTION)
                    val selection =
                        command
                            .getStringExtra(EXTRA_PRODUCT_WANTED_FILE_RANGES)
                            ?.split(',')
                            ?.filter(String::isNotBlank)
                            ?.map { encodedRange ->
                                val (start, endExclusive) = encodedRange.split(':', limit = 2)
                                FileIndexRange(start.toUInt(), endExclusive.toUInt())
                            }
                            ?.let(FileSelectionIntent::WantedRanges)
                            ?: FileSelectionIntent.All
                    command.removeExtra(EXTRA_PRODUCT_WANTED_FILE_RANGES)
                    val service = productService.value
                    if (service == null) {
                        pendingProductTorrentBase64 = encoded
                        pendingProductTorrentStartContent = startContent
                        pendingProductTorrentAwaitFileSelection = awaitFileSelection
                        pendingProductTorrentSelection = selection
                    } else {
                        service.addTorrentBytes(
                            android.util.Base64.decode(
                                encoded,
                                android.util.Base64.DEFAULT,
                            ),
                            startContent,
                            selection,
                            awaitFileSelection,
                        )
                    }
                }
        }
        command.getStringExtra(EXTRA_PRODUCT_MAGNET)?.takeIf(String::isNotBlank)?.let {
            command.removeExtra(EXTRA_PRODUCT_MAGNET)
            val startContent = command.getBooleanExtra(EXTRA_PRODUCT_START_CONTENT, true)
            command.removeExtra(EXTRA_PRODUCT_START_CONTENT)
            val awaitFileSelection =
                command.getBooleanExtra(EXTRA_PRODUCT_AWAIT_FILE_SELECTION, false)
            command.removeExtra(EXTRA_PRODUCT_AWAIT_FILE_SELECTION)
            val skipFiles =
                command
                    .getStringExtra(EXTRA_PRODUCT_SKIP_FILES)
                    ?.split(',')
                    ?.filter(String::isNotBlank)
                    ?.map(String::toUInt)
                    .orEmpty()
            command.removeExtra(EXTRA_PRODUCT_SKIP_FILES)
            val service = productService.value
            if (service == null) {
                pendingProductMagnet = it
                pendingProductStartContent = startContent
                pendingProductAwaitFileSelection = awaitFileSelection
                pendingProductSkipFiles = skipFiles
            } else {
                val policy = pendingProductTrackerPolicy
                pendingProductTrackerPolicy = null
                val encryption = pendingProductEncryptionPolicy
                pendingProductEncryptionPolicy = null
                when {
                    policy != null ->
                        service.addMagnetWithTrackerPolicyForTest(it, policy, startContent)
                    encryption != null ->
                        service.addMagnetWithEncryptionPolicyForTest(it, encryption, skipFiles)
                    else -> service.addMagnet(it, skipFiles, startContent, awaitFileSelection)
                }
            }
        }
        startProductService(
            if (isChromeOsCompanionLaunch(command)) {
                ProductEngineService.ACTION_ENABLE_CHROMEOS_COMPANION
            } else {
                null
            },
        )
        command.getStringExtra(EXTRA_COMPANION_ROOT_REQUEST)?.let { requestId ->
            command.removeExtra(EXTRA_COMPANION_ROOT_REQUEST)
            pendingProductCompanionRootRequestId = requestId
            val repairRootId = command.getStringExtra(EXTRA_COMPANION_REPAIR_ROOT)
            command.removeExtra(EXTRA_COMPANION_REPAIR_ROOT)
            launchProductTreePicker(repairRootId)
        }
        if (
            ProductSafDocuments.isDebuggable(this) &&
            command.getBooleanExtra(EXTRA_PRODUCT_SELECT_SAF, false)
        ) {
            command.removeExtra(EXTRA_PRODUCT_SELECT_SAF)
            launchProductTreePicker()
        }
        if (lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) {
            bindProductService()
        }
    }

    private fun recordProductForegroundIfPending(service: ProductEngineService) {
        if (ProductForegroundSessionEpoch.claimCurrent()) {
            service.recordProductForegroundSession()
        }
    }

    override fun onDestroy() {
        if (isFinishing) ProductForegroundSessionEpoch.hideProductSurface()
        super.onDestroy()
    }

    private fun showDiagnosticSurface() {
        ProductForegroundSessionEpoch.hideProductSurface()
        if (productMode) {
            productMode = false
            productStartRequested = false
            if (productBound) {
                unbindService(productConnection)
                productBound = false
                productService.value = null
            }
        }
        setContentView(
            TextView(this).apply {
                text = getString(R.string.engine_bootstrap_name)
                textSize = 18f
                setPadding(32, 32, 32, 32)
            },
        )
    }

    private fun handleDiagnostic(command: Intent) {
        val storage = command.getStringExtra("storage") ?: "private"
        if (
            (command.action ?: BootstrapContract.ACTION_START) ==
                BootstrapContract.ACTION_START &&
            storage.startsWith("saf-") &&
            command.getStringExtra("tree_uri") == null
        ) {
            pendingCommand = Intent(command)
            val picker =
                Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
                    val initial =
                        command.getStringExtra("tree_initial_uri")
                            ?: "content://com.android.externalstorage.documents/document/primary%3ADownload"
                    putExtra(
                        "android.provider.extra.INITIAL_URI",
                        android.net.Uri.parse(initial),
                    )
                }
            startActivityForResult(picker, TREE_REQUEST)
            return
        }
        dispatch(command)
        finishIfRequested(command)
    }

    private fun startProductService(action: String? = null) {
        val serviceIntent =
            Intent(this, ProductEngineService::class.java)
                .setAction(action)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
        productStartRequested = true
    }

    private fun launchProductTreePicker(repairRootId: String? = null) {
        pendingProductRepairRootId = repairRootId
        ProductInteractionRegistry.setLease(
            ProductEngineService.INTERACTION_SAF_PICKER,
            true,
        )
        try {
            productTreePicker.launch(
                Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
                    putExtra(
                        "android.provider.extra.INITIAL_URI",
                        android.net.Uri.parse(
                            "content://com.android.externalstorage.documents/document/" +
                                "primary%3ADownload",
                        ),
                    )
                },
            )
        } catch (error: RuntimeException) {
            ProductInteractionRegistry.setLease(
                ProductEngineService.INTERACTION_SAF_PICKER,
                false,
            )
            throw error
        }
    }

    private fun launchProductTorrentPicker(awaitFileSelection: Boolean) {
        pendingProductTorrentAwaitFileSelection = awaitFileSelection
        ProductInteractionRegistry.setLease(
            ProductEngineService.INTERACTION_TORRENT_PICKER,
            true,
        )
        try {
            productTorrentPicker.launch(
                Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "application/x-bittorrent"
                    putExtra(
                        Intent.EXTRA_MIME_TYPES,
                        arrayOf("application/x-bittorrent", "application/octet-stream"),
                    )
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                },
            )
        } catch (error: RuntimeException) {
            ProductInteractionRegistry.setLease(
                ProductEngineService.INTERACTION_TORRENT_PICKER,
                false,
            )
            throw error
        }
    }

    private fun bindProductService() {
        if (productBound) return
        productBound =
            bindService(
                Intent(this, ProductEngineService::class.java),
                productConnection,
                Context.BIND_AUTO_CREATE,
            )
    }

    private fun requestNotificationPermission() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            ProductInteractionRegistry.setLease(
                ProductEngineService.INTERACTION_NOTIFICATION_PERMISSION,
                true,
            )
            try {
                notificationPermissionRequest.launch(Manifest.permission.POST_NOTIFICATIONS)
            } catch (error: RuntimeException) {
                ProductInteractionRegistry.setLease(
                    ProductEngineService.INTERACTION_NOTIFICATION_PERMISSION,
                    false,
                )
                throw error
            }
        } else {
            notificationsGranted.value = true
            productService.value?.refreshNotificationEligibility()
        }
    }

    private fun setBackgroundDownloads(enabled: Boolean) {
        val service = productService.value ?: return
        if (!enabled) {
            pendingBackgroundEnable = false
            service.setBackgroundDownloadsEnabled(false)
            return
        }
        if (!notificationPermissionGranted()) {
            pendingBackgroundEnable = true
            requestNotificationPermission()
            return
        }
        val notifications = service.state.value.notifications
        if (!notifications.appNotificationsEnabled || !notifications.backgroundChannelEnabled) {
            pendingBackgroundEnable = true
            openNotificationSettings()
            return
        }
        pendingBackgroundEnable = false
        service.setBackgroundDownloadsEnabled(true)
    }

    private fun notificationPermissionGranted(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun openNotificationSettings() {
        ProductInteractionRegistry.setLease(
            ProductEngineService.INTERACTION_NOTIFICATION_SETTINGS,
            true,
        )
        pendingNotificationSettingsReturn = true
        runCatching {
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                    putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                },
            )
        }.onFailure {
            pendingNotificationSettingsReturn = false
            pendingBackgroundEnable = false
            ProductInteractionRegistry.setLease(
                ProductEngineService.INTERACTION_NOTIFICATION_SETTINGS,
                false,
            )
        }
    }

    private fun openFeedback(includeStatistics: Boolean, expectedUrl: String) {
        val service = productService.value ?: return
        lifecycleScope.launch {
            runCatching {
                service.confirmProductFeedback(includeStatistics, expectedUrl)
            }.onSuccess { url ->
                AndroidFeedbackLauncher.launchReviewed(
                    url = url,
                    startExternalActivity = ::startActivity,
                    onFailure = ::showFeedbackFailure,
                )
            }.onFailure { showFeedbackFailure() }
        }
    }

    private fun showFeedbackFailure() {
        Toast.makeText(this, R.string.feedback_open_failed, Toast.LENGTH_LONG).show()
    }

    private fun openPrivacy() {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PRODUCT_PRIVACY_URL)))
        }.onFailure { showFeedbackFailure() }
    }

    private fun setThemeMode(mode: ProductThemeMode) {
        themeMode.value = mode
        getSharedPreferences(PRODUCT_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(PREFERENCE_THEME_MODE, mode.name)
            .apply()
    }

    private fun setDynamicColor(enabled: Boolean) {
        dynamicColor.value = enabled
        getSharedPreferences(PRODUCT_PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(PREFERENCE_DYNAMIC_COLOR, enabled)
            .apply()
    }

    private fun isDiagnostic(command: Intent): Boolean =
        command.action in
            setOf(
                BootstrapContract.ACTION_START,
                BootstrapContract.ACTION_CANCEL,
                BootstrapContract.ACTION_OBSERVE,
                BootstrapContract.ACTION_VERIFY,
            )

    private fun isChromeOs(): Boolean =
        packageManager.hasSystemFeature("org.chromium.arc") ||
            packageManager.hasSystemFeature("org.chromium.arc.device_management")

    private fun openChromeExtension() {
        if (!isChromeOs() || chromeExtensionSetupBusy.value) return
        val service = productService.value ?: return
        chromeExtensionSetupBusy.value = true
        chromeExtensionSetupFailed.value = false
        chromeExtensionSetupJob = lifecycleScope.launch {
            try {
                service.prepareChromeExtensionSetup()
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(ProductChromeExtensionSetup.HANDOFF_URL)))
                chromeExtensionSetupVisible.value = false
            } catch (canceled: CancellationException) {
                throw canceled
            } catch (_: Exception) {
                // No raw transport/platform error or URL authority enters UI.
                chromeExtensionSetupFailed.value = true
            } finally {
                chromeExtensionSetupBusy.value = false
            }
        }
    }

    private fun isChromeOsCompanionLaunch(command: Intent): Boolean {
        val uri = command.data ?: return false
        return command.action == Intent.ACTION_VIEW &&
            ProductChromeExtensionSetup.acceptsLaunch(
                uri.scheme, uri.host, uri.path, uri.query, uri.fragment, uri.port, uri.userInfo,
            )
    }

    private fun finishIfRequested(command: Intent) {
        if (command.getBooleanExtra("finish_activity", false)) {
            finish()
        }
    }

    private fun dispatch(command: Intent) {
        val serviceIntent =
            Intent(this, EngineService::class.java).apply {
                action = command.action ?: BootstrapContract.ACTION_START
                replaceExtras(command.extras ?: Bundle())
            }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
    }

    companion object {
        private const val PRODUCT_PRIVACY_URL = "https://jstorrent.com/privacy.html"
        private const val TREE_REQUEST = 51
        private const val PRODUCT_PREFERENCES = "product_ui"
        private const val PREFERENCE_THEME_MODE = "theme_mode"
        private const val PREFERENCE_DYNAMIC_COLOR = "dynamic_color"
        private const val STATE_PENDING_TORRENT_URI = "pending_torrent_uri"
        private const val STATE_PENDING_TORRENT_START = "pending_torrent_start"
        private const val STATE_PENDING_TORRENT_FILE_SELECTION =
            "pending_torrent_file_selection"
        private const val STATE_PENDING_BACKGROUND_ENABLE = "pending_background_enable"
        private const val STATE_PENDING_COMPANION_ROOT_REQUEST =
            "pending_companion_root_request"
        private const val STATE_PENDING_COMPANION_REPAIR_ROOT =
            "pending_companion_repair_root"
        private const val STATE_PENDING_COMPANION_ROOT_CANCELLED =
            "pending_companion_root_cancelled"
        private const val STATE_NOTIFICATION_SEQUENCE = "notification_sequence"
        private const val STATE_NOTIFICATION_ROUTE = "notification_route"
        private const val STATE_NOTIFICATION_TORRENT_ID = "notification_torrent_id"
        private const val STATE_NOTIFICATION_STORAGE_ROOT_ID = "notification_storage_root_id"
        private val TORRENT_ID_PATTERN = Regex("^t1-[0-9a-f]{32}$")
        const val EXTRA_PRODUCT_MAGNET = "product_magnet"
        const val EXTRA_PRODUCT_TRACKER_HTTPS_POLICY = "product_tracker_https_policy"
        const val EXTRA_PRODUCT_ENCRYPTION_POLICY = "product_encryption_policy"
        const val EXTRA_PRODUCT_MSE_EVIDENCE = "product_mse_evidence"
        const val EXTRA_PRODUCT_DOWNLOAD_ADMISSION_EVIDENCE =
            "product_download_admission_evidence"
        const val EXTRA_PRODUCT_SEED_ADMISSION_EVIDENCE =
            "product_seed_admission_evidence"
        const val EXTRA_PRODUCT_BANDWIDTH_POLICY = "product_bandwidth_policy"
        const val EXTRA_PRODUCT_IPV6_POLICY = "product_ipv6_policy"
        const val EXTRA_PRODUCT_UNMETERED_NETWORK_POLICY =
            "product_unmetered_network_policy"
        const val EXTRA_PRODUCT_LIFECYCLE_EVIDENCE = "product_lifecycle_evidence"
        const val EXTRA_PRODUCT_QUOTA_RESTART_EVIDENCE =
            "product_quota_restart_evidence"
        const val EXTRA_PRODUCT_TORRENT_ACTION = "product_torrent_action"
        const val EXTRA_PRODUCT_TORRENT_ID = "product_torrent_id"
        const val EXTRA_PRODUCT_DATA_RESET = "product_data_reset"
        const val EXTRA_PRODUCT_TORRENT_BASE64 = "product_torrent_base64"
        const val EXTRA_PRODUCT_WANTED_FILE_RANGES = "product_wanted_file_ranges"
        const val EXTRA_PRODUCT_START_CONTENT = "product_start_content"
        const val EXTRA_PRODUCT_AWAIT_FILE_SELECTION = "product_await_file_selection"
        const val EXTRA_PRODUCT_SKIP_FILES = "product_skip_files"
        const val EXTRA_PRODUCT_TRACKER_EVIDENCE_TORRENT = "product_tracker_evidence_torrent"
        const val EXTRA_PRODUCT_SELECT_SAF = "product_select_saf"
        const val EXTRA_PRODUCT_RELEASE_SAF_GRANT = "product_release_saf_grant"
        const val EXTRA_PRODUCT_RELEASE_SAF_ROOT = "product_release_saf_root"
        const val EXTRA_COMPANION_ROOT_REQUEST = "companion_root_request"
        const val EXTRA_COMPANION_REPAIR_ROOT = "companion_repair_root"
        const val EXTRA_EXTERNAL_SOURCE = "external_intake_source"
        const val EXTRA_EXTERNAL_MIME_TYPE = "external_intake_mime_type"
        const val EXTRA_EXTERNAL_REJECTION = "external_intake_rejection"
    }
}
