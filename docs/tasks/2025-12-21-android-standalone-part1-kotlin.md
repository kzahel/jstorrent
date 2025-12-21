# Android Standalone Part 1: Kotlin Bridge & Activity

**Status:** Ready for execution  
**Scope:** KVBridge, TypeScript adapters, StandaloneActivity  
**Handoff to:** `2025-12-21-android-standalone-part2-ui.md`

---

## Context

We're adding a foreground-only WebView-based torrent client for non-ChromeOS Android devices. This replaces the current "go away" NonChromebookScreen with a functional UI.

**Architecture:**
```
StandaloneActivity
└── WebView
    └── standalone.html (Part 2)
        └── @jstorrent/engine
            ├── DaemonSocketFactory → 127.0.0.1:7800 (existing)
            ├── DaemonFileSystem → 127.0.0.1:7800 (existing)
            ├── JsBridgeSessionStore → window.KVBridge (this task)
            └── JsBridgeSettingsStore → window.KVBridge (this task)
```

**Your job:** Build the Kotlin bridge and TypeScript adapters. Part 2 will build the UI that uses them.

---

## Phase 1: KVBridge (Kotlin)

JavaScript bridge for key-value storage using SharedPreferences.

### 1.1 Create bridge directory

```bash
mkdir -p app/src/main/java/com/jstorrent/app/bridge
```

### 1.2 Create KVBridge.kt

```kotlin
// app/src/main/java/com/jstorrent/app/bridge/KVBridge.kt
package com.jstorrent.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * JavaScript bridge for key-value storage.
 * Backs the engine's session and settings stores via SharedPreferences.
 * 
 * Called from JS as: window.KVBridge.get("key")
 */
class KVBridge(context: Context) {
    
    private val prefs = context.getSharedPreferences("jstorrent_kv", Context.MODE_PRIVATE)
    
    @JavascriptInterface
    fun get(key: String): String? {
        return prefs.getString(key, null)
    }
    
    @JavascriptInterface
    fun set(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
    
    @JavascriptInterface
    fun delete(key: String) {
        prefs.edit().remove(key).apply()
    }
    
    @JavascriptInterface
    fun clear() {
        prefs.edit().clear().apply()
    }
    
    /**
     * Get all keys matching a prefix.
     * Returns JSON array of keys.
     */
    @JavascriptInterface
    fun keys(prefix: String): String {
        val matchingKeys = prefs.all.keys.filter { it.startsWith(prefix) }
        return JSONArray(matchingKeys).toString()
    }
    
    /**
     * Get multiple values at once.
     * Input: JSON array of keys
     * Output: JSON object { key: value, ... } (null values omitted)
     */
    @JavascriptInterface
    fun getMulti(keysJson: String): String {
        val keys = JSONArray(keysJson)
        val result = JSONObject()
        for (i in 0 until keys.length()) {
            val key = keys.getString(i)
            prefs.getString(key, null)?.let { result.put(key, it) }
        }
        return result.toString()
    }
}
```

### 1.3 Create RootsBridge.kt

Expose download roots to WebView:

```kotlin
// app/src/main/java/com/jstorrent/app/bridge/RootsBridge.kt
package com.jstorrent.app.bridge

import android.content.Context
import android.webkit.JavascriptInterface
import com.jstorrent.app.storage.RootStore
import org.json.JSONArray
import org.json.JSONObject

/**
 * JavaScript bridge for download root access.
 * Exposes SAF-selected folders to the WebView.
 */
class RootsBridge(private val context: Context) {
    
    private val rootStore by lazy { RootStore(context) }
    
    @JavascriptInterface
    fun hasDownloadRoot(): Boolean {
        return rootStore.getRoots().isNotEmpty()
    }
    
    @JavascriptInterface
    fun getDownloadRoots(): String {
        val roots = rootStore.getRoots()
        val arr = JSONArray()
        for (root in roots) {
            arr.put(JSONObject().apply {
                put("key", root.key)
                put("displayName", root.displayName)
                put("available", root.lastStatOk)
            })
        }
        return arr.toString()
    }
    
    @JavascriptInterface
    fun getDefaultRootKey(): String? {
        return rootStore.getRoots().firstOrNull()?.key
    }
}
```

### ⚠️ CHECKPOINT 1

Before proceeding:
1. Run `./gradlew assembleDebug` - must compile without errors
2. Verify both bridge files exist in `app/src/main/java/com/jstorrent/app/bridge/`

---

## Phase 2: TypeScript Storage Adapters

Create adapters that call window.KVBridge.

### 2.1 Create adapter directory

```bash
mkdir -p packages/engine/src/adapters/android
```

### 2.2 Create JsBridgeKVStore.ts

