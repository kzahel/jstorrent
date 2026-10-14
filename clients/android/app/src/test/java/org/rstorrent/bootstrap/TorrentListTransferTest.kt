package org.rstorrent.bootstrap

import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.rstorrent.session.uniffi.TorrentListImportFailure
import org.rstorrent.session.uniffi.TorrentListImportReport

class TorrentListTransferTest {
    private val v1 = "magnet:?xt=urn:btih:" + "a".repeat(40)
    private val v2 = "magnet:?xt=urn:btih:" + "b".repeat(40) + "&dn=Second"

    @Test
    fun blankTextHasNoMagnets() {
        assertEquals(emptyList<String>(), splitMagnetLinks(""))
        assertEquals(emptyList<String>(), splitMagnetLinks(" \n\t "))
    }

    @Test
    fun oneLinkIsReturnedWholeSoASingleAddIsUnchanged() {
        assertEquals(listOf(v1), splitMagnetLinks("  $v1\n"))
        // A raw space inside a single link is not a separator.
        assertEquals(listOf("$v1&dn=My File"), splitMagnetLinks("$v1&dn=My File"))
        // Text that is not a magnet still reaches the add as before.
        assertEquals(listOf("not a magnet"), splitMagnetLinks(" not a magnet "))
    }

    @Test
    fun splitsLinksOnLinesSpacesAndTabs() {
        assertEquals(listOf(v1, v2), splitMagnetLinks("$v1\n$v2"))
        assertEquals(listOf(v1, v2), splitMagnetLinks("$v1\r\n\r\n$v2\r\n"))
        assertEquals(listOf(v1, v2), splitMagnetLinks("$v1 \t $v2"))
        assertEquals(listOf(v1, "MAGNET:?xt=x"), splitMagnetLinks("$v1\nMAGNET:?xt=x"))
    }

    @Test
    fun wordsAfterALinkStayWithItAndLeadingTextIsItsOwnEntry() {
        assertEquals(
            listOf("notes:", "$v1&dn=My File", v2),
            splitMagnetLinks("notes:\n$v1&dn=My File\n$v2"),
        )
    }

    @Test
    fun magnetNamesPreferTheDisplayNameThenTheHash() {
        assertEquals("Second", magnetDisplayName(v2))
        assertEquals("My File", magnetDisplayName("$v1&dn=My+File"))
        assertEquals("My File", magnetDisplayName("$v1&DN=My%20File"))
        assertEquals("a".repeat(40), magnetDisplayName(v1))
        assertEquals("not a magnet", magnetDisplayName(" not a magnet "))
        val long = magnetDisplayName("$v1&dn=" + "x".repeat(500))
        assertEquals(120, long.length)
        assertTrue(long.endsWith("…"))
    }

    @Test
    fun summaryListsAtMostFiftyFailuresAndCountsTheRest() {
        val builder = TorrentAddSummaryBuilder()
        builder.added()
        builder.alreadyPresent(2)
        repeat(MAX_LISTED_ADD_FAILURES + 10) { builder.failed("t$it", "bad") }
        builder.failedUnlisted(5)
        builder.failedUnlisted(0)
        val summary = builder.build()
        assertEquals(1, summary.added)
        assertEquals(2, summary.alreadyPresent)
        assertEquals(MAX_LISTED_ADD_FAILURES, summary.failed.size)
        assertEquals(15, summary.unlistedFailures)
        assertEquals(MAX_LISTED_ADD_FAILURES + 15, summary.failedCount)
        assertEquals(TorrentAddFailure("t0", "bad"), summary.failed.first())
    }

    @Test
    fun importReportBecomesASummary() {
        val summary =
            torrentListImportSummary(
                TorrentListImportReport(
                    added = 3U,
                    alreadyPresent = 1U,
                    failed = listOf(TorrentListImportFailure("Broken", "invalid metainfo")),
                ),
            )
        assertEquals(TorrentAddSummary(3, 1, listOf(TorrentAddFailure("Broken", "invalid metainfo"))), summary)
    }

    @Test
    fun summaryLinesShowOnlyWhatHappened() {
        val allAdded = torrentAddSummaryLines(TorrentAddSummary(2, 0, emptyList()), FakeText)
        assertEquals("Added 2[other].", allAdded.headline)
        assertNull(allAdded.failureHeader)
        assertTrue(allAdded.failures.isEmpty())
        assertNull(allAdded.moreFailures)

        val nothingNew = torrentAddSummaryLines(TorrentAddSummary(0, 1, emptyList()), FakeText)
        assertEquals("Added 0[other]. Already in your list: 1[one].", nothingNew.headline)

        val mixed =
            torrentAddSummaryLines(
                TorrentAddSummary(
                    1,
                    0,
                    listOf(TorrentAddFailure("a.torrent", "The file is empty.")),
                    unlistedFailures = 2,
                ),
                FakeText,
            )
        assertEquals("Added 1[one].", mixed.headline)
        assertEquals("Couldn't add 3[other]:", mixed.failureHeader)
        assertEquals(listOf("a.torrent — The file is empty."), mixed.failures)
        assertEquals("And 2[other] more.", mixed.moreFailures)
    }

    @Test
    fun bundleLimitMatchesTheEngineAndExceedsOneTorrent() {
        assertEquals(256 * 1024 * 1024, MAX_TORRENT_LIST_BUNDLE_BYTES)
        assertTrue(MAX_TORRENT_LIST_BUNDLE_BYTES > MAX_TORRENT_SOURCE_BYTES)
        assertTrue(TORRENT_LIST_BUNDLE_READ_TIMEOUT_MILLIS > TORRENT_SOURCE_READ_TIMEOUT_MILLIS)
    }

    @Test
    fun oversizedBundleIsRefusedBeforeOpeningWhenItsLengthIsKnown() = runBlocking {
        var opened = false
        try {
            readTorrentListBundle(
                openInput = {
                    opened = true
                    ByteArrayInputStream(ByteArray(1))
                },
                knownLength = MAX_TORRENT_LIST_BUNDLE_BYTES.toLong() + 1L,
            )
            fail("expected OversizedTorrentSourceException")
        } catch (_: OversizedTorrentSourceException) {
        }
        assertFalse(opened)
    }

    @Test
    fun bundleReadStopsAtTheLimitWhenTheLengthIsUnknownOrWrong() = runBlocking {
        val exact = readTorrentListBundle({ ByteArrayInputStream(ByteArray(64)) }, null, maximumBytes = 64)
        assertEquals(64, exact.size)
        for (knownLength in listOf(null, -1L, 10L)) {
            try {
                readTorrentListBundle(
                    { ByteArrayInputStream(ByteArray(65)) },
                    knownLength,
                    maximumBytes = 64,
                )
                fail("expected OversizedTorrentSourceException for $knownLength")
            } catch (_: OversizedTorrentSourceException) {
            }
        }
        try {
            readTorrentListBundle({ ByteArrayInputStream(ByteArray(0)) }, null)
            fail("expected EmptyTorrentSourceException")
        } catch (_: EmptyTorrentSourceException) {
        }
    }

    private object FakeText : TorrentAddSummaryText {
        private fun plural(count: Int) = if (count == 1) "$count[one]" else "$count[other]"

        override fun added(count: Int) = "Added ${plural(count)}."

        override fun alreadyPresent(count: Int) = "Already in your list: ${plural(count)}."

        override fun failedHeader(count: Int) = "Couldn't add ${plural(count)}:"

        override fun failure(
            name: String,
            reason: String,
        ) = "$name — $reason"

        override fun moreFailures(count: Int) = "And ${plural(count)} more."
    }
}
