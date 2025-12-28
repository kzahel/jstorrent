package com.jstorrent.app.e2e

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Ignore
import org.junit.Test
import org.junit.runner.RunWith

/**
 * E2E tests for downloading from an external seeder.
 *
 * These tests require the Python seeder to be running:
 *   cd packages/engine/integration/python
 *   uv run python seed_for_test.py --size 100mb --quiet
 *
 * For Android emulator, use 10.0.2.2 which maps to the host's loopback.
 *
 * Run with:
 *   ./gradlew :app:connectedAndroidTest \
 *     -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.e2e.DownloadE2ETest
 *
 * Or with custom seeder configuration:
 *   adb shell am instrument -w \
 *     -e seeder_host 192.168.1.100 \
 *     -e seeder_port 6881 \
 *     -e class com.jstorrent.app.e2e.DownloadE2ETest \
 *     com.jstorrent.app.test/androidx.test.runner.AndroidJUnitRunner
 */
@RunWith(AndroidJUnit4::class)
class DownloadE2ETest : E2EBaseTest() {

    companion object {
        private const val TAG = "DownloadE2ETest"
    }

    /**
     * Test that adding a magnet link creates a torrent in the list.
     *
     * This test does NOT require the seeder to be running - it just
     * verifies that the engine properly handles the magnet link.
     */
    @Test
    fun addMagnet_torrentAppearsInList() {
        val engine = requireEngine()
        val magnet = TestMagnets.getMagnetForTest(arguments, "100mb")
        val expectedHash = TestMagnets.InfoHashes.TEST_100MB

        Log.i(TAG, "Adding magnet: $magnet")
        engine.addTorrent(magnet)

        // Wait for torrent to appear
        val torrent = waitForTorrent(expectedHash, timeoutMs = 10_000)
        assertNotNull("Torrent should appear in list after adding magnet", torrent)

        Log.i(TAG, "Torrent added: ${torrent?.name}, status=${torrent?.status}")
        logTorrentState()
    }

    /**
     * Test downloading from a running seeder.
     *
     * Requires the Python seeder to be running on the host.
     * In CI, the seeder is started automatically before this test.
     * The emulator reaches the host via 10.0.2.2.
     *
     * TODO: Fix seed-for-test infrastructure - seeder connectivity issues
     * prevent reliable peer connections from emulator/device.
     */
    @Ignore("seed-for-test infrastructure needs fixing - seeder not reachable from test devices")
    @Test
    fun downloadFromSeeder_makesProgress() {
        val engine = requireEngine()
        val magnet = TestMagnets.getMagnetForTest(arguments, "100mb")
        val expectedHash = TestMagnets.InfoHashes.TEST_100MB

        Log.i(TAG, "Adding magnet with seeder hint: $magnet")
        engine.addTorrent(magnet)

        // Wait for torrent to appear
        val torrent = waitForTorrent(expectedHash)
        assertNotNull("Torrent should appear in list", torrent)
        Log.i(TAG, "Torrent added: ${torrent?.name}")

        // Wait for peers to connect
        val peersConnected = waitForPeers(expectedHash, minPeers = 1, timeoutMs = 30_000)
        assertTrue("Should connect to seeder peer", peersConnected)

        // Wait for download progress
        val madeProgress = waitForProgress(expectedHash, minProgress = 0.05, timeoutMs = 60_000)
        logTorrentState()
        assertTrue("Should make download progress (at least 5%)", madeProgress)

        // Verify download speed was non-zero at some point
        val finalTorrent = getTorrentByHash(expectedHash)
        assertNotNull("Torrent should still exist", finalTorrent)
        Log.i(TAG, "Final state: progress=${finalTorrent?.progress}, " +
            "downloaded=${finalTorrent?.downloaded}B")
    }

