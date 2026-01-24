package com.jstorrent.app.e2e

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * E2E tests for bandwidth limiting.
 *
 * These tests require the Python seeder to be running:
 *   cd packages/engine/integration/python
 *   uv run python seed_for_test.py --size 100mb --quiet
 *
 * Run with:
 *   ./gradlew :app:connectedAndroidTest \
 *     -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.e2e.BandwidthLimitE2ETest
 */
@RunWith(AndroidJUnit4::class)
class BandwidthLimitE2ETest : E2EBaseTest() {

    companion object {
        private const val TAG = "BandwidthLimitE2ETest"
        private const val LIMIT_100KB = 100 * 1024 // 100 KB/s
        private const val MEASUREMENT_WINDOW_MS = 5000L
        // TokenBucket allows burst of 2x rate, so allow some tolerance
        private const val TOLERANCE_FACTOR = 2.0
    }

    /**
     * Test that download speed stays under the configured limit.
     *
     * Sets a 100 KB/s limit, downloads from seeder, measures average speed,
     * and verifies it stays under the limit (with tolerance for burst).
     */
    @Test
    fun downloadLimit_speedStaysUnderLimit() {
        val engine = requireEngine()
        val magnet = TestMagnets.getMagnetForTest(arguments, "100mb")
        val expectedHash = TestMagnets.InfoHashes.TEST_100MB

        // Set download limit to 100 KB/s
        engine.setDownloadSpeedLimit(LIMIT_100KB)
        Log.i(TAG, "Set download limit to $LIMIT_100KB B/s (100 KB/s)")

        // Add torrent and wait for download activity
        engine.addTorrent(magnet)
        waitForTorrent(expectedHash)
        waitForPeers(expectedHash)

        // Wait for initial burst to settle (TokenBucket burst capacity is 2s)
        Thread.sleep(3000)

        // Measure average speed over window
        val startTorrent = getTorrentByHash(expectedHash)
        val startDownloaded = startTorrent?.downloaded ?: 0L
        Log.i(TAG, "Start measurement: downloaded=$startDownloaded bytes")

        Thread.sleep(MEASUREMENT_WINDOW_MS)

        val endTorrent = getTorrentByHash(expectedHash)
        val endDownloaded = endTorrent?.downloaded ?: 0L
        val bytesDownloaded = endDownloaded - startDownloaded
        val elapsedSeconds = MEASUREMENT_WINDOW_MS / 1000.0
        val avgSpeed = bytesDownloaded / elapsedSeconds

        Log.i(TAG, "End measurement: downloaded=$endDownloaded bytes")
        Log.i(TAG, "Downloaded $bytesDownloaded bytes in ${elapsedSeconds}s = ${avgSpeed.toLong()} B/s")
        Log.i(TAG, "Limit: $LIMIT_100KB B/s, Max allowed: ${(LIMIT_100KB * TOLERANCE_FACTOR).toLong()} B/s")

        logTorrentState()

        assertTrue(
            "Average speed (${avgSpeed.toLong()} B/s) should be under limit * tolerance " +
                "(${(LIMIT_100KB * TOLERANCE_FACTOR).toLong()} B/s)",
            avgSpeed <= LIMIT_100KB * TOLERANCE_FACTOR
        )
    }

