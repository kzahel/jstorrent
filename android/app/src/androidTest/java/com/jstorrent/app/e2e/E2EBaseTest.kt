package com.jstorrent.app.e2e

import android.os.Bundle
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.service.ForegroundNotificationService
import com.jstorrent.quickjs.model.TorrentInfo
import org.junit.After
import org.junit.Before
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Base class for E2E tests that interact with the full engine stack.
 *
 * Provides setup/teardown for ForegroundNotificationService and helper methods for
 * waiting on engine state, checking torrent progress, etc.
 *
 * ## Test Flow
 * 1. @Before starts ForegroundNotificationService and waits for it to load
 * 2. Test adds torrents, checks progress, etc.
 * 3. @After removes all torrents and stops ForegroundNotificationService
 *
 * ## Instrumentation Arguments
 * - seeder_host: Override seeder host (default: 10.0.2.2 for emulator)
 * - seeder_port: Override seeder port (default: 6881)
 *
 * Example:
 * ```
 * adb shell am instrument -w \
 *   -e seeder_host 192.168.1.100 \
 *   -e seeder_port 6881 \
 *   com.jstorrent.app.test/androidx.test.runner.AndroidJUnitRunner
 * ```
 */
abstract class E2EBaseTest {

    companion object {
        private const val TAG = "E2EBaseTest"
    }

    protected lateinit var arguments: Bundle
    protected var engineService: ForegroundNotificationService? = null

    @Before
    open fun setUp() {
        arguments = InstrumentationRegistry.getArguments()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as JSTorrentApplication

        Log.i(TAG, "Starting E2E test setup")
        Log.i(TAG, "Seeder host: ${E2ETestConfig.getSeederHost(arguments)}")
        Log.i(TAG, "Seeder port: ${E2ETestConfig.getSeederPort(arguments)}")

        // Initialize engine via Application (with null storage mode for in-memory)
        // This avoids SAF permission issues during tests
        app.initializeEngine(storageMode = "null")
        Log.i(TAG, "Engine initialized via Application")

        // Mark activity as in foreground via lifecycle manager
        app.serviceLifecycleManager.setActivityForeground(true)

        // Start the service (it will use the Application's engine)
        ForegroundNotificationService.start(context, "null")

        // Wait for engine to load
        val loaded = waitForEngineLoad()
        if (!loaded) {
            throw AssertionError("Engine failed to load within timeout")
        }

        engineService = ForegroundNotificationService.instance
        Log.i(TAG, "E2E test setup complete - engine loaded")
    }

    @After
    open fun tearDown() {
        Log.i(TAG, "Starting E2E test teardown")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as JSTorrentApplication
        // Reset foreground flag to prevent test pollution
        app.serviceLifecycleManager.setActivityForeground(false)

        // Remove all torrents added during the test
        try {
            engineService?.getTorrentList()?.forEach { torrent ->
                Log.i(TAG, "Removing torrent: ${torrent.infoHash}")
                engineService?.removeTorrent(torrent.infoHash, deleteFiles = true)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error removing torrents during teardown", e)
        }

        // Stop the engine service
        ForegroundNotificationService.stop(context)

        // Shutdown engine
        app.shutdownEngine()

        // Wait a bit for service to fully stop
        Thread.sleep(500)

        engineService = null
        Log.i(TAG, "E2E test teardown complete")
    }

    /**
     * Wait for the engine to load with a configurable timeout.
     *
     * @param timeoutMs Maximum time to wait (default from E2ETestConfig)
     * @return true if engine loaded, false on timeout
     */
    protected fun waitForEngineLoad(
        timeoutMs: Long = E2ETestConfig.ENGINE_LOAD_TIMEOUT_MS
    ): Boolean {
        val latch = CountDownLatch(1)
        var loaded = false

        Thread {
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                val instance = ForegroundNotificationService.instance
                if (instance?.isLoaded?.value == true) {
                    loaded = true
                    latch.countDown()
                    return@Thread
                }
                Thread.sleep(E2ETestConfig.POLL_INTERVAL_MS)
            }
            Log.e(TAG, "Timeout waiting for engine to load")
            latch.countDown()
        }.start()

        latch.await(timeoutMs + 1000, TimeUnit.MILLISECONDS)
        return loaded
    }

