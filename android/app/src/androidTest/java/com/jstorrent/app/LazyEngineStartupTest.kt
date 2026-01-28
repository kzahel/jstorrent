package com.jstorrent.app

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

private const val TAG = "LazyEngineStartupTest"

/**
 * Instrumented tests for Stage 2 of lazy engine startup.
 *
 * Tests that:
 * 1. App launches without starting engine
 * 2. Engine starts when user takes action (play, detail view, add torrent)
 * 3. Engine starts on demand and is functional
 *
 * Run with:
 * ./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.LazyEngineStartupTest
 */
@RunWith(AndroidJUnit4::class)
class LazyEngineStartupTest {

    private lateinit var app: JSTorrentApplication

    @Before
    fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        app = context.applicationContext as JSTorrentApplication

        // Ensure engine is shutdown before each test
        app.shutdownEngine()
        Log.i(TAG, "Engine shutdown for clean test state")
    }

    @After
    fun teardown() {
        // Clean up after tests
        app.shutdownEngine()
        Log.i(TAG, "Engine shutdown after test")
    }

    @Test
    fun appLaunch_doesNotStartEngine() {
        // Given: Fresh app state (engine shutdown in setup)

        // Then: Engine should not be initialized
        assertFalse("Engine should not be initialized on app launch", app.isEngineInitialized)
        assertNull("Engine controller should be null", app.engineController)
    }

    @Test
    fun ensureEngineStarted_startsEngine() = runBlocking {
        // Given: Engine not initialized
        assertFalse("Pre-condition: engine not initialized", app.isEngineInitialized)

        // When: ensureEngineStarted is called
        val controller = app.ensureEngineStarted(storageMode = "null")

        // Then: Engine should be initialized
        assertTrue("Engine should be initialized", app.isEngineInitialized)
        assertNotNull("Controller should not be null", controller)

        // Wait for engine to fully load
        repeat(30) {
            if (controller.isLoaded?.value == true) return@repeat
            delay(100)
        }
        assertTrue("Engine should be loaded", controller.isLoaded?.value == true)
    }

    @Test
    fun ensureEngineStarted_isIdempotent() = runBlocking {
        // Given: Engine not initialized
        assertFalse("Pre-condition: engine not initialized", app.isEngineInitialized)

        // When: ensureEngineStarted is called multiple times
        val controller1 = app.ensureEngineStarted(storageMode = "null")
        val controller2 = app.ensureEngineStarted(storageMode = "null")
        val controller3 = app.ensureEngineStarted(storageMode = "null")

        // Then: Same controller returned each time
        assertTrue("Should return same controller", controller1 === controller2)
        assertTrue("Should return same controller", controller2 === controller3)
    }

    @Test
    fun engineStartsOnDemand_andIsFunctional() = runBlocking {
        // Given: Engine not initialized
        assertFalse("Pre-condition: engine not initialized", app.isEngineInitialized)

        // When: Engine is started on demand
        val controller = app.ensureEngineStarted(storageMode = "null")

        // Wait for engine to fully load
        repeat(30) {
            if (controller.isLoaded?.value == true) return@repeat
            delay(100)
        }

        // Then: Engine should be functional - can add a torrent
        val testMagnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Test"
        controller.addTorrentAsync(testMagnet)

        // Wait for torrent to be added
        delay(500)

        // Verify torrent was added (state should have at least one torrent)
        val state = controller.state.value
        assertNotNull("State should not be null", state)
        assertTrue("Should have at least one torrent", state?.torrents?.isNotEmpty() == true)
    }

    @Test
    fun multipleEngineRestarts_workCorrectly() = runBlocking {
        // Start engine first time
        val controller1 = app.ensureEngineStarted(storageMode = "null")
        repeat(30) {
            if (controller1.isLoaded?.value == true) return@repeat
            delay(100)
        }
        assertTrue("Engine should load first time", controller1.isLoaded?.value == true)

        // Shutdown engine
        app.shutdownEngine()
        assertFalse("Engine should be shutdown", app.isEngineInitialized)

        // Start engine second time
        val controller2 = app.ensureEngineStarted(storageMode = "null")
        repeat(30) {
            if (controller2.isLoaded?.value == true) return@repeat
            delay(100)
        }
        assertTrue("Engine should load second time", controller2.isLoaded?.value == true)

        // Controllers should be different instances
        assertTrue("Should be different controller instances", controller1 !== controller2)
    }
}
