# JSTorrent Everywhere: Architecture Vision

**Date:** December 2025  
**Status:** Planning  
**Author:** Kyle / Claude

---

## Vision

JSTorrent is the torrent client that truly runs everywhere, powered by a single TypeScript engine with platform-native I/O bindings.

```
┌────────────────────────────────────────────────────────────────────┐
│                    @jstorrent/engine (TypeScript)                  │
│                                                                     │
│    The same BitTorrent protocol code runs on every platform.       │
│    Only the I/O layer differs.                                     │
└────────────────────────────────────────────────────────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    Browser V8   │    │     QuickJS     │    │ JavaScriptCore  │
│                 │    │                 │    │                 │
│  Chrome ext +   │    │ Android native  │    │   iOS native    │
│  Rust/Kotlin IO │    │   standalone    │    │   standalone    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**Why this matters:**

- **One codebase** for BitTorrent protocol, piece management, peer connections, DHT, trackers
- **Native performance** where it counts: socket I/O, file operations, hashing
- **Platform-native UI** for each target (Compose on Android, SwiftUI on iOS, web on desktop)
- **Background execution** on mobile via native services

---

## Platform Configurations

| Platform | JS Runtime | I/O Layer | UI | Distribution |
|----------|------------|-----------|-----|--------------|
| Desktop (Linux/Win/Mac) | Chrome V8 (extension) | Rust native host | Web (React/Solid) | Chrome Web Store + installers |
| ChromeOS | Chrome V8 (extension) | Kotlin companion | Web (React/Solid) | Chrome Web Store + Play Store |
| Android Standalone | QuickJS | Kotlin io-core | Jetpack Compose | Play Store |
| iOS | JavaScriptCore | Swift io-core | SwiftUI | App Store / AltStore / Sideload |

---

## The Engine: Platform-Agnostic Core

The `@jstorrent/engine` package contains all BitTorrent logic with zero platform dependencies:

```
packages/engine/
├── src/
│   ├── core/           # BtEngine, Torrent, PeerConnection, Swarm
│   ├── protocol/       # Wire protocol, bencode, handshakes
│   ├── tracker/        # HTTP/UDP tracker clients
│   ├── dht/            # Distributed hash table
│   ├── storage/        # Piece management, file allocation
│   ├── interfaces/     # ISocketFactory, IFileSystem, ISessionStore, IHasher
│   └── adapters/       # Platform-specific implementations
│       ├── daemon/     # WebSocket to Rust/Kotlin daemon (extension mode)
│       ├── native/     # Direct native bindings (QuickJS/JSC mode) ← NEW
│       ├── android/    # WebView bridges (legacy standalone)
│       ├── node/       # Node.js (testing)
│       └── memory/     # In-memory (unit tests)
```

### Interface Surface

The engine depends on four core interfaces:

```typescript
// packages/engine/src/interfaces/

interface ISocketFactory {
  createTcpSocket(host?: string, port?: number): Promise<ITcpSocket>
  createUdpSocket(bindAddr?: string, bindPort?: number): Promise<IUdpSocket>
  createTcpServer(): ITcpServer
}

interface IFileSystem {
  open(rootKey: string, path: string): Promise<IFileHandle>
}