```typescript
// packages/engine/src/adapters/android/JsBridgeKVStore.ts

declare global {
  interface Window {
    KVBridge?: {
      get(key: string): string | null
      set(key: string, value: string): void
      delete(key: string): void
      clear(): void
      keys(prefix: string): string // JSON array
      getMulti(keysJson: string): string // JSON object
    }
    RootsBridge?: {
      hasDownloadRoot(): boolean
      getDownloadRoots(): string // JSON array
      getDefaultRootKey(): string | null
    }
  }
}

/**
 * KV store implementation using Android's @JavascriptInterface bridge.
 * Synchronous under the hood (SharedPreferences), but we wrap in async
 * for interface compatibility.
 */
export class JsBridgeKVStore {
  private get bridge() {
    if (!window.KVBridge) {
      throw new Error('KVBridge not available - not running in Android WebView')
    }
    return window.KVBridge
  }

  async get(key: string): Promise<string | null> {
    return this.bridge.get(key)
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const value = this.bridge.get(key)
    return value ? JSON.parse(value) : null
  }

  async set(key: string, value: string): Promise<void> {
    this.bridge.set(key, value)
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    this.bridge.set(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    this.bridge.delete(key)
  }

  async keys(prefix: string): Promise<string[]> {
    const json = this.bridge.keys(prefix)
    return JSON.parse(json)
  }

  async getMulti(keys: string[]): Promise<Record<string, string>> {
    const json = this.bridge.getMulti(JSON.stringify(keys))
    return JSON.parse(json)
  }

  async clear(): Promise<void> {
    this.bridge.clear()
  }
}
```

### 2.3 Create JsBridgeSessionStore.ts

First, check what the ISessionStore interface looks like:

```bash
# Find the interface definition
grep -r "interface ISessionStore" packages/engine/src --include="*.ts"
```

Then implement:

```typescript
// packages/engine/src/adapters/android/JsBridgeSessionStore.ts

import type { ISessionStore, TorrentSession } from '../../interfaces/session-store'
import { JsBridgeKVStore } from './JsBridgeKVStore'

const SESSION_PREFIX = 'session:'

/**
 * Session store for Android standalone mode.
 * Stores torrent sessions in SharedPreferences via KVBridge.
 */
export class JsBridgeSessionStore implements ISessionStore {
  private kv = new JsBridgeKVStore()

  async getSession(infohash: string): Promise<TorrentSession | null> {
    return this.kv.getJSON<TorrentSession>(`${SESSION_PREFIX}${infohash}`)
  }

  async saveSession(infohash: string, session: TorrentSession): Promise<void> {
    await this.kv.setJSON(`${SESSION_PREFIX}${infohash}`, session)
  }

  async deleteSession(infohash: string): Promise<void> {
    await this.kv.delete(`${SESSION_PREFIX}${infohash}`)
  }

  async listSessions(): Promise<string[]> {
    const keys = await this.kv.keys(SESSION_PREFIX)
    return keys.map((k) => k.slice(SESSION_PREFIX.length))
  }
}
```

### 2.4 Create JsBridgeSettingsStore.ts

First, check the ISettingsStore interface:

```bash
grep -r "interface ISettingsStore\|interface.*SettingsStore" packages/engine/src --include="*.ts"
```

Then implement (adjust based on actual interface):

```typescript
// packages/engine/src/adapters/android/JsBridgeSettingsStore.ts

import { JsBridgeKVStore } from './JsBridgeKVStore'

const SETTINGS_KEY = 'settings'

// Adjust this type based on actual Settings interface
export interface Settings {
  maxConnections?: number
  maxDownloadSpeed?: number
  maxUploadSpeed?: number
  downloadRootKey?: string
}

/**
 * Settings store for Android standalone mode.
 */
export class JsBridgeSettingsStore {
  private kv = new JsBridgeKVStore()

  async getSettings(): Promise<Settings | null> {
    return this.kv.getJSON<Settings>(SETTINGS_KEY)
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.kv.setJSON(SETTINGS_KEY, settings)
  }

  async getSetting<K extends keyof Settings>(key: K): Promise<Settings[K] | undefined> {
    const settings = await this.getSettings()
    return settings?.[key]
  }

  async setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    const settings = (await this.getSettings()) ?? {}
    settings[key] = value
    await this.saveSettings(settings)
  }
}
```

### 2.5 Create index.ts

```typescript
// packages/engine/src/adapters/android/index.ts
export { JsBridgeKVStore } from './JsBridgeKVStore'
export { JsBridgeSessionStore } from './JsBridgeSessionStore'
export { JsBridgeSettingsStore } from './JsBridgeSettingsStore'
```

### ⚠️ CHECKPOINT 2

Before proceeding:
1. Run `pnpm typecheck` from monorepo root - must pass
2. Verify adapters implement the correct interfaces (check imports resolved)
3. If interface doesn't exist or differs, adapt the implementation

---

## Phase 3: StandaloneActivity

New activity that hosts the WebView.

### 3.1 Create StandaloneActivity.kt

