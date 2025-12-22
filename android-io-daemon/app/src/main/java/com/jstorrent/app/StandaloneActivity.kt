package com.jstorrent.app

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.util.Base64
import android.util.Log
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
                // Improve performance
                cacheMode = WebSettings.LOAD_DEFAULT
            }

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
}
