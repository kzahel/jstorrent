package com.jstorrent.app

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.e2e.TestMagnets
import com.jstorrent.app.service.EngineService
import com.jstorrent.app.viewmodel.EngineServiceRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.system.measureTimeMillis

private const val TAG = "RepositoryAsyncTest"

/**
 * Instrumentation tests for async repository methods.
 *
 * Verifies that:
 * - Commands (addTorrent, pauseTorrent, etc.) are fire-and-forget and don't block
 * - Queries (getTorrentList, getFiles) work as suspend functions
 *
 * Run with:
 * ./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.RepositoryAsyncTest
 */
@RunWith(AndroidJUnit4::class)
class RepositoryAsyncTest {

    private lateinit var repository: EngineServiceRepository

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

            // Wait for engine to be fully loaded
            repeat(30) {
                if (app.engineController?.isLoaded?.value == true) return@repeat
                delay(500)
            }
            assertTrue("Engine not loaded", app.engineController?.isLoaded?.value == true)

            repository = EngineServiceRepository(app)
            Log.i(TAG, "Engine loaded, repository created")
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

    @Test
    fun addTorrent_returnsImmediately() {
        // Command should return immediately (fire-and-forget)
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                repository.addTorrent("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567")
            }
        }
        Log.i(TAG, "addTorrent took ${elapsed}ms")
        assertTrue("addTorrent should return in <50ms, took ${elapsed}ms", elapsed < 50)
    }

    @Test
    fun pauseTorrent_returnsImmediately() {
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                repository.pauseTorrent("0123456789abcdef0123456789abcdef01234567")
            }
        }
        Log.i(TAG, "pauseTorrent took ${elapsed}ms")
        assertTrue("pauseTorrent should return in <50ms, took ${elapsed}ms", elapsed < 50)
    }

    @Test
    fun resumeTorrent_returnsImmediately() {
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                repository.resumeTorrent("0123456789abcdef0123456789abcdef01234567")
            }
        }
        Log.i(TAG, "resumeTorrent took ${elapsed}ms")
        assertTrue("resumeTorrent should return in <50ms, took ${elapsed}ms", elapsed < 50)
    }

    @Test
    fun removeTorrent_returnsImmediately() {
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                repository.removeTorrent("0123456789abcdef0123456789abcdef01234567", false)
            }
        }
        Log.i(TAG, "removeTorrent took ${elapsed}ms")
        assertTrue("removeTorrent should return in <50ms, took ${elapsed}ms", elapsed < 50)
    }

    @Test
    fun getTorrentList_suspendVersion_works() = runTest {
        // Add a torrent first
        val magnetLink = TestMagnets.buildMagnetLink(
            infoHash = TestMagnets.InfoHashes.TEST_100MB,
            displayName = TestMagnets.DisplayNames.TEST_100MB
        )
        repository.addTorrent(magnetLink)
        delay(2000) // Wait for torrent to be processed

        // Query using suspend function
        val list = repository.getTorrentList()
        Log.i(TAG, "getTorrentList returned ${list.size} torrents")
        assertNotNull("getTorrentList should return a list", list)

        // Cleanup
        repository.removeTorrent(TestMagnets.InfoHashes.TEST_100MB, true)
    }

    @Test
    fun getFiles_suspendVersion_works() = runTest {
        // Add a torrent first
        val magnetLink = TestMagnets.buildMagnetLink(
            infoHash = TestMagnets.InfoHashes.TEST_100MB,
            displayName = TestMagnets.DisplayNames.TEST_100MB
        )
        repository.addTorrent(magnetLink)
        delay(2000) // Wait for torrent to be processed

        // Query files using suspend function
        val files = repository.getFiles(TestMagnets.InfoHashes.TEST_100MB)
        Log.i(TAG, "getFiles returned ${files.size} files")
        assertNotNull("getFiles should return a list", files)

        // Cleanup
        repository.removeTorrent(TestMagnets.InfoHashes.TEST_100MB, true)
    }

    @Test
    fun pauseAll_doesNotBlock() {
        // pauseAll iterates torrents internally - should not block
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                repository.pauseAll()
            }
        }
        Log.i(TAG, "pauseAll took ${elapsed}ms")
        assertTrue("pauseAll should return in <50ms, took ${elapsed}ms", elapsed < 50)
    }

    @Test
    fun resumeAll_doesNotBlock() {
        // resumeAll iterates torrents internally - should not block
        val elapsed = measureTimeMillis {
            runBlocking(Dispatchers.Main) {
                repository.resumeAll()
            }
        }
        Log.i(TAG, "resumeAll took ${elapsed}ms")
        assertTrue("resumeAll should return in <50ms, took ${elapsed}ms", elapsed < 50)
    }
}
