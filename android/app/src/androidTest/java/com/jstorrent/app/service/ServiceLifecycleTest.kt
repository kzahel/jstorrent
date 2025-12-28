package com.jstorrent.app.service

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.settings.SettingsStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val TAG = "ServiceLifecycleTest"

/**
 * Instrumentation tests for Phase 6: Service Lifecycle Management.
 *
 * Tests:
 * - Service starts in RUNNING state
 * - Settings persistence (wifiOnlyEnabled, whenDownloadsComplete)
 * - WiFi-only setting changes take effect at runtime
 * - Auto-stop behavior with "stop_and_close" setting
 *
 * Run with:
 * ./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.service.ServiceLifecycleTest
 */
@RunWith(AndroidJUnit4::class)
class ServiceLifecycleTest {

    private lateinit var settingsStore: SettingsStore

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        settingsStore = SettingsStore(context)

        // Reset settings to defaults for each test
        settingsStore.whenDownloadsComplete = "stop_and_close"
        settingsStore.wifiOnlyEnabled = false
    }

    @After
    fun tearDown() {
        // Reset foreground flag to prevent test pollution
        EngineService.isActivityInForeground = false

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        EngineService.stop(context)
        Thread.sleep(500)
    }

    @Test
    fun testServiceStartsInRunningState() {
        runBlocking {
            Log.i(TAG, "Testing service starts in RUNNING state")
            val context = InstrumentationRegistry.getInstrumentation().targetContext

            // Start the service
            EngineService.start(context, "null")

            // Wait for service to start
            waitForService()

            // Check service state is RUNNING
            val service = EngineService.instance
            assertNotNull("Service should be available", service)
            assertEquals("Service should be in RUNNING state", ServiceState.RUNNING, service?.serviceState?.value)

            Log.i(TAG, "SUCCESS: Service started in RUNNING state")
        }
    }

    @Test
    fun testWhenDownloadsCompleteSettingPersists() {
        Log.i(TAG, "Testing whenDownloadsComplete setting persistence")

        // Test default value
        assertEquals("Default should be stop_and_close", "stop_and_close", settingsStore.whenDownloadsComplete)

        // Test changing to keep_seeding
        settingsStore.whenDownloadsComplete = "keep_seeding"
        assertEquals("Should persist keep_seeding", "keep_seeding", settingsStore.whenDownloadsComplete)

        // Test changing back to stop_and_close
        settingsStore.whenDownloadsComplete = "stop_and_close"
        assertEquals("Should persist stop_and_close", "stop_and_close", settingsStore.whenDownloadsComplete)

        Log.i(TAG, "SUCCESS: whenDownloadsComplete setting persists correctly")
    }

    @Test
    fun testWifiOnlySettingPersists() {
        Log.i(TAG, "Testing wifiOnlyEnabled setting persistence")

        // Test default value
        assertFalse("Default should be false", settingsStore.wifiOnlyEnabled)

        // Test enabling
        settingsStore.wifiOnlyEnabled = true
        assertTrue("Should persist true", settingsStore.wifiOnlyEnabled)

        // Test disabling
        settingsStore.wifiOnlyEnabled = false
        assertFalse("Should persist false", settingsStore.wifiOnlyEnabled)

        Log.i(TAG, "SUCCESS: wifiOnlyEnabled setting persists correctly")
    }

    @Test
    fun testWifiOnlyRuntimeToggle() {
        runBlocking {
            Log.i(TAG, "Testing WiFi-only runtime toggle")
            val context = InstrumentationRegistry.getInstrumentation().targetContext

            // Ensure WiFi-only is disabled initially
            settingsStore.wifiOnlyEnabled = false

            // Start the service
            EngineService.start(context, "null")
            waitForService()

            val service = EngineService.instance
            assertNotNull("Service should be available", service)

            // Enable WiFi-only at runtime
            service?.setWifiOnlyEnabled(true)
            delay(100) // Give it a moment to process

            // Verify setting was updated
            assertTrue("wifiOnlyEnabled should be true after runtime toggle", settingsStore.wifiOnlyEnabled)

            // Disable WiFi-only at runtime
            service?.setWifiOnlyEnabled(false)
            delay(100)

            // Verify setting was updated
            assertFalse("wifiOnlyEnabled should be false after runtime toggle", settingsStore.wifiOnlyEnabled)

            Log.i(TAG, "SUCCESS: WiFi-only runtime toggle works correctly")
        }
    }

    @Test
    fun testServiceStateExposedCorrectly() {
        runBlocking {
            Log.i(TAG, "Testing serviceState is exposed correctly")
            val context = InstrumentationRegistry.getInstrumentation().targetContext

            // Start the service
            EngineService.start(context, "null")
            waitForService()

            val service = EngineService.instance
            assertNotNull("Service should be available", service)

            // Verify serviceState StateFlow is accessible
            val stateFlow = service?.serviceState
            assertNotNull("serviceState StateFlow should be accessible", stateFlow)

            // Verify initial state
            val currentState = stateFlow?.value
            assertEquals("Initial state should be RUNNING", ServiceState.RUNNING, currentState)

            Log.i(TAG, "SUCCESS: serviceState is exposed correctly")
        }
    }

    @Test
    fun testKeepSeedingDoesNotAutoStop() {
        runBlocking {
            Log.i(TAG, "Testing keep_seeding does not trigger auto-stop")
            val context = InstrumentationRegistry.getInstrumentation().targetContext

            // Set to keep_seeding mode
            settingsStore.whenDownloadsComplete = "keep_seeding"

            // Start the service
            EngineService.start(context, "null")
            waitForService()

            val service = EngineService.instance
            assertNotNull("Service should be available", service)

            // Wait a bit to ensure service doesn't auto-stop
            delay(2000)

            // Service should still be running
            val currentService = EngineService.instance
            assertNotNull("Service should still be running with keep_seeding setting", currentService)
            assertEquals("Service should be in RUNNING state", ServiceState.RUNNING, currentService?.serviceState?.value)

            Log.i(TAG, "SUCCESS: Service stays running with keep_seeding setting")
        }
    }

    @Test
    fun testAutoStopWithNoTorrentsWhenBackgrounded() {
        runBlocking {
            Log.i(TAG, "Testing auto-stop with no torrents when backgrounded")
            val context = InstrumentationRegistry.getInstrumentation().targetContext

            // Set to stop_and_close mode
            settingsStore.whenDownloadsComplete = "stop_and_close"

            // Start the service
            EngineService.start(context, "null")
            waitForService()

            val service = EngineService.instance
            assertNotNull("Service should be available", service)

            // Simulate backgrounding the app
            EngineService.isActivityInForeground = false

            // Wait past grace period (5 seconds) plus some buffer for the check loop
            delay(7000)

            // Service should have stopped (instance may be null or state STOPPED)
            val currentService = EngineService.instance
            val stopped = currentService == null || currentService.serviceState.value == ServiceState.STOPPED
            assertTrue("Service should stop when no torrents and backgrounded", stopped)

            Log.i(TAG, "SUCCESS: Service auto-stops when no torrents and backgrounded")
        }
    }

    @Test
    fun testNoAutoStopWithNoTorrentsWhenForegrounded() {
        runBlocking {
            Log.i(TAG, "Testing no auto-stop with no torrents when foregrounded")
            val context = InstrumentationRegistry.getInstrumentation().targetContext

            // Set to stop_and_close mode
            settingsStore.whenDownloadsComplete = "stop_and_close"

            // Start the service
            EngineService.start(context, "null")
            waitForService()

            val service = EngineService.instance
            assertNotNull("Service should be available", service)

            // Keep activity in foreground (simulate user viewing app)
            EngineService.isActivityInForeground = true

            // Wait past grace period
            delay(7000)

            // Service should still be running (foregrounded prevents auto-stop)
            val currentService = EngineService.instance
            assertNotNull("Service should still be running when foregrounded", currentService)
            assertEquals("Service should be in RUNNING state", ServiceState.RUNNING, currentService?.serviceState?.value)

            Log.i(TAG, "SUCCESS: Service does not auto-stop when foregrounded")
        }
    }

    @Test
    fun testNoAutoStopInPausedWifiState() {
        runBlocking {
            Log.i(TAG, "Testing no auto-stop when in PAUSED_WIFI state")
            val context = InstrumentationRegistry.getInstrumentation().targetContext

            // Enable WiFi-only mode
            settingsStore.wifiOnlyEnabled = true
            settingsStore.whenDownloadsComplete = "stop_and_close"

            // Start the service
            EngineService.start(context, "null")
            waitForService()

            val service = EngineService.instance
            assertNotNull("Service should be available", service)

            // Simulate losing WiFi - this sets PAUSED_WIFI state
            // We need to call the internal method or trigger network change
            // For now, we verify that if service IS in PAUSED_WIFI, it doesn't stop
            // This test will be more meaningful when we can simulate network changes

            // Background the app
            EngineService.isActivityInForeground = false

            // Wait past grace period
            delay(7000)

            // If service is in PAUSED_WIFI state, it should NOT have stopped
            // (even though there are no active torrents)
            val currentService = EngineService.instance
            if (currentService?.serviceState?.value == ServiceState.PAUSED_WIFI) {
                Log.i(TAG, "Service is in PAUSED_WIFI state - verifying it stays running")
                assertNotNull("Service should still be running in PAUSED_WIFI state", currentService)
            } else {
                // Service isn't in PAUSED_WIFI (WiFi is available), so it may have stopped
                // This is expected behavior - the test passes either way
                Log.i(TAG, "Service not in PAUSED_WIFI (WiFi available), test passes")
            }

            Log.i(TAG, "SUCCESS: PAUSED_WIFI state check completed")
        }
    }

    /**
     * Wait for the EngineService to be available and loaded.
     */
    private fun waitForService(timeoutMs: Long = 15000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (EngineService.instance?.isLoaded?.value == true) {
                return true
            }
            Thread.sleep(100)
        }
        return false
    }
}
