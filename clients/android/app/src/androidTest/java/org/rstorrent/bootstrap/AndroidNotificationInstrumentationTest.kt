package org.rstorrent.bootstrap

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters
import org.rstorrent.session.uniffi.ApplicationNetworkPrerequisiteView
import org.rstorrent.session.uniffi.ApplicationNetworkRuntimeState
import org.rstorrent.session.uniffi.ApplicationNetworkRuntimeView
import org.rstorrent.session.uniffi.ActiveSeedLimit
import org.rstorrent.session.uniffi.ProgressAssessment
import org.rstorrent.session.uniffi.AdvertisedPeerEndpointStatus
import org.rstorrent.session.uniffi.BandwidthDirectionRuntimeView
import org.rstorrent.session.uniffi.BandwidthRuntimeView
import org.rstorrent.session.uniffi.ClientSettings
import org.rstorrent.session.uniffi.ClientSettingsApplicationState
import org.rstorrent.session.uniffi.ClientSettingsRuntimeView
import org.rstorrent.session.uniffi.EffectiveListenerSettings
import org.rstorrent.session.uniffi.EncryptionPolicy
import org.rstorrent.session.uniffi.HttpsServerAuthenticationPolicy
import org.rstorrent.session.uniffi.Ipv6PinholeStatus
import org.rstorrent.session.uniffi.ListenerPolicy
import org.rstorrent.session.uniffi.ListenerStatus
import org.rstorrent.session.uniffi.PortMappingPolicy
import org.rstorrent.session.uniffi.PortMappingStatus
import org.rstorrent.session.uniffi.ProgressDisposition
import org.rstorrent.session.uniffi.ProgressPhase
import org.rstorrent.session.uniffi.ProgressReason
import org.rstorrent.session.uniffi.SeedAdmissionView
import org.rstorrent.session.uniffi.SessionUdpStatus
import org.rstorrent.session.uniffi.StorageSettingsSnapshot
import org.rstorrent.session.uniffi.StorageState
import org.rstorrent.session.uniffi.TorrentEtaView
import org.rstorrent.session.uniffi.TorrentLifetimeView
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.TorrentProtocolIdentities
import org.rstorrent.session.uniffi.TorrentState
import org.rstorrent.session.uniffi.TorrentSeedingView
import org.rstorrent.session.uniffi.TorrentTransferLimits
import org.rstorrent.session.uniffi.TorrentView
import org.rstorrent.session.uniffi.TransferRateLimit
import org.rstorrent.session.uniffi.ViewPatch
import org.rstorrent.session.uniffi.ViewSnapshot
import org.rstorrent.session.uniffi.ViewUpdate
import org.rstorrent.session.uniffi.ViewUpdatePayload

