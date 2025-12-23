package com.jstorrent.app

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.service.EngineService
import org.junit.Test
import org.junit.runner.RunWith
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

        // Start the service
        EngineService.start(context)
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

            // Try adding a torrent
            val magnetLink = "magnet:?xt=urn:btih:95c6c298c84fee2eee10c044d673537da158f0f8&dn=ubuntu-22.04.5-live-server-amd64.iso&tr=https://torrent.ubuntu.com/announce"
            instance.addTorrent(magnetLink)
            Log.i(TAG, "addTorrent called with Ubuntu ISO magnet")

            // Wait a bit for the torrent to be processed
            Thread.sleep(2000)

            // Query torrent list
            val torrents = instance.getTorrentList()
            Log.i(TAG, "getTorrentList returned ${torrents.size} torrents")
            torrents.forEach { t ->
                Log.i(TAG, "Torrent: name=${t.name}, infoHash=${t.infoHash}, status=${t.status}")
            }

            // Check state flow
            val state = instance.state?.value
            Log.i(TAG, "State flow value: ${state?.torrents?.size ?: 0} torrents")
            state?.torrents?.forEach { t ->
                Log.i(TAG, "State torrent: name=${t.name}, progress=${t.progress}")
            }
        }

        // Stop service
        EngineService.stop(context)
        Log.i(TAG, "EngineService.stop() called")

        assert(loaded) { "Engine failed to load" }
    }
}
