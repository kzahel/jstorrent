package org.rstorrent.bootstrap

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import org.rstorrent.bootstrap.ui.formatRate
import org.rstorrent.session.uniffi.ProgressReason
import org.rstorrent.session.uniffi.SpeedMetric
import org.rstorrent.session.uniffi.TorrentOperationalState
import org.rstorrent.session.uniffi.ViewPatch
import org.rstorrent.session.uniffi.ViewSnapshot
import org.rstorrent.session.uniffi.ViewUpdate
import org.rstorrent.session.uniffi.ViewUpdatePayload

internal object AndroidNotificationContract {
    const val BACKGROUND_CHANNEL_ID = "rstorrent-product"
    const val COMPLETION_CHANNEL_ID = "rstorrent-downloads-completed"
    const val ATTENTION_CHANNEL_ID = "rstorrent-action-required"
    const val ONGOING_NOTIFICATION_ID = 42
    const val COMPANION_ROOT_NOTIFICATION_ID = 43
    const val COMPLETION_NOTIFICATION_ID = 44
    const val ATTENTION_NOTIFICATION_ID = 45
    const val EXTRA_TORRENT_ID = "notification_torrent_id"
    const val EXTRA_ROUTE = "notification_route"
    const val EXTRA_STORAGE_ROOT_ID = "notification_storage_root_id"
    const val ROUTE_TORRENT = "torrent"
    const val ROUTE_STORAGE_REPAIR = "storage_repair"

    fun routeAction(
        packageName: String,
        opaqueTag: String,
    ): String = "$packageName.action.NOTIFICATION_ROUTE.$opaqueTag"

    fun routedNotification(
        packageName: String,
        action: String,
    ): ProductNotificationIdentity? {
        val prefix = "$packageName.action.NOTIFICATION_ROUTE."
        if (!action.startsWith(prefix)) return null
        val tag = action.removePrefix(prefix)
        val category =
            ProductNotificationCategory.entries.firstOrNull { category ->
                val tagPrefix = productNotificationTagPrefix(category)
                tag.startsWith(tagPrefix) &&
                    OPAQUE_TAG_SUFFIX.matches(tag.removePrefix(tagPrefix))
            } ?: return null
        return ProductNotificationIdentity(tag, eventNotificationId(category))
    }

    private val OPAQUE_TAG_SUFFIX = Regex("[0-9a-f]{64}")
}

internal data class ProductNotificationIdentity(
    val tag: String,
    val id: Int,
)

internal class ProductNotificationPreferenceStore(context: Context) {
    private val preferences =
        context.getSharedPreferences(PREFERENCE_FILE, Context.MODE_PRIVATE)

    fun read(): ProductNotificationPreferences =
        ProductNotificationPreferences(
            downloadComplete = preferences.getBoolean(KEY_DOWNLOAD_COMPLETE, true),
            needsAttention = preferences.getBoolean(KEY_NEEDS_ATTENTION, true),
        )

    fun write(
        preference: ProductNotificationPreference,
        enabled: Boolean,
    ): Boolean =
        preferences
            .edit()
            .putBoolean(
                when (preference) {
                    ProductNotificationPreference.DOWNLOAD_COMPLETE -> KEY_DOWNLOAD_COMPLETE
                    ProductNotificationPreference.NEEDS_ATTENTION -> KEY_NEEDS_ATTENTION
                },
                enabled,
            ).commit()

    fun reset(): Boolean = preferences.edit().clear().commit()

    companion object {
        private const val PREFERENCE_FILE = "product_notifications"
        private const val KEY_DOWNLOAD_COMPLETE = "notify_download_complete"
        private const val KEY_NEEDS_ATTENTION = "notify_needs_attention"
    }
}

