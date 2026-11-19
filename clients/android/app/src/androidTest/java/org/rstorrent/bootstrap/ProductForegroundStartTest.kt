package org.rstorrent.bootstrap

import android.app.ForegroundServiceStartNotAllowedException
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@SdkSuppress(minSdkVersion = Build.VERSION_CODES.S)
class ProductForegroundStartTest {
    @Test
    fun platformDenialIsRecoverableOnALaterVisibleAttempt() {
        assertFalse(
            tryProductForegroundStart("test") {
                throw ForegroundServiceStartNotAllowedException("test denial")
            },
        )
        assertTrue(tryProductForegroundStart("test") {})
    }

    @Test
    fun unrelatedStateFailureStillPropagates() {
        val failure = IllegalStateException("test failure")
        assertSame(
            failure,
            assertThrows(IllegalStateException::class.java) {
                tryProductForegroundStart("test") { throw failure }
            },
        )
    }
}
