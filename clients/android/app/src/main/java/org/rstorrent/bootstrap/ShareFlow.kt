package org.rstorrent.bootstrap

import android.content.Context
import androidx.annotation.StringRes
import org.rstorrent.session.uniffi.FileView
import org.rstorrent.session.uniffi.MagnetPeerHint
import org.rstorrent.session.uniffi.MagnetPeerHintOmission
import org.rstorrent.session.uniffi.MagnetPeerHintScope

/**
 * The remembered answer to "Let them connect to you directly?" (Tactical 357).
 * Persisted values are stable; an unknown or missing value reads as [ASK].
 */
enum class SharePeerHintChoice(val persistedValue: String) {
    ASK("ask"),
    INCLUDE("include"),
    OMIT("omit"),
    ;

    companion object {
        fun decode(value: String?): SharePeerHintChoice =
            entries.firstOrNull { it.persistedValue == value } ?: ASK
    }
}

/**
 * Upgrades keep the stored choice; only Clear all data resets it, back to
 * asking, with the other product preferences.
 */
internal object SharePeerHintPreference {
    private const val PREFERENCES = "product_share"
    private const val PEER_HINT_CHOICE = "peer_hint_choice"

    fun read(context: Context): SharePeerHintChoice =
        SharePeerHintChoice.decode(
            context
                .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .getString(PEER_HINT_CHOICE, null),
        )

    fun persist(
        context: Context,
        choice: SharePeerHintChoice,
    ): Boolean =
        context
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(PEER_HINT_CHOICE, choice.persistedValue)
            .commit()

    fun reset(context: Context): Boolean =
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().clear().commit()
}

internal enum class SharePeerHintDecision {
    /** Export without a peer hint, without asking. */
    OMIT,

    /** Ask the engine for a peer hint, without asking the user. */
    INCLUDE,

    /** Ask the user first. */
    PROMPT,
}

/**
 * A private torrent never gets a hint or a question. A remembered choice
 * applies otherwise. Before metadata the engine cannot add a hint, so an
 * undecided user is not asked about one.
 */
internal fun sharePeerHintDecision(
    privateTorrent: Boolean,
    metadataAvailable: Boolean,
    choice: SharePeerHintChoice,
): SharePeerHintDecision =
    when {
        privateTorrent -> SharePeerHintDecision.OMIT
        choice == SharePeerHintChoice.INCLUDE -> SharePeerHintDecision.INCLUDE
        choice == SharePeerHintChoice.OMIT -> SharePeerHintDecision.OMIT
        !metadataAvailable -> SharePeerHintDecision.OMIT
        else -> SharePeerHintDecision.PROMPT
    }

/** The engine's bound on `ExportMagnet` file indices. */
internal const val MAX_SHARED_FILES = 4096

/** What one share action exports: a torrent, or some of its files. */
internal data class ShareLinkRequest(
    val torrentId: String,
    /** The torrent or single file name, for the share sheet subject and dialog title. */
    val title: String,
    val privateTorrent: Boolean,
    val metadataAvailable: Boolean,
    /** Sorted, unique `FileView.fileIndex` values; empty shares the whole torrent. */
    val fileIndices: List<UInt> = emptyList(),
    /** Display keys for a single-file share. */
    val file: ShareLinkFile? = null,
)

/**
 * A share request for [files] of one torrent: sorted, unique, non-padding
 * file indices, plus the base name and size of a single file, titled by that
 * file or else [torrentName]. Null when no file can be shared or there are
 * more than the engine accepts.
 */
internal fun fileShareRequest(
    torrentId: String,
    torrentName: String,
    privateTorrent: Boolean,
    files: List<FileView>,
): ShareLinkRequest? {
    val shareable = files.filterNot(FileView::padding).distinctBy(FileView::fileIndex).sortedBy(FileView::fileIndex)
    if (shareable.isEmpty() || shareable.size > MAX_SHARED_FILES) return null
    val single = shareable.singleOrNull()
    val name = single?.path?.lastOrNull()
    return ShareLinkRequest(
        torrentId = torrentId,
        title = name?.takeIf(String::isNotEmpty) ?: torrentName,
        privateTorrent = privateTorrent,
        // A file list exists only once metadata is verified.
        metadataAvailable = true,
        fileIndices = shareable.map(FileView::fileIndex),
        file =
            if (single != null && !name.isNullOrEmpty()) {
                ShareLinkFile(name, single.lengthBytes)
            } else {
                null
            },
    )
}

/** An exported share link and what happened to a requested peer hint. */
internal data class ShareLinkExport(
    val request: ShareLinkRequest,
    val link: String,
    val peerHintRequested: Boolean,
    val peerHints: List<MagnetPeerHint>,
    val peerHintOmission: MagnetPeerHintOmission?,
)

/**
 * A one-sentence note about the link: that it is for a private torrent, or
 * whether a requested address was added and, if not, why. Null when there is
 * nothing to say.
 */
@StringRes
internal fun shareLinkNoticeRes(export: ShareLinkExport): Int? =
    when {
        export.request.privateTorrent ||
            export.peerHintOmission == MagnetPeerHintOmission.PRIVATE_TORRENT ->
            R.string.share_private_notice
        !export.peerHintRequested -> null
        export.peerHints.any { it.scope == MagnetPeerHintScope.INTERNET } -> R.string.share_hint_included
        export.peerHints.isNotEmpty() -> R.string.share_hint_included_local
        else -> export.peerHintOmission?.let(::peerHintOmissionRes)
    }

@StringRes
internal fun peerHintOmissionRes(omission: MagnetPeerHintOmission): Int =
    when (omission) {
        MagnetPeerHintOmission.PRIVATE_TORRENT -> R.string.share_private_notice
        MagnetPeerHintOmission.METADATA_PENDING -> R.string.share_hint_omitted_metadata_pending
        MagnetPeerHintOmission.INCOMING_DISABLED -> R.string.share_hint_omitted_incoming_off
        MagnetPeerHintOmission.NOT_REACHABLE -> R.string.share_hint_omitted_not_reachable
        MagnetPeerHintOmission.NO_ADDRESS -> R.string.share_hint_omitted_no_address
    }
