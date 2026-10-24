package org.rstorrent.bootstrap

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test
import org.rstorrent.bootstrap.uniffi.AndroidClientException

class ProductClientShutdownTest {
    @Test
    fun successReleasesAfterJoining() = runBlocking {
        val events = mutableListOf<String>()
        val failure = joinProductClientShutdown(
            shutdown = { events += "joined" },
            release = { events += "released" },
        )
        assertNull(failure)
        assertEquals(listOf("joined", "released"), events)
    }

    @Test
    fun nativeCleanupFailureIsReturnedAfterRelease() = runBlocking {
        val native = AndroidClientException.Failure("uncertain finite pinhole lease")
        val events = mutableListOf<String>()
        val failure = joinProductClientShutdown(
            shutdown = { events += "joined-with-error"; throw native },
            release = { events += "released" },
        )
        assertSame(native, failure)
        assertEquals(listOf("joined-with-error", "released"), events)
    }

    @Test
    fun cancellationIsNotConvertedToCleanupSuccess() {
        val cancellation = CancellationException("cancelled")
        var releases = 0
        val actual = assertThrows(CancellationException::class.java) {
            runBlocking {
                joinProductClientShutdown(
                    shutdown = { throw cancellation },
                    release = { releases++ },
                )
            }
        }
        assertSame(cancellation, actual)
        assertEquals(1, releases)
    }

    @Test
    fun unexpectedFailurePropagatesAfterRelease() {
        val unexpected = IllegalStateException("unexpected adapter failure")
        var releases = 0
        val actual = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                joinProductClientShutdown(
                    shutdown = { throw unexpected },
                    release = { releases++ },
                )
            }
        }
        assertSame(unexpected, actual)
        assertEquals(1, releases)
    }

    @Test
    fun releaseFailureRetainsNativeCleanupError() {
        val native = AndroidClientException.Failure("uncertain finite pinhole lease")
        val release = IllegalStateException("release failed")
        val actual = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                joinProductClientShutdown(
                    shutdown = { throw native },
                    release = { throw release },
                )
            }
        }
        assertSame(release, actual)
        assertEquals(listOf(native), actual.suppressed.toList())
    }
}
