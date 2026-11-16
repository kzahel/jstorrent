package org.rstorrent.bootstrap

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.ServiceTestRule
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ExternalActivityLifecycleTest {
    @get:Rule val serviceRule = ServiceTestRule.withTimeout(15, TimeUnit.SECONDS)

    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test
    fun coldWarmAndRecreatedActivityConsumeEachDeliveryOnce() {
        assertColdWarmAndRecreatedActivityConsumeEachDeliveryOnce(Intent.ACTION_VIEW)
    }

    @Test
    fun chromeOsBrowserColdWarmAndRecreatedActivityConsumeEachDeliveryOnce() {
        assertColdWarmAndRecreatedActivityConsumeEachDeliveryOnce(CHROMEOS_VIEW_ACTION)
    }

    private fun assertColdWarmAndRecreatedActivityConsumeEachDeliveryOnce(action: String) {
        val first = magnet('1')
        val second = magnet('2')
        val application = context.applicationContext as Application
        val monitor = MainActivityMonitor()
        application.registerActivityLifecycleCallbacks(monitor)
        var activity: MainActivity? = null
        try {
            context.startActivity(
                externalView(first, action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            activity = monitor.awaitResumed()
            val service = bindProductService()
            awaitDepth(service, 1)
            assertSanitized(requireNotNull(activity))

            val original = requireNotNull(activity)
            InstrumentationRegistry.getInstrumentation().runOnMainSync(original::recreate)
            activity = monitor.awaitResumed(excluding = original)
            assertSanitized(requireNotNull(activity))
            assertEquals(1, service.state.value.externalIntakeDepth)

            context.startActivity(
                externalView(second, action).addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP,
                ),
            )
            awaitDepth(service, 2)
            assertSanitized(requireNotNull(activity))

            while (service.state.value.externalIntakeDepth > 0) {
                val expectedDepth = service.state.value.externalIntakeDepth - 1
                val intakeId = requireNotNull(service.state.value.externalIntake?.intakeId)
                service.cancelExternalIntake(intakeId)
                awaitDepth(service, expectedDepth)
            }
        } finally {
            activity?.let { current ->
                InstrumentationRegistry.getInstrumentation().runOnMainSync(current::finish)
            }
            context.stopService(Intent(context, ProductEngineService::class.java))
            application.unregisterActivityLifecycleCallbacks(monitor)
        }
    }

    private fun bindProductService(): ProductEngineService {
        val binder =
            serviceRule.bindService(
                Intent(context, ProductEngineService::class.java),
            ) as ProductEngineService.LocalBinder
        return binder.service
    }

    private fun awaitDepth(
        service: ProductEngineService,
        depth: Int,
    ) = runBlocking {
        withTimeout(5_000L) {
            service.state.first { it.externalIntakeDepth == depth }
        }
    }

    private fun assertSanitized(activity: MainActivity) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            assertEquals(Intent.ACTION_MAIN, activity.intent.action)
            assertNull(activity.intent.data)
        }
    }

    private fun externalView(source: String, viewAction: String): Intent =
        Intent(context, MainActivity::class.java).apply {
            action = viewAction
            data = Uri.parse(source)
        }

    private fun magnet(digit: Char): String =
        "magnet:?xt=urn:btih:${digit.toString().repeat(40)}"

    private class MainActivityMonitor : Application.ActivityLifecycleCallbacks {
        private val resumed = LinkedBlockingQueue<MainActivity>()

        fun awaitResumed(excluding: MainActivity? = null): MainActivity {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
            while (System.nanoTime() < deadline) {
                val remaining = deadline - System.nanoTime()
                val activity = resumed.poll(remaining, TimeUnit.NANOSECONDS)
                    ?: break
                if (activity !== excluding) return activity
            }
            throw AssertionError("MainActivity did not resume")
        }

        override fun onActivityResumed(activity: Activity) {
            if (activity is MainActivity) resumed.offer(activity)
        }

        override fun onActivityCreated(activity: Activity, state: Bundle?) = Unit

        override fun onActivityStarted(activity: Activity) = Unit

        override fun onActivityPaused(activity: Activity) = Unit

        override fun onActivityStopped(activity: Activity) = Unit

        override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) = Unit

        override fun onActivityDestroyed(activity: Activity) = Unit
    }
}
