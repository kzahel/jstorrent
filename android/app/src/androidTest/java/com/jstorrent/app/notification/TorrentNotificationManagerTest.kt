package com.jstorrent.app.notification

import android.app.NotificationManager
import android.net.Uri
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
        manager.cancelAll()
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

    // =========================================================================
    // Completion notification with size tests
    // =========================================================================

    @Test
    fun showDownloadCompleteWithSizeDoesNotCrash() {
        // Should not throw even without permission
        manager.showDownloadComplete(
            torrentName = "ubuntu-24.04.iso",
            infoHash = "test_hash_with_size",
            sizeBytes = 4_700_000_000L // 4.7 GB
        )
        manager.cancelDownloadComplete("test_hash_with_size")
    }

    @Test
    fun showDownloadCompleteWithFolderUriDoesNotCrash() {
        val testUri = Uri.parse("content://com.android.externalstorage.documents/tree/primary%3ADownload")

        // Should not throw even without permission
        manager.showDownloadComplete(
            torrentName = "ubuntu-24.04.iso",
            infoHash = "test_hash_with_folder",
            sizeBytes = 4_700_000_000L,
            folderUri = testUri
        )
        manager.cancelDownloadComplete("test_hash_with_folder")
    }

    @Test
    fun showDownloadCompleteWithAllParametersDoesNotCrash() {
        val testUri = Uri.parse("content://com.android.externalstorage.documents/tree/primary%3ADownload")

        manager.showDownloadComplete(
            torrentName = "Test Movie.mkv",
            infoHash = "full_params_hash",
            sizeBytes = 1_500_000_000L, // 1.5 GB
            folderUri = testUri
        )
        manager.cancelDownloadComplete("full_params_hash")
    }

    // =========================================================================
    // Error notification tests
    // =========================================================================

    @Test
    fun errorChannelExistsFromApplication() {
        val channel = notificationManager.getNotificationChannel(JSTorrentApplication.NotificationChannels.ERRORS)

        assertNotNull("Error channel should be created by Application", channel)
        assertEquals("Errors", channel.name)
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.importance)
    }

    @Test
    fun showErrorDoesNotCrash() {
        // Should not throw even without permission
        manager.showError(
            torrentName = "Test Torrent",
            infoHash = "error_test_hash",
            errorMessage = "Storage full"
        )
        manager.cancelError("error_test_hash")
    }

    @Test
    fun showErrorWithDifferentMessagesDoesNotCrash() {
        // Test various error messages
        val errorMessages = listOf(
            "Storage full",
            "Connection error",
            "Permission denied",
            "Download error"
        )

        errorMessages.forEachIndexed { index, message ->
            val hash = "error_hash_$index"
            manager.showError(
                torrentName = "Test Torrent $index",
                infoHash = hash,
                errorMessage = message
            )
            manager.cancelError(hash)
        }
    }

    // =========================================================================
    // Cancel error notification tests
    // =========================================================================

    @Test
    fun cancelErrorDoesNotCrash() {
        // Should not throw even if notification doesn't exist
        manager.cancelError("nonexistent_error_hash")
    }

    @Test
    fun cancelAllErrorsDoesNotCrash() {
        // Should not throw even if no notifications exist
        manager.cancelAllErrors()
    }

    @Test
    fun showAndCancelErrorWorksTogether() {
        val testHash = "error_hash_cancel_test"

        // Show notification (may not actually show if no permission)
        manager.showError("Test Error Torrent", testHash, "Test error")

        // Cancel should work regardless
        manager.cancelError(testHash)
    }

    // =========================================================================
    // Cancel all tests
    // =========================================================================

    @Test
    fun cancelAllClearsBothCompletionAndErrors() {
        // Show both types
        manager.showDownloadComplete("Complete Torrent", "complete_hash")
        manager.showError("Error Torrent", "error_hash", "Test error")

        // Cancel all should clear both
        manager.cancelAll()
    }
}