/** Owns Android notification channels, delivery, and the pure torrent-edge policy. */
internal class AndroidNotificationCoordinator(
    private val context: Context,
    private val state: MutableStateFlow<ProductState>,
    private val manager: NotificationManager =
        context.getSystemService(NotificationManager::class.java),
    private val preferenceStore: ProductNotificationPreferenceStore =
        ProductNotificationPreferenceStore(context),
) {
    private val policy = AndroidNotificationPolicy()
    private var preferences = preferenceStore.read()
    private val submittedTags =
        ProductNotificationCategory.entries.associateWith { ArrayDeque<String>() }

    fun initialize(interactionLeaseCount: Int) {
        createChannels()
        refreshPlatformState(interactionLeaseCount)
    }

    fun onTorrentListUpdate(
        update: ViewUpdate,
        product: ProductState,
    ) {
        when (val payload = update.payload) {
            is ViewUpdatePayload.Snapshot -> {
                val snapshot = payload.snapshot as? ViewSnapshot.TorrentList ?: return
                policy.baseline(snapshot.torrents)
            }
            is ViewUpdatePayload.Patch -> {
                val patch = payload.patch as? ViewPatch.TorrentList ?: return
                val affected =
                    buildSet {
                        patch.upsert.mapTo(this) { it.torrentId }
                        patch.updates.mapTo(this) { it.torrentId }
                    }
                val rows = affected.mapNotNull(product.torrents::get)
                val reduction = policy.applyPatch(rows, patch.removed)
                reduction.removedTorrentIds.forEach(::cancelTorrentNotifications)
                reduction.edges.forEach(::deliver)
            }
            is ViewUpdatePayload.ResetRequired -> policy.reset()
        }
    }

    fun onTorrentListReset() {
        policy.reset()
    }

    fun setPreference(
        preference: ProductNotificationPreference,
        enabled: Boolean,
        interactionLeaseCount: Int,
    ) {
        when (
            val result =
                persistNotificationPreference(
                    preferences,
                    preference,
                    enabled,
                    preferenceStore::write,
                )
        ) {
            is ProductNotificationPreferenceResult.Applied -> {
                preferences = result.preferences
                state.update {
                    it.copy(
                        notifications =
                            platformState(interactionLeaseCount).copy(preferenceError = null),
                    )
                }
            }
            ProductNotificationPreferenceResult.Failed -> {
                state.update {
                    it.copy(
                        notifications =
                            it.notifications.copy(
                                preferenceError =
                                    ProductError.Code.NOTIFICATION_PREFERENCE_SAVE_FAILED,
                            ),
                    )
                }
            }
        }
    }

    fun refreshPlatformState(interactionLeaseCount: Int): NotificationEligibility {
        val notifications = platformState(interactionLeaseCount)
        state.update { it.copy(notifications = notifications) }
        return notifications.eligibility
    }

    /** Without [rates] the app name is the title; with them the status is. */
    fun ongoingNotification(
        detail: String,
        rates: String? = null,
    ): Notification {
        val open =
            PendingIntent.getActivity(
                context,
                ONGOING_OPEN_REQUEST,
                Intent(context, MainActivity::class.java).setPackage(context.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val stop =
            PendingIntent.getService(
                context,
                ONGOING_STOP_REQUEST,
                Intent(context, ProductEngineService::class.java)
                    .setPackage(context.packageName)
                    .setAction(ProductEngineService.ACTION_STOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        return NotificationCompat
            .Builder(context, AndroidNotificationContract.BACKGROUND_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_rstorrent_notification)
            .setContentTitle(if (rates == null) context.getString(R.string.app_name) else detail)
            .setContentText(rates ?: detail)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                context.getString(R.string.action_stop),
                stop,
            ).build()
    }

    fun updateOngoingNotification(content: ProductOngoingNotificationContent) {
        updateOngoingNotification(
            context.productOngoingNotificationText(content.message),
            content.rates?.let(context::productOngoingNotificationRates),
        )
    }

    fun updateOngoingNotification(
        detail: String,
        rates: String? = null,
    ) {
        runCatching {
            manager.notify(
                AndroidNotificationContract.ONGOING_NOTIFICATION_ID,
                ongoingNotification(detail, rates),
            )
        }.onFailure { error ->
            Log.w(TAG, "notification_delivery category=background result=rejected", error)
        }
    }

    fun cancelCompanionRootNotification() {
        manager.cancel(AndroidNotificationContract.COMPANION_ROOT_NOTIFICATION_ID)
    }

    fun showCompanionRootNotification(pendingIntent: PendingIntent): Boolean {
        val platform = platformState(state.value.notifications.interactionLeaseCount)
        state.update { it.copy(notifications = platform) }
        if (
            !platform.permissionGranted ||
            !platform.appNotificationsEnabled ||
            !platform.attentionChannelEnabled
        ) {
            return false
        }
        val notification =
            NotificationCompat
                .Builder(context, AndroidNotificationContract.ATTENTION_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_rstorrent_notification)
                .setContentTitle(context.getString(R.string.notification_choose_folder_title))
                .setContentText(context.getString(R.string.notification_choose_folder_body))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build()
        return runCatching {
            manager.notify(AndroidNotificationContract.COMPANION_ROOT_NOTIFICATION_ID, notification)
            true
        }.getOrElse { error ->
            Log.w(TAG, "notification_delivery category=workflow result=rejected", error)
            false
        }
    }

    fun close() {
        policy.reset()
        cancelCompanionRootNotification()
    }

    fun resetProductPreferencesAndEvents(interactionLeaseCount: Int): Boolean {
        if (!preferenceStore.reset()) return false
        preferences = preferenceStore.read()
        policy.reset()
        cancelCompanionRootNotification()
        val canceled =
            runCatching {
                manager.activeNotifications
                    .filter { notification ->
                        ProductNotificationCategory.entries.any { category ->
                            notification.id == eventNotificationId(category) &&
                                notification.tag?.startsWith(productNotificationTagPrefix(category)) == true
                        }
                    }.forEach { manager.cancel(it.tag, it.id) }
                submittedTags.values.forEach(ArrayDeque<String>::clear)
            }.isSuccess
        refreshPlatformState(interactionLeaseCount)
        return canceled
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val background =
            NotificationChannel(
                AndroidNotificationContract.BACKGROUND_CHANNEL_ID,
                context.getString(R.string.notification_channel_background),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description =
                    context.getString(R.string.notification_channel_background_description)
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }
        val completion =
            NotificationChannel(
                AndroidNotificationContract.COMPLETION_CHANNEL_ID,
                context.getString(R.string.notification_channel_completed),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description =
                    context.getString(R.string.notification_channel_completed_description)
            }
        val attention =
            NotificationChannel(
                AndroidNotificationContract.ATTENTION_CHANNEL_ID,
                context.getString(R.string.notification_channel_attention),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description =
                    context.getString(R.string.notification_channel_attention_description)
            }
        manager.createNotificationChannels(listOf(background, completion, attention))
    }

    private fun deliver(edge: ProductNotificationEdge) {
        val platform = platformState(state.value.notifications.interactionLeaseCount)
        state.update { it.copy(notifications = platform) }
        if (!preferences.enabled(edge.category)) return
        if (!platform.permissionGranted || !platform.appNotificationsEnabled) return
        val channelEnabled =
            when (edge.category) {
                ProductNotificationCategory.DOWNLOAD_COMPLETE ->
                    platform.completionChannelEnabled
                ProductNotificationCategory.NEEDS_ATTENTION -> platform.attentionChannelEnabled
            }
        if (!channelEnabled || !makeRoom(edge.category)) return

        val tag = productNotificationTag(edge.category, edge.torrentId)
        val intent =
            Intent(context, MainActivity::class.java).apply {
                action = AndroidNotificationContract.routeAction(context.packageName, tag)
                setPackage(context.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(AndroidNotificationContract.EXTRA_TORRENT_ID, edge.torrentId)
                when (val route = edge.route) {
                    ProductNotificationRoute.Torrent ->
                        putExtra(
                            AndroidNotificationContract.EXTRA_ROUTE,
                            AndroidNotificationContract.ROUTE_TORRENT,
                        )
                    is ProductNotificationRoute.StorageRepair -> {
                        putExtra(
                            AndroidNotificationContract.EXTRA_ROUTE,
                            AndroidNotificationContract.ROUTE_STORAGE_REPAIR,
                        )
                        putExtra(AndroidNotificationContract.EXTRA_STORAGE_ROOT_ID, route.rootId)
                    }
                }
            }
        val pending =
            PendingIntent.getActivity(
                context,
                tag.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val channel =
            when (edge.category) {
                ProductNotificationCategory.DOWNLOAD_COMPLETE ->
                    AndroidNotificationContract.COMPLETION_CHANNEL_ID
                ProductNotificationCategory.NEEDS_ATTENTION ->
                    AndroidNotificationContract.ATTENTION_CHANNEL_ID
            }
        val displayName = edge.displayName ?: context.getString(R.string.torrent_fallback_name)
        val (title, body) =
            when (edge.category) {
                ProductNotificationCategory.DOWNLOAD_COMPLETE ->
                    context.getString(R.string.notification_download_complete_title) to
                        context.getString(R.string.notification_download_complete_body, displayName)
                ProductNotificationCategory.NEEDS_ATTENTION ->
                    context.getString(R.string.notification_attention_title) to
                        context.getString(R.string.notification_attention_body, displayName)
            }
        val notification =
            NotificationCompat
                .Builder(context, channel)
                .setSmallIcon(R.drawable.ic_rstorrent_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setCategory(
                    if (edge.category == ProductNotificationCategory.DOWNLOAD_COMPLETE) {
                        NotificationCompat.CATEGORY_STATUS
                    } else {
                        NotificationCompat.CATEGORY_ERROR
                    },
                ).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .build()
        runCatching { manager.notify(tag, eventNotificationId(edge.category), notification) }
            .onSuccess { rememberSubmitted(edge.category, tag) }
            .onFailure { error ->
                Log.w(
                    TAG,
                    "notification_delivery category=${edge.category.name.lowercase()} " +
                        "result=rejected",
                    error,
                )
                refreshPlatformState(platform.interactionLeaseCount)
            }
    }

    private fun makeRoom(category: ProductNotificationCategory): Boolean {
        val id = eventNotificationId(category)
        val prefix = productNotificationTagPrefix(category)
        val active =
            try {
                manager.activeNotifications
                    .filter { it.id == id && it.tag?.startsWith(prefix) == true }
                    .sortedBy { it.postTime }
            } catch (error: RuntimeException) {
                Log.w(
                    TAG,
                    "notification_delivery category=${category.name.lowercase()} " +
                        "result=inspection_failed",
                    error,
                )
                return false
            }
        val submitted = submittedTags.getValue(category)
        active.forEach { notification ->
            val tag = notification.tag ?: return@forEach
            if (tag !in submitted) submitted.addLast(tag)
        }
        while (submitted.size >= MAX_ACTIVE_PER_CATEGORY) {
            manager.cancel(submitted.removeFirst(), id)
        }
        return true
    }

    private fun rememberSubmitted(
        category: ProductNotificationCategory,
        tag: String,
    ) {
        val submitted = submittedTags.getValue(category)
        submitted.remove(tag)
        submitted.addLast(tag)
    }

    private fun cancelTorrentNotifications(torrentId: String) {
        ProductNotificationCategory.entries.forEach { category ->
            val tag = productNotificationTag(category, torrentId)
            manager.cancel(
                tag,
                eventNotificationId(category),
            )
            submittedTags.getValue(category).remove(tag)
        }
    }

    private fun platformState(interactionLeaseCount: Int): ProductNotificationState {
        val permissionGranted =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        val appEnabled = manager.areNotificationsEnabled()
        return ProductNotificationState(
            preferences = preferences,
            permissionGranted = permissionGranted,
            appNotificationsEnabled = appEnabled,
            backgroundChannelEnabled = channelEnabled(AndroidNotificationContract.BACKGROUND_CHANNEL_ID),
            completionChannelEnabled = channelEnabled(AndroidNotificationContract.COMPLETION_CHANNEL_ID),
            attentionChannelEnabled = channelEnabled(AndroidNotificationContract.ATTENTION_CHANNEL_ID),
            interactionLeaseCount = interactionLeaseCount,
            preferenceError = state.value.notifications.preferenceError,
        )
    }

    private fun channelEnabled(channelId: String): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            manager.getNotificationChannel(channelId)?.importance?.let {
                it != NotificationManager.IMPORTANCE_NONE
            } == true

    companion object {
        private const val ONGOING_OPEN_REQUEST = 42
        private const val ONGOING_STOP_REQUEST = 43
        private const val MAX_ACTIVE_PER_CATEGORY = 32
        private const val TAG = "RSTorrentProduct"
    }
}

internal fun eventNotificationId(category: ProductNotificationCategory): Int =
    when (category) {
        ProductNotificationCategory.DOWNLOAD_COMPLETE ->
            AndroidNotificationContract.COMPLETION_NOTIFICATION_ID
        ProductNotificationCategory.NEEDS_ATTENTION ->
            AndroidNotificationContract.ATTENTION_NOTIFICATION_ID
    }

internal fun productNotificationTagPrefix(category: ProductNotificationCategory): String =
    "rstorrent-${category.name.lowercase()}-"

internal data class ProductOngoingNotificationMessage(
    val kind: Kind,
    val count: Int = 0,
    val total: Int = 0,
) {
    enum class Kind {
        CLEARING_DATA,
        CLEARING_DATA_PROGRESS,
        OPENING_PROFILE,
        NEEDS_ATTENTION,
        SEEDING_BACKGROUND,
        CHROME_CONNECTED,
        CHROME_RECONNECT,
        WAITING_UNMETERED,
        DOWNLOADING,
        GETTING_METADATA,
        STARTING,
        CHECKING,
        SEEDING,
        READY_CHROME,
        READY,
    }
}

internal data class ProductOngoingNotificationRates(
    val downloadBytes: ULong,
    val uploadBytes: ULong,
)

internal data class ProductOngoingNotificationContent(
    val message: ProductOngoingNotificationMessage,
    val rates: ProductOngoingNotificationRates? = null,
)

internal fun productOngoingNotificationContent(product: ProductState): ProductOngoingNotificationContent {
    val message = productOngoingNotificationMessage(product)
    val current = product.currentRates?.rates?.associate { it.metric to it.bytes }.orEmpty()
    val rates =
        ProductOngoingNotificationRates(
            downloadBytes = current[SpeedMetric.PAYLOAD_RECEIVED]?.toULongOrNull() ?: 0UL,
            uploadBytes = current[SpeedMetric.PAYLOAD_UPLOADED]?.toULongOrNull() ?: 0UL,
        )
    val shown =
        when (message.kind) {
            ProductOngoingNotificationMessage.Kind.DOWNLOADING,
            ProductOngoingNotificationMessage.Kind.SEEDING_BACKGROUND,
            ProductOngoingNotificationMessage.Kind.SEEDING,
            -> true
            ProductOngoingNotificationMessage.Kind.READY,
            ProductOngoingNotificationMessage.Kind.READY_CHROME,
            ProductOngoingNotificationMessage.Kind.CHROME_CONNECTED,
            ProductOngoingNotificationMessage.Kind.CHROME_RECONNECT,
            ProductOngoingNotificationMessage.Kind.GETTING_METADATA,
            ProductOngoingNotificationMessage.Kind.STARTING,
            ProductOngoingNotificationMessage.Kind.CHECKING,
            -> rates.downloadBytes > 0UL || rates.uploadBytes > 0UL
            else -> false
        }
    return ProductOngoingNotificationContent(message, rates.takeIf { shown })
}

/**
 * Coalesces rate-only changes to the ongoing notification. Status changes post
 * at once; changed rate values post at most once per [rateIntervalMillis].
 */
internal class ProductOngoingNotificationThrottle(
    private val rateIntervalMillis: Long = ONGOING_RATE_INTERVAL_MILLIS,
) {
    private var posted: ProductOngoingNotificationContent? = null
    private var postedAtMillis = 0L

    /** Milliseconds to wait before posting [content], or null when it is already shown. */
    fun delayMillis(
        content: ProductOngoingNotificationContent,
        nowMillis: Long,
    ): Long? {
        val previous = posted
        if (content == previous) return null
        val ratesOnly =
            previous != null &&
                previous.message == content.message &&
                previous.rates != null &&
                content.rates != null
        if (!ratesOnly) return 0L
        return (postedAtMillis + rateIntervalMillis - nowMillis).coerceAtLeast(0L)
    }

    fun posted(
        content: ProductOngoingNotificationContent,
        nowMillis: Long,
    ) {
        posted = content
        postedAtMillis = nowMillis
    }

    /** The notification now shows something else, or nothing. */
    fun forget() {
        posted = null
    }

    companion object {
        const val ONGOING_RATE_INTERVAL_MILLIS = 2_000L
    }
}

internal fun productOngoingNotificationMessage(product: ProductState): ProductOngoingNotificationMessage {
    val reset = product.dataReset?.takeUnless { it.complete }
    if (reset != null) {
        return when {
            reset.failure != null ->
                ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.NEEDS_ATTENTION)
            reset.phase == ProductDataResetPhase.REMOVING_TORRENTS ->
                ProductOngoingNotificationMessage(
                    ProductOngoingNotificationMessage.Kind.CLEARING_DATA_PROGRESS,
                    reset.completedTorrents,
                    reset.totalTorrents,
                )
            else -> ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.CLEARING_DATA)
        }
    }
    if (!product.ready && product.error == null) {
        return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.OPENING_PROFILE)
    }
    if (product.error != null) {
        return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.NEEDS_ATTENTION)
    }
    when (product.lifecycle.reason) {
        "retain_background_seeding" ->
            return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.SEEDING_BACKGROUND)
        "retain_chromeos_companion" ->
            return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.CHROME_CONNECTED)
        "retain_chromeos_reconnect_grace" ->
            return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.CHROME_RECONNECT)
    }
    val networkRuntime = product.clientSettings?.applicationNetwork
    if (
        networkRuntime?.requestedPrerequisite ==
            org.rstorrent.session.uniffi.ApplicationNetworkPrerequisiteView
                .WAITING_FOR_UNMETERED_NETWORK &&
        networkRuntime.state !=
            org.rstorrent.session.uniffi.ApplicationNetworkRuntimeState.ALLOWED
    ) {
        return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.WAITING_UNMETERED)
    }
    val work = classifyProductLifetimeTorrentViews(product.torrents.values)
    if (work.downloading > 0) {
        return ProductOngoingNotificationMessage(
            ProductOngoingNotificationMessage.Kind.DOWNLOADING,
            work.downloading,
        )
    }
    if (work.checking > 0) {
        return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.CHECKING)
    }
    if (work.starting > 0) {
        val metadata = product.torrents.values.any {
            it.operationalState == TorrentOperationalState.STARTING &&
                it.progress.reason == ProgressReason.ACQUIRING_METADATA &&
                !it.archived && it.removalState == null
        }
        return ProductOngoingNotificationMessage(
            if (metadata) ProductOngoingNotificationMessage.Kind.GETTING_METADATA
            else ProductOngoingNotificationMessage.Kind.STARTING,
        )
    }
    if (work.seeding > 0) {
        return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.SEEDING, work.seeding)
    }
    if (product.companionPort != null) {
        return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.READY_CHROME)
    }
    return ProductOngoingNotificationMessage(ProductOngoingNotificationMessage.Kind.READY)
}

