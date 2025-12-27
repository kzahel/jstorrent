package com.jstorrent.app.companion

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jstorrent.app.service.IoDaemonService
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

private const val TAG = "IoDaemonServiceTest"

@RunWith(AndroidJUnit4::class)
class IoDaemonServiceTest : CompanionTestBase() {

    @Test
    fun serviceStartsAndServerIsRunning() {
        assertNotNull("Service instance should exist", IoDaemonService.instance)
        assertTrue("Server should be running", IoDaemonService.instance?.isServerRunning == true)
        assertTrue("Port should be valid", IoDaemonService.instance?.port ?: 0 > 0)
        Log.i(TAG, "Server running on port ${IoDaemonService.instance?.port}")
    }

    @Test
    fun serviceStopsCleanly() = runBlocking {
        assertTrue("Server should be running initially", IoDaemonService.instance?.isServerRunning == true)

        IoDaemonService.stop(context)
        delay(1000)

        // Instance may still exist briefly but server should be stopped
        val instance = IoDaemonService.instance
        assertTrue(
            "Server should be stopped or instance null",
            instance == null || !instance.isServerRunning
        )
    }

    @Test
    fun serviceRestartsSuccessfully() = runBlocking {
        val port1 = IoDaemonService.instance?.port
        assertNotNull("Initial port should be set", port1)

        IoDaemonService.stop(context)
        delay(500)

        IoDaemonService.start(context)
        repeat(30) {
            if (IoDaemonService.instance?.isServerRunning == true) return@repeat
            delay(100)
        }

        assertTrue("Server should be running after restart", IoDaemonService.instance?.isServerRunning == true)
    }
}
