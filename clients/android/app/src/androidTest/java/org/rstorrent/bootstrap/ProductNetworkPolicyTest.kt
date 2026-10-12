package org.rstorrent.bootstrap

import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.ServiceTestRule
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.rules.TestRule
import org.junit.runner.RunWith
import org.rstorrent.session.uniffi.ApplicationNetworkPrerequisiteView

@RunWith(AndroidJUnit4::class)
class ProductNetworkPolicyTest {
    private val permissionRule =
        NotificationPermissionRule()
    private val serviceRule = ServiceTestRule.withTimeout(30, TimeUnit.SECONDS)

    @get:Rule
    val rules: TestRule = RuleChain.outerRule(permissionRule).around(serviceRule)

    @Test
    fun preferenceAndNativePrerequisiteConvergeOnCurrentDefaultNetwork() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue(ProductNetworkPreference.persist(context, false))
        ProductInteractionRegistry.resetForTest()
        ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, true)
        context.startForegroundService(Intent(context, ProductEngineService::class.java))
        val binder: IBinder =
            serviceRule.bindService(Intent(context, ProductEngineService::class.java))
        val service = (binder as ProductEngineService.LocalBinder).service

        try {
            withTimeout(30_000L) {
                service.state.first {
                    it.ready &&
                        it.clientSettings != null &&
                        it.network.effectiveNetworkAllowed == true
                }
            }
            assertTrue(service.resourceSnapshotForTest().networkCallbackRegistered)

            service.setUnmeteredNetworksOnly(true)
            val restricted =
                withTimeout(30_000L) {
                    service.state.first { state ->
                        val expected = expectedPrerequisite(state.network.eligibility)
                        state.network.unmeteredNetworksOnly &&
                            state.clientSettings?.applicationNetwork?.requestedPrerequisite ==
                            expected &&
                            state.network.effectiveNetworkAllowed ==
                            (expected == ApplicationNetworkPrerequisiteView.ALLOWED)
                    }
                }
            assertTrue(ProductNetworkPreference.read(context))
            assertEquals(
                expectedPrerequisite(restricted.network.eligibility),
                restricted.clientSettings?.applicationNetwork?.effectivePrerequisite,
            )
            InstrumentationRegistry.getArguments().getString("expectRestricted")?.let {
                assertEquals(
                    it.toBooleanStrict(),
                    restricted.network.eligibility != AndroidNetworkEligibility.UNRESTRICTED,
                )
            }

            service.setUnmeteredNetworksOnly(false)
            withTimeout(30_000L) {
                service.state.first { state ->
                    !state.network.unmeteredNetworksOnly &&
                        state.network.effectiveNetworkAllowed == true &&
                        state.clientSettings?.applicationNetwork?.effectivePrerequisite ==
                        ApplicationNetworkPrerequisiteView.ALLOWED
                }
            }
            assertFalse(ProductNetworkPreference.read(context))
        } finally {
            ProductInteractionRegistry.setActivityVisible(ProductInteractionRegistry, false)
            service.shutdownFromUi()
            val deadline = SystemClock.elapsedRealtime() + 30_000L
            while (
                !service.resourceSnapshotForTest().shutdownComplete &&
                    SystemClock.elapsedRealtime() < deadline
            ) {
                SystemClock.sleep(25L)
            }
            assertTrue(service.resourceSnapshotForTest().shutdownComplete)
            assertFalse(service.resourceSnapshotForTest().networkCallbackRegistered)
            context.stopService(Intent(context, ProductEngineService::class.java))
            ProductInteractionRegistry.resetForTest()
        }
    }

    private fun expectedPrerequisite(
        eligibility: AndroidNetworkEligibility,
    ): ApplicationNetworkPrerequisiteView =
        if (eligibility == AndroidNetworkEligibility.UNRESTRICTED) {
            ApplicationNetworkPrerequisiteView.ALLOWED
        } else {
            ApplicationNetworkPrerequisiteView.WAITING_FOR_UNMETERED_NETWORK
        }
}