```kotlin
// app/src/main/java/com/jstorrent/app/StandaloneActivity.kt
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
import com.jstorrent.app.bridge.KVBridge
import com.jstorrent.app.bridge.RootsBridge
import com.jstorrent.app.service.IoDaemonService

private const val TAG = "StandaloneActivity"

class StandaloneActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var kvBridge: KVBridge
    private lateinit var rootsBridge: RootsBridge
    private var pendingIntent: Intent? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.i(TAG, "onCreate")

        // Start IO daemon service
        IoDaemonService.start(this)

        // Create bridges
        kvBridge = KVBridge(this)
        rootsBridge = RootsBridge(this)

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
            }
        }

        setContentView(webView)

        // Save intent for after page loads
        pendingIntent = intent

        // Load UI
        loadUI()
    }

    private fun loadUI() {
        if (BuildConfig.DEBUG) {
            // Dev mode: load from dev server
            // 10.0.2.2 is host loopback from Android emulator
            val devUrl = "http://10.0.2.2:3001/standalone.html"
            Log.i(TAG, "Loading dev URL: $devUrl")
            webView.loadUrl(devUrl)
        } else {
            // Production: load from assets
            webView.loadUrl("file:///android_asset/standalone/standalone.html")
        }
    }

    private fun injectConfig() {
        val port = IoDaemonService.instance?.port ?: 7800
        val script = """
            (function() {
                window.JSTORRENT_CONFIG = {
                    daemonUrl: 'http://127.0.0.1:$port',
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
```

### 3.2 Add port accessor to IoDaemonService

Check if `port` is already accessible. If not, add:

```kotlin
// In IoDaemonService.kt, add to the class:

val port: Int
    get() = httpServer?.port ?: 7800
```

### 3.3 Update MainActivity routing

Find the `isRunningOnChromebook()` check in MainActivity.kt and update to route to StandaloneActivity:

```kotlin
// In MainActivity.onCreate(), near the top after super.onCreate():

if (!isRunningOnChromebook()) {
    Log.i(TAG, "Not a Chromebook - launching standalone mode")
    startActivity(Intent(this, StandaloneActivity::class.java).apply {
        data = intent.data  // Forward any magnet/torrent intent
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
    })
    finish()
    return
}
```

### 3.4 Update AndroidManifest.xml

Add the new activity with intent filters:

```xml
<!-- Add inside <application> tag -->
<activity
    android:name=".StandaloneActivity"
    android:exported="true"
    android:launchMode="singleTask"
    android:theme="@style/Theme.JSTorrent"
    android:configChanges="orientation|screenSize|keyboardHidden">

    <!-- Magnet links -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="magnet" />
    </intent-filter>

    <!-- .torrent files -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:scheme="content" />
        <data android:mimeType="application/x-bittorrent" />
    </intent-filter>
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:scheme="file" />
        <data android:mimeType="application/x-bittorrent" />
    </intent-filter>

    <!-- Internal intents -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:scheme="jstorrent" android:host="add-root" />
    </intent-filter>
</activity>
```

### ⚠️ CHECKPOINT 3

Before completing:
1. Run `./gradlew assembleDebug` - must compile
2. Verify StandaloneActivity is in manifest
3. Test on emulator (non-Chromebook):
   - App should launch StandaloneActivity
   - WebView should attempt to load (will fail without UI - that's Part 2)
   - Check logcat for "StandaloneActivity" logs

---

## Handoff to Part 2

**What's complete:**
- KVBridge.kt - JS bridge for SharedPreferences storage
- RootsBridge.kt - JS bridge for download root access  
- JsBridgeKVStore.ts - TypeScript wrapper for KVBridge
- JsBridgeSessionStore.ts - Session persistence adapter
- JsBridgeSettingsStore.ts - Settings persistence adapter
- StandaloneActivity.kt - WebView host with config injection

**Interface contract for Part 2:**

```typescript
// Available on window after page load:
window.JSTORRENT_CONFIG = {
  daemonUrl: string,  // e.g., 'http://127.0.0.1:7800'
  platform: 'android-standalone'
}

// Callback when config is ready:
window.onJSTorrentConfig = (config) => { ... }

// Handlers Part 2 must implement:
window.handleMagnet = (magnetLink: string) => void
window.handleTorrentFile = (name: string, base64: string) => void

// Bridges available:
window.KVBridge.get/set/delete/clear/keys/getMulti
window.RootsBridge.hasDownloadRoot/getDownloadRoots/getDefaultRootKey
```

**Part 2 builds:** `standalone.html` and the minimal UI that uses these bridges.

---

## Files Created/Modified

**New files:**
- `app/src/main/java/com/jstorrent/app/bridge/KVBridge.kt`
- `app/src/main/java/com/jstorrent/app/bridge/RootsBridge.kt`
- `app/src/main/java/com/jstorrent/app/StandaloneActivity.kt`
- `packages/engine/src/adapters/android/JsBridgeKVStore.ts`
- `packages/engine/src/adapters/android/JsBridgeSessionStore.ts`
- `packages/engine/src/adapters/android/JsBridgeSettingsStore.ts`
- `packages/engine/src/adapters/android/index.ts`

**Modified files:**
- `app/src/main/java/com/jstorrent/app/MainActivity.kt` - Route non-Chromebook to StandaloneActivity
- `app/src/main/java/com/jstorrent/app/service/IoDaemonService.kt` - Add port accessor (if needed)
- `app/src/main/AndroidManifest.xml` - Add StandaloneActivity
