# JSTorrent Package Structure

## Monorepo Layout

```
jstorrent-monorepo/
├── packages/
│   ├── engine/                 ← Core BitTorrent engine (platform-agnostic)
│   ├── client/                 ← App shell, chrome integration, IO Bridge UI
│   ├── ui/                     ← Virtualized tables, presentational components
│   ├── shared-ts/              ← Shared TypeScript utilities (placeholder)
│   ├── proto/                  ← Protocol buffer definitions (placeholder)
│   ├── docs/                   ← Package-level design documents
│   └── legacy-jstorrent-engine/ ← Migration docs from original engine
│
├── extension/         ← Chrome extension entry points, manifest, daemon bridge
├── system-bridge/     ← Rust binaries (jstorrent-host, io-daemon, link-handler)
├── android-io-daemon/ ← Kotlin Android app for ChromeOS
├── website/           ← jstorrent.com landing/launch page
│
├── chromeos-testbed/  ← ChromeOS testing infrastructure
├── legacy-app/        ← Original Chrome App (deprecated, still published)
├── legacy-extension/  ← Helper extension for Chrome App
├── test_torrents/     ← Test torrent files for development
│
├── docs/
│   ├── tasks/         ← Agent execution plans (current work)
│   ├── tasks/archive/ ← Completed task plans
│   ├── project/       ← Strategic context (this folder)
│   ├── design/        ← Design documents
│   └── decisions/     ← Architecture decision records
│
├── design_docs/       ← Historical design documents
├── infra/             ← Infrastructure (API definitions)
├── scripts/           ← Build/release scripts
└── apps/              ← Future mobile app stubs
```

## Package Details

### packages/engine

Platform-agnostic BitTorrent engine. No browser or Node.js APIs directly - everything through interfaces.

```
src/
  core/              ← BtEngine, Torrent, PeerConnection, Swarm, ConnectionManager
  interfaces/        ← IFileSystem, ISocketFactory, ISessionStore, IHasher
  adapters/
    daemon/          ← DaemonConnection, DaemonFileSystem, DaemonSocketFactory
    node/            ← NodeFileSystem, NodeSocketFactory
    memory/          ← InMemoryFileSystem, MemorySocketFactory
    browser/         ← OPFSFileSystem, ChromeStorageSessionStore
  protocol/          ← Wire protocol, bencode
  tracker/           ← TrackerManager, HttpTracker, UdpTracker
  storage/           ← StorageRootManager
  logging/           ← RingBufferLogger, scoped logging
  utils/             ← BitField, buffer helpers, magnet parsing
  presets/           ← Pre-configured engine setups (daemon, memory, node)
  cmd/               ← Command-line utilities
  extensions/        ← Engine extensions
  io/                ← I/O utilities
  node-rpc/          ← Node.js RPC layer

integration/python/  ← Python tests against libtorrent
```

**Key exports:** `BtEngine`, `Torrent`, `PeerConnection`, `DaemonConnection`, adapters, interfaces

### packages/client

Chrome-specific app shell. Connects engine to chrome APIs, provides IO Bridge UI components.

```
src/
  App.tsx            ← Main application shell (toolbar, layout, state)
  chrome/
    engine-manager.ts      ← Engine lifecycle, daemon connection
    extension-bridge.ts    ← Service worker communication
    notification-bridge.ts ← Native notification forwarding
  components/
    SystemBridgePanel.tsx  ← IO Bridge status dropdown panel
    SystemIndicator.tsx    ← Toolbar connection status indicator
    DownloadRootsManager.tsx ← Download folder picker
  context/
    EngineContext.tsx      ← React context for engine access
  hooks/
    useEngineState.ts      ← Engine state subscription
    useIOBridgeState.ts    ← IO Bridge state subscription
    useSystemBridge.ts     ← Combined system bridge logic
  adapters/
    types.ts               ← Adapter type definitions
  utils/
    clipboard.ts           ← Clipboard utilities
```

**Key exports:** `App`, `EngineManager`, `SystemBridgePanel`, `SystemIndicator`

### packages/ui

Presentational components. High-performance virtualized tables using Solid.js.

```
src/
  tables/
    VirtualTable.solid.tsx  ← Core virtualized table (Solid.js)
    TorrentTable.tsx        ← Torrent list columns
    PeerTable.tsx           ← Peer list columns  
    PieceTable.tsx          ← Piece visualization
    FileTable.tsx           ← File list with progress
    LogTable.solid.tsx      ← Log viewer (Solid.js)
    LogTableWrapper.tsx     ← React wrapper for log table
    mount.tsx               ← TableMount (React → Solid bridge)
    types.ts                ← ColumnDef, ColumnConfig
    column-config.ts        ← Column persistence
  components/
    DetailPane.tsx          ← Tabbed detail view (Peers, Pieces, Files, General, Logs)
    GeneralPane.tsx         ← Torrent info display
    ContextMenu.tsx         ← Right-click menu
    DropdownMenu.tsx        ← Generic dropdown
    ResizeHandle.tsx        ← Draggable divider
    TorrentItem.tsx         ← Single torrent row
  hooks/
    usePersistedHeight.ts   ← Height persistence for resize
  utils/
    format.ts               ← formatBytes, formatSpeed, formatPercent
```

**Key exports:** `TorrentTable`, `DetailPane`, `TableMount`, `ContextMenu`, formatters

### extension/

Chrome extension entry points. Service worker manages daemon bridge lifecycle.

