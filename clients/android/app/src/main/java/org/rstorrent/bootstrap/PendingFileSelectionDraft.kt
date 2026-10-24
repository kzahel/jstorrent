package org.rstorrent.bootstrap

import java.math.BigInteger
import java.util.BitSet
import org.rstorrent.session.uniffi.FileIndexRange
import org.rstorrent.session.uniffi.FileSelectionOverride
import org.rstorrent.session.uniffi.FileSelectionView
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.PendingFileSelectionBase
import org.rstorrent.session.uniffi.TorrentView

internal const val MAX_PENDING_FILE_SELECTION_OVERRIDES = 4_096 // Normalized request ranges, not files.
private const val MAX_FILES = 374_998

internal data class PendingFileSelectionSummary(val count: Long, val bytes: BigInteger)

/** Immutable draft with two bits per file, independent of paged file rows. */
internal class PendingFileSelectionDraft(
    val base: PendingFileSelectionBase = PendingFileSelectionBase.CURRENT,
    private val touched: BitSet = BitSet(),
    private val values: BitSet = BitSet(),
    private val rangeCount: Int = 0,
    private val countDelta: Long = 0,
    private val bytesDelta: BigInteger = BigInteger.ZERO,
) {
    private fun bit(bits: BitSet, index: Int): Boolean = index >= 0 && bits[index]
    private fun rangeStart(index: Int): Int =
        if (bit(touched, index) && (!bit(touched, index - 1) || bit(values, index - 1) != bit(values, index))) 1 else 0

    fun selected(file: FileView): Boolean =
        if (file.safety?.blocked == true) false
        else if (touched[file.fileIndex.toInt()]) values[file.fileIndex.toInt()] else baseline(file)

    /** Null only for an invalid index or too many normalized request ranges. */
    fun toggle(file: FileView): PendingFileSelectionDraft? {
        if (file.safety?.blocked == true) return this
        require(!file.padding) { "padding files are not selectable" }
        if (file.fileIndex >= MAX_FILES.toUInt()) return null
        val index = file.fileIndex.toInt()
        val selected = !selected(file)
        val nextTouched = touched.clone() as BitSet
        val nextValues = values.clone() as BitSet
        nextTouched.set(index, selected != baseline(file))
        nextValues.set(index, selected)
        val delta = if (selected) 1L else -1L
        val next = PendingFileSelectionDraft(base, nextTouched, nextValues, 0,
            countDelta + delta, bytesDelta + file.lengthBytes.toBigInteger() * delta.toBigInteger())
        val ranges = rangeCount - rangeStart(index) - rangeStart(index + 1) + next.rangeStart(index) + next.rangeStart(index + 1)
        return if (ranges > MAX_PENDING_FILE_SELECTION_OVERRIDES) null else
            PendingFileSelectionDraft(base, nextTouched, nextValues, ranges, next.countDelta, next.bytesDelta)
    }

    fun selectAll() = PendingFileSelectionDraft(PendingFileSelectionBase.ALL)
    fun selectNone() = PendingFileSelectionDraft(PendingFileSelectionBase.NONE)

    fun summary(torrent: TorrentView): PendingFileSelectionSummary {
        val count = when (base) {
            PendingFileSelectionBase.ALL -> torrent.selectableFileCount.toLong() - (torrent.safetySummary?.blockedFileCount?.toLong() ?: 0L)
            PendingFileSelectionBase.NONE -> 0L
            PendingFileSelectionBase.CURRENT -> torrent.selectedFileCount.toLong()
        }
        val bytes = when (base) {
            PendingFileSelectionBase.ALL -> torrent.selectableFileBytes.toBigInteger() - (torrent.safetySummary?.blockedFileBytes?.toBigInteger() ?: BigInteger.ZERO)
            PendingFileSelectionBase.NONE -> BigInteger.ZERO
            PendingFileSelectionBase.CURRENT -> torrent.selectedFileBytes.toBigInteger()
        }
        return PendingFileSelectionSummary(count + countDelta, bytes + bytesDelta)
    }

    fun compactOverrides(): List<FileSelectionOverride> {
        val compact = mutableListOf<FileSelectionOverride>()
        var index = touched.nextSetBit(0)
        while (index >= 0) {
            val selected = values[index]
            val previous = compact.lastOrNull()
            if (previous != null && previous.selected == selected && previous.range.endExclusive == index.toUInt()) {
                previous.range = previous.range.copy(endExclusive = index.toUInt() + 1U)
            } else {
                compact += FileSelectionOverride(FileIndexRange(index.toUInt(), index.toUInt() + 1U), selected)
            }
            index = touched.nextSetBit(index + 1)
        }
        return compact
    }

    private fun baseline(file: FileView): Boolean = if (file.safety?.blocked == true) false else when (base) {
        PendingFileSelectionBase.ALL -> true
        PendingFileSelectionBase.NONE -> false
        PendingFileSelectionBase.CURRENT -> file.selection != FileSelectionView.SKIPPED
    }
}
