package com.jstorrent.app.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.mockito.ArgumentCaptor
import org.mockito.kotlin.any
import org.mockito.kotlin.capture
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

class TorrentNotificationManagerTest {

    private lateinit var context: Context
    private lateinit var notificationManager: NotificationManager

    @Before
    fun setup() {
        context = mock()
        notificationManager = mock()
        whenever(context.getSystemService(NotificationManager::class.java)).thenReturn(notificationManager)
    }

    // =========================================================================
    // Initialization tests
    // =========================================================================

    @Test
    fun `creates notification channel on init`() {
        val channelCaptor = ArgumentCaptor.forClass(NotificationChannel::class.java)

        TorrentNotificationManager(context)

        verify(notificationManager).createNotificationChannel(capture(channelCaptor))

        val channel = channelCaptor.value
        assertEquals("jstorrent_download_complete", channel.id)
        assertEquals("Download Complete", channel.name)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, channel.importance)
    }

    // Note: Permission tests require Android SDK API levels that are difficult
    // to mock in unit tests. These should be covered by instrumented tests.
}
