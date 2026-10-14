package org.rstorrent.bootstrap

import java.io.InputStream
import java.net.URLDecoder
import org.rstorrent.session.uniffi.TorrentListImportReport

/** The engine refuses bundles above this size; read no more than it accepts. */
internal const val MAX_TORRENT_LIST_BUNDLE_BYTES = 256 * 1024 * 1024

/** A bundle can be much larger than one .torrent, so a slow provider gets longer. */
internal const val TORRENT_LIST_BUNDLE_READ_TIMEOUT_MILLIS = 120_000L

/** At most this many torrents are added from one pick or paste. */
internal const val MAX_BATCH_ADD_ITEMS = 1_000

/** Failures listed by name in a summary; the rest are counted. */
internal const val MAX_LISTED_ADD_FAILURES = 50

private const val MAX_FAILURE_NAME_CHARS = 120

internal object TorrentListDocuments {
    const val EXPORT_FILE_NAME = "jstorrent-torrents.zip"
    const val EXPORT_MIME_TYPE = "application/zip"
    val IMPORT_MIME_TYPES = arrayOf("application/zip", "application/octet-stream")
}

/** Long-running torrent list work; one runs at a time. */
enum class TorrentListActivity {
    EXPORTING,
    IMPORTING,
    ADDING,
}

data class TorrentAddFailure(
    val name: String,
    val reason: String,
)

/** The outcome of adding several torrents at once, shown as one summary. */
data class TorrentAddSummary(
    val added: Int,
    val alreadyPresent: Int,
    val failed: List<TorrentAddFailure>,
    /** Failures beyond [failed] that are counted but not listed. */
    val unlistedFailures: Int = 0,
) {
    val failedCount: Int
        get() = failed.size + unlistedFailures
}

enum class TorrentListFailure {
    NO_DOWNLOAD_FOLDER,
    BUSY,
    TOO_LARGE,
    EMPTY,
    READ_FAILED,
    WRITE_FAILED,
    /** The engine refused the operation; [TorrentListNotice.Failed.detail] says why. */
    ENGINE,
}

/** A torrent list result, shown once. */
sealed interface TorrentListNotice {
    val sequence: Long

    data class Exported(override val sequence: Long) : TorrentListNotice

    data class Failed(
        override val sequence: Long,
        val export: Boolean,
        val failure: TorrentListFailure,
        val detail: String? = null,
    ) : TorrentListNotice

    data class Summary(
        override val sequence: Long,
        val summary: TorrentAddSummary,
    ) : TorrentListNotice
}

/** Collects per-torrent outcomes in order, listing a bounded number of failures. */
internal class TorrentAddSummaryBuilder {
    private var added = 0
    private var alreadyPresent = 0
    private val failed = mutableListOf<TorrentAddFailure>()
    private var unlisted = 0

    fun added(count: Int = 1) {
        added += count
    }

    fun alreadyPresent(count: Int = 1) {
        alreadyPresent += count
    }

    fun failed(
        name: String,
        reason: String,
    ) {
        if (failed.size < MAX_LISTED_ADD_FAILURES) {
            failed += TorrentAddFailure(boundedFailureName(name), reason)
        } else {
            unlisted += 1
        }
    }

    fun failedUnlisted(count: Int) {
        if (count > 0) unlisted += count
    }

    fun build(): TorrentAddSummary = TorrentAddSummary(added, alreadyPresent, failed.toList(), unlisted)
}

internal fun torrentListImportSummary(report: TorrentListImportReport): TorrentAddSummary {
    val summary = TorrentAddSummaryBuilder()
    summary.added(report.added.toInt())
    summary.alreadyPresent(report.alreadyPresent.toInt())
    report.failed.forEach { summary.failed(it.name, it.reason) }
    return summary.build()
}

/** Strings a summary needs; the activity supplies catalog text, tests a fake. */
internal interface TorrentAddSummaryText {
    fun added(count: Int): String

    fun alreadyPresent(count: Int): String

    fun failedHeader(count: Int): String

    fun failure(
        name: String,
        reason: String,
    ): String

    fun moreFailures(count: Int): String
}

internal data class TorrentAddSummaryLines(
    val headline: String,
    val failureHeader: String?,
    val failures: List<String>,
    val moreFailures: String?,
)

/**
 * "Added N." always; "Already in your list: M." only when M is not zero; a
 * failure header and one line per listed failure only when something failed.
 */
internal fun torrentAddSummaryLines(
    summary: TorrentAddSummary,
    text: TorrentAddSummaryText,
): TorrentAddSummaryLines {
    val headline =
        buildList {
            add(text.added(summary.added))
            if (summary.alreadyPresent > 0) add(text.alreadyPresent(summary.alreadyPresent))
        }.joinToString(" ")
    if (summary.failedCount == 0) return TorrentAddSummaryLines(headline, null, emptyList(), null)
    return TorrentAddSummaryLines(
        headline = headline,
        failureHeader = text.failedHeader(summary.failedCount),
        failures = summary.failed.map { text.failure(it.name, it.reason) },
        moreFailures = summary.unlistedFailures.takeIf { it > 0 }?.let(text::moreFailures),
    )
}

/**
 * Splits pasted text into magnet links. A token that starts with `magnet:`
 * begins a new link; any other token stays with the link before it, so a
 * name pasted with a raw space is not split. Text with at most one link is
 * returned whole so a single add behaves as before.
 */
internal fun splitMagnetLinks(text: String): List<String> {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return emptyList()
    val links = mutableListOf<StringBuilder>()
    for (token in trimmed.split(WHITESPACE)) {
        if (token.isEmpty()) continue
        if (token.startsWith("magnet:", ignoreCase = true) || links.isEmpty()) {
            links += StringBuilder(token)
        } else {
            links.last().append(' ').append(token)
        }
    }
    return if (links.size <= 1) listOf(trimmed) else links.map(StringBuilder::toString)
}

/** A short name for a magnet in a failure list: its name, else its hash. */
internal fun magnetDisplayName(magnet: String): String {
    val query = magnet.substringAfter('?', missingDelimiterValue = "")
    val name =
        query.split('&')
            .firstOrNull { it.startsWith("dn=", ignoreCase = true) }
            ?.substring(3)
            ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }
            ?.trim()
            ?.takeIf(String::isNotEmpty)
    if (name != null) return boundedFailureName(name)
    val hash =
        Regex("(?i)urn:bt(?:ih|mh):([0-9a-z]+)").find(query)?.groupValues?.get(1)
    return boundedFailureName(hash ?: magnet.trim())
}

internal fun boundedFailureName(name: String): String =
    if (name.length <= MAX_FAILURE_NAME_CHARS) name else name.take(MAX_FAILURE_NAME_CHARS - 1) + "…"

/** Reads a torrent list bundle, refusing anything the engine would refuse. */
internal suspend fun readTorrentListBundle(
    openInput: () -> InputStream,
    knownLength: Long?,
    maximumBytes: Int = MAX_TORRENT_LIST_BUNDLE_BYTES,
    timeoutMillis: Long = TORRENT_LIST_BUNDLE_READ_TIMEOUT_MILLIS,
    cancelled: () -> Boolean = { false },
    onCancel: () -> Unit = {},
): ByteArray =
    BoundedTorrentSourceReader.read(
        openInput = openInput,
        knownLength = knownLength?.takeIf { it >= 0 },
        maximumBytes = maximumBytes,
        timeoutMillis = timeoutMillis,
        cancelled = cancelled,
        onCancel = onCancel,
    ).bytes

private val WHITESPACE = Regex("\\s+")
