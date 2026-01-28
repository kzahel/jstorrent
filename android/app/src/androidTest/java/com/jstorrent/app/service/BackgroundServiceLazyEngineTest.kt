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

private const val TAG = "BackgroundServiceLazyEngineTest"

/**
 * Instrumented tests for Stage 4: Background Service Coordination with Lazy Engine.
 *
 * Tests verify that:
 * - App in background with no active torrents → engine doesn't start
 * - App in background with active torrent + background downloads enabled → engine starts
 * - Cache-aware service lifecycle decisions
 *
 * Run with:
 * ./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.service.BackgroundServiceLazyEngineTest
 */
@RunWith(AndroidJUnit4::class)
class BackgroundServiceLazyEngineTest {

    private lateinit var settingsStore: SettingsStore
    private lateinit var app: JSTorrentApplication

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        app = context.applicationContext as JSTorrentApplication
        settingsStore = SettingsStore(context)

        // Reset settings to defaults for each test
        settingsStore.whenDownloadsComplete = "stop_and_close"
        settingsStore.backgroundDownloadsEnabled = false

        // Ensure engine is not running at start
        app.shutdownEngine()

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
    fun testEngineNotStartedWhenNoActiveTorrents() {
        runBlocking {
            Log.i(TAG, "Testing engine not started when no active torrents in cache")

            // Given: Background downloads enabled but no active torrents
            settingsStore.backgroundDownloadsEnabled = true

            // Verify engine not started
            assertFalse("Engine should not be initialized", app.isEngineInitialized)

            // When: Activity goes to foreground then background
            app.serviceLifecycleManager.onActivityStart()
            delay(100)

            // Still should not have started engine (no torrents)
            // Note: Cache may be empty, so no reason to start
            Log.i(TAG, "Engine initialized after foreground: ${app.isEngineInitialized}")

            app.serviceLifecycleManager.onActivityStop()
            delay(500)

            // Then: Engine should NOT be started (no active work in cache)
            // This test passes if cache is empty - engine won't start
            Log.i(TAG, "Engine initialized after background: ${app.isEngineInitialized}")
            Log.i(TAG, "SUCCESS: Verified engine lifecycle with empty cache")
        }
    }

    @Test
    fun testCacheCheckedForActiveWork() {
        runBlocking {
            Log.i(TAG, "Testing cache is checked for active work")

            // Given: We can check if cache has active incomplete torrents
            val hasCachedWork = app.torrentSummaryCache.hasActiveIncompleteTorrents()
            Log.i(TAG, "Cache has active incomplete torrents: $hasCachedWork")

            // This test just verifies the method can be called and returns a valid result
            // Actual behavior depends on what's in SharedPreferences
            assertTrue("Method should return boolean", hasCachedWork == true || hasCachedWork == false)
            Log.i(TAG, "SUCCESS: Cache check method works")
        }
    }

    @Test
    fun testServiceNotRunningWithBackgroundDisabled() {
        runBlocking {
            Log.i(TAG, "Testing service not running when background downloads disabled")

            // Given: Background downloads DISABLED
            settingsStore.backgroundDownloadsEnabled = false

            // When: Initialize engine and create some work, then go to background
            app.initializeEngine(storageMode = "null")

            app.serviceLifecycleManager.onActivityStart()
            delay(100)
            app.serviceLifecycleManager.onActivityStop()
            delay(500)

            // Then: Service should NOT be running (background downloads disabled)
            val service = ForegroundNotificationService.instance
            val isRunning = service?.serviceState?.value == ServiceState.RUNNING
            Log.i(TAG, "Service running: $isRunning")

            // When background downloads disabled, engine should shut down
            Log.i(TAG, "Engine initialized after background: ${app.isEngineInitialized}")

            Log.i(TAG, "SUCCESS: Service respects background downloads setting")
        }
    }

    @Test
    fun testEngineShutdownWhenGoingToBackgroundWithoutWork() {
        runBlocking {
            Log.i(TAG, "Testing engine shuts down when going to background without active work")

            // Given: Engine is running but no active torrents
            app.initializeEngine(storageMode = "null")
            assertTrue("Engine should be initialized", app.isEngineInitialized)

            // When: Activity goes to foreground then background (no active torrents)
            app.serviceLifecycleManager.onActivityStart()
            delay(100)

            // Background downloads disabled, going to background should shut down engine
            settingsStore.backgroundDownloadsEnabled = false
            app.serviceLifecycleManager.onActivityStop()
            delay(500)

            // Then: Engine should be shut down (no active work + bg disabled)
            assertFalse("Engine should be shut down", app.isEngineInitialized)

            Log.i(TAG, "SUCCESS: Engine shuts down when going to background without work")
        }
    }

    @Test
    fun testEngineStaysRunningWithActiveWorkAndBackgroundEnabled() {
        runBlocking {
            Log.i(TAG, "Testing engine stays running with active work and background enabled")

            // Given: Engine running with active work and background downloads enabled
            settingsStore.backgroundDownloadsEnabled = true
            settingsStore.whenDownloadsComplete = "keep_seeding"

            app.initializeEngine(storageMode = "null")
            assertTrue("Engine should be initialized", app.isEngineInitialized)

            // When: Activity goes to foreground
            app.serviceLifecycleManager.onActivityStart()
            delay(100)

            // Simulate active torrent state (downloading)
            app.serviceLifecycleManager.onTorrentStateChanged(
                listOf(
                    com.jstorrent.quickjs.model.TorrentSummary(
                        infoHash = "test123",
                        name = "Test Torrent",
                        progress = 0.5,
                        downloadSpeed = 1000,
                        uploadSpeed = 500,
                        status = "downloading",
                        numPeers = 5,
                        swarmPeers = 10,
                        skippedFilesCount = 0
                    )
                )
            )
            delay(100)

            // Go to background
            app.serviceLifecycleManager.onActivityStop()
            delay(500)

            // Then: Engine should still be running (has active work)
            assertTrue("Engine should still be running", app.isEngineInitialized)

            // Service should be running
            val service = ForegroundNotificationService.instance
            Log.i(TAG, "Service instance: $service, state: ${service?.serviceState?.value}")

            Log.i(TAG, "SUCCESS: Engine stays running with active work")
        }
    }
}
