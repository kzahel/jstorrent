package org.rstorrent.bootstrap.ui

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.google.zxing.common.BitMatrix
import org.rstorrent.bootstrap.ProductEngineService
import org.rstorrent.bootstrap.ProductState
import org.rstorrent.bootstrap.R
import org.rstorrent.bootstrap.ShareLinkExport
import org.rstorrent.bootstrap.ShareLinkRequest
import org.rstorrent.bootstrap.SharePeerHintChoice
import org.rstorrent.bootstrap.SharePeerHintDecision
import org.rstorrent.bootstrap.sharePeerHintDecision
import org.rstorrent.bootstrap.shareLinkNoticeRes
import org.rstorrent.bootstrap.shareQrMatrix
import org.rstorrent.session.uniffi.TorrentView

/** What a share action does with the exported link. */
internal enum class ShareMode {
    /** Copy it to the clipboard. */
    COPY,

    /** Open the system share sheet. */
    SEND,

    /** Show the link, its QR code, Copy and Share. */
    PANEL,
}

internal fun torrentShareRequest(torrent: TorrentView): ShareLinkRequest =
    ShareLinkRequest(
        torrentId = torrent.torrentId,
        title = torrentPresentationName(torrent),
        privateTorrent = torrent.privateTorrent,
        metadataAvailable = torrent.metadataAvailable,
    )

/**
 * Runs share actions (Tactical 357): asks about the peer hint when the
 * remembered choice says to, exports through the engine, then copies, opens
 * the share sheet or shows the share panel. Returns the action launcher.
 */
@Composable
internal fun rememberShareFlow(
    state: ProductState,
    service: ProductEngineService?,
    onMessage: (String) -> Unit,
): (ShareLinkRequest, ShareMode) -> Unit {
    val context = LocalContext.current
    val currentService by rememberUpdatedState(service)
    val currentOnMessage by rememberUpdatedState(onMessage)
    var prompt by remember { mutableStateOf<Pair<ShareLinkRequest, ShareMode>?>(null) }
    var panel by remember { mutableStateOf<ShareLinkExport?>(null) }

    fun deliver(
        export: ShareLinkExport,
        mode: ShareMode,
    ) {
        val notice = shareLinkNoticeRes(export)?.let(context::getString)
        when (mode) {
            ShareMode.COPY -> {
                copyShareLinkText(context, export.link)
                // Android confirms the clipboard write itself; only add news.
                notice?.let { currentOnMessage(context.getString(R.string.share_link_copied_notice, it)) }
            }
            ShareMode.SEND -> {
                launchShareChooser(context, export)
                notice?.let(currentOnMessage)
            }
            ShareMode.PANEL -> panel = export
        }
    }

    fun export(
        request: ShareLinkRequest,
        mode: ShareMode,
        peerHint: Boolean,
    ) {
        currentService?.exportShareLink(request, peerHint) { deliver(it, mode) }
    }

    prompt?.let { (request, mode) ->
        PeerHintDialog(
            onDismiss = { prompt = null },
            onChoice = { include, rememberChoice ->
                prompt = null
                if (rememberChoice) {
                    currentService?.setSharePeerHintChoice(
                        if (include) SharePeerHintChoice.INCLUDE else SharePeerHintChoice.OMIT,
                    )
                }
                export(request, mode, include)
            },
        )
    }
    panel?.let { export ->
        ShareLinkPanel(
            export = export,
            onCopy = {
                panel = null
                copyShareLinkText(context, export.link)
            },
            onSend = {
                panel = null
                launchShareChooser(context, export)
            },
            onDismiss = { panel = null },
        )
    }

    val choice = state.sharePeerHintChoice
    return { request, mode ->
        when (sharePeerHintDecision(request.privateTorrent, request.metadataAvailable, choice)) {
            SharePeerHintDecision.PROMPT -> prompt = request to mode
            SharePeerHintDecision.INCLUDE -> export(request, mode, peerHint = true)
            SharePeerHintDecision.OMIT -> export(request, mode, peerHint = false)
        }
    }
}