    /**
     * Test that pausing stops download progress.
     */
    @Test
    fun pauseTorrent_stopsDownload() {
        val engine = requireEngine()
        val magnet = TestMagnets.getMagnetForTest(arguments, "100mb")
        val expectedHash = TestMagnets.InfoHashes.TEST_100MB

        // Add and wait for initial progress
        engine.addTorrent(magnet)
        waitForTorrent(expectedHash)
        waitForPeers(expectedHash)
        waitForProgress(expectedHash, minProgress = 0.01)

        // Record progress before pause
        val beforePause = getTorrentByHash(expectedHash)
        val progressBeforePause = beforePause?.downloaded ?: 0L
        Log.i(TAG, "Progress before pause: ${beforePause?.progress}, downloaded=$progressBeforePause")

        // Pause the torrent
        engine.pauseTorrent(expectedHash)
        Log.i(TAG, "Torrent paused")

        // Wait a bit
        Thread.sleep(3000)

        // Verify no more progress
        val afterPause = getTorrentByHash(expectedHash)
        val progressAfterPause = afterPause?.downloaded ?: 0L
        Log.i(TAG, "Progress after pause: ${afterPause?.progress}, downloaded=$progressAfterPause")

        // Downloaded bytes should not have increased significantly
        val deltaBytes = progressAfterPause - progressBeforePause
        assertTrue(
            "Download should stop when paused (delta: $deltaBytes bytes)",
            deltaBytes < 1024 * 1024  // Allow up to 1MB of buffered data
        )
    }

    /**
     * Test that resuming continues download.
     *
     * TODO: Fix seed-for-test infrastructure - seeder connectivity issues
     * prevent reliable peer connections from emulator/device.
     */
    @Ignore("seed-for-test infrastructure needs fixing - seeder not reachable from test devices")
    @Test
    fun resumeTorrent_continuesDownload() {
        val engine = requireEngine()
        val magnet = TestMagnets.getMagnetForTest(arguments, "100mb")
        val expectedHash = TestMagnets.InfoHashes.TEST_100MB

        // Add and pause immediately
        engine.addTorrent(magnet)
        waitForTorrent(expectedHash)
        engine.pauseTorrent(expectedHash)
        Thread.sleep(1000)

        // Record state while paused
        val whilePaused = getTorrentByHash(expectedHash)
        Log.i(TAG, "While paused: progress=${whilePaused?.progress}")

        // Resume
        engine.resumeTorrent(expectedHash)
        Log.i(TAG, "Torrent resumed")

        // Wait for progress after resume
        val madeProgress = waitForProgress(expectedHash, minProgress = 0.05, timeoutMs = 60_000)
        logTorrentState()
        assertTrue("Should make progress after resume", madeProgress)
    }

    /**
     * Full download test - downloads the complete 100MB file.
     *
     * This is a long-running test (potentially several minutes).
     * Only run in CI or when specifically testing download completion.
     *
     * TODO: Fix seed-for-test infrastructure - seeder connectivity issues
     * prevent reliable peer connections from emulator/device.
     */
    @Ignore("seed-for-test infrastructure needs fixing - seeder not reachable from test devices")
    @Test
    fun fullDownload_completes() {
        val engine = requireEngine()
        val magnet = TestMagnets.getMagnetForTest(arguments, "100mb")
        val expectedHash = TestMagnets.InfoHashes.TEST_100MB

        Log.i(TAG, "Starting full download test")
        engine.addTorrent(magnet)

        // Wait for torrent to appear and connect
        waitForTorrent(expectedHash)
        waitForPeers(expectedHash)

        // Wait for completion (2 minute timeout for 100MB)
        val completed = waitForComplete(expectedHash, timeoutMs = 2 * 60_000)
        logTorrentState()

        assertTrue("Download should complete", completed)

        val finalTorrent = getTorrentByHash(expectedHash)
        assertNotNull(finalTorrent)
        assertTrue("Progress should be 100%", finalTorrent!!.progress >= 0.99)
        Log.i(TAG, "Download complete: ${finalTorrent.downloaded} bytes")
    }
}
