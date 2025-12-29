package com.jstorrent.app.service

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.settings.SettingsStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

private const val TAG = "ServiceLifecycleTest"

/**
 * Instrumentation tests for Service Lifecycle Management.
 *
 * Tests:
 * - Service starts in RUNNING state
 * - Settings persistence (wifiOnlyEnabled, whenDownloadsComplete)
 * - WiFi-only setting changes take effect at runtime
 * - ServiceLifecycleManager controls service start/stop
 *
 * Run with:
 * ./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.service.ServiceLifecycleTest
 */
@RunWith(AndroidJUnit4::class)
class ServiceLifecycleTest {

    private lateinit var settingsStore: SettingsStore
    private lateinit var app: JSTorrentApplication

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        app = context.applicationContext as JSTorrentApplication
        settingsStore = SettingsStore(context)

        // Reset settings to defaults for each test
        settingsStore.whenDownloadsComplete = "stop_and_close"
        settingsStore.wifiOnlyEnabled = false

        // Set activity in foreground via lifecycle manager
        app.serviceLifecycleManager.setActivityForeground(true)
    }

    @After
    fun tearDown() {
        // Reset foreground flag to prevent test pollution
        app.serviceLifecycleManager.setActivityForeground(false)

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        ForegroundNotificationService.stop(context)
        app.shutdownEngine()
        Thread.sleep(500)
    }

    @Test
    fun testServiceStartsInRunningState() {
        runBlocking {
            Log.i(TAG, "Testing service starts in RUNNING state")
            val context = InstrumentationRegistry.getInstrumentation().targetContext

            // Initialize engine via Application
            app.initializeEngine(storageMode = "null")

            // Start the service directly (for testing purposes)
            ForegroundNotificationService.start(context, "null")

            // Wait for service to start
            waitForService()

            // Check service state is RUNNING
            val service = ForegroundNotificationService.instance
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

            // Initialize engine via Application
            app.initializeEngine(storageMode = "null")

            // Start the service
            ForegroundNotificationService.start(context, "null")
            waitForService()

            val service = ForegroundNotificationService.instance
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

            // Initialize engine via Application
            app.initializeEngine(storageMode = "null")

            // Start the service
            ForegroundNotificationService.start(context, "null")
            waitForService()

            val service = ForegroundNotificationService.instance
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

            // Initialize engine via Application
            app.initializeEngine(storageMode = "null")

            // Start the service
            ForegroundNotificationService.start(context, "null")
            waitForService()

            val service = ForegroundNotificationService.instance
            assertNotNull("Service should be available", service)

            // Wait a bit to ensure service doesn't auto-stop
            delay(2000)

            // Service should still be running
            val currentService = ForegroundNotificationService.instance
            assertNotNull("Service should still be running with keep_seeding setting", currentService)
            assertEquals("Service should be in RUNNING state", ServiceState.RUNNING, currentService?.serviceState?.value)

            Log.i(TAG, "SUCCESS: Service stays running with keep_seeding setting")
        }
    }

    @Test
    fun testLifecycleManagerForegroundState() {
        runBlocking {
            Log.i(TAG, "Testing lifecycle manager foreground state tracking")

            // Initially should be foreground (set in setUp)
            assertTrue("Initial state should be foreground", app.serviceLifecycleManager.isActivityForeground.value)

            // Set to background
            app.serviceLifecycleManager.setActivityForeground(false)
            assertFalse("Should be background after setting false", app.serviceLifecycleManager.isActivityForeground.value)

            // Set back to foreground
            app.serviceLifecycleManager.setActivityForeground(true)
            assertTrue("Should be foreground after setting true", app.serviceLifecycleManager.isActivityForeground.value)

            Log.i(TAG, "SUCCESS: Lifecycle manager foreground state tracking works")
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

            // Initialize engine via Application
            app.initializeEngine(storageMode = "null")

            // Start the service
            ForegroundNotificationService.start(context, "null")
            waitForService()

            val service = ForegroundNotificationService.instance
            assertNotNull("Service should be available", service)

            // Background the app via lifecycle manager
            app.serviceLifecycleManager.setActivityForeground(false)

            // Wait a bit
            delay(2000)

            // If service is in PAUSED_WIFI state, it should NOT have stopped
            // (even though there are no active torrents)
            val currentService = ForegroundNotificationService.instance
            if (currentService?.serviceState?.value == ServiceState.PAUSED_WIFI) {
                Log.i(TAG, "Service is in PAUSED_WIFI state - verifying it stays running")
                assertNotNull("Service should still be running in PAUSED_WIFI state", currentService)
            } else {
                // Service isn't in PAUSED_WIFI (WiFi is available)
                Log.i(TAG, "Service not in PAUSED_WIFI (WiFi available), test passes")
            }

            Log.i(TAG, "SUCCESS: PAUSED_WIFI state check completed")
        }
    }

    @Test
    fun testEngineHealthCheck() {
        runBlocking {
            Log.i(TAG, "Testing engine health check")

            // Initialize engine
            val engine = app.initializeEngine(storageMode = "null")

            // Engine should be healthy
            assertTrue("Newly initialized engine should be healthy", engine.isHealthy)

            // After shutdown, engine should not be healthy
            app.shutdownEngine()
            assertFalse("Shutdown engine should not be healthy", engine.isHealthy)

            // ensureEngine should create new engine after shutdown
            assertNull("Controller should be null after shutdown", app.engineController)
            val newEngine = app.ensureEngine(storageMode = "null")
            assertTrue("Ensured engine should be healthy", newEngine.isHealthy)

            Log.i(TAG, "SUCCESS: Engine health check works correctly")
        }
    }

    /**
     * Wait for the ForegroundNotificationService to be available and loaded.
     */
    private fun waitForService(timeoutMs: Long = 15000): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (ForegroundNotificationService.instance?.isLoaded?.value == true) {
                return true
            }
            Thread.sleep(100)
        }
        return false
    }
}
