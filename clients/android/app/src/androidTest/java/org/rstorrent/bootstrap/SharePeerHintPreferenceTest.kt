package org.rstorrent.bootstrap

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SharePeerHintPreferenceTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @After
    fun clear() {
        SharePeerHintPreference.reset(context)
    }

    @Test
    fun choicePersistsUntilReset() {
        assertTrue(SharePeerHintPreference.reset(context))
        assertEquals(SharePeerHintChoice.ASK, SharePeerHintPreference.read(context))
        for (choice in listOf(SharePeerHintChoice.INCLUDE, SharePeerHintChoice.OMIT, SharePeerHintChoice.ASK)) {
            assertTrue(SharePeerHintPreference.persist(context, choice))
            assertEquals(choice, SharePeerHintPreference.read(context))
        }
        assertTrue(SharePeerHintPreference.persist(context, SharePeerHintChoice.OMIT))
        assertTrue(SharePeerHintPreference.reset(context))
        assertEquals(SharePeerHintChoice.ASK, SharePeerHintPreference.read(context))
    }
}
