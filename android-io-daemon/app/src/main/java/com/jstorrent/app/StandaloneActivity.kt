package com.jstorrent.app

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.ContextMenu
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.jstorrent.app.auth.TokenStore
import com.jstorrent.app.bridge.KVBridge
import com.jstorrent.app.bridge.RootsBridge
import com.jstorrent.app.service.IoDaemonService
import com.jstorrent.app.storage.RootStore

private const val TAG = "StandaloneActivity"

class StandaloneActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var kvBridge: KVBridge
    private lateinit var rootsBridge: RootsBridge
    private lateinit var tokenStore: TokenStore
    private lateinit var rootStore: RootStore
    private var pendingIntent: Intent? = null

    private val folderPickerLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri != null) {
            Log.i(TAG, "Folder selected: $uri")
            // Take persistent permission
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            // Add to root store
            val root = rootStore.addRoot(uri)
            Log.i(TAG, "Added root: ${root.key} -> ${root.displayName}")
            // Notify WebView that roots changed
            rootsBridge.reload()
            Toast.makeText(this, "Added: ${root.displayName}", Toast.LENGTH_SHORT).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.i(TAG, "onCreate")

        // Enable remote debugging (chrome://inspect)
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // Start IO daemon service
        IoDaemonService.start(this)

        // Create bridges and stores
        kvBridge = KVBridge(this)
        rootsBridge = RootsBridge(this)
        tokenStore = TokenStore(this)
        rootStore = RootStore(this)

        // Create WebView
        webView = WebView(this).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                // Allow mixed content for localhost HTTP
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                // Disable caching for development (HMR support)
                cacheMode = WebSettings.LOAD_NO_CACHE
            }

            // Prevent native Android context menus from showing
            // Let JavaScript handle context menus instead
            setOnLongClickListener { true }
            isLongClickable = false
            isHapticFeedbackEnabled = false

            // Disable WebView's built-in context menu for right-click
            setOnCreateContextMenuListener { _, _, _ -> }  // Empty listener, do nothing

            // Add JavaScript interfaces
            addJavascriptInterface(kvBridge, "KVBridge")
            addJavascriptInterface(rootsBridge, "RootsBridge")

            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    Log.i(TAG, "Page finished loading: $url")
                    // Inject config
                    injectConfig()
                    // Handle any pending intent
                    pendingIntent?.let { handleIntent(it) }
                    pendingIntent = null
                }

                override fun shouldOverrideUrlLoading(view: WebView?, request: android.webkit.WebResourceRequest?): Boolean {
                    val url = request?.url ?: return false
                    if (url.scheme == "jstorrent") {
                        when (url.host) {
                            "add-root" -> openFolderPicker()
                            "switch-ui" -> {
                                val mode = url.getQueryParameter("mode") ?: return false
                                Log.i(TAG, "Switching UI to: $mode")
                                tokenStore.uiMode = mode
                                loadUI()
                            }
                        }
                        return true // We handled it
                    }
                    return false // Let WebView handle it
                }
            }
        }

        setContentView(webView)

        // Save intent for after page loads
        pendingIntent = intent

        // Load UI
        loadUI()
    }

    private fun getUiPath(): String {
        // Intent extra overrides saved preference
        val intentMode = intent.getStringExtra("ui_mode")
        val uiMode = if (intentMode != null) {
            tokenStore.uiMode = intentMode  // Save for next launch
            intentMode
        } else {
            tokenStore.uiMode  // Use saved preference
        }
        return if (uiMode == "full") {
            "standalone_full/standalone_full.html"
        } else {
            "standalone/standalone.html"
        }
    }

    private fun loadUI() {
        val path = getUiPath()
        if (BuildConfig.DEBUG) {
            // Dev mode: load from dev server via adb reverse
            // Use 127.0.0.1 (not 10.0.2.2) so crypto.subtle works (secure context)
            // Requires: adb reverse tcp:3000 tcp:3000
            val devUrl = "http://127.0.0.1:3000/$path"
            Log.i(TAG, "Loading dev URL: $devUrl")
            webView.loadUrl(devUrl)
        } else {
            // Production: load from assets
            webView.loadUrl("file:///android_asset/$path")
        }
    }

    private fun openFolderPicker() {
        Log.i(TAG, "Opening folder picker")
        folderPickerLauncher.launch(null)
    }

    private fun injectConfig() {
        val port = IoDaemonService.instance?.port ?: 7800
        val token = tokenStore.standaloneToken
        val script = """
            (function() {
                window.JSTORRENT_CONFIG = {
                    daemonUrl: 'http://127.0.0.1:$port?token=$token',
                    platform: 'android-standalone'
                };
                console.log('[JSTorrent] Config injected:', window.JSTORRENT_CONFIG);
                if (window.onJSTorrentConfig) {
                    window.onJSTorrentConfig(window.JSTORRENT_CONFIG);
                }

                // Long-press to contextmenu for touch devices
                if (!window._longPressInitialized) {
                    window._longPressInitialized = true;
                    let longPressTimer = null;
                    let longPressTarget = null;
                    const LONG_PRESS_DURATION = 500;

                    document.addEventListener('touchstart', (e) => {
                        if (e.touches.length !== 1) return;
                        longPressTarget = e.target;
                        const touch = e.touches[0];
                        longPressTimer = setTimeout(() => {
                            const contextEvent = new MouseEvent('contextmenu', {
                                bubbles: true,
                                cancelable: true,
                                clientX: touch.clientX,
                                clientY: touch.clientY,
                                screenX: touch.screenX,
                                screenY: touch.screenY
                            });
                            longPressTarget.dispatchEvent(contextEvent);
                            longPressTarget = null;
                        }, LONG_PRESS_DURATION);
                    }, { passive: true });

                    document.addEventListener('touchmove', () => {
                        if (longPressTimer) {
                            clearTimeout(longPressTimer);
                            longPressTimer = null;
                        }
                    }, { passive: true });

                    document.addEventListener('touchend', () => {
                        if (longPressTimer) {
                            clearTimeout(longPressTimer);
                            longPressTimer = null;
                        }
                    }, { passive: true });

                    document.addEventListener('touchcancel', () => {
                        if (longPressTimer) {
                            clearTimeout(longPressTimer);
                            longPressTimer = null;
                        }
                    }, { passive: true });

                    console.log('[JSTorrent] Long-press to contextmenu initialized');
                }
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        Log.i(TAG, "onNewIntent: ${intent.data}")

        // Check for UI mode change
        val intentMode = intent.getStringExtra("ui_mode")
        if (intentMode != null && intentMode != tokenStore.uiMode) {
            Log.i(TAG, "UI mode changed to: $intentMode")
            tokenStore.uiMode = intentMode
            loadUI()
            return  // Don't handle other intent data when switching modes
        }

        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent) {
        val uri = intent.data ?: return

        when (uri.scheme) {
            "magnet" -> {
                val magnetLink = uri.toString()
                Log.i(TAG, "Handling magnet: $magnetLink")
                val escaped = magnetLink.replace("\\", "\\\\").replace("'", "\\'")
                webView.evaluateJavascript(
                    "window.handleMagnet && window.handleMagnet('$escaped')",
                    null
                )
            }

            "content", "file" -> {
                // .torrent file - read and pass to engine
                Log.i(TAG, "Handling torrent file: $uri")
                try {
                    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    if (bytes != null) {
                        val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                        val name = uri.lastPathSegment ?: "unknown.torrent"
                        val escaped = name.replace("\\", "\\\\").replace("'", "\\'")
                        webView.evaluateJavascript(
                            "window.handleTorrentFile && window.handleTorrentFile('$escaped', '$base64')",
                            null
                        )
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to read torrent file", e)
                    Toast.makeText(this, "Failed to open torrent file", Toast.LENGTH_SHORT).show()
                }
            }

            "jstorrent" -> {
                // Internal intents
                when (uri.host) {
                    "add-root" -> {
                        startActivity(Intent(this, AddRootActivity::class.java))
                    }
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        Log.i(TAG, "onPause - downloads will pause")
        webView.onPause()
        Toast.makeText(this, "Downloads paused - return to app to continue", Toast.LENGTH_SHORT)
            .show()
    }

    override fun onResume() {
        super.onResume()
        Log.i(TAG, "onResume")
        webView.onResume()
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy")
        webView.destroy()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    // Prevent native context menu on right-click - let JavaScript handle it
    override fun onCreateContextMenu(menu: ContextMenu?, v: View?, menuInfo: ContextMenu.ContextMenuInfo?) {
        // Do nothing - don't call super, don't create menu
    }

    // Intercept mouse right-click (secondary button) to prevent system "back" behavior
    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        // Check for secondary button (right-click) press
        if (event.actionMasked == MotionEvent.ACTION_BUTTON_PRESS &&
            event.actionButton == MotionEvent.BUTTON_SECONDARY) {
            Log.d(TAG, "Right-click intercepted, letting WebView handle via JS contextmenu")
            // Don't consume - let it reach WebView so JS contextmenu event fires
            return super.dispatchGenericMotionEvent(event)
        }
        return super.dispatchGenericMotionEvent(event)
    }

    // Intercept back button which might be triggered by right-click on emulators
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_DOWN) {
            Log.d(TAG, "Back key: source=${event.source}, repeat=${event.repeatCount}")
            // Emulator maps right-click to back - let onBackPressed handle it instead
            // This prevents the activity from being finished before we can check webView.canGoBack()
        }
        return super.dispatchKeyEvent(event)
    }
}
