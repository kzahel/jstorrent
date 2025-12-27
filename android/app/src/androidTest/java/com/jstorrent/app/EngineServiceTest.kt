package com.jstorrent.app

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.e2e.TestMagnets
import com.jstorrent.app.service.EngineService
import org.junit.Test
import org.junit.runner.RunWith
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val TAG = "EngineServiceTest"

/**
 * Instrumentation test for EngineService.
 *
 * Run with: ./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.EngineServiceTest
 */
@RunWith(AndroidJUnit4::class)
class EngineServiceTest {

    @Test
    fun testEngineServiceStartsAndLoads() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        Log.i(TAG, "Starting EngineService test")

        // Start the service with null storage mode (in-memory, no SAF permissions needed)
        EngineService.start(context, "null")
        Log.i(TAG, "EngineService.start() called")

        // Wait for service to initialize
        val latch = CountDownLatch(1)
        var loaded = false

        Thread {
            // Poll for service instance and loaded state
            repeat(30) { attempt ->
                val instance = EngineService.instance
                if (instance != null) {
                    Log.i(TAG, "Service instance available (attempt $attempt)")

                    val isLoadedFlow = instance.isLoaded
                    if (isLoadedFlow?.value == true) {
                        Log.i(TAG, "Engine is loaded!")
                        loaded = true
                        latch.countDown()
                        return@Thread
                    }
                }
                Thread.sleep(500)
            }
            Log.e(TAG, "Timeout waiting for engine to load")
            latch.countDown()
        }.start()

        latch.await(20, TimeUnit.SECONDS)

        // Check result
        val instance = EngineService.instance
        Log.i(TAG, "Final check - instance: ${instance != null}, loaded: $loaded")

        if (instance != null && loaded) {
            Log.i(TAG, "SUCCESS: Engine service started and loaded")

            // Try adding a torrent using deterministic test data
            // This uses known info hash from seed_for_test.py with seed 0xDEADBEEF
            val magnetLink = TestMagnets.buildMagnetLink(
                infoHash = TestMagnets.InfoHashes.TEST_100MB,
                displayName = TestMagnets.DisplayNames.TEST_100MB
            )
            instance.addTorrent(magnetLink)
            Log.i(TAG, "addTorrent called with test magnet: $magnetLink")

            // Wait a bit for the torrent to be processed
            Thread.sleep(2000)

            // Query torrent list
            val torrents = instance.getTorrentList()
            Log.i(TAG, "getTorrentList returned ${torrents.size} torrents")
            torrents.forEach { t ->
                Log.i(TAG, "Torrent: name=${t.name}, infoHash=${t.infoHash}, status=${t.status}")
            }

            // Verify the torrent was added with the expected info hash
            val expectedHash = TestMagnets.InfoHashes.TEST_100MB
            val addedTorrent = torrents.find {
                it.infoHash.equals(expectedHash, ignoreCase = true)
            }
            assert(addedTorrent != null) {
                "Expected torrent with hash $expectedHash not found in list"
            }
            Log.i(TAG, "Verified torrent added: ${addedTorrent?.name}")

            // Check state flow
            val state = instance.state?.value
            Log.i(TAG, "State flow value: ${state?.torrents?.size ?: 0} torrents")
            state?.torrents?.forEach { t ->
                Log.i(TAG, "State torrent: name=${t.name}, progress=${t.progress}")
            }

            // Clean up - remove the test torrent
            instance.removeTorrent(expectedHash, deleteFiles = true)
            Log.i(TAG, "Removed test torrent")
        }

        // Stop service
        EngineService.stop(context)
        Log.i(TAG, "EngineService.stop() called")

        assert(loaded) { "Engine failed to load" }
    }

    @Test
    fun testAsyncMethods() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        Log.i(TAG, "Starting async methods test")

        // Start the service with null storage mode (in-memory, no SAF permissions needed)
        EngineService.start(context, "null")
        Log.i(TAG, "EngineService.start() called")

        // Wait for engine to load (polling with coroutine delay)
        var instance: EngineService? = null
        repeat(30) {
            instance = EngineService.instance
            if (instance?.isLoaded?.value == true) return@repeat
            delay(500)
        }
        requireNotNull(instance) { "Engine failed to load" }
        assert(instance!!.isLoaded?.value == true) { "Engine not loaded" }
        Log.i(TAG, "Engine loaded, testing async methods")

        // Test async add
        val magnetLink = TestMagnets.buildMagnetLink(
            infoHash = TestMagnets.InfoHashes.TEST_100MB,
            displayName = TestMagnets.DisplayNames.TEST_100MB
        )
        instance!!.addTorrentAsync(magnetLink)
        Log.i(TAG, "addTorrentAsync called with test magnet")
        delay(2000)

        // Test async query
        val torrents = instance!!.getTorrentListAsync()
        val infoHash = TestMagnets.InfoHashes.TEST_100MB
        Log.i(TAG, "getTorrentListAsync returned ${torrents.size} torrents")
        assert(torrents.any { it.infoHash.equals(infoHash, ignoreCase = true) }) {
            "Expected torrent with hash $infoHash not found"
        }

        // Test async file query
        val files = instance!!.getFilesAsync(infoHash)
        Log.i(TAG, "getFilesAsync returned ${files.size} files")

        // Test async pause/resume
        instance!!.pauseTorrentAsync(infoHash)
        Log.i(TAG, "pauseTorrentAsync called")
        delay(500)

        instance!!.resumeTorrentAsync(infoHash)
        Log.i(TAG, "resumeTorrentAsync called")
        delay(500)

        // Test async remove
        instance!!.removeTorrentAsync(infoHash, deleteFiles = true)
        Log.i(TAG, "removeTorrentAsync called")
        delay(500)

        // Verify removal
        val torrentsAfterRemove = instance!!.getTorrentListAsync()
        assert(torrentsAfterRemove.none { it.infoHash.equals(infoHash, ignoreCase = true) }) {
            "Torrent should have been removed"
        }
        Log.i(TAG, "Verified torrent removed")

        // Cleanup
        EngineService.stop(context)
        Log.i(TAG, "Async methods test completed successfully")
        Unit
    }
}