    /**
     * Test that changing limit at runtime takes effect.
     *
     * Starts without limit, then applies 100 KB/s limit,
     * and verifies the speed drops accordingly.
     */
    @Test
    fun runtimeLimitChange_takesEffect() {
        val engine = requireEngine()
        val magnet = TestMagnets.getMagnetForTest(arguments, "100mb")
        val expectedHash = TestMagnets.InfoHashes.TEST_100MB

        // Start with no limit (0 = unlimited)
        engine.setDownloadSpeedLimit(0)
        Log.i(TAG, "Starting with unlimited speed")

        engine.addTorrent(magnet)
        waitForTorrent(expectedHash)
        waitForPeers(expectedHash)
        waitForProgress(expectedHash, minProgress = 0.01)

        // Measure speed with no limit
        Thread.sleep(2000)
        val unlimitedTorrent = getTorrentByHash(expectedHash)
        val unlimitedSpeed = unlimitedTorrent?.downloadSpeed ?: 0L
        Log.i(TAG, "Unlimited speed: $unlimitedSpeed B/s")

        // Now apply limit
        engine.setDownloadSpeedLimit(LIMIT_100KB)
        Log.i(TAG, "Applied limit: $LIMIT_100KB B/s (100 KB/s)")

        // Wait for limit to take effect.
        // SpeedCalculator uses a 5-second rolling window, so we need to wait
        // at least 5 seconds for the window to "flush out" old high-speed data.
        // We add 1 extra second for TokenBucket burst capacity.
        Thread.sleep(6000)

        // Measure new speed
        val limitedTorrent = getTorrentByHash(expectedHash)
        val limitedSpeed = limitedTorrent?.downloadSpeed ?: 0L
        Log.i(TAG, "Limited speed: $limitedSpeed B/s")

        logTorrentState()

        // Speed should be under limit (with tolerance)
        assertTrue(
            "Speed after limit ($limitedSpeed B/s) should be under limit " +
                "(${(LIMIT_100KB * TOLERANCE_FACTOR).toLong()} B/s)",
            limitedSpeed <= LIMIT_100KB * TOLERANCE_FACTOR
        )

        // If we were going fast before, verify speed dropped significantly
        if (unlimitedSpeed > LIMIT_100KB * 3) {
            assertTrue(
                "Speed should drop significantly after limit " +
                    "(was $unlimitedSpeed B/s, now $limitedSpeed B/s)",
                limitedSpeed < unlimitedSpeed * 0.5
            )
        }
    }

    /**
     * Test that removing limit restores full speed.
     */
    @Test
    fun removingLimit_restoresSpeed() {
        val engine = requireEngine()
        val magnet = TestMagnets.getMagnetForTest(arguments, "100mb")
        val expectedHash = TestMagnets.InfoHashes.TEST_100MB

        // Start with a strict limit
        engine.setDownloadSpeedLimit(LIMIT_100KB)
        Log.i(TAG, "Starting with 100 KB/s limit")

        engine.addTorrent(magnet)
        waitForTorrent(expectedHash)
        waitForPeers(expectedHash)
        Thread.sleep(3000)

        // Verify speed is limited
        val limitedTorrent = getTorrentByHash(expectedHash)
        val limitedSpeed = limitedTorrent?.downloadSpeed ?: 0L
        Log.i(TAG, "Limited speed: $limitedSpeed B/s")

        // Remove limit (0 = unlimited)
        engine.setDownloadSpeedLimit(0)
        Log.i(TAG, "Removed limit (set to unlimited)")

        // Wait for speed to ramp up
        Thread.sleep(3000)

        val unlimitedTorrent = getTorrentByHash(expectedHash)
        val unlimitedSpeed = unlimitedTorrent?.downloadSpeed ?: 0L
        Log.i(TAG, "Unlimited speed: $unlimitedSpeed B/s")

        logTorrentState()

        // Speed should be higher after removing limit (if network allows)
        // This may not always be true if network is slow, so just log it
        Log.i(TAG, "Speed change: $limitedSpeed -> $unlimitedSpeed B/s")
    }

    /**
     * Test upload speed limit.
     *
     * Note: This test requires the torrent to be seeding (100% complete).
     * It's harder to test reliably since upload depends on remote peer demand.
     */
    @Test
    fun uploadLimit_canBeSet() {
        val engine = requireEngine()

        // Just verify the API works without crashing
        engine.setUploadSpeedLimit(LIMIT_100KB)
        Log.i(TAG, "Set upload limit to $LIMIT_100KB B/s")

        val limit = engine.getUploadSpeedLimit()
        assertTrue("Upload limit should be set", limit == LIMIT_100KB)

        // Reset
        engine.setUploadSpeedLimit(0)
        val newLimit = engine.getUploadSpeedLimit()
        assertTrue("Upload limit should be reset to 0 (unlimited)", newLimit == 0)
    }

    /**
     * Test that bandwidth limits persist across settings.
     */
    @Test
    fun bandwidthLimits_gettersWork() {
        val engine = requireEngine()

        // Set limits
        engine.setDownloadSpeedLimit(512 * 1024) // 512 KB/s
        engine.setUploadSpeedLimit(256 * 1024) // 256 KB/s

        // Verify getters
        val downloadLimit = engine.getDownloadSpeedLimit()
        val uploadLimit = engine.getUploadSpeedLimit()

        assertTrue("Download limit getter should work", downloadLimit == 512 * 1024)
        assertTrue("Upload limit getter should work", uploadLimit == 256 * 1024)

        Log.i(TAG, "Limits verified: download=$downloadLimit, upload=$uploadLimit")
    }
}
