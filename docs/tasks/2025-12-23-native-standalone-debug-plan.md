# Native Standalone Debug Plan

**Date:** December 23, 2025  
**Status:** In Progress

## Current State

The native standalone (QuickJS) is partially working:
- ✅ JNI bindings registered
- ✅ Engine bundle loads and evaluates  
- ✅ UI can add torrents
- ❌ Torrents don't download (no progress)
- ❌ Torrents don't persist (reload = gone)
- ❌ No magnet intent for NativeStandaloneActivity
- ❌ No way to switch back to WebView mode

## Root Cause Analysis

### Issue 1: No Session Persistence (CRITICAL)

**Problem:** `bundle-entry.ts` never calls `engine.restoreSession()`, so torrents aren't restored on app restart.

**Evidence:**
```typescript
// bundle-entry.ts init() currently does:
engine = createNativeEngine(nativeConfig)
setupController(engine)
stopStatePush = startStatePushLoop(engine)
// ← Missing: await engine.restoreSession()
```

Compare with `android-standalone-engine-manager.ts`:
```typescript
// WebView mode does:
const restored = await this.engine.restoreSession()
this.engine.resume()
```

**Fix:** Add `restoreSession()` call after engine creation in bundle-entry.ts.

---

### Issue 2: Downloads Not Progressing

**Likely causes (in order of probability):**

1. **Tracker announce failing** - UDP barely works on emulator
2. **TCP callback dispatch not working** - Need to verify callbacks fire
3. **File writes failing** - SAF permissions or path issues

**Debugging approach:** Use local seeder with peer hint to bypass tracker.

---

## Stepwise Debug Plan

### Phase 1: Fix Session Persistence (15 min)

**File:** `packages/engine/src/adapters/native/bundle-entry.ts`

Change the `init()` function:

```typescript
async init(config: {...}): Promise<void> {
  if (engine) {
    throw new Error('Engine already initialized')
  }

  const nativeConfig: NativeEngineConfig = { ... }

  engine = createNativeEngine(nativeConfig)
  setupController(engine)

  // NEW: Restore session before starting state push
  try {
    const restored = await engine.restoreSession()
    console.log(`JSTorrent: Restored ${restored} torrents from session`)
  } catch (e) {
    console.error('JSTorrent: Failed to restore session:', e)
  }

  stopStatePush = startStatePushLoop(engine)
  console.log('JSTorrent engine initialized')
}
```

**Verification:**
1. Add a torrent
2. Force kill the app (swipe away)
3. Reopen app
4. Torrent should reappear in the list

---

### Phase 2: Add Debug Logging (15 min)

Add verbose logging to trace the download flow:

**File:** `packages/engine/src/adapters/native/native-tcp-socket.ts`

Add logging to constructor and callbacks:
```typescript
constructor(private readonly id: number, ...) {
  console.log(`[NativeTcpSocket] Creating socket ${id}`)
  
  callbackManager.registerTcp(id, {
    onData: (data) => {
      console.log(`[NativeTcpSocket ${id}] onData: ${data.length} bytes`)
      this.onDataCb?.(data)
    },
    onClose: (hadError) => {
      console.log(`[NativeTcpSocket ${id}] onClose: hadError=${hadError}`)
      // ...
    },
    onError: (err) => {
      console.log(`[NativeTcpSocket ${id}] onError: ${err.message}`)
      // ...
    },
    onConnect: (success, errorMessage) => {
      console.log(`[NativeTcpSocket ${id}] onConnect: success=${success}, error=${errorMessage}`)
      // ...
    },
  })
}
```

**File:** `packages/engine/src/adapters/native/native-udp-socket.ts`

Similar logging for UDP.

---

### Phase 3: Test with Local Seeder (20 min)

Since UDP tracker/DHT barely works on emulator, test with a local seeder.

**Setup:**
1. Run Transmission/qBittorrent on your dev machine
2. Create a test torrent (small file, ~1MB)
3. Find your machine's IP on the local network (e.g., 192.168.1.100)
4. Create a magnet link with peer hint:
   ```
   magnet:?xt=urn:btih:INFOHASH&dn=test&x.pe=192.168.1.100:51413
   ```

**Alternative:** If using Android emulator:
- Host IP is usually `10.0.2.2` from emulator's perspective

**Test flow:**
1. Add the magnet link with peer hint
2. Watch logcat for:
   - `[NativeTcpSocket] Creating socket N`
   - `[NativeTcpSocket N] onConnect: success=true`
   - `[NativeTcpSocket N] onData: X bytes`

---

### Phase 4: Add Magnet Intent Support (20 min)

**File:** `android/app/src/main/AndroidManifest.xml`

Add intent filter to NativeStandaloneActivity:

```xml
<activity
    android:name=".NativeStandaloneActivity"
    android:exported="true"
    android:launchMode="singleTask">
    
    <!-- Existing intent filter for jstorrent://native -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="jstorrent" android:host="native" />
    </intent-filter>
    
    <!-- NEW: magnet: links -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="magnet" />
    </intent-filter>
    
    <!-- NEW: .torrent files -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="content" />
        <data android:mimeType="application/x-bittorrent" />
    </intent-filter>
</activity>
```

**Test with adb:**
```bash
# Test magnet link
adb shell am start -a android.intent.action.VIEW \
  -d "magnet:?xt=urn:btih:HASH&x.pe=10.0.2.2:51413"

# Test with peer hint for local seeder
adb shell am start -a android.intent.action.VIEW \
  -d "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=test&x.pe=10.0.2.2:51413"
```