interface IFileHandle {
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{bytesRead: number}>
  write(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{bytesWritten: number}>
  close(): Promise<void>
}

interface ISessionStore {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  getJson<T>(key: string): Promise<T | null>
  setJson<T>(key: string, value: T): Promise<void>
}

interface IHasher {
  sha1(data: Uint8Array): Promise<Uint8Array>
}
```

Every platform implements these four interfaces. The engine doesn't care how.

---

## Native Adapter: Unified Binding Interface

For QuickJS (Android) and JavaScriptCore (iOS), we define a unified native binding contract:

```typescript
// packages/engine/src/adapters/native/bindings.d.ts

declare global {
  // TCP
  function __jstorrent_tcp_connect(socketId: number, host: string, port: number): void
  function __jstorrent_tcp_send(socketId: number, data: ArrayBuffer): void
  function __jstorrent_tcp_close(socketId: number): void
  function __jstorrent_tcp_on_data(callback: (socketId: number, data: ArrayBuffer) => void): void
  function __jstorrent_tcp_on_close(callback: (socketId: number, hadError: boolean) => void): void
  function __jstorrent_tcp_on_error(callback: (socketId: number, message: string) => void): void
  function __jstorrent_tcp_on_connected(callback: (socketId: number, success: boolean) => void): void

  // UDP
  function __jstorrent_udp_bind(socketId: number, addr: string, port: number): void
  function __jstorrent_udp_send(socketId: number, addr: string, port: number, data: ArrayBuffer): void
  function __jstorrent_udp_close(socketId: number): void
  function __jstorrent_udp_on_message(callback: (socketId: number, addr: string, port: number, data: ArrayBuffer) => void): void
  function __jstorrent_udp_on_bound(callback: (socketId: number, success: boolean, port: number) => void): void

  // Files
  function __jstorrent_file_open(handleId: number, rootKey: string, path: string): void
  function __jstorrent_file_read(handleId: number, offset: number, length: number): ArrayBuffer
  function __jstorrent_file_write(handleId: number, offset: number, data: ArrayBuffer): number
  function __jstorrent_file_close(handleId: number): void

  // Hashing
  function __jstorrent_sha1(data: ArrayBuffer): ArrayBuffer

  // Storage (SharedPreferences / UserDefaults)
  function __jstorrent_storage_get(key: string): string | null
  function __jstorrent_storage_set(key: string, value: string): void
  function __jstorrent_storage_delete(key: string): void
  function __jstorrent_storage_keys(prefix: string): string  // JSON array

  // Text encoding (QuickJS lacks TextEncoder/TextDecoder)
  function __jstorrent_text_encode(str: string): ArrayBuffer
  function __jstorrent_text_decode(data: ArrayBuffer): string

  // Timers (QuickJS has setTimeout but not setInterval)
  function __jstorrent_set_timeout(callback: () => void, ms: number): number
  function __jstorrent_clear_timeout(id: number): void

  // Crypto
  function __jstorrent_random_bytes(length: number): ArrayBuffer
}
```

Both Kotlin (for Android) and Swift (for iOS) implement these identical function signatures. The TypeScript adapter doesn't know or care which platform it's running on.

---

## Android Architecture

### Current State (After Phase 1-8)

```
android/                          # Renamed from android-io-daemon
├── io-core/                      # Pure I/O primitives
│   └── com/jstorrent/io/
│       ├── socket/
│       │   ├── TcpSocketManager.kt
│       │   ├── UdpSocketManager.kt
│       │   └── TcpServerManager.kt
│       ├── file/
│       │   └── FileManager.kt
│       └── hash/
│           └── Hasher.kt
│
├── companion-server/             # HTTP/WS server for extension mode
│   └── com/jstorrent/companion/
│       ├── CompanionServer.kt
│       ├── SocketHandler.kt      # WebSocket /io endpoint
│       └── FileHandler.kt        # HTTP /read, /write endpoints
│
└── app/                          # Main application
    └── com/jstorrent/app/
        ├── MainActivity.kt
        ├── StandaloneActivity.kt     # WebView standalone (debug)
        └── mode/
            └── ModeManager.kt
```

### Future State (With QuickJS)

```
android/
├── io-core/                      # (unchanged)
│
├── companion-server/             # (unchanged)
│
├── quickjs-engine/               # NEW: QuickJS runtime module
│   ├── build.gradle.kts
│   ├── src/main/
│   │   ├── kotlin/com/jstorrent/quickjs/
│   │   │   ├── QuickJSRuntime.kt       # Lifecycle, script loading
│   │   │   ├── NativeBindings.kt       # Registers __jstorrent_* functions
│   │   │   ├── EngineService.kt        # Foreground service
│   │   │   └── EngineController.kt     # Start/stop/status API
│   │   ├── jniLibs/                    # Pre-built QuickJS .so files
│   │   │   ├── arm64-v8a/libquickjs.so
│   │   │   ├── armeabi-v7a/libquickjs.so
│   │   │   └── x86_64/libquickjs.so
│   │   └── assets/
│   │       └── engine.bundle.js        # Bundled engine code
│   └── src/test/                       # Unit tests
│
└── app/
    └── com/jstorrent/app/
        ├── MainActivity.kt
        ├── mode/
        │   └── ModeManager.kt          # Companion | WebView | Native
        ├── standalone/
        │   ├── StandaloneActivity.kt       # WebView (debug mode)
        │   └── NativeStandaloneActivity.kt # Compose UI ← NEW
        └── ui/
            ├── TorrentListScreen.kt    # Compose UI ← NEW
            ├── FileListScreen.kt       # Compose UI ← NEW
            └── SettingsScreen.kt       # Compose UI ← NEW
```

### Android App Modes

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Android App Modes                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │   Companion     │  │    WebView      │  │     Native      │     │
│  │     Mode        │  │   Standalone    │  │   Standalone    │     │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤     │
│  │ companion-server│  │ companion-server│  │ quickjs-engine  │     │
│  │ (HTTP/WS)       │  │ + WebView UI    │  │ + Compose UI    │     │
│  │                 │  │ + injected auth │  │                 │     │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤     │
│  │    io-core      │  │    io-core      │  │    io-core      │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                                     │
│  Engine location:     Engine location:     Engine location:        │
│  Chrome extension     WebView (V8)         QuickJS                 │
│                                                                     │
│  Use case:            Use case:            Use case:               │
│  ChromeOS pairing     Debug/test           Production standalone   │
└─────────────────────────────────────────────────────────────────────┘
```

### Thread Model (Android Native Standalone)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  QuickJS Thread │     │  IO Thread Pool │     │  Main Thread    │
│                 │     │  (Coroutines)   │     │  (Android UI)   │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ Engine logic    │◄───►│ Socket I/O      │     │ Compose UI      │
│ Piece mgmt      │     │ File I/O        │     │ Notifications   │
│ Peer protocol   │     │ DNS resolution  │     │ Service binding │
│ DHT             │     │ Hashing         │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        └───────────────────────┴───────────────────────┘
                    JNI calls (thread-safe)
```

**Critical:** QuickJS is single-threaded. All JS execution happens on one dedicated thread. Native callbacks must post results back to the JS thread, never call directly from I/O threads.

---

## iOS Architecture (Future)

```
ios/
├── io-core/                      # Swift I/O primitives
│   ├── Sources/IOCore/
│   │   ├── TcpSocketManager.swift
│   │   ├── UdpSocketManager.swift
│   │   ├── FileManager.swift
│   │   └── Hasher.swift
│   └── Package.swift
│
├── jsc-bridge/                   # JavaScriptCore bindings
│   ├── Sources/JSCBridge/
│   │   ├── JSCRuntime.swift          # Lifecycle, script loading
│   │   ├── NativeBindings.swift      # Registers __jstorrent_* functions
│   │   └── EngineController.swift    # Start/stop/status API
│   └── Package.swift
│
└── app/                          # Main iOS app
    ├── JSTorrent.xcodeproj
    └── Sources/
        ├── JSTorrentApp.swift
        ├── ContentView.swift
        ├── TorrentListView.swift     # SwiftUI
        ├── FileListView.swift        # SwiftUI
        └── SettingsView.swift        # SwiftUI
```

### iOS vs Android Differences

| Aspect | Android (QuickJS) | iOS (JavaScriptCore) |
|--------|-------------------|----------------------|
| JS Runtime | QuickJS (external lib) | JavaScriptCore (built into iOS) |
| Native bindings | JNI + Kotlin | Swift JSExport protocol |
| Background execution | Foreground Service | Background App Refresh (limited) |
| File storage | SAF / app private | App container |
| Distribution | Play Store | App Store / AltStore / Sideload |

**Note:** iOS background execution is more restricted. Downloads may pause when app is backgrounded unless using specific entitlements (background audio, VoIP, etc.). This is a known limitation.

---

## Desktop Architecture (Current)

```
desktop/                          # Renamed from system-bridge
├── common/                       # Shared Rust code
├── host/                         # jstorrent-host (native messaging coordinator)
├── io-daemon/                    # I/O operations (sockets, files, hashing)
├── link-handler/                 # OS protocol handler (magnet:, .torrent)
├── installers/                   # Platform-specific installers
│   ├── windows/                  # NSIS/Inno Setup
│   ├── macos/                    # pkgbuild
│   └── linux/                    # deb/AppImage
└── manifests/                    # Chrome native messaging manifests
```

Desktop remains extension-based. The engine runs in Chrome's V8, I/O happens via native messaging to Rust binaries.

---

## Bundle Compilation Pipeline

The engine TypeScript must be bundled into a single JS file for QuickJS/JSC:

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ TypeScript   │───►│ JavaScript   │───►│ .js file     │
│ source       │    │ bundle       │    │ (ES2020)     │
└──────────────┘    └──────────────┘    └──────────────┘
     esbuild            (single file,      assets/
                         no browser APIs)
```

### Build Configuration

```
packages/engine/
├── bundle/
│   ├── esbuild.native.config.js  # Bundle config for native adapters
│   └── build-native.js           # Entry point
├── src/adapters/native/
│   ├── bindings.d.ts             # Type declarations for __jstorrent_*
│   ├── socket-factory.ts
│   ├── filesystem.ts
│   ├── session-store.ts
│   ├── hasher.ts
│   └── index.ts                  # Entry point that wires everything
```

### Bundle Entry Point

```typescript
// packages/engine/src/adapters/native/index.ts

import { BtEngine } from '../../core/bt-engine'
import { NativeSocketFactory } from './socket-factory'
import { NativeFileSystem } from './filesystem'
import { NativeSessionStore } from './session-store'
import { NativeHasher } from './hasher'

// Create engine with native adapters
const engine = new BtEngine({
  socketFactory: new NativeSocketFactory(),
  fileSystem: new NativeFileSystem(),
  sessionStore: new NativeSessionStore(),
  hasher: new NativeHasher(),
})

// Expose to native layer
;(globalThis as any).jstorrentEngine = engine

// Native layer can now call:
// jstorrentEngine.addTorrent(magnetLink)
// jstorrentEngine.torrents
// etc.
```

### npm Script

```json
// packages/engine/package.json
{
  "scripts": {
    "bundle:native": "node bundle/build-native.js"
  }
}
```

### Gradle Integration (Android)

```kotlin
// android/quickjs-engine/build.gradle.kts

tasks.register("buildEngineBundle") {
    doLast {
        exec {
            workingDir = rootProject.file("../../packages/engine")
            commandLine("pnpm", "bundle:native")
        }
        copy {
            from(rootProject.file("../../packages/engine/dist/engine.native.js"))
            into("src/main/assets")
            rename { "engine.bundle.js" }
        }
    }
}

tasks.named("preBuild") {
    dependsOn("buildEngineBundle")
}
```

---

## Folder Renames

Before QuickJS work begins, rename folders for clarity:

| Current | New | Reason |
|---------|-----|--------|
| `android-io-daemon/` | `android/` | It's the entire Android project, not just a daemon |
| `system-bridge/` | `desktop/` | Clearer, matches other platform folders |

---

## Initial Phases (High-Level)

### Phase 0: Renames
- Rename `android-io-daemon/` → `android/`
- Rename `system-bridge/` → `desktop/`
- Update all scripts, CI, docs that reference old paths

### Phase 1: Native Adapter Interface
- Create `packages/engine/src/adapters/native/`
- Define `bindings.d.ts` with all `__jstorrent_*` declarations
- Implement adapter classes (NativeSocketFactory, NativeFileSystem, etc.)
- Create bundle config in `packages/engine/bundle/`
- Test bundle builds (output should be valid ES2020 JS)

### Phase 2: QuickJS Module Scaffolding
- Create `android/quickjs-engine/` module
- Integrate QuickJS library (find pre-built AAR or build from source)
- Implement `QuickJSRuntime.kt` for lifecycle management
- Test: Load and execute simple JS code

### Phase 3: JNI Bindings
- Implement `NativeBindings.kt` - register all `__jstorrent_*` functions
- Wire bindings to io-core (TcpSocketManager, UdpSocketManager, FileManager, Hasher)
- Handle threading: callbacks from io-core → QuickJS thread
- Test: Simple socket connection from JS

### Phase 4: Engine Integration
- Create `EngineService.kt` (foreground service)
- Load `engine.bundle.js` in QuickJS runtime
- Expose engine control API (addTorrent, removeTorrent, getStatus)
- Test: Add a magnet link, verify engine starts downloading

### Phase 5: Native UI
- Create basic Compose UI screens
  - TorrentListScreen (name, progress, speed)
  - FileListScreen (tap a torrent to see files)
  - SettingsScreen (download folder, mode switch)
- Wire UI to EngineService via Binder
- Test: Full flow from add → download → view files

### Phase 6: Mode Integration
- Update `ModeManager.kt` to support three modes
- Settings UI for switching modes
- Handle transitions cleanly (stop old mode, start new mode)
- Test: Switch between all three modes

### Phase 7: Polish & Testing
- Error handling and crash recovery
- Session persistence across app restarts
- Background execution testing (download continues when backgrounded)
- Performance benchmarks (compare to WebView standalone)

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Download throughput | ≥20 MB/s (matching companion mode) |
| Memory usage | <100 MB for engine |
| Cold start time | <2 seconds to first peer connection |
| Background stability | 24-hour soak test without crashes |
| UI responsiveness | 60 FPS during active downloads |

---

## Open Questions

1. **QuickJS library choice:** Use an existing Android wrapper (like quickjs-ng) or build from source?

2. **Bytecode compilation:** QuickJS supports bytecode (`.qbc`), which speeds up parsing. Worth adding later as optimization?

3. **iOS background execution:** What strategies exist for keeping downloads alive? Background audio trick? App Refresh?

4. **Shared engine state:** If user has both Companion and Native modes configured, should they share torrent state? Current answer: No, keep them isolated.

---

## References

- [QuickJS](https://bellard.org/quickjs/) - Fabrice Bellard's lightweight JS engine
- [quickjs-ng](https://github.com/quickjs-ng/quickjs) - Actively maintained QuickJS fork
- [JavaScriptCore](https://developer.apple.com/documentation/javascriptcore) - Apple's JS engine