@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class AndroidNotificationInstrumentationTest {
    @get:Rule
    val notificationPermission = NotificationPermissionRule()

    private lateinit var context: Context
    private lateinit var manager: NotificationManager

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        manager = context.getSystemService(NotificationManager::class.java)
        clearAutomaticNotifications()
        ProductNotificationPreferenceStore(context).apply {
            write(ProductNotificationPreference.DOWNLOAD_COMPLETE, true)
            write(ProductNotificationPreference.NEEDS_ATTENTION, true)
        }
    }

    @After
    fun tearDown() {
        clearAutomaticNotifications()
        ProductNotificationPreferenceStore(context).apply {
            write(ProductNotificationPreference.DOWNLOAD_COMPLETE, true)
            write(ProductNotificationPreference.NEEDS_ATTENTION, true)
        }
    }

    @Test
    fun aCreatesThreeTruthfulChannelsWithoutChangingUserPolicy() {
        val coordinator = coordinator()

        val background =
            requireNotNull(
                manager.getNotificationChannel(AndroidNotificationContract.BACKGROUND_CHANNEL_ID),
            )
        val completion =
            requireNotNull(
                manager.getNotificationChannel(AndroidNotificationContract.COMPLETION_CHANNEL_ID),
            )
        val attention =
            requireNotNull(
                manager.getNotificationChannel(AndroidNotificationContract.ATTENTION_CHANNEL_ID),
            )
        assertEquals(NotificationManager.IMPORTANCE_LOW, background.importance)
        assertFalse(background.canShowBadge())
        assertNull(background.sound)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, completion.importance)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, attention.importance)

        coordinator.close()
    }

    @Test
    fun bPostsOpaqueExactCompletionAndAttentionNotifications() {
        val state = MutableStateFlow(ProductState())
        val coordinator = coordinator(state)
        val initial = torrent(ID, TorrentState.DOWNLOADING, received = 0UL)
        val baseline = ProductState(ready = true, torrents = mapOf(ID to initial))
        state.value = baseline
        coordinator.onTorrentListUpdate(snapshot(listOf(initial)), baseline)

        val complete = initial.copy(state = TorrentState.COMPLETE, receivedBytes = "1")
        val completeState = baseline.copy(torrents = mapOf(ID to complete))
        state.value = completeState
        coordinator.onTorrentListUpdate(patch(listOf(complete)), completeState)

        val completion = waitForAutomaticNotification("rstorrent-download_complete-")
        assertFalse(requireNotNull(completion.tag).contains(ID))
        assertEquals(
            "Download complete",
            completion.notification.extras.getCharSequence(Notification.EXTRA_TITLE),
        )
        assertEquals(
            "Fixture torrent finished downloading",
            completion.notification.extras.getCharSequence(Notification.EXTRA_TEXT),
        )
        assertEquals(context.packageName, completion.notification.contentIntent.creatorPackage)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            assertTrue(completion.notification.contentIntent.isImmutable)
        }

        val repaired = complete.copy(state = TorrentState.PAUSED, receivedBytes = "1")
        coordinator.onTorrentListUpdate(
            patch(listOf(repaired)),
            completeState.copy(torrents = mapOf(ID to repaired)),
        )
        val attentionRow = repaired.copy(storageState = StorageState.NEEDS_REPAIR)
        val attentionState = completeState.copy(torrents = mapOf(ID to attentionRow))
        state.value = attentionState
        coordinator.onTorrentListUpdate(patch(listOf(attentionRow)), attentionState)

        val attention = waitForAutomaticNotification("rstorrent-needs_attention-")
        assertFalse(requireNotNull(attention.tag).contains(ID))
        assertEquals(
            "Download needs attention",
            attention.notification.extras.getCharSequence(Notification.EXTRA_TITLE),
        )
        assertEquals(
            "Fixture torrent · Open JSTorrent for details",
            attention.notification.extras.getCharSequence(Notification.EXTRA_TEXT),
        )
        assertEquals(context.packageName, attention.notification.contentIntent.creatorPackage)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            assertTrue(attention.notification.contentIntent.isImmutable)
        }

        coordinator.close()
    }

    @Test
    fun cPersistsPreferenceBeforeSuppressingWithoutEnableReplay() {
        val state = MutableStateFlow(ProductState())
        val coordinator = coordinator(state)
        val store = ProductNotificationPreferenceStore(context)
        try {
            coordinator.setPreference(
                ProductNotificationPreference.DOWNLOAD_COMPLETE,
                false,
                1,
            )
            assertFalse(state.value.notifications.preferences.downloadComplete)
            assertFalse(store.read().downloadComplete)

            val initial = torrent(ID, TorrentState.DOWNLOADING, received = 0UL)
            val baseline = ProductState(ready = true, torrents = mapOf(ID to initial))
            state.value = baseline
            coordinator.onTorrentListUpdate(snapshot(listOf(initial)), baseline)
            val progress = initial.copy(receivedBytes = "1")
            val progressState = baseline.copy(torrents = mapOf(ID to progress))
            state.value = progressState
            coordinator.onTorrentListUpdate(patch(listOf(progress)), progressState)
            val complete = progress.copy(state = TorrentState.COMPLETE)
            val completeState = baseline.copy(torrents = mapOf(ID to complete))
            state.value = completeState
            coordinator.onTorrentListUpdate(patch(listOf(complete)), completeState)
            SystemClock.sleep(300L)
            assertEquals(
                0,
                manager.activeNotifications.count {
                    it.tag?.startsWith("rstorrent-download_complete-") == true
                },
            )

            coordinator.setPreference(
                ProductNotificationPreference.DOWNLOAD_COMPLETE,
                true,
                1,
            )
            SystemClock.sleep(300L)
            assertTrue(store.read().downloadComplete)
            assertEquals(
                0,
                manager.activeNotifications.count {
                    it.tag?.startsWith("rstorrent-download_complete-") == true
                },
            )
        } finally {
            store.write(ProductNotificationPreference.DOWNLOAD_COMPLETE, true)
            coordinator.close()
        }
    }

    @Test
    fun zEvictsOnlyTheOldestAutomaticNotificationInItsCategory() {
        val state = MutableStateFlow(ProductState())
        val coordinator = coordinator(state)
        val initial =
            (0 until 33).map { index ->
                torrent(torrentId(index), TorrentState.PAUSED, received = 0UL)
            }
        val baseline = ProductState(ready = true, torrents = initial.associateBy { it.torrentId })
        state.value = baseline
        coordinator.onTorrentListUpdate(snapshot(initial), baseline)
        var rows = baseline.torrents
        initial.forEach { row ->
            val error = row.copy(state = TorrentState.ERROR, error = "hidden")
            rows = rows + (row.torrentId to error)
            val errorState = baseline.copy(torrents = rows)
            state.value = errorState
            coordinator.onTorrentListUpdate(patch(listOf(error)), errorState)
            SystemClock.sleep(250L)
        }

        val deadline = SystemClock.elapsedRealtime() + 5_000L
        var active = emptyList<android.service.notification.StatusBarNotification>()
        while (SystemClock.elapsedRealtime() < deadline) {
            active =
                manager.activeNotifications.filter {
                    it.tag?.startsWith("rstorrent-needs_attention-") == true
                }
            if (active.size == 32) {
                break
            }
            SystemClock.sleep(50L)
        }
        assertEquals(32, active.size)
        assertFalse(
            active.any {
                it.tag ==
                    productNotificationTag(
                        ProductNotificationCategory.NEEDS_ATTENTION,
                        initial.first().torrentId,
                    )
            },
        )
        assertTrue(
            active.any {
                it.tag ==
                    productNotificationTag(
                        ProductNotificationCategory.NEEDS_ATTENTION,
                        initial.last().torrentId,
                    )
            },
        )
        assertEquals(
            0,
            manager.activeNotifications.count {
                it.tag?.startsWith("rstorrent-download_complete-") == true
            },
        )

        coordinator.close()
    }

    private fun coordinator(
        state: MutableStateFlow<ProductState> = MutableStateFlow(ProductState()),
    ): AndroidNotificationCoordinator =
        AndroidNotificationCoordinator(context, state).also { it.initialize(1) }

    private fun clearAutomaticNotifications() {
        manager.activeNotifications
            .filter { it.tag?.startsWith("rstorrent-") == true }
            .forEach { manager.cancel(it.tag, it.id) }
        val deadline = SystemClock.elapsedRealtime() + 5_000L
        while (
            manager.activeNotifications.any { it.tag?.startsWith("rstorrent-") == true } &&
            SystemClock.elapsedRealtime() < deadline
        ) {
            SystemClock.sleep(25L)
        }
    }

    private fun waitForAutomaticNotification(
        prefix: String,
    ): android.service.notification.StatusBarNotification {
        val deadline = SystemClock.elapsedRealtime() + 5_000L
        while (SystemClock.elapsedRealtime() < deadline) {
            manager.activeNotifications.singleOrNull {
                it.tag?.startsWith(prefix) == true
            }?.let { return it }
            SystemClock.sleep(25L)
        }
        throw AssertionError("notification with prefix $prefix was not active")
    }

    private fun snapshot(torrents: List<TorrentView>) =
        ViewUpdate(
            2U.toUShort(),
            "torrent-list",
            "epoch",
            "1",
            "0",
            "1",
            ViewUpdatePayload.Snapshot(
                ViewSnapshot.TorrentList(torrents, storage(), clientSettings()),
            ),
        )

    private fun patch(torrents: List<TorrentView>) =
        ViewUpdate(
            2U.toUShort(),
            "torrent-list",
            "epoch",
            "2",
            "1",
            "2",
            ViewUpdatePayload.Patch(
                ViewPatch.TorrentList(torrents, emptyList(), emptyList(), null, null),
            ),
        )

    private fun torrent(
        id: String,
        state: TorrentState,
        received: ULong,
    ) =
        TorrentView(
            torrentId = id,
            protocolIdentities = TorrentProtocolIdentities(v1 = null, v2 = null),
            displayName = "Fixture torrent",
            sourceDisplayName = null,
            sourceSizeBytes = null,
            state = state,
            operationalState = TorrentOperationalState.DOWNLOADING,
            downloadQueuePosition = null,
            transferLimits =
                TorrentTransferLimits(TransferRateLimit.Unlimited, TransferRateLimit.Unlimited),
            storageState = StorageState.AVAILABLE,
            storageRoot = "downloads",
            metadataAvailable = true,
            privateTorrent = false,
            awaitingFileSelection = false,
            pendingFileSelectionPosition = null,
            fileCatalogId = null,
            selectableFileCount = 0U,
            selectedFileCount = 0U,
            selectableFileBytes = "0",
            selectedFileBytes = "0",
            pieceCount = 1U,
            totalSizeBytes = "1",
            verifiedPieceCount = 0U,
            requestedBytes = received.toString(),
            receivedBytes = received.toString(),
            storedBytes = received.toString(),
            activePeerConnections = 0U,
            configuredTrackerCount = 0U,
            payloadDownloadRateBytes = "0",
            requiredPayloadBytes = "1",
            remainingPayloadBytes = "1",
            etaPayloadDownloadRateBytes = "0",
            eta = TorrentEtaView.Unavailable,
            lifetime = TorrentLifetimeView("0", received.toString(), "0", "0", "0", "0"),
            seeding = TorrentSeedingView(SeedAdmissionView.INELIGIBLE, null, null),
            progress =
                ProgressAssessment(
                    ProgressDisposition.ACTIVE,
                    ProgressPhase.TRANSFER,
                    ProgressReason.TRANSFERRING_PIECES,
                    emptyList(),
                ),
            checking = null,
            archived = false,
            removalState = null,
            deleteDataSupported = true,
            forceRecheckAvailable = true,
            error = null,
        )

    private fun torrentId(index: Int): String = "t1-${index.toString(16).padStart(32, '0')}"

    private fun storage(): StorageSettingsSnapshot =
        StorageSettingsSnapshot(emptyList(), null, false, true)

    private fun clientSettings(): ClientSettingsRuntimeView {
        val configured =
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
                trackerHttpsServerAuthentication = HttpsServerAuthenticationPolicy.SYSTEM_TRUST,
            )
        return ClientSettingsRuntimeView(
            configured = configured,
            applicationNetwork = allowedApplicationNetwork(),
            effectiveListener =
                EffectiveListenerSettings(
                    listener = ListenerPolicy.Disabled,
                    preferredListenPort = 6_881U.toUShort(),
                ),
            effectivePortMapping = PortMappingPolicy.DISABLED,
            effectivePeerConnectionLimit = 200U,
            effectiveUploadSlots = 8U.toUShort(),
            effectiveActiveDownloads = 3U.toUShort(),
            effectiveActiveSeeds = configured.activeSeeds,
            effectiveUploadRateLimit = TransferRateLimit.Unlimited,
            effectiveDownloadRateLimit = TransferRateLimit.Unlimited,
            activeDownloadsClampReason = null,
            activeDownloadCount = 0U.toUShort(),
            checkingCount = 0U.toUShort(),
            activeSeedCount = 0U.toUShort(),
            inactiveSeedCount = 0U.toUShort(),
            effectiveEncryption = EncryptionPolicy.ALLOW,
            effectiveIpv6Enabled = true,
            effectiveDhtEnabled = true,
            effectivePeerExchangeEnabled = true,
            effectiveTrackerHttpsServerAuthentication =
                HttpsServerAuthenticationPolicy.SYSTEM_TRUST,
            transportApplication = ClientSettingsApplicationState.Applied,
            portMappingApplication = ClientSettingsApplicationState.Applied,
            peerConnectionsApplication = ClientSettingsApplicationState.Applied,
            uploadSlotsApplication = ClientSettingsApplicationState.Applied,
            bandwidthApplication = ClientSettingsApplicationState.Applied,
            bandwidth = BandwidthRuntimeView(bandwidthDirection(), bandwidthDirection()),
            encryptionApplication = ClientSettingsApplicationState.Applied,
            ipv6Application = ClientSettingsApplicationState.Applied,
            dhtApplication = ClientSettingsApplicationState.Applied,
            peerExchangeApplication = ClientSettingsApplicationState.Applied,
            trackerHttpsAuthenticationApplication = ClientSettingsApplicationState.Applied,
            listenerStatus = ListenerStatus.Disabled,
            sessionUdpStatus = SessionUdpStatus.Unavailable,
            portMappingStatus = PortMappingStatus.Disabled,
            udpPortMappingStatus = PortMappingStatus.Disabled,
            ipv6PinholeStatus = Ipv6PinholeStatus.Disabled,
            advertisedPeerEndpoint = AdvertisedPeerEndpointStatus.Unavailable,
            transportFamilies = emptyList(),
        )
    }

    private fun allowedApplicationNetwork(): ApplicationNetworkRuntimeView =
        ApplicationNetworkRuntimeView(
            requestedGeneration = "1",
            requestedPrerequisite = ApplicationNetworkPrerequisiteView.ALLOWED,
            effectiveGeneration = "1",
            effectivePrerequisite = ApplicationNetworkPrerequisiteView.ALLOWED,
            state = ApplicationNetworkRuntimeState.ALLOWED,
            degradedDetail = null,
        )

    private fun bandwidthDirection(): BandwidthDirectionRuntimeView =
        BandwidthDirectionRuntimeView(
            registeredTorrents = 0U,
            activeWaiters = 0U,
            queuedRequestedBytes = "0",
            grantedBytes = "0",
            returnedBytes = "0",
            cancelledRequests = "0",
            throttleWaitMicros = "0",
            throttleWaitHighWaterMicros = "0",
            currentBurstCreditBytes = "0",
        )

    companion object {
        private const val ID = "t1-0123456789abcdef0123456789abcdef"
    }
}
