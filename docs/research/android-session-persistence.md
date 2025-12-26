# Android Session Persistence Architecture

Research into how torrent session state is persisted on Android.

## Overview

Android uses a two-layer persistence architecture:
1. **TypeScript Layer:** `ISessionStore` interface abstracts storage
2. **Native Layer:** Android SharedPreferences provides actual persistence

## ISessionStore Interface

Defined at `packages/engine/src/interfaces/session-store.ts`:

- Binary data methods: `get(key)`, `set(key, value)`, `delete(key)`, `keys(prefix)`, `clear()`
- JSON data methods: `getJson<T>(key)`, `setJson<T>(key, value)`
- All methods are async (return Promises)

## Android Implementations

### Native QuickJS Runtime (Primary Path)

```
NativeSessionStore (TypeScript)
    ↓ (__jstorrent_storage_* bindings)
StorageBindings.kt (Kotlin)
    ↓
SharedPreferences ("jstorrent_session")
```

**Key files:**
- `packages/engine/src/adapters/native/native-session-store.ts` - TypeScript adapter
- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/StorageBindings.kt` - Kotlin native bindings

The engine is started via `EngineService.start()` in `NativeStandaloneActivity.kt`.

### WebView Standalone (Legacy Path)

```
JsBridgeSessionStore → JsBridgeKVStore → KVBridge (@JavascriptInterface) → SharedPreferences ("jstorrent_kv")
```

**Key files:**
- `packages/engine/src/adapters/android/JsBridgeSessionStore.ts`
- `android/app/src/main/java/com/jstorrent/app/bridge/KVBridge.kt`

## Session Storage Keys

From `packages/engine/src/session-persistence.ts`:

| Data | Storage Key Pattern |
|------|---------------------|
| Torrent list | `torrents` (JSON index) |
| Per-torrent state | `session:<infohash>:state` |
| .torrent file bytes | `session:<infohash>:torrentfile` |
| Info dictionary (magnets) | `session:<infohash>:infodict` |

## What Gets Persisted

### Torrent List (TorrentListData)
- Info hashes of all torrents
- Source (file or magnet)
- Magnet URI (for magnet torrents)
- Added timestamp

### Per-Torrent State (TorrentStateData)
- User state (active/paused)
- Progress bitfield (hex-encoded)
- Downloaded/uploaded bytes
- File priorities (0=normal, 1=skip)
- Storage key (which download root)
- Queue position

### Metadata
- .torrent file contents (base64 encoded) - file-source torrents
- Info dictionary (base64 encoded) - magnet torrents

## Session Restore Flow on Android

Startup sequence:

1. `EngineService.start()` - Called in `NativeStandaloneActivity.onCreate()`
2. `EngineController.loadEngine()` - Evaluates bundle and initializes engine
3. Engine created with `startSuspended: true` - No networking yet
4. `engine.restoreSession()` - Loads from SharedPreferences
5. `engine.resume()` - Starts networking
6. State push loop begins - UI updates

See `packages/engine/src/adapters/native/bundle-entry.ts` lines 112-124.

## Continuous Persistence

State is saved on every significant change:
- Metadata reception
- Progress updates
- Pause/resume
- File priority changes

Save points in `packages/engine/src/Torrent.ts` at lines 801, 852, 994, 1435, 1452, 2848, 2895, 2954.

## Comparison: Extension vs Android

| Platform | Storage Backend | API Pattern |
|----------|-----------------|-------------|
| Chrome Extension | `chrome.storage.local` | Async messaging |
| Android Native | SharedPreferences | Sync ops wrapped as async |

Both use the same serialization:
- Base64 for binary data
- `'json:'` prefix for JSON data

## SharedPreferences Files

Located at `/data/data/com.jstorrent.app/shared_prefs/`:

| File | Purpose |
|------|---------|
| `jstorrent_session` | Torrent state, metadata (StorageBindings) |
| `jstorrent_kv` | WebView bridge storage (KVBridge) |
| `jstorrent_config` | Settings (NativeConfigHub) |

## Conclusion

**Torrent state fully survives app restart** because:
- Session restoration is explicitly called on startup
- All torrent metadata, progress, and state is serialized to JSON/binary
- Multiple save points ensure no loss on normal operation
- Both magnet and .torrent file sources are supported with proper metadata caching
