package org.rstorrent.bootstrap

import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal data class ProductLifetimeDurations(
    val settleMillis: Long = PRODUCT_LIFETIME_SETTLE_MILLIS,
    val resyncMillis: Long = PRODUCT_LIFETIME_RESYNC_MILLIS,
    val startupMillis: Long = PRODUCT_LIFETIME_STARTUP_MILLIS,
    val companionGraceMillis: Long = PRODUCT_COMPANION_RECONNECT_MILLIS,
) {
    init {
        require(settleMillis > 0)
        require(resyncMillis > 0)
        require(startupMillis > 0)
        require(companionGraceMillis > 0)
    }
}

internal data class ProductLifecycleCoordinatorSnapshot(
    val revision: Long,
    val decision: ProductLifetimeDecision,
    val preferences: ProductLifecyclePreferences,
    val work: ProductLifetimeWork?,
    val companionConnections: Int,
    val scheduledDeadlineMillis: Long?,
)

/** Serializes all mutable Android product-lifetime facts and owns one deadline job. */
internal class ProductLifecycleCoordinator(
    private val scope: CoroutineScope,
    private val clockMillis: () -> Long,
    initialPreferences: ProductLifecyclePreferences,
    initialNotificationEligible: Boolean,
    private val durations: ProductLifetimeDurations = ProductLifetimeDurations(),
    private val onDecision: (ProductLifecycleCoordinatorSnapshot) -> Unit,
) {
    private val ownership = Any()
    private val closed = AtomicBoolean(false)
    private var started = false
    private var revision = 1L
    private var activityVisible = false
    private var interactionLeaseCount = 0
    private var notificationEligible = initialNotificationEligible
    private var preferences = initialPreferences
    private var work: ProductLifetimeWork? = null
    private var companionConnections = 0
    private var startupDeadlineMillis: Long? = clockMillis() + durations.startupMillis
    private var resyncDeadlineMillis: Long? = null
    private var settleDeadlineMillis: Long? = null
    private var settleReason = ProductLifetimeWaitReason.WORK_SETTLE
    private var companionGraceDeadlineMillis: Long? = null
    private var terminalReason: ProductLifetimeStopReason? = null
    private var deadlineJob: Job? = null
    private var scheduledDeadlineMillis: Long? = null
    private var scheduledRevision: Long? = null

    fun start() {
        synchronized(ownership) {
            if (closed.get() || started) return
            started = true
            evaluateLocked(clockMillis())
        }
    }

    fun updateInteractions(
        visible: Boolean,
        workflowLeaseCount: Int,
    ) {
        require(workflowLeaseCount >= 0)
        mutate { now ->
            if (
                activityVisible == visible &&
                    interactionLeaseCount == workflowLeaseCount
            ) {
                return@mutate false
            }
            val lostLastInteraction =
                (activityVisible || interactionLeaseCount > 0) &&
                    !visible &&
                    workflowLeaseCount == 0
            activityVisible = visible
            interactionLeaseCount = workflowLeaseCount
            when {
                visible -> settleDeadlineMillis = null
                lostLastInteraction -> beginSettle(now, ProductLifetimeWaitReason.VISIBILITY_SETTLE)
            }
            true
        }
    }

    fun updateNotificationEligibility(eligible: Boolean) {
        mutate {
            if (notificationEligible == eligible) return@mutate false
            notificationEligible = eligible
            true
        }
    }

    fun updatePreferences(updated: ProductLifecyclePreferences) {
        mutate { now ->
            if (preferences == updated) return@mutate false
            preferences = updated
            updateWorkSettleLocked(now)
            true
        }
    }

    fun updateWork(updated: ProductLifetimeWork) {
        mutate { now ->
            if (work == updated && startupDeadlineMillis == null && resyncDeadlineMillis == null) {
                return@mutate false
            }
            work = updated
            startupDeadlineMillis = null
            resyncDeadlineMillis = null
            updateWorkSettleLocked(now)
            true
        }
    }

    fun resetWork() {
        mutate { now ->
            work = null
            startupDeadlineMillis = null
            resyncDeadlineMillis = now + durations.resyncMillis
            true
        }
    }

    fun companionStarted() {
        mutate { now ->
            if (companionConnections > 0 || companionGraceDeadlineMillis != null) {
                return@mutate false
            }
            companionGraceDeadlineMillis = now + durations.companionGraceMillis
            true
        }
    }

    /** Only an explicit Android setup action renews a bootstrap grace. */
    fun companionSetupRequested() {
        mutate { now ->
            if (companionConnections > 0) return@mutate false
            companionGraceDeadlineMillis = now + durations.companionGraceMillis
            true
        }
    }

    fun updateCompanionConnections(count: Int) {
        require(count >= 0)
        mutate { now ->
            if (companionConnections == count) return@mutate false
            val disconnected = companionConnections > 0 && count == 0
            companionConnections = count
            companionGraceDeadlineMillis =
                when {
                    count > 0 -> null
                    disconnected -> now + durations.companionGraceMillis
                    else -> companionGraceDeadlineMillis
                }
            true
        }
    }

    fun terminal(reason: ProductLifetimeStopReason) {
        mutate {
            if (terminalReason != null) return@mutate false
            terminalReason = reason
            true
        }
    }

    fun snapshot(): ProductLifecycleCoordinatorSnapshot? =
        synchronized(ownership) {
            if (!started) null else snapshotLocked(clockMillis())
        }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        synchronized(ownership) {
            deadlineJob?.cancel()
            deadlineJob = null
            scheduledDeadlineMillis = null
            scheduledRevision = null
        }
    }

    private fun mutate(change: (Long) -> Boolean) {
        synchronized(ownership) {
            if (closed.get() || terminalReason != null) return
            val now = clockMillis()
            if (!change(now)) return
            advanceRevisionLocked()
            if (started) evaluateLocked(now)
        }
    }

    private fun advanceRevisionLocked() {
        if (revision == Long.MAX_VALUE) {
            terminalReason = ProductLifetimeStopReason.REVISION_EXHAUSTED
        } else {
            revision += 1
        }
    }

    private fun updateWorkSettleLocked(now: Long) {
        val current = work ?: return
        if (current.qualifies(preferences)) {
            if (settleReason == ProductLifetimeWaitReason.WORK_SETTLE) {
                settleDeadlineMillis = null
            }
        } else if (!activityVisible && interactionLeaseCount == 0) {
            beginSettle(now, ProductLifetimeWaitReason.WORK_SETTLE)
        }
    }

    private fun beginSettle(
        now: Long,
        reason: ProductLifetimeWaitReason,
    ) {
        settleDeadlineMillis = now + durations.settleMillis
        settleReason = reason
    }

    private fun evaluateLocked(now: Long) {
        val snapshot = snapshotLocked(now)
        replaceDeadlineLocked(nextDeadline(snapshot.decision), now)
        onDecision(snapshot.copy(scheduledDeadlineMillis = scheduledDeadlineMillis))
    }

    private fun snapshotLocked(now: Long): ProductLifecycleCoordinatorSnapshot {
        val decision =
            ProductLifetimePolicy.reduce(
                ProductLifetimeFacts(
                    revision = revision,
                    nowMillis = now,
                    activityVisible = activityVisible,
                    interactionLeaseCount = interactionLeaseCount,
                    notificationEligible = notificationEligible,
                    preferences = preferences,
                    work = work,
                    companionConnections = companionConnections,
                    startupDeadlineMillis = startupDeadlineMillis,
                    resyncDeadlineMillis = resyncDeadlineMillis,
                    settleDeadlineMillis = settleDeadlineMillis,
                    settleReason = settleReason,
                    companionGraceDeadlineMillis = companionGraceDeadlineMillis,
                    terminalReason = terminalReason,
                ),
            )
        return ProductLifecycleCoordinatorSnapshot(
            revision = revision,
            decision = decision,
            preferences = preferences,
            work = work,
            companionConnections = companionConnections,
            scheduledDeadlineMillis = scheduledDeadlineMillis,
        )
    }

    private fun nextDeadline(decision: ProductLifetimeDecision): Long? =
        listOfNotNull(
            startupDeadlineMillis,
            resyncDeadlineMillis,
            when (decision) {
                is ProductLifetimeDecision.Wait -> decision.deadlineMillis
                is ProductLifetimeDecision.Retain ->
                    if (
                        decision.reason ==
                            ProductLifetimeRetentionReason.CHROMEOS_RECONNECT_GRACE
                    ) {
                        companionGraceDeadlineMillis
                    } else {
                        null
                    }
                is ProductLifetimeDecision.Stop -> null
            },
        ).minOrNull()

    private fun replaceDeadlineLocked(
        deadlineMillis: Long?,
        now: Long,
    ) {
        if (scheduledDeadlineMillis == deadlineMillis && scheduledRevision == revision) return
        deadlineJob?.cancel()
        deadlineJob = null
        scheduledDeadlineMillis = deadlineMillis
        scheduledRevision = revision.takeIf { deadlineMillis != null }
        if (deadlineMillis == null) return
        val expectedRevision = revision
        deadlineJob =
            scope.launch {
                delay((deadlineMillis - now).coerceAtLeast(0))
                synchronized(ownership) {
                    if (
                        closed.get() ||
                            scheduledDeadlineMillis != deadlineMillis ||
                            revision != expectedRevision
                    ) {
                        return@synchronized
                    }
                    deadlineJob = null
                    scheduledDeadlineMillis = null
                    scheduledRevision = null
                    when (deadlineMillis) {
                        startupDeadlineMillis -> {
                            startupDeadlineMillis = null
                            terminalReason = ProductLifetimeStopReason.INITIALIZATION_FAILED
                        }
                        resyncDeadlineMillis -> {
                            resyncDeadlineMillis = null
                            terminalReason =
                                ProductLifetimeStopReason.AUTHORITATIVE_STATE_UNAVAILABLE
                        }
                    }
                    advanceRevisionLocked()
                    evaluateLocked(clockMillis())
                }
            }
    }

    private fun ProductLifetimeWork.qualifies(
        preferences: ProductLifecyclePreferences,
    ): Boolean =
        preferences.backgroundDownloadsEnabled &&
            (
                hasDownloadWork ||
                    waitingForUnmeteredNetwork > 0 ||
                    (preferences.keepSeedingEnabled && seeding > 0)
            )
}
