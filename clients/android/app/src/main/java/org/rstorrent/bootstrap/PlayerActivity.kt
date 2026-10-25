@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package org.rstorrent.bootstrap

import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.viewModels
import androidx.lifecycle.ViewModel
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import kotlin.math.roundToInt
import org.rstorrent.bootstrap.ui.ProductThemeMode
import org.rstorrent.bootstrap.ui.RstorrentTheme

class PlayerActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: android.content.Context) {
        super.attachBaseContext(ProductAppLanguage.wrap(newBase))
    }

    private var player: ExoPlayer? = null
    private val playbackSession: PlaybackSessionModel by viewModels()
    private var playerView: PlayerView? = null
    private var playbackTitle by mutableStateOf("")
    private var preparing by mutableStateOf(true)
    private var playbackError by mutableStateOf<PlaybackError?>(null)
    private var inPictureInPicture by mutableStateOf(false)
    private var interactionLeaseHeld = false
    private var videoAspectRatio: Rational? = null

    private val playerListener =
        object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                preparing =
                    playbackState == Player.STATE_IDLE || playbackState == Player.STATE_BUFFERING
                Log.i(
                    TAG,
                    "media_playback_state instance=$instanceId state=${stateLabel(playbackState)} " +
                        "position=${player?.currentPosition ?: 0L} " +
                        "buffered=${player?.bufferedPosition ?: 0L}",
                )
                updatePictureInPictureParameters()
            }

            override fun onPlayerError(error: PlaybackException) {
                preparing = false
                playbackError = PlaybackError.FAILED
                Log.e(TAG, "media_playback_error instance=$instanceId code=${error.errorCode}")
                updatePictureInPictureParameters()
            }

            override fun onVideoSizeChanged(videoSize: VideoSize) {
                if (videoSize.width <= 0 || videoSize.height <= 0) return
                val ratio =
                    (videoSize.width.toDouble() * videoSize.pixelWidthHeightRatio) /
                        videoSize.height.toDouble()
                val bounded = ratio.coerceIn(MIN_PIP_ASPECT_RATIO, MAX_PIP_ASPECT_RATIO)
                videoAspectRatio = Rational((bounded * ASPECT_RATIO_SCALE).roundToInt(), ASPECT_RATIO_SCALE)
                Log.i(
                    TAG,
                    "media_playback_video instance=$instanceId width=${videoSize.width} " +
                        "height=${videoSize.height}",
                )
                updatePictureInPictureParameters()
            }

            override fun onRenderedFirstFrame() {
                Log.i(TAG, "media_playback_first_frame instance=$instanceId")
            }

            override fun onPositionDiscontinuity(
                oldPosition: Player.PositionInfo,
                newPosition: Player.PositionInfo,
                reason: Int,
            ) {
                Log.i(
                    TAG,
                    "media_playback_position instance=$instanceId reason=$reason " +
                        "from=${oldPosition.positionMs} to=${newPosition.positionMs}",
                )
            }
        }

    private val instanceId = nextInstanceId.incrementAndGet()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Capability URLs stay only in a retained in-process owner, never in
        // saved state. Process death intentionally requires opening media again.
        val request = consumeRequest(intent)?.also { playbackSession.request = it }
            ?: playbackSession.request
        if (request == null) {
            finish()
            return
        }
        acquireInteractionLease()
        Log.i(TAG, "media_playback_created instance=$instanceId")
        initializePlayer(
            request,
            savedInstanceState?.getLong(STATE_POSITION_MILLIS) ?: playbackSession.positionMillis,
            savedInstanceState?.getBoolean(STATE_PLAY_WHEN_READY) ?: playbackSession.playWhenReady,
        )
        setContent {
            RstorrentTheme(ProductThemeMode.SYSTEM, dynamicColor = true) {
                if (inPictureInPicture) {
                    PlayerSurface()
                } else {
                    Scaffold(
                        topBar = {
                            TopAppBar(
                                navigationIcon = {
                                    IconButton(onClick = ::finish) {
                                        Icon(
                                            Icons.AutoMirrored.Outlined.ArrowBack,
                                            contentDescription =
                                                stringResource(R.string.a11y_close_player),
                                        )
                                    }
                                },
                                title = { Text(playbackTitle, maxLines = 1) },
                            )
                        },
                    ) { padding ->
                        Box(
                            Modifier
                                .fillMaxSize()
                                .padding(padding)
                                .background(Color.Black),
                        ) {
                            PlayerSurface()
                            if (preparing && playbackError == null) {
                                CircularProgressIndicator(Modifier.align(Alignment.Center))
                            }
                            playbackError?.let { playbackError ->
                                Text(
                                    stringResource(
                                        when (playbackError) {
                                            PlaybackError.FAILED -> R.string.media_playback_failed
                                            PlaybackError.INVALID_REQUEST -> R.string.media_invalid_request
                                        },
                                    ),
                                    color = MaterialTheme.colorScheme.error,
                                    modifier = Modifier.align(Alignment.Center),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun PlayerSurface() {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                PlayerView(context).apply {
                    player = this@PlayerActivity.player
                    useController = !inPictureInPicture
                    setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS)
                    playerView = this
                }
            },
            update = { view ->
                view.player = player
                view.useController = !inPictureInPicture
                playerView = view
            },
        )
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        when (intent.getStringExtra(EXTRA_CONTROL)) {
            CONTROL_SEEK -> {
                val position = intent.getLongExtra(EXTRA_POSITION_MILLIS, -1L)
                intent.removeExtra(EXTRA_CONTROL)
                intent.removeExtra(EXTRA_POSITION_MILLIS)
                if (position >= 0L) {
                    Log.i(TAG, "media_playback_seek_requested instance=$instanceId position=$position")
                    player?.seekTo(position)
                }
                return
            }
            CONTROL_CLOSE -> {
                intent.removeExtra(EXTRA_CONTROL)
                Log.i(TAG, "media_playback_close_requested instance=$instanceId")
                finishAndRemoveTask()
                return
            }
        }
        val request = consumeRequest(intent)
        if (request == null) {
            player?.stop()
            playbackError = PlaybackError.INVALID_REQUEST
            preparing = false
            updatePictureInPictureParameters()
            return
        }
        playbackTitle = request.title
        playbackSession.request = request
        playbackSession.positionMillis = 0L
        playbackSession.playWhenReady = true
        playbackError = null
        preparing = true
        player?.apply {
            setMediaItem(MediaItem.fromUri(request.source))
            prepare()
            playWhenReady = true
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && canEnterPictureInPicture()) {
            runCatching { enterPictureInPictureMode(currentPictureInPictureParameters()) }
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPictureInPicture = isInPictureInPictureMode
        Log.i(
            TAG,
            "media_playback_pip instance=$instanceId active=$isInPictureInPictureMode",
        )
    }

    override fun onDestroy() {
        player?.let {
            playbackSession.positionMillis = it.currentPosition
            playbackSession.playWhenReady = it.playWhenReady
        }
        playerView?.player = null
        playerView = null
        player?.removeListener(playerListener)
        player?.release()
        player = null
        // The retained playback request hands the lease to its replacement;
        // releasing it here could stop the engine during locale recreation.
        if (!isChangingConfigurations) releaseInteractionLease()
        Log.i(TAG, "media_playback_released instance=$instanceId")
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putLong(STATE_POSITION_MILLIS, player?.currentPosition ?: playbackSession.positionMillis)
        outState.putBoolean(STATE_PLAY_WHEN_READY, player?.playWhenReady ?: playbackSession.playWhenReady)
        super.onSaveInstanceState(outState)
    }

    private fun initializePlayer(
        request: PlaybackRequest,
        positionMillis: Long,
        playWhenReady: Boolean,
    ) {
        playbackTitle = request.title
        val audioAttributes =
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build()
        player =
            ExoPlayer.Builder(this)
                .setMediaSourceFactory(
                    DefaultMediaSourceFactory(this)
                        .setDataSourceFactory(
                            DefaultHttpDataSource.Factory()
                                .setConnectTimeoutMs(MEDIA_CONNECT_TIMEOUT_MILLIS)
                                .setReadTimeoutMs(MEDIA_READ_TIMEOUT_MILLIS),
                        ),
                )
                .setAudioAttributes(audioAttributes, true)
                .build()
                .also { mediaPlayer ->
                    mediaPlayer.addListener(playerListener)
                    mediaPlayer.setMediaItem(MediaItem.fromUri(request.source), positionMillis.coerceAtLeast(0L))
                    mediaPlayer.prepare()
                    mediaPlayer.playWhenReady = playWhenReady
                }
        updatePictureInPictureParameters()
    }

    private fun acquireInteractionLease() {
        if (interactionLeaseHeld) return
        interactionLeaseHeld = true
        ProductInteractionRegistry.setLease(ProductEngineService.INTERACTION_PLAYBACK, true)
    }

    private fun releaseInteractionLease() {
        if (!interactionLeaseHeld) return
        interactionLeaseHeld = false
        ProductInteractionRegistry.setLease(ProductEngineService.INTERACTION_PLAYBACK, false)
    }

    private fun canEnterPictureInPicture(): Boolean =
        !isFinishing && player != null && playbackError == null

    private fun currentPictureInPictureParameters(): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder()
        videoAspectRatio?.let(builder::setAspectRatio)
        val sourceRect = Rect()
        if (playerView?.getGlobalVisibleRect(sourceRect) == true && !sourceRect.isEmpty) {
            builder.setSourceRectHint(sourceRect)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(canEnterPictureInPicture())
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    private fun updatePictureInPictureParameters() {
        if (isFinishing) return
        runCatching { setPictureInPictureParams(currentPictureInPictureParameters()) }
    }

    private fun consumeRequest(intent: Intent): PlaybackRequest? {
        val source = intent.getStringExtra(EXTRA_SOURCE)
        val title = intent.getStringExtra(EXTRA_TITLE)?.take(MAX_TITLE_CHARACTERS)
        intent.removeExtra(EXTRA_SOURCE)
        intent.removeExtra(EXTRA_TITLE)
        if (source == null) return null
        return runCatching {
            PlaybackRequest(
                AndroidMediaPlaybackPolicy.requireCapabilityUrl(source),
                title?.takeIf(String::isNotBlank) ?: getString(R.string.media_fallback_title),
            )
        }.getOrNull()
    }

    private enum class PlaybackError {
        FAILED,
        INVALID_REQUEST,
    }

    internal class PlaybackSessionModel : ViewModel() {
        var request: PlaybackRequest? = null
        var positionMillis = 0L
        var playWhenReady = true
    }

    internal data class PlaybackRequest(
        val source: String,
        val title: String,
    )

    companion object {
        private const val TAG = "RSTorrentProduct"
        private const val STATE_POSITION_MILLIS = "playback_position_millis"
        private const val STATE_PLAY_WHEN_READY = "playback_play_when_ready"
        private const val EXTRA_SOURCE = "org.rstorrent.bootstrap.extra.MEDIA_SOURCE"
        private const val EXTRA_TITLE = "org.rstorrent.bootstrap.extra.MEDIA_TITLE"
        private const val EXTRA_CONTROL = "org.rstorrent.bootstrap.extra.MEDIA_CONTROL"
        private const val EXTRA_POSITION_MILLIS =
            "org.rstorrent.bootstrap.extra.MEDIA_POSITION_MILLIS"
        private const val CONTROL_SEEK = "seek"
        private const val CONTROL_CLOSE = "close"
        private const val MAX_TITLE_CHARACTERS = 256
        private const val ASPECT_RATIO_SCALE = 10_000
        private const val MIN_PIP_ASPECT_RATIO = 1.0 / 2.39
        private const val MAX_PIP_ASPECT_RATIO = 2.39
        private const val MEDIA_CONNECT_TIMEOUT_MILLIS = 15_000
        private const val MEDIA_READ_TIMEOUT_MILLIS = 125_000
        private val nextInstanceId = java.util.concurrent.atomic.AtomicLong(0L)

        internal fun launchIntent(
            context: Context,
            source: String,
            title: String,
        ): Intent =
            Intent(context, PlayerActivity::class.java).apply {
                putExtra(EXTRA_SOURCE, AndroidMediaPlaybackPolicy.requireCapabilityUrl(source))
                putExtra(EXTRA_TITLE, title.take(MAX_TITLE_CHARACTERS))
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }

        internal fun controlIntent(
            context: Context,
            positionMillis: Long?,
        ): Intent =
            Intent(context, PlayerActivity::class.java).apply {
                putExtra(EXTRA_CONTROL, if (positionMillis == null) CONTROL_CLOSE else CONTROL_SEEK)
                positionMillis?.let { putExtra(EXTRA_POSITION_MILLIS, it) }
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }

        private fun stateLabel(state: Int): String =
            when (state) {
                Player.STATE_IDLE -> "idle"
                Player.STATE_BUFFERING -> "buffering"
                Player.STATE_READY -> "ready"
                Player.STATE_ENDED -> "ended"
                else -> "unknown"
            }
    }
}
