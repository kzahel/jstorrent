# Android IO Core Extraction - Super Task

**Date:** December 22, 2025  
**Status:** Planning  
**Type:** Multi-phase restructure

---

## Background

The JSTorrent Android app currently serves two roles:

1. **ChromeOS Companion** - An I/O daemon that the Chrome extension connects to via HTTP/WebSocket at `100.115.92.2`. The extension runs the BitTorrent engine in browser JS; the Android app just handles sockets, files, and hashing.

2. **Standalone App** - A full torrent client with WebView UI running the same `@jstorrent/engine` TypeScript code. Works well on tablets/ChromeOS but has a critical limitation: **WebView dies when backgrounded**, stopping all downloads.

The current architecture has I/O operations (TCP sockets, UDP sockets, file read/write, hashing) tightly coupled to Ktor HTTP/WebSocket handlers. This makes it impossible to reuse the I/O layer for a non-HTTP context.

---

## Goal

Extract a clean **io-core** module containing pure I/O operations with no HTTP/Ktor dependencies. This enables:

1. **Companion mode**: HTTP server wraps io-core (existing behavior, cleaner code)
2. **Hermes standalone mode**: JSI bindings call io-core directly (future work)

The end state is a single APK that can operate in either mode:
- Companion mode when launched via Chrome extension intent
- Standalone mode when launched directly (with Hermes engine for background execution)

---

## Why Hermes?

For standalone Android, we need the BitTorrent engine to run in the background without a visible Activity. Options considered:

| Approach | Verdict |
|----------|---------|
| **React Native** | Heavy, complex native bridge, overkill for our needs |
| **WebView in Service** | WebView requires Activity context, dies in background |
| **Hermes JS engine** | Lightweight (~3-4MB), runs in Service, JSI for zero-copy data |

Hermes is Facebook's JavaScript engine optimized for React Native. It can run standalone (without React Native's bridge layer) and provides JSI (JavaScript Interface) for efficient native↔JS communication.

### Performance Benefits of JSI

Current data path (ChromeOS companion):
```
Peer → Kotlin socket → serialize to WS frame → HTTP send → 
Chrome receives → deserialize → JS engine → 
serialize to HTTP → Kotlin receives → deserialize → disk write
```

Proposed data path (Hermes + JSI):
```
Peer → Kotlin socket → JSI wrap ArrayBuffer (zero-copy) → 
JS engine processes → JSI pass to write (zero-copy) → disk write
```

Benefits:
- **Zero-copy**: JSI can share memory between Kotlin and JS
- **No serialization overhead**: No WS framing, HTTP headers, JSON encoding
- **Lower latency**: In-process calls vs network round-trips
- **Reduced GC pressure**: Fewer intermediate byte array allocations

This is critical for sustaining 20MB/s+ download speeds on mobile hardware.

---

## Current Code Structure

```
android-io-daemon/
├── app/src/main/java/com/jstorrent/app/
│   ├── server/
│   │   ├── HttpServer.kt       # Ktor server, routing, CORS
│   │   ├── SocketHandler.kt    # TCP/UDP ops intertwined with WS
│   │   ├── FileHandler.kt      # SAF file ops as Ktor routes
│   │   ├── Protocol.kt         # Wire protocol constants
│   │   ├── AuthMiddleware.kt
│   │   └── OriginCheckMiddleware.kt
│   ├── storage/
│   │   ├── RootStore.kt        # SAF root management
│   │   └── DownloadRoot.kt
│   ├── auth/
│   │   └── TokenStore.kt
│   ├── service/
│   │   └── IoDaemonService.kt  # Foreground service
│   ├── bridge/
│   │   ├── KVBridge.kt         # WebView JS bridge
│   │   └── RootsBridge.kt
│   ├── MainActivity.kt         # ChromeOS companion UI
│   ├── StandaloneActivity.kt   # WebView standalone UI
│   ├── AddRootActivity.kt
│   └── PairingApprovalActivity.kt
```

**Key coupling issues:**

1. `SocketHandler.kt` contains `TcpSocketHandler` and `UdpSocketHandler` classes that directly reference `SocketSession` (Ktor type) and call `session.send()` to emit data
2. `FileHandler.kt` defines Ktor routes inline with SAF file operations
3. `Protocol.kt` is pure but lives in `server/` package

---

## Target Structure