```
src/
  sw.ts                     ← Service worker (daemon bridge, UI port management)
  lib/
    daemon-bridge.ts        ← Daemon connection management
    install-id.ts           ← Extension install ID utilities
    io-bridge/              ← IO Bridge utilities
      readiness.ts          ← Readiness state tracking
      version-status.ts     ← Version compatibility checking
    native-connection.ts    ← Native host connection types
    notifications.ts        ← Notification handling
    platform.ts             ← Platform detection
    sockets.ts              ← Socket utilities
    kv-handlers.ts          ← Key-value storage handlers
  ui/
    app.html / app.tsx      ← Thin wrapper, imports from @jstorrent/client
    share.html / share.tsx  ← Share target handler
  magnet/
    magnet-handler.html/ts  ← Magnet link handler page

public/
  manifest.json             ← MV3 manifest
  icons/

test/                       ← Unit tests
e2e/                        ← Playwright E2E tests
```

### system-bridge/

Rust workspace with four packages.

```
Cargo.toml                  ← Workspace root (no [package])
common/
  Cargo.toml
  src/lib.rs                ← Shared library (jstorrent_common)
host/
  Cargo.toml
  build.rs
  Info.plist                ← macOS app bundle metadata
  src/
    main.rs                 ← jstorrent-host binary (coordination)
    daemon_manager.rs       ← io-daemon process management
    folder_picker.rs        ← Native folder picker dialog
    rpc.rs                  ← RPC protocol handling
    ipc.rs                  ← Inter-process communication
    path_safety.rs          ← Path validation and sanitization
    protocol.rs             ← Native messaging protocol
    logging.rs              ← Logging setup
    state.rs                ← Shared state
io-daemon/
  Cargo.toml
  build.rs
  Info.plist                ← macOS app bundle metadata
  src/
    main.rs
    ws.rs                   ← WebSocket server, TCP/UDP multiplexing
    files.rs                ← File read/write endpoints
    hashing.rs              ← SHA1/SHA256 endpoints
    auth.rs                 ← Token validation middleware
link-handler/
  Cargo.toml
  build.rs
  Info.plist                ← macOS app bundle metadata
  src/main.rs               ← jstorrent-link-handler binary (protocol handler)
installers/                 ← Platform installers (NSIS, pkgbuild, deb)
manifests/                  ← Chrome native messaging manifests
scripts/                    ← Build and install scripts
verify_*.py                 ← Python integration tests
```

### android-io-daemon/

Kotlin Android app providing I/O daemon for ChromeOS.

```
app/src/main/java/com/jstorrent/app/
  MainActivity.kt              ← Main activity, pairing UI
  AddRootActivity.kt           ← Activity for adding download roots
  PairingApprovalActivity.kt   ← Pairing approval UI
  service/
    IoDaemonService.kt         ← Foreground service for daemon
  server/
    HttpServer.kt              ← Ktor HTTP/WebSocket server
    SocketHandler.kt           ← TCP/UDP multiplexing
    FileHandler.kt             ← File read/write endpoints
    AuthMiddleware.kt          ← Token validation
    OriginCheckMiddleware.kt   ← Origin validation for requests
    Protocol.kt                ← Binary protocol definitions
  auth/
    TokenStore.kt              ← Secure token storage
  storage/
    DownloadRoot.kt            ← Download root data model
    RootStore.kt               ← Multiple download root management
  ui/theme/                    ← Compose theme

scripts/                       ← Build and test scripts
```

**Key differences from Rust daemon:**
- HTTP at `100.115.92.2:7800` (ARC bridge IP)
- Auth token passed via intent URL during pairing
- Multiple download roots supported via Storage Access Framework

### website/

Landing page and launch handler for jstorrent.com.

```
src/                        ← Source files
public/                     ← Static assets
launch/                     ← Launch page for magnet/torrent handling
```

## Dependencies Between Packages

```
extension/
    └── @jstorrent/client
            ├── @jstorrent/engine
            └── @jstorrent/ui
                    └── @jstorrent/engine (types only)
```

- `engine` has zero internal dependencies (platform-agnostic)
- `ui` depends on engine for types only
- `client` depends on both engine and ui
- `extension` depends on client

## Build & Test Commands

### From Monorepo Root (Preferred)

```bash
pnpm install          # Install all deps
pnpm build            # Build all packages
pnpm test             # Run ALL tests across all packages
pnpm dev              # Dev mode: extension watch + local website server
pnpm typecheck        # Type check all packages
pnpm lint             # Lint all packages
pnpm format:fix       # Format all files (run last, after tests pass)
```

### Package-Specific Testing

```bash
# Engine tests
cd packages/engine
pnpm test

# UI tests
cd packages/ui
pnpm test

# Extension unit tests
cd extension
pnpm test

# Extension E2E
cd extension
pnpm test:e2e
```

### Python Integration Tests

```bash
cd packages/engine/integration/python
python run_tests.py           # All tests
python test_download.py       # Single test
```

### System Bridge (Rust)

```bash
cd system-bridge
cargo build --workspace --release    # Build all binaries
cargo test --workspace               # Run Rust tests

# Python verification tests
python verify_host.py
python verify_torrent.py
```

### Android IO Daemon (Kotlin)

```bash
cd android-io-daemon
./gradlew build                      # Build APK
./gradlew assembleDebug              # Debug APK only
./gradlew test                       # Run unit tests
```

### TypeScript Editing Workflow

See `CLAUDE.md` for the required sequence after editing TypeScript:
1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`
4. `pnpm format:fix` (last, after all tests pass)
