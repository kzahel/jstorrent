package org.rstorrent.bootstrap

import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.ServiceTestRule
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProductServiceTimeoutTest {
    private val permissionRule =
        NotificationPermissionRule()
    private val serviceRule = ServiceTestRule()

    @get:Rule
    val rules: TestRule = RuleChain.outerRule(permissionRule).around(serviceRule)

    @Test
    fun exhaustedQuotaAcknowledgesAnAcceptedStartWithoutOpeningTheEngine() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val intent = Intent(context, ProductEngineService::class.java)
        val bindingResults = LinkedBlockingQueue<Boolean>()
        val connection =
            object : ServiceConnection {
                override fun onServiceConnected(name: ComponentName, service: IBinder) {
                    bindingResults.offer(false)
                }

                override fun onNullBinding(name: ComponentName) {
                    bindingResults.offer(true)
                }

                override fun onServiceDisconnected(name: ComponentName) = Unit
            }
        assertTrue(ProductDataSyncQuotaFence.markExhausted(context))
        var bound = false
        try {
            context.startForegroundService(intent)
            bound = context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
            assertTrue(bound)
            assertEquals(true, bindingResults.poll(5, TimeUnit.SECONDS))
            context.unbindService(connection)
            bound = false

            // Android delivers the fatal exception asynchronously after service
            // teardown when a start was left unacknowledged.
            SystemClock.sleep(1_000L)
            assertTrue(ProductDataSyncQuotaFence.isExhausted(context))
            assertFalse(
                context
                    .getSystemService(android.app.NotificationManager::class.java)
                    .activeNotifications
                    .any { it.id == AndroidNotificationContract.ONGOING_NOTIFICATION_ID },
            )
        } finally {
            if (bound) context.unbindService(connection)
            context.stopService(intent)
            assertTrue(ProductDataSyncQuotaFence.clearForUserVisibleStart(context))
        }
    }

    @Test
    fun dataSyncTimeoutUsesJoinedNonStickyShutdown() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        ProductInteractionRegistry.resetForTest()
        assertTrue(ProductDataSyncQuotaFence.clearForUserVisibleStart(context))
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val binder: IBinder =
            serviceRule.bindService(Intent(context, ProductEngineService::class.java))
        val service = (binder as ProductEngineService.LocalBinder).service

        service.onTimeout(1, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        val deadline = SystemClock.elapsedRealtime() + 30_000L
        var snapshot = service.resourceSnapshotForTest()
        while (!snapshot.shutdownComplete && SystemClock.elapsedRealtime() < deadline) {
            SystemClock.sleep(25L)
            snapshot = service.resourceSnapshotForTest()
        }

        assertTrue(snapshot.shutdownComplete)
        assertTrue(ProductDataSyncQuotaFence.isExhausted(context))
        assertEquals(0, snapshot.interactionLeases)
        assertFalse(snapshot.notificationReceiverRegistered)
        assertFalse(snapshot.wakeLockHeld)
        assertFalse(
            context
                .getSystemService(android.app.NotificationManager::class.java)
                .activeNotifications
                .any { it.id == AndroidNotificationContract.ONGOING_NOTIFICATION_ID },
        )
        context.stopService(Intent(context, ProductEngineService::class.java))
        assertTrue(ProductDataSyncQuotaFence.clearForUserVisibleStart(context))
        ProductInteractionRegistry.resetForTest()
    }
}