---

### Phase 5: Add Settings/Mode Switcher UI (30 min)

**File:** `android/app/src/main/java/com/jstorrent/app/NativeStandaloneActivity.kt`

Add a settings button to the Compose UI:

```kotlin
@Composable
fun NativeStandaloneScreen(
    // existing params...
    onSwitchToWebView: () -> Unit  // NEW
) {
    Scaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text("JSTorrent") },
                actions = {
                    IconButton(onClick = onSwitchToWebView) {
                        Icon(
                            imageVector = Icons.Default.Settings,
                            contentDescription = "Settings"
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        // ... existing content
    }
}
```

Add mode switching:

```kotlin
private fun switchToWebViewMode() {
    // Stop the engine service
    EngineService.stop(this)
    
    // Save preference
    getSharedPreferences("jstorrent", MODE_PRIVATE).edit()
        .putString("standalone_mode", "webview")
        .apply()
    
    // Launch WebView standalone
    startActivity(Intent(this, StandaloneActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
    })
    finish()
}
```

---

### Phase 6: Verify Callback Flow (Debug Only)

If downloads still don't work, add tracing to verify callback dispatch:

**File:** `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/TcpBindings.kt`

Add logging:
```kotlin
override fun onTcpConnected(socketId: Int, success: Boolean, errorCode: Int) {
    Log.d("TcpBindings", "onTcpConnected: socket=$socketId, success=$success, error=$errorCode")
    if (!hasConnectedCallback) {
        Log.w("TcpBindings", "No connected callback registered!")
        return
    }
    // ...
}

override fun onTcpData(socketId: Int, data: ByteArray) {
    Log.d("TcpBindings", "onTcpData: socket=$socketId, bytes=${data.size}")
    // ...
}
```

---

## Quick Reference: Key Files

| Component | File |
|-----------|------|
| Bundle entry | `packages/engine/src/adapters/native/bundle-entry.ts` |
| Controller (JS→Kotlin) | `packages/engine/src/adapters/native/controller.ts` |
| Callback manager | `packages/engine/src/adapters/native/callback-manager.ts` |
| TCP socket (JS) | `packages/engine/src/adapters/native/native-tcp-socket.ts` |
| TCP bindings (Kotlin) | `android/quickjs-engine/.../bindings/TcpBindings.kt` |
| Native bindings | `android/quickjs-engine/.../bindings/NativeBindings.kt` |
| Engine service | `android/app/.../service/EngineService.kt` |
| Activity | `android/app/.../NativeStandaloneActivity.kt` |
| Session store | `packages/engine/src/adapters/native/native-session-store.ts` |
| Storage bindings | `android/quickjs-engine/.../bindings/StorageBindings.kt` |

---

## Expected Outcome

After all phases:
1. Torrents persist across app restarts
2. Download progress visible when connected to local seeder
3. Can add torrents via magnet: URL intent
4. Can switch between native and WebView modes
5. Full download works (verified with local seeder)

---

## Logcat Filter

```bash
adb logcat -s NativeStandaloneActivity EngineService EngineController QuickJsEngine TcpBindings UdpBindings NativeBindings
```

Or use the full tag filter:
```bash
adb logcat | grep -E "(NativeStandalone|EngineService|EngineController|QuickJs|TcpBinding|UdpBinding|NativeBinding|\[engine\]|\[NativeTcpSocket\]|\[controller\])"
```

---

## ADB Test Commands

### Launch Native Standalone
```bash
adb shell am start -n com.jstorrent.app/.NativeStandaloneActivity
```

### Add Magnet via Intent (URL-encoded)
```bash
# Format: jstorrent://native?magnet=<URL-encoded magnet link>
# The magnet parameter should be URL-encoded

# Example with a real infohash and local seeder at 10.0.2.2 (host from emulator):
MAGNET="magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=test&x.pe=10.0.2.2:51413"
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$MAGNET'))")
adb shell am start -a android.intent.action.VIEW -d "jstorrent://native?magnet=$ENCODED"
```

### Check SharedPreferences (verify persistence)
```bash
# Pull the preferences file
adb shell run-as com.jstorrent.app cat /data/data/com.jstorrent.app/shared_prefs/jstorrent_session.xml
```

---

## Testing with Local Seeder

1. **Start seeder** (Transmission, qBittorrent, or libtorrent) on your dev machine
2. **Create small test torrent** (~1MB file)
3. **Find emulator-accessible IP:**
   - Physical device on same network: Use your machine's LAN IP (e.g., 192.168.1.100)
   - Android emulator: Use `10.0.2.2` (host loopback from emulator's perspective)
4. **Create magnet with peer hint:**
   ```
   magnet:?xt=urn:btih:<INFOHASH>&dn=test&x.pe=<IP>:<PORT>
   ```
5. **Add via adb command above**
6. **Watch logcat for TCP connection logs**

Expected flow in logs:
```
[NativeTcpSocket] Creating socket 1
[NativeTcpSocket 1] Connecting to 10.0.2.2:51413
[NativeTcpSocket 1] Connect result: success=true
[NativeTcpSocket 1] onData: 68 bytes  (handshake)
[NativeTcpSocket 1] onData: ...       (bitfield, etc.)
```