    /**
     * Wait for a torrent to appear in the torrent list.
     *
     * @param infoHash The info hash to look for
     * @param timeoutMs Maximum time to wait
     * @return The TorrentInfo if found, null on timeout
     */
    protected fun waitForTorrent(
        infoHash: String,
        timeoutMs: Long = E2ETestConfig.DOWNLOAD_START_TIMEOUT_MS
    ): TorrentInfo? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val torrents = engineService?.getTorrentList() ?: emptyList()
            val torrent = torrents.find { it.infoHash.equals(infoHash, ignoreCase = true) }
            if (torrent != null) {
                return torrent
            }
            Thread.sleep(E2ETestConfig.POLL_INTERVAL_MS)
        }
        return null
    }

    /**
     * Wait for a torrent to have connected peers.
     *
     * @param infoHash The info hash to check
     * @param minPeers Minimum number of peers to wait for
     * @param timeoutMs Maximum time to wait
     * @return true if peers connected, false on timeout
     */
    protected fun waitForPeers(
        infoHash: String,
        minPeers: Int = 1,
        timeoutMs: Long = E2ETestConfig.DOWNLOAD_START_TIMEOUT_MS
    ): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val torrent = getTorrentByHash(infoHash)
            if (torrent != null && torrent.peersConnected >= minPeers) {
                Log.i(TAG, "Torrent $infoHash has ${torrent.peersConnected} peers connected")
                return true
            }
            Thread.sleep(E2ETestConfig.POLL_INTERVAL_MS)
        }
        return false
    }

    /**
     * Wait for a torrent to make download progress.
     *
     * @param infoHash The info hash to check
     * @param minProgress Minimum progress (0.0 to 1.0) to wait for
     * @param timeoutMs Maximum time to wait
     * @return true if progress reached, false on timeout
     */
    protected fun waitForProgress(
        infoHash: String,
        minProgress: Double = 0.01, // At least 1%
        timeoutMs: Long = E2ETestConfig.DOWNLOAD_PROGRESS_TIMEOUT_MS
    ): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        var lastProgress = 0.0

        while (System.currentTimeMillis() < deadline) {
            val torrent = getTorrentByHash(infoHash)
            if (torrent != null) {
                if (torrent.progress >= minProgress) {
                    Log.i(TAG, "Torrent $infoHash reached progress: ${torrent.progress}")
                    return true
                }
                if (torrent.progress > lastProgress) {
                    Log.i(TAG, "Torrent $infoHash progress: ${torrent.progress}")
                    lastProgress = torrent.progress
                }
            }
            Thread.sleep(E2ETestConfig.POLL_INTERVAL_MS)
        }
        return false
    }

    /**
     * Wait for a torrent to complete (progress = 1.0).
     *
     * @param infoHash The info hash to check
     * @param timeoutMs Maximum time to wait
     * @return true if completed, false on timeout
     */
    protected fun waitForComplete(
        infoHash: String,
        timeoutMs: Long = E2ETestConfig.DOWNLOAD_PROGRESS_TIMEOUT_MS
    ): Boolean {
        return waitForProgress(infoHash, 1.0, timeoutMs)
    }

    /**
     * Get a torrent by info hash.
     */
    protected fun getTorrentByHash(infoHash: String): TorrentInfo? {
        return engineService?.getTorrentList()
            ?.find { it.infoHash.equals(infoHash, ignoreCase = true) }
    }

    /**
     * Assert that engine is loaded and return the service.
     */
    protected fun requireEngine(): ForegroundNotificationService {
        return engineService ?: throw AssertionError("ForegroundNotificationService not available")
    }

    /**
     * Log the current state of all torrents for debugging.
     */
    protected fun logTorrentState() {
        val torrents = engineService?.getTorrentList() ?: emptyList()
        Log.i(TAG, "Current torrents: ${torrents.size}")
        torrents.forEach { t ->
            Log.i(TAG, "  ${t.name}: progress=${t.progress}, " +
                "status=${t.status}, peers=${t.peersConnected}, " +
                "down=${t.downloadSpeed}B/s, up=${t.uploadSpeed}B/s")
        }
    }
}
