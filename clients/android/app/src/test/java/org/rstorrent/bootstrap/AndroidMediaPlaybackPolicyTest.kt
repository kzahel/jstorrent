package org.rstorrent.bootstrap

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.rstorrent.session.uniffi.LibraryMediaKind
import org.rstorrent.session.uniffi.LibraryMediaRole
import org.rstorrent.session.uniffi.MediaFileAvailability

class AndroidMediaPlaybackPolicyTest {
    @Test
    fun recognizedVideoExtensionsMatchSharedClassifierV1() {
        val recognized =
            listOf(
                "mp4",
                "mkv",
                "avi",
                "webm",
                "mov",
                "m4v",
                "ts",
                "mts",
                "m2ts",
                "flv",
                "wmv",
                "ogv",
                "3gp",
            )

        recognized.forEach { extension ->
            assertTrue(
                extension,
                AndroidMediaPlaybackPolicy.isRecognizedVideo(listOf("Show", "clip.$extension")),
            )
            assertTrue(
                extension.uppercase(),
                AndroidMediaPlaybackPolicy.isRecognizedVideo(
                    listOf("clip.${extension.uppercase()}"),
                ),
            )
        }
        listOf("mp3", "flac", "vtt", "txt", "", "mp4.exe").forEach { extension ->
            assertFalse(AndroidMediaPlaybackPolicy.isRecognizedVideo(listOf("clip.$extension")))
        }
    }

    @Test
    fun libraryPlayUsesTheHostExtensionAndPlayableAvailabilityOnly() {
        // A cut file name keeps its host-classified extension.
        val cut = libraryMediaItem(fileName = "A very long episode name, cut", extension = "mkv")
        assertTrue(
            AndroidMediaPlaybackPolicy.isLibraryPlayActionEnabled(
                cut.copy(mediaAvailability = MediaFileAvailability.STREAMABLE),
                launchPending = false,
            ),
        )
        assertTrue(
            AndroidMediaPlaybackPolicy.isLibraryPlayActionEnabled(
                libraryMediaItem(verifiedBytes = "1024", availability = MediaFileAvailability.AVAILABLE),
                launchPending = false,
            ),
        )
        assertFalse(
            AndroidMediaPlaybackPolicy.isLibraryPlayActionEnabled(
                libraryMediaItem(availability = MediaFileAvailability.AVAILABLE),
                launchPending = true,
            ),
        )
        listOf(
            MediaFileAvailability.INCOMPLETE,
            MediaFileAvailability.UNVERIFIED,
            MediaFileAvailability.STORAGE_UNAVAILABLE,
        ).forEach { availability ->
            assertFalse(
                availability.name,
                AndroidMediaPlaybackPolicy.isLibraryPlayActionEnabled(
                    libraryMediaItem(availability = availability),
                    launchPending = false,
                ),
            )
        }
        // Audio has no Android player yet.
        assertFalse(
            AndroidMediaPlaybackPolicy.isLibraryPlayActionEnabled(
                libraryMediaItem(
                    fileName = "01 Track.flac",
                    extension = "flac",
                    kind = LibraryMediaKind.AUDIO,
                    role = LibraryMediaRole.TRACK,
                    availability = MediaFileAvailability.AVAILABLE,
                ),
                launchPending = false,
            ),
        )
    }

    @Test
    fun playabilityRequiresTypedAuthorityAndRejectsPadding() {
        assertTrue(
            AndroidMediaPlaybackPolicy.isPlayable(
                listOf("clip.mp4"),
                false,
                MediaFileAvailability.AVAILABLE,
            ),
        )
        assertTrue(
            AndroidMediaPlaybackPolicy.isPlayable(
                listOf("clip.mkv"),
                false,
                MediaFileAvailability.STREAMABLE,
            ),
        )
        assertFalse(
            AndroidMediaPlaybackPolicy.isPlayable(
                listOf("clip.mp4"),
                true,
                MediaFileAvailability.AVAILABLE,
            ),
        )
        MediaFileAvailability.entries
            .filterNot {
                it == MediaFileAvailability.AVAILABLE ||
                    it == MediaFileAvailability.STREAMABLE
            }.forEach { availability ->
                assertFalse(
                    availability.name,
                    AndroidMediaPlaybackPolicy.isPlayable(
                        listOf("clip.mp4"),
                        false,
                        availability,
                    ),
                )
            }
        assertFalse(
            AndroidMediaPlaybackPolicy.isPlayable(
                listOf("clip.txt"),
                false,
                MediaFileAvailability.AVAILABLE,
            ),
        )
    }

    @Test
    fun acceptsOnlyExactLoopbackCapabilityUrls() {
        val token = "A".repeat(43)
        val valid = "http://127.0.0.1:43121/media/v1/$token"
        assertEquals(valid, AndroidMediaPlaybackPolicy.requireCapabilityUrl(valid))

        listOf(
            "https://127.0.0.1:43121/media/v1/$token",
            "http://localhost:43121/media/v1/$token",
            "http://127.0.0.2:43121/media/v1/$token",
            "http://127.0.0.1/media/v1/$token",
            "http://user@127.0.0.1:43121/media/v1/$token",
            "http://127.0.0.1:43121/media/v1/${"A".repeat(42)}",
            "http://127.0.0.1:43121/media/v1/${"A".repeat(44)}",
            "http://127.0.0.1:43121/media/v1/${"A".repeat(42)}!",
            "http://127.0.0.1:43121/media/v1/$token?query=1",
            "http://127.0.0.1:43121/media/v1/$token#fragment",
            "http://127.0.0.1:43121/media/v1/$token/extra",
            "not a URL",
        ).forEach { invalid ->
            assertThrows(IllegalArgumentException::class.java) {
                AndroidMediaPlaybackPolicy.requireCapabilityUrl(invalid)
            }
        }
    }

    @Test
    fun mediaLaunchGateAdmitsExactlyOnePendingRequest() {
        val gate = MediaLaunchGate()
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(8)
        try {
            val attempts =
                (0 until 32).map {
                    executor.submit<Boolean> {
                        start.await()
                        gate.tryAcquire()
                    }
                }
            start.countDown()
            assertEquals(1, attempts.count { it.get() })
            assertTrue(gate.isPending())
            gate.release()
            assertFalse(gate.isPending())
            assertTrue(gate.tryAcquire())
            gate.release()
        } finally {
            executor.shutdownNow()
        }
    }
}
