package org.rstorrent.bootstrap


enum class ProductNotificationPreference {
    DOWNLOAD_COMPLETE,
    NEEDS_ATTENTION,
}

data class ProductNotificationPreferences(
    val downloadComplete: Boolean = true,
    val needsAttention: Boolean = true,
) {
    internal fun enabled(category: ProductNotificationCategory): Boolean =
        when (category) {
            ProductNotificationCategory.DOWNLOAD_COMPLETE -> downloadComplete
            ProductNotificationCategory.NEEDS_ATTENTION -> needsAttention
        }

    internal fun with(
        preference: ProductNotificationPreference,
        enabled: Boolean,
    ): ProductNotificationPreferences =
        when (preference) {
            ProductNotificationPreference.DOWNLOAD_COMPLETE -> copy(downloadComplete = enabled)
            ProductNotificationPreference.NEEDS_ATTENTION -> copy(needsAttention = enabled)
        }
}

internal sealed interface ProductNotificationPreferenceResult {
    data class Applied(val preferences: ProductNotificationPreferences) :
        ProductNotificationPreferenceResult

    data object Failed : ProductNotificationPreferenceResult
}

internal fun persistNotificationPreference(
    current: ProductNotificationPreferences,
    preference: ProductNotificationPreference,
    enabled: Boolean,
    persist: (ProductNotificationPreference, Boolean) -> Boolean,
): ProductNotificationPreferenceResult {
    if (current.with(preference, enabled) == current) {
        return ProductNotificationPreferenceResult.Applied(current)
    }
    if (!persist(preference, enabled)) return ProductNotificationPreferenceResult.Failed
    return ProductNotificationPreferenceResult.Applied(current.with(preference, enabled))
}

internal data class NotificationEligibility(
    val permissionGranted: Boolean,
    val appNotificationsEnabled: Boolean,
    val backgroundChannelEnabled: Boolean,
    val interactionLeaseCount: Int,
) {
    init {
        require(interactionLeaseCount >= 0) { "interaction lease count cannot be negative" }
    }

    val backgroundNotificationVisible: Boolean
        get() = permissionGranted && appNotificationsEnabled && backgroundChannelEnabled

    val visibleOnly: Boolean
        get() = !backgroundNotificationVisible

    val shouldStopOwner: Boolean
        get() = visibleOnly && interactionLeaseCount == 0
}

/** Process-local interaction leases; process death deliberately resets them to absent. */
internal object ProductInteractionRegistry {
    private val ownership = Any()
    private val leases = mutableSetOf<String>()
    private val visibleActivities = mutableSetOf<Any>()
    private var listener: ((Set<String>) -> Unit)? = null

    fun setLease(
        token: String,
        held: Boolean,
    ) {
        val callback: ((Set<String>) -> Unit)?
        val snapshot: Set<String>
        synchronized(ownership) {
            if (held) leases.add(token) else leases.remove(token)
            callback = listener
            snapshot = leases.toSet()
        }
        callback?.invoke(snapshot)
    }

    /**
     * Each activity instance reports its own visibility; the activity lease is
     * held while any of them is visible. A relaunched activity can start before
     * the instance it replaces stops, so one shared flag would be cleared while
     * the new instance is on screen.
     */
    fun setActivityVisible(
        activity: Any,
        visible: Boolean,
    ) {
        val callback: ((Set<String>) -> Unit)?
        val snapshot: Set<String>
        synchronized(ownership) {
            if (visible) visibleActivities.add(activity) else visibleActivities.remove(activity)
            if (visibleActivities.isEmpty()) {
                leases.remove(ProductEngineService.INTERACTION_ACTIVITY)
            } else {
                leases.add(ProductEngineService.INTERACTION_ACTIVITY)
            }
            callback = listener
            snapshot = leases.toSet()
        }
        callback?.invoke(snapshot)
    }

    fun attach(listener: (Set<String>) -> Unit) {
        val snapshot: Set<String>
        synchronized(ownership) {
            check(this.listener == null) { "interaction leases already have a service owner" }
            this.listener = listener
            snapshot = leases.toSet()
        }
        listener(snapshot)
    }

    fun detach() {
        synchronized(ownership) { listener = null }
    }

    internal fun resetForTest() {
        synchronized(ownership) {
            listener = null
            leases.clear()
            visibleActivities.clear()
        }
    }
}

data class ProductNotificationState(
    val preferences: ProductNotificationPreferences = ProductNotificationPreferences(),
    val permissionGranted: Boolean = false,
    val appNotificationsEnabled: Boolean = true,
    val backgroundChannelEnabled: Boolean = true,
    val completionChannelEnabled: Boolean = true,
    val attentionChannelEnabled: Boolean = true,
    val interactionLeaseCount: Int = 0,
    val preferenceError: ProductError? = null,
) {
    internal val eligibility: NotificationEligibility
        get() =
            NotificationEligibility(
                permissionGranted,
                appNotificationsEnabled,
                backgroundChannelEnabled,
                interactionLeaseCount,
            )
}

sealed interface ProductNotificationNavigation {
    val sequence: Long

    data class Torrent(
        override val sequence: Long,
        val torrentId: String,
    ) : ProductNotificationNavigation

    data class StorageRepair(
        override val sequence: Long,
        val rootId: String?,
    ) : ProductNotificationNavigation
}
