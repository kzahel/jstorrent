package com.jstorrent.app.notification

import android.app.NotificationManager
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.jstorrent.app.JSTorrentApplication
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented tests for TorrentNotificationManager.
 *
 * Run with: ./gradlew :app:connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.notification.TorrentNotificationManagerTest
 */
@RunWith(AndroidJUnit4::class)
class TorrentNotificationManagerTest {

    private lateinit var manager: TorrentNotificationManager
    private lateinit var notificationManager: NotificationManager

    @Before
    fun setup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        manager = TorrentNotificationManager(context)
        notificationManager = context.getSystemService(NotificationManager::class.java)
    }

    @After
    fun tearDown() {
        // Cancel any test notifications
        manager.cancelAllDownloadComplete()
    }

    // =========================================================================
    // Channel creation tests
    // =========================================================================

    @Test
    fun channelExistsFromApplication() {
        // Channel is now created by JSTorrentApplication, not TorrentNotificationManager
        val channel = notificationManager.getNotificationChannel(JSTorrentApplication.NotificationChannels.COMPLETE)

        assertNotNull("Notification channel should be created by Application", channel)
        assertEquals("Download Complete", channel.name)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, channel.importance)
    }

    // =========================================================================
    // Permission tests
    // =========================================================================

    @Test
    fun hasNotificationPermissionReturnsValueBasedOnAndroidVersion() {
        // On Android 12 and below, should always return true
        // On Android 13+, depends on whether permission is granted
        val hasPermission = manager.hasNotificationPermission()

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            assertTrue("On Android 12 and below, should always have permission", hasPermission)
        }
        // On Android 13+, we just verify it returns without crashing
        // The actual value depends on permission state
    }

    @Test
    fun getNotificationPermissionReturnsCorrectValue() {
        val permission = manager.getNotificationPermission()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            assertEquals(android.Manifest.permission.POST_NOTIFICATIONS, permission)
        } else {
            assertEquals(null, permission)
        }
    }

    // =========================================================================
    // Cancel notification tests
    // =========================================================================

    @Test
    fun cancelDownloadCompleteDoesNotCrash() {
        // Should not throw even if notification doesn't exist
        manager.cancelDownloadComplete("nonexistent_hash")
    }

    @Test
    fun cancelAllDownloadCompleteDoesNotCrash() {
        // Should not throw even if no notifications exist
        manager.cancelAllDownloadComplete()
    }

    // =========================================================================
    // Show notification tests (if permission granted)
    // =========================================================================

    @Test
    fun showDownloadCompleteDoesNotCrashWithoutPermission() {
        // Should not throw even without permission
        manager.showDownloadComplete("Test Torrent", "test_hash_123")
    }

    @Test
    fun showAndCancelDownloadCompleteWorksTogether() {
        val testHash = "test_hash_456"

        // Show notification (may not actually show if no permission)
        manager.showDownloadComplete("Test Torrent", testHash)

        // Cancel should work regardless
        manager.cancelDownloadComplete(testHash)
    }
}
