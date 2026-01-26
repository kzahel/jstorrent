package com.jstorrent.app.notification

import android.app.NotificationManager
import android.content.Intent
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.JSTorrentApplication
import com.jstorrent.app.service.ForegroundNotificationService
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Instrumented tests for notification action buttons.
 *
 * Run with: ./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.notification.NotificationActionTest
 */
@RunWith(AndroidJUnit4::class)
class NotificationActionTest {

    companion object {
        private const val TAG = "NotificationActionTest"
        private const val ENGINE_LOAD_TIMEOUT_MS = 30_000L
        private const val POLL_INTERVAL_MS = 500L
    }

    private lateinit var notificationManager: NotificationManager

    @Before
    fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        notificationManager = context.getSystemService(NotificationManager::class.java)
    }

    @After
    fun tearDown() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as JSTorrentApplication
        // Reset foreground flag to prevent test pollution
        app.serviceLifecycleManager.setActivityForeground(false)

        // Stop the engine service if running
        if (ForegroundNotificationService.instance != null) {
            ForegroundNotificationService.stop(context)
            app.shutdownEngine()
            Thread.sleep(500)
        }
    }

    // =========================================================================
    // Channel tests
    // =========================================================================

    @Test
    fun allNotificationChannelsExist() {
        // Verify all channels are created by JSTorrentApplication
        val serviceChannel = notificationManager.getNotificationChannel(
            JSTorrentApplication.NotificationChannels.SERVICE
        )
        val completeChannel = notificationManager.getNotificationChannel(
            JSTorrentApplication.NotificationChannels.COMPLETE
        )
        val errorsChannel = notificationManager.getNotificationChannel(
            JSTorrentApplication.NotificationChannels.ERRORS
        )

        assertNotNull("Service channel should exist", serviceChannel)
        assertNotNull("Complete channel should exist", completeChannel)
        assertNotNull("Errors channel should exist", errorsChannel)

        assertEquals(NotificationManager.IMPORTANCE_LOW, serviceChannel.importance)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, completeChannel.importance)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, errorsChannel.importance)
    }

    // =========================================================================
    // Service notification tests
    // =========================================================================

    @Test
    fun serviceStartsSuccessfullyWithForegroundNotification() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as JSTorrentApplication

        // Initialize engine via Application
        app.initializeEngine(storageMode = "null")

        // Mark activity as in foreground via lifecycle manager
        app.serviceLifecycleManager.setActivityForeground(true)

        // Start the service
        ForegroundNotificationService.start(context, "null")

        // Wait for engine to load
        val loaded = waitForEngineLoad()
        assertTrue("Engine should load", loaded)

        // If we get here without crashing, the foreground notification was posted
        // (Android requires foreground services to call startForeground() immediately)
        assertNotNull("Service should be running", ForegroundNotificationService.instance)

        // Wait a bit for notification update loop to start
        Thread.sleep(1500)

        // Service should still be running (notification update loop didn't crash)
        assertNotNull("Service should still be running after notification updates", ForegroundNotificationService.instance)
    }

    @Test
    fun notificationManagerBuildsCorrectContent() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val notifManager = ForegroundNotificationManager(context)

        // Test with empty torrent list
        val emptyNotification = notifManager.buildNotification(emptyList())
        assertNotNull("Should build notification for empty list", emptyNotification)

        // Verify notification content via extras
        val extras = emptyNotification.extras
        val title = extras?.getCharSequence("android.title")?.toString()
        val text = extras?.getCharSequence("android.text")?.toString()

        Log.i(TAG, "Empty notification - title: $title, text: $text")

        assertEquals("Title should be JSTorrent", "JSTorrent", title)
        assertTrue("Content should show 'No active torrents'", text?.contains("No active torrents") == true)
    }

    // =========================================================================
    // Action button tests
    // =========================================================================

    @Test
    fun quitActionStopsService() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as JSTorrentApplication

        // Initialize engine via Application
        app.initializeEngine(storageMode = "null")

        // Mark activity as in foreground via lifecycle manager
        app.serviceLifecycleManager.setActivityForeground(true)

        // Start the service
        ForegroundNotificationService.start(context, "null")

        // Wait for engine to load
        val loaded = waitForEngineLoad()
        assertTrue("Engine should load", loaded)

        assertNotNull("Service instance should exist before quit", ForegroundNotificationService.instance)

        // Send QUIT action
        val quitIntent = Intent(NotificationActionReceiver.ACTION_QUIT)
        quitIntent.setPackage(context.packageName)
        context.sendBroadcast(quitIntent)

        // Wait for service to stop - stopService() is asynchronous, poll for completion
        val stopped = waitForServiceStop()
        assertTrue("Service instance should be null after quit", stopped)
    }

    private fun waitForServiceStop(timeoutMs: Long = 5_000L): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (ForegroundNotificationService.instance == null) {
                return true
            }
            Thread.sleep(POLL_INTERVAL_MS)
        }
        Log.e(TAG, "Timeout waiting for service to stop")
        return false
    }

    @Test
    fun pauseAllActionDoesNotCrash() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as JSTorrentApplication

        // Initialize engine via Application
        app.initializeEngine(storageMode = "null")

        // Mark activity as in foreground via lifecycle manager
        app.serviceLifecycleManager.setActivityForeground(true)

        // Start the service
        ForegroundNotificationService.start(context, "null")

        // Wait for engine to load
        val loaded = waitForEngineLoad()
        assertTrue("Engine should load", loaded)

        // Send PAUSE_ALL action (should not crash even with no torrents)
        val pauseIntent = Intent(NotificationActionReceiver.ACTION_PAUSE_ALL)
        pauseIntent.setPackage(context.packageName)
        context.sendBroadcast(pauseIntent)

        // Wait a bit
        Thread.sleep(500)

        // Service should still be running
        assertNotNull("Service should still be running", ForegroundNotificationService.instance)
    }

    @Test
    fun resumeAllActionDoesNotCrash() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as JSTorrentApplication

        // Initialize engine via Application
        app.initializeEngine(storageMode = "null")

        // Mark activity as in foreground via lifecycle manager
        app.serviceLifecycleManager.setActivityForeground(true)

        // Start the service
        ForegroundNotificationService.start(context, "null")

        // Wait for engine to load
        val loaded = waitForEngineLoad()
        assertTrue("Engine should load", loaded)

        // Send RESUME_ALL action (should not crash even with no torrents)
        val resumeIntent = Intent(NotificationActionReceiver.ACTION_RESUME_ALL)
        resumeIntent.setPackage(context.packageName)
        context.sendBroadcast(resumeIntent)

        // Wait a bit
        Thread.sleep(500)

        // Service should still be running
        assertNotNull("Service should still be running", ForegroundNotificationService.instance)
    }

    @Test
    fun openFolderActionDoesNotCrash() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        // Send OPEN_FOLDER action with a test URI
        // This will try to open a file manager which may not exist, but shouldn't crash
        val openFolderIntent = Intent(NotificationActionReceiver.ACTION_OPEN_FOLDER)
        openFolderIntent.setPackage(context.packageName)
        openFolderIntent.putExtra(
            NotificationActionReceiver.EXTRA_FOLDER_URI,
            "content://com.android.externalstorage.documents/tree/primary%3ADownload"
        )
        context.sendBroadcast(openFolderIntent)

        // Wait a bit - action should complete without crashing
        Thread.sleep(500)

        // Test passes if we get here without crashing
        assertTrue("Open folder action should not crash", true)
    }

    @Test
    fun openFolderActionWithNullUriDoesNotCrash() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        // Send OPEN_FOLDER action without URI extra
        // Should handle gracefully
        val openFolderIntent = Intent(NotificationActionReceiver.ACTION_OPEN_FOLDER)
        openFolderIntent.setPackage(context.packageName)
        context.sendBroadcast(openFolderIntent)

        // Wait a bit
        Thread.sleep(500)

        // Test passes if we get here without crashing
        assertTrue("Open folder action with null URI should not crash", true)
    }

    // =========================================================================
    // Helper methods
    // =========================================================================

    private fun waitForEngineLoad(timeoutMs: Long = ENGINE_LOAD_TIMEOUT_MS): Boolean {
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
                Thread.sleep(POLL_INTERVAL_MS)
            }
            Log.e(TAG, "Timeout waiting for engine to load")
            latch.countDown()
        }.start()

        latch.await(timeoutMs + 1000, TimeUnit.MILLISECONDS)
        return loaded
    }
}
