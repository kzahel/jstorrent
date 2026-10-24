package org.rstorrent.bootstrap

import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.LibraryMediaItemView
import org.rstorrent.session.uniffi.MediaFileAvailability

internal object AndroidMediaPlaybackPolicy {
    private val videoExtensions =
        setOf(
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
    private val playableAvailability =
        setOf(MediaFileAvailability.AVAILABLE, MediaFileAvailability.STREAMABLE)
    private val capabilityPath = Regex("^/media/v1/[A-Za-z0-9_-]{43}$")

    fun isRecognizedVideo(path: List<String>): Boolean {
        val name = path.lastOrNull() ?: return false
        val separator = name.lastIndexOf('.')
        if (separator < 0 || separator == name.lastIndex) return false
        return name.substring(separator + 1).lowercase() in videoExtensions
    }

    fun isPlayable(
        path: List<String>,
        padding: Boolean,
        availability: MediaFileAvailability,
    ): Boolean = !padding && isRecognizedVideo(path) && availability in playableAvailability

    fun isPlayActionEnabled(
        file: FileView,
        launchPending: Boolean,
    ): Boolean =
        !launchPending &&
            isPlayable(file.path, file.padding, file.mediaAvailability)

    /**
     * Library rows carry the host's extension, which survives a cut file name.
     * Audio stays unplayable until a player owns background playback.
     */
    fun isLibraryPlayActionEnabled(
        item: LibraryMediaItemView,
        launchPending: Boolean,
    ): Boolean =
        !launchPending &&
            item.extension.lowercase() in videoExtensions &&
            item.mediaAvailability in playableAvailability

    fun requireCapabilityUrl(source: String): String {
        val uri =
            runCatching { URI(source) }
                .getOrElse { throw IllegalArgumentException("Invalid media source") }
        require(!uri.isOpaque) { "Invalid media source" }
        require(uri.scheme == "http") { "Media source must use HTTP loopback" }
        require(uri.host == "127.0.0.1") { "Media source must use IPv4 loopback" }
        require(uri.port in 1..65_535) { "Media source must use an explicit port" }
        require(uri.rawUserInfo == null) { "Media source must not contain user information" }
        require(uri.rawQuery == null) { "Media source must not contain a query" }
        require(uri.rawFragment == null) { "Media source must not contain a fragment" }
        require(capabilityPath.matches(uri.rawPath.orEmpty())) {
            "Media source must contain an exact capability path"
        }
        return source
    }

}

internal class MediaLaunchGate {
    private val pending = AtomicBoolean(false)

    fun tryAcquire(): Boolean = pending.compareAndSet(false, true)

    fun release() {
        check(pending.compareAndSet(true, false)) { "media launch gate was not held" }
    }

    fun isPending(): Boolean = pending.get()
}