```
android-io-daemon/
├── io-core/                        # New: Pure I/O library
│   ├── src/main/java/com/jstorrent/io/
│   │   ├── socket/
│   │   │   ├── TcpSocketManager.kt
│   │   │   ├── TcpSocketCallback.kt
│   │   │   ├── UdpSocketManager.kt
│   │   │   └── UdpSocketCallback.kt
│   │   ├── file/
│   │   │   ├── FileManager.kt
│   │   │   └── FileManagerImpl.kt
│   │   ├── hash/
│   │   │   └── Hasher.kt
│   │   └── protocol/
│   │       └── Protocol.kt
│   └── build.gradle.kts
│
├── companion-server/               # New: HTTP/WS layer
│   ├── src/main/java/com/jstorrent/companion/
│   │   ├── HttpServer.kt
│   │   ├── IoWebSocketHandler.kt   # Adapts io-core ↔ WS
│   │   ├── ControlWebSocketHandler.kt
│   │   ├── FileRoutes.kt           # HTTP adapter for FileManager
│   │   ├── AuthMiddleware.kt
│   │   └── OriginCheckMiddleware.kt
│   └── build.gradle.kts
│
├── app/                            # Slimmed down
│   ├── src/main/java/com/jstorrent/app/
│   │   ├── storage/                # Stays here (Android-specific)
│   │   ├── auth/                   # Stays here
│   │   ├── service/
│   │   │   └── IoDaemonService.kt
│   │   ├── mode/                   # New: mode detection
│   │   │   ├── ModeDetector.kt
│   │   │   ├── CompanionMode.kt
│   │   │   └── StandaloneMode.kt
│   │   ├── bridge/
│   │   ├── MainActivity.kt
│   │   ├── StandaloneActivity.kt
│   │   └── ...
│   └── build.gradle.kts
│
├── hermes-engine/                  # Future: Phase 9+
│   ├── src/main/java/com/jstorrent/hermes/
│   │   ├── HermesRuntime.kt
│   │   ├── JsiBridge.kt            # Native methods → io-core
│   │   └── EngineService.kt
│   ├── src/main/assets/
│   │   └── engine.bundle.js        # Compiled @jstorrent/engine
│   └── build.gradle.kts
│
├── settings.gradle.kts             # include(":io-core", ":companion-server", ":app")
└── build.gradle.kts
```

**Dependency graph:**
```
hermes-engine ──┐
                ├──► io-core
companion-server┘
        │
        ▼
       app ──────────► io-core
        │
        └────────────► companion-server
        │
        └────────────► hermes-engine (future)
```

---

## Phases

### Phase 1: Module Scaffolding
**Risk: Low | Effort: Small**

Create empty `io-core` and `companion-server` Gradle modules. Update `settings.gradle.kts`. Verify clean build with no code changes.

Deliverables:
- `io-core/build.gradle.kts` (Android library, no Ktor)
- `companion-server/build.gradle.kts` (Android library, depends on io-core + Ktor)
- Updated `settings.gradle.kts`
- Updated `app/build.gradle.kts` dependencies
- Placeholder source files so modules compile

### Phase 2: Move Protocol.kt
**Risk: Low | Effort: Small**

Move `Protocol.kt` from `app/server/` to `io-core/protocol/`. It has no dependencies beyond stdlib. Update imports in app module.

Deliverables:
- `io-core/src/main/java/com/jstorrent/io/protocol/Protocol.kt`
- All `app` imports updated
- Tests pass

### Phase 3: Extract Hasher
**Risk: Low | Effort: Small**

Create `Hasher` class in io-core. Currently hashing is inline in `FileHandler.kt`:
```kotlin
val digest = MessageDigest.getInstance("SHA-1")
val actualHash = digest.digest(body).joinToString("") { "%02x".format(it) }
```

Deliverables:
- `io-core/src/main/java/com/jstorrent/io/hash/Hasher.kt`
- `FileHandler` uses new `Hasher` class
- Unit tests for Hasher

### Phase 4: Extract FileManager
**Risk: Medium | Effort: Medium**

Create `FileManager` interface and implementation in io-core. Moves:
- SAF resolution logic (`resolveFile`, `getOrCreateFile`)
- DocumentFile caching
- Read/write operations via ParcelFileDescriptor

`FileHandler.kt` becomes a thin HTTP adapter that calls `FileManager`.

**Challenge:** FileManager needs `Context` and `ContentResolver` for SAF. Pass these at construction time.

Deliverables:
- `io-core/src/main/java/com/jstorrent/io/file/FileManager.kt` (interface)
- `io-core/src/main/java/com/jstorrent/io/file/FileManagerImpl.kt`
- Updated `FileHandler.kt` in companion-server (thin adapter)
- Tests pass

### Phase 5: Define Socket Callback Interfaces
**Risk: Low | Effort: Small**

Define callback interfaces in io-core that consumers implement:

```kotlin
interface TcpSocketCallback {
    fun onConnected(socketId: Int, success: Boolean, errorCode: Int)
    fun onData(socketId: Int, data: ByteArray)
    fun onClose(socketId: Int, hadError: Boolean, errorCode: Int)
}

interface UdpSocketCallback {
    fun onBound(socketId: Int, success: Boolean, boundPort: Int, errorCode: Int)
    fun onMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray)
    fun onClose(socketId: Int, hadError: Boolean, errorCode: Int)
}
```

And manager interfaces:
```kotlin
interface TcpSocketManager {
    fun connect(socketId: Int, host: String, port: Int)
    fun send(socketId: Int, data: ByteArray)
    fun close(socketId: Int)
    fun setCallback(callback: TcpSocketCallback)
}
```

Deliverables:
- Interface files in `io-core/src/main/java/com/jstorrent/io/socket/`
- No implementations yet

### Phase 6: Implement Socket Managers
**Risk: High | Effort: Large**

This is the trickiest phase. Move socket logic from `SocketHandler.kt`:

Current: `TcpSocketHandler` takes `SocketSession`, reads from socket, calls `session.send(Protocol.createMessage(...))`

Target: `TcpSocketManagerImpl` takes `TcpSocketCallback`, reads from socket, calls `callback.onData(socketId, data)`

Key changes:
- Remove all Ktor imports
- Replace `session.send()` calls with callback invocations
- Maintain connection semaphore, pending connects map, etc.
- Handle TLS upgrade flow

**This phase should probably be broken into sub-phases:**
- 6a: TCP connect/send/close (basic flow)
- 6b: TCP server (listen/accept)
- 6c: TLS upgrade
- 6d: UDP bind/send/recv/multicast

Deliverables:
- `TcpSocketManagerImpl.kt` in io-core
- `UdpSocketManagerImpl.kt` in io-core
- Comprehensive unit tests
- `SocketHandler.kt` gutted (logic moved)

### Phase 7: Create Companion Server Module
**Risk: Medium | Effort: Medium**

Move HTTP/Ktor code to companion-server module:
- `HttpServer.kt` (mostly unchanged)
- `IoWebSocketHandler.kt` - implements socket callbacks, emits WS frames
- `ControlWebSocketHandler.kt` - roots/events broadcast
- `FileRoutes.kt` - HTTP adapter for FileManager
- Middleware classes

The WebSocket handler implements `TcpSocketCallback`/`UdpSocketCallback` and translates:
- `onData(socketId, data)` → send WS frame `OP_TCP_RECV`
- `onConnected(...)` → send WS frame `OP_TCP_CONNECTED`

Deliverables:
- All companion-server source files
- Updated app module to use companion-server
- Integration tests pass
- ChromeOS functionality verified

### Phase 8: Clean Up App Module
**Risk: Low | Effort: Small**

Final cleanup:
- Remove dead code from app module
- Add `ModeDetector` to route between companion/standalone
- Update `IoDaemonService` to instantiate io-core managers
- Document the new architecture

Deliverables:
- Clean app module with clear responsibilities
- Architecture documentation updated
- All tests pass

### Phase 9+: Hermes Integration (Future)
**Risk: High | Effort: Large**

Not part of this task, but this restructure enables:
- Add `hermes-engine` module
- Depend on `com.facebook.react:hermes-android` AAR
- Create JSI bindings that call io-core directly
- Build pipeline to compile `@jstorrent/engine` to `engine.bundle.js`
- `StandaloneMode` starts Hermes in a Service

---

## Verification Strategy

After each phase:
1. `./gradlew assembleDebug` succeeds
2. `./gradlew test` passes
3. For phases touching socket/file code:
   - Install APK on ChromeOS device
   - Verify extension connects and downloads work
   - Check throughput hasn't regressed (target: 20MB/s)

---

## Risk Mitigation

**Biggest risk:** Phase 6 (socket manager extraction) is complex and could introduce subtle bugs in connection handling, especially around:
- Connection semaphore for limiting concurrent connects
- Pending connect job cancellation on TCP_CLOSE
- TLS upgrade flow
- Error propagation

**Mitigation:**
- Break Phase 6 into sub-phases
- Write comprehensive unit tests before moving code
- Test each sub-phase on real ChromeOS hardware
- Keep a working branch we can revert to

---

## Dependencies

- Kotlin coroutines (already used)
- Ktor (stays in companion-server only)
- AndroidX DocumentFile (for SAF)
- No new dependencies until Hermes phase

---

## Success Criteria

1. Clean module separation with clear dependency graph
2. io-core has zero Ktor imports
3. Existing ChromeOS companion functionality unchanged
4. Throughput maintained at 20MB/s+
5. Foundation ready for Hermes integration