internal fun Context.productOngoingNotificationText(product: ProductState): String =
    productOngoingNotificationText(productOngoingNotificationMessage(product))

internal fun Context.productOngoingNotificationRates(rates: ProductOngoingNotificationRates): String =
    getString(
        R.string.status_rates,
        formatRate(rates.downloadBytes.toString()),
        formatRate(rates.uploadBytes.toString()),
    )

internal fun Context.productOngoingNotificationText(message: ProductOngoingNotificationMessage): String =
    when (message.kind) {
        ProductOngoingNotificationMessage.Kind.CLEARING_DATA ->
            getString(R.string.notification_clearing_data)
        ProductOngoingNotificationMessage.Kind.CLEARING_DATA_PROGRESS ->
            getString(R.string.notification_clearing_data_progress, message.count, message.total)
        ProductOngoingNotificationMessage.Kind.OPENING_PROFILE ->
            getString(R.string.notification_opening_profile)
        ProductOngoingNotificationMessage.Kind.NEEDS_ATTENTION ->
            getString(R.string.notification_needs_attention)
        ProductOngoingNotificationMessage.Kind.SEEDING_BACKGROUND ->
            getString(R.string.notification_seeding_background)
        ProductOngoingNotificationMessage.Kind.CHROME_CONNECTED ->
            getString(R.string.notification_chrome_connected)
        ProductOngoingNotificationMessage.Kind.CHROME_RECONNECT ->
            getString(R.string.notification_chrome_reconnect)
        ProductOngoingNotificationMessage.Kind.WAITING_UNMETERED ->
            getString(R.string.notification_waiting_unmetered)
        ProductOngoingNotificationMessage.Kind.DOWNLOADING ->
            resources.getQuantityString(
                R.plurals.notification_downloading_torrents,
                message.count,
                message.count,
            )
        ProductOngoingNotificationMessage.Kind.GETTING_METADATA ->
            getString(R.string.activity_getting_metadata)
        ProductOngoingNotificationMessage.Kind.STARTING ->
            getString(R.string.notification_starting_downloads)
        ProductOngoingNotificationMessage.Kind.CHECKING ->
            getString(R.string.notification_checking_downloads)
        ProductOngoingNotificationMessage.Kind.SEEDING ->
            resources.getQuantityString(R.plurals.notification_seeding_torrents, message.count, message.count)
        ProductOngoingNotificationMessage.Kind.READY_CHROME ->
            getString(R.string.notification_ready_chrome)
        ProductOngoingNotificationMessage.Kind.READY -> getString(R.string.notification_ready)
    }