private fun copyShareLinkText(
    context: Context,
    link: String,
) {
    context.getSystemService(ClipboardManager::class.java)
        .setPrimaryClip(ClipData.newPlainText(context.getString(R.string.share_link_clip_label), link))
}

private fun launchShareChooser(
    context: Context,
    export: ShareLinkExport,
) {
    val title = export.request.title
    val send =
        Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, export.link)
            putExtra(Intent.EXTRA_SUBJECT, title)
            putExtra(Intent.EXTRA_TITLE, title)
        }
    val chooser = Intent.createChooser(send, title)
    if (context !is Activity) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(chooser)
}

@Composable
private fun PeerHintDialog(
    onDismiss: () -> Unit,
    onChoice: (include: Boolean, remember: Boolean) -> Unit,
) {
    var rememberChoice by rememberSaveable { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag("share-hint-dialog"),
        title = { Text(stringResource(R.string.share_hint_prompt_title)) },
        text = {
            Column {
                Text(stringResource(R.string.share_hint_prompt_body))
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier =
                        Modifier.fillMaxWidth()
                            .toggleable(
                                value = rememberChoice,
                                role = Role.Checkbox,
                                onValueChange = { rememberChoice = it },
                            )
                            .testTag("share-hint-remember"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = rememberChoice, onCheckedChange = null)
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(R.string.share_hint_prompt_remember))
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onChoice(true, rememberChoice) },
                modifier = Modifier.testTag("share-hint-include"),
            ) { Text(stringResource(R.string.share_hint_prompt_include)) }
        },
        dismissButton = {
            TextButton(
                onClick = { onChoice(false, rememberChoice) },
                modifier = Modifier.testTag("share-hint-omit"),
            ) { Text(stringResource(R.string.share_hint_prompt_omit)) }
        },
    )
}

/** The share link, its QR code and what it carries, with Copy and Share. */
@Composable
private fun ShareLinkPanel(
    export: ShareLinkExport,
    onCopy: () -> Unit,
    onSend: () -> Unit,
    onDismiss: () -> Unit,
) {
    val sidePx = with(LocalDensity.current) { 240.dp.roundToPx() }
    val qr = remember(export.link, sidePx) { shareQrMatrix(export.link)?.toImageBitmap(sidePx) }
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag("share-panel"),
        title = {
            Text(
                export.request.title.ifEmpty { stringResource(R.string.share_link_clip_label) },
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        },
        text = {
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (qr != null) {
                    val sideDp = with(LocalDensity.current) { qr.width.toDp() }
                    // Dark modules on light in every theme, as scanners expect.
                    Image(
                        bitmap = qr,
                        contentDescription = stringResource(R.string.share_qr_description),
                        modifier = Modifier.size(sideDp).background(Color.White).testTag("share-qr"),
                        filterQuality = FilterQuality.None,
                    )
                } else {
                    Text(stringResource(R.string.share_qr_too_long))
                }
                shareLinkNoticeRes(export)?.let {
                    Spacer(Modifier.height(12.dp))
                    Text(stringResource(it), style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(Modifier.height(12.dp))
                SelectionContainer {
                    Text(
                        export.link,
                        maxLines = 4,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        confirmButton = {
            Row {
                TextButton(onClick = onCopy, modifier = Modifier.testTag("share-panel-copy")) {
                    Text(stringResource(R.string.action_copy))
                }
                TextButton(onClick = onSend, modifier = Modifier.testTag("share-panel-send")) {
                    Text(stringResource(R.string.action_share_link))
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
        },
    )
}

/**
 * Draws whole pixels per module, as large as fits in [maxSidePx], so the
 * modules stay square and sharp when shown at the bitmap's own size.
 */
private fun BitMatrix.toImageBitmap(maxSidePx: Int): ImageBitmap {
    val modules = width
    val scale = (maxSidePx / modules).coerceAtLeast(1)
    val side = modules * scale
    val pixels =
        IntArray(side * side) { index ->
            if (get(index % side / scale, index / side / scale)) android.graphics.Color.BLACK else android.graphics.Color.WHITE
        }
    return Bitmap.createBitmap(pixels, side, side, Bitmap.Config.ARGB_8888).asImageBitmap()
}
