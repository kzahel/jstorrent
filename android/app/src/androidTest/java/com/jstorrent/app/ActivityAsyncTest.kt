package com.jstorrent.app

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.service.EngineService
import com.jstorrent.app.storage.RootStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.system.measureTimeMillis

private const val TAG = "ActivityAsyncTest"

/**
 * Instrumentation tests for async Activity methods.
 *
 * Verifies that:
 * - Root synchronization uses async methods and doesn't block
 * - Root addition from SAF picker doesn't block Main thread
 *
 * Run with:
 * ./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.ActivityAsyncTest
 */
@RunWith(AndroidJUnit4::class)
class ActivityAsyncTest {

    @Before
    fun setup() {
        runBlocking {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            val app = context.applicationContext as JSTorrentApplication
            Log.i(TAG, "Initializing engine via Application")

            // Initialize engine via Application (with null storage mode for in-memory)
            app.initializeEngine(storageMode = "null")

            // Mark activity as in foreground via lifecycle manager
            app.serviceLifecycleManager.setActivityForeground(true)

            // Start service (it will use the Application's engine)
            Log.i(TAG, "Starting EngineService")
            EngineService.start(context, "null")

            // Wait for engine to be fully loaded and service to start
            repeat(30) {
                if (app.engineController?.isLoaded?.value == true && EngineService.instance != null) return@repeat
                delay(500)
            }
            assertTrue("Engine not loaded", app.engineController?.isLoaded?.value == true)
            assertNotNull("Service not started", EngineService.instance)

            Log.i(TAG, "Engine loaded, service started")
        }
    }

    @After
    fun teardown() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as JSTorrentApplication
        // Reset foreground flag to prevent test pollution
        app.serviceLifecycleManager.setActivityForeground(false)
        EngineService.stop(context)
        app.shutdownEngine()
        // Wait for service to fully stop to avoid race conditions with next test
        Thread.sleep(1000)
        Log.i(TAG, "EngineService stopped")
    }

    private fun getController(): com.jstorrent.quickjs.EngineController {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as JSTorrentApplication
        return app.engineController ?: throw IllegalStateException("Controller not available")
    }

    @Test
    fun addRootAsync_returnsImmediately() {
        val controller = getController()

        // Async root addition should return quickly
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                controller.addRootAsync("test-key", "Test Root", "content://test/uri")
            }
        }
        Log.i(TAG, "addRootAsync took ${elapsed}ms")
        assertTrue("addRootAsync should return in <100ms, took ${elapsed}ms", elapsed < 100)
    }

    @Test
    fun setDefaultRootAsync_returnsImmediately() {
        val controller = getController()

        // First add a root
        runBlocking {
            controller.addRootAsync("test-key", "Test Root", "content://test/uri")
        }

        // Setting default should be quick
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                controller.setDefaultRootAsync("test-key")
            }
        }
        Log.i(TAG, "setDefaultRootAsync took ${elapsed}ms")
        assertTrue("setDefaultRootAsync should return in <100ms, took ${elapsed}ms", elapsed < 100)
    }

    @Test
    fun multipleRoots_addedWithoutBlocking() {
        val controller = getController()

        // Adding multiple roots should not cause cumulative blocking
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                repeat(5) { i ->
                    controller.addRootAsync("test-key-$i", "Test Root $i", "content://test/uri/$i")
                }
            }
        }
        Log.i(TAG, "Adding 5 roots took ${elapsed}ms")
        // Even with 5 roots, should complete quickly (not 5x the single root time)
        assertTrue("Adding 5 roots should return in <200ms, took ${elapsed}ms", elapsed < 200)
    }

    @Test
    fun removeRootAsync_returnsImmediately() {
        val controller = getController()

        // First add a root
        runBlocking {
            controller.addRootAsync("test-key", "Test Root", "content://test/uri")
        }

        // Removing should be quick
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                controller.removeRootAsync("test-key")
            }
        }
        Log.i(TAG, "removeRootAsync took ${elapsed}ms")
        assertTrue("removeRootAsync should return in <100ms, took ${elapsed}ms", elapsed < 100)
    }
}
