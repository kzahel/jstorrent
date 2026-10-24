package org.rstorrent.bootstrap

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProductLifecycleCoordinatorTest {
    @Test
    fun promotesActiveWorkThenStopsAfterLatestIdleDeadline() {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val decisions = CopyOnWriteArrayList<ProductLifetimeDecision>()
        val stopped = CountDownLatch(1)
        val coordinator =
            coordinator(scope) { snapshot ->
                decisions += snapshot.decision
                if (snapshot.decision is ProductLifetimeDecision.Stop) stopped.countDown()
            }
        try {
            coordinator.start()
            coordinator.updateInteractions(visible = true, workflowLeaseCount = 0)
            coordinator.updateWork(ProductLifetimeWork(downloading = 1))
            coordinator.updateInteractions(visible = false, workflowLeaseCount = 0)

            assertEquals(
                ProductLifetimeRetentionReason.ACTIVE_DOWNLOAD,
                (decisions.last() as ProductLifetimeDecision.Retain).reason,
            )
            assertTrue((decisions.last() as ProductLifetimeDecision.Retain).stickyAllowed)

            coordinator.updateWork(ProductLifetimeWork())
            assertEquals(
                ProductLifetimeWaitReason.WORK_SETTLE,
                (decisions.last() as ProductLifetimeDecision.Wait).reason,
            )
            assertTrue(stopped.await(1, TimeUnit.SECONDS))
            assertEquals(
                ProductLifetimeStopReason.IDLE,
                (decisions.last() as ProductLifetimeDecision.Stop).reason,
            )
        } finally {
            coordinator.close()
            scope.cancel()
        }
    }

    @Test
    fun newerIdleFactReplacesTheOnlyDeadline() {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val stopped = CountDownLatch(1)
        val coordinator =
            coordinator(scope, settleMillis = 120) { snapshot ->
                if (snapshot.decision is ProductLifetimeDecision.Stop) stopped.countDown()
            }
        try {
            coordinator.start()
            coordinator.updateWork(ProductLifetimeWork())
            Thread.sleep(70)
            coordinator.updateWork(ProductLifetimeWork(seeding = 1))

            assertFalse(stopped.await(70, TimeUnit.MILLISECONDS))
            assertTrue(stopped.await(1, TimeUnit.SECONDS))
        } finally {
            coordinator.close()
            scope.cancel()
        }
    }

    @Test
    fun startupDeadlineIsHardEvenWhileActivityRemainsVisible() {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val stopped = CountDownLatch(1)
        var terminal: ProductLifetimeDecision.Stop? = null
        val coordinator =
            coordinator(scope) { snapshot ->
                (snapshot.decision as? ProductLifetimeDecision.Stop)?.let {
                    terminal = it
                    stopped.countDown()
                }
            }
        try {
            coordinator.start()
            coordinator.updateInteractions(visible = true, workflowLeaseCount = 0)

            assertTrue(stopped.await(1, TimeUnit.SECONDS))
            assertEquals(ProductLifetimeStopReason.INITIALIZATION_FAILED, terminal?.reason)
        } finally {
            coordinator.close()
            scope.cancel()
        }
    }

    private fun coordinator(
        scope: CoroutineScope,
        settleMillis: Long = 20,
        onDecision: (ProductLifecycleCoordinatorSnapshot) -> Unit,
    ) = ProductLifecycleCoordinator(
        scope = scope,
        clockMillis = { System.nanoTime() / 1_000_000 },
        initialPreferences = ProductLifecyclePreferences(backgroundDownloadsEnabled = true),
        initialNotificationEligible = true,
        durations =
            ProductLifetimeDurations(
                settleMillis = settleMillis,
                resyncMillis = 50,
                startupMillis = 100,
                companionGraceMillis = 80,
            ),
        onDecision = onDecision,
    )

    @Test
    fun explicitSetupRenewsAnExpiredGraceWithoutResurrectingTerminalStop() {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val decisions = CopyOnWriteArrayList<ProductLifetimeDecision>()
        val now = java.util.concurrent.atomic.AtomicLong(0)
        var scheduledDeadline: Long? = null
        val coordinator = ProductLifecycleCoordinator(
            scope = scope,
            clockMillis = { now.get() },
            initialPreferences = ProductLifecyclePreferences(),
            initialNotificationEligible = true,
            durations = ProductLifetimeDurations(companionGraceMillis = 80),
            onDecision = { decisions += it.decision; scheduledDeadline = it.scheduledDeadlineMillis },
        )
        try {
            coordinator.start()
            coordinator.updateInteractions(visible = true, workflowLeaseCount = 0)
            coordinator.updateWork(ProductLifetimeWork())
            coordinator.companionStarted()
            now.set(81)
            coordinator.companionSetupRequested()
            coordinator.updateInteractions(visible = false, workflowLeaseCount = 0)
            val retained = decisions.last() as ProductLifetimeDecision.Retain
            assertEquals(ProductLifetimeRetentionReason.CHROMEOS_RECONNECT_GRACE, retained.reason)
            assertEquals(161L, scheduledDeadline)
            coordinator.terminal(ProductLifetimeStopReason.EXPLICIT_STOP)
            coordinator.companionSetupRequested()
            assertEquals(ProductLifetimeStopReason.EXPLICIT_STOP,
                (decisions.last() as ProductLifetimeDecision.Stop).reason)
        } finally {
            coordinator.close()
            scope.cancel()
        }
    }
}
