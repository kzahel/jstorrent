# JSTorrent Package Structure

## Monorepo Layout

```
jstorrent-monorepo/
├── packages/
│   ├── engine/        ← Core BitTorrent engine (platform-agnostic)
│   ├── client/        ← App shell, chrome integration, adapters
│   ├── ui/            ← Virtualized tables, presentational components
│   ├── shared-ts/     ← Shared TypeScript utilities
│   └── proto/         ← Protocol buffer definitions (future)
│
├── extension/         ← Chrome extension entry points, manifest
├── native-host/       ← Rust binaries (native-host, io-daemon, link-handler)
├── website/           ← jstorrent.com landing/launch page
│
├── docs/
│   ├── tasks/         ← Agent execution plans (current work)
│   ├── tasks/archive/ ← Completed task plans
│   └── project/       ← Strategic context (this folder)
│
└── scripts/           ← Build/release scripts
```

## Package Details

### packages/engine

Platform-agnostic BitTorrent engine. No browser or Node.js APIs directly - everything through interfaces.

```
src/
  core/              ← BtEngine, Torrent, PeerConnection, PieceManager
  interfaces/        ← IFileSystem, ISocketFactory, ISessionStore, IHasher
  adapters/
    daemon/          ← DaemonFileSystem, DaemonSocketFactory, DaemonHasher
    node/            ← NodeFileSystem, NodeSocketFactory
    memory/          ← InMemoryFileSystem, MemorySocketFactory
    browser/         ← OPFSFileSystem, ChromeStorageSessionStore
  protocol/          ← Wire protocol, bencode, metadata exchange
  tracker/           ← TrackerManager, HttpTracker, UdpTracker
  storage/           ← StorageRootManager
  logging/           ← RingBufferLogger, scoped logging
  utils/             ← BitField, buffer helpers, magnet parsing

integration/python/  ← Python tests against libtorrent
```

**Key exports:** `BtEngine`, `Torrent`, `PeerConnection`, adapters, interfaces

### packages/client

Chrome-specific app shell. Connects engine to chrome APIs and daemon.

```
src/
  App.tsx            ← Main application shell (toolbar, layout, state)
  adapters/          ← EngineAdapter (wraps BtEngine for UI)
  chrome/            ← Chrome-specific: DaemonManager, messaging
  components/        ← Settings dialogs, download root picker
  context/           ← React contexts (EngineContext)
  hooks/             ← useEngine, useEngineState
```

**Key exports:** `App`, `EngineAdapter`, `DaemonManager`

### packages/ui

Presentational components. High-performance virtualized tables using Solid.js.

```
src/
  tables/
    VirtualTable.solid.tsx  ← Core virtualized table (Solid.js)
    TorrentTable.tsx        ← Torrent list columns
    PeerTable.tsx           ← Peer list columns  
    PieceTable.tsx          ← Piece visualization
    mount.tsx               ← TableMount (React → Solid bridge)
    types.ts                ← ColumnDef, ColumnConfig
  components/
    DetailPane.tsx          ← Tabbed detail view
    GeneralPane.tsx         ← Torrent info display
    ContextMenu.tsx         ← Right-click menu
    ResizeHandle.tsx        ← Draggable divider
  hooks/
  utils/
    format.ts               ← formatBytes, formatSpeed, formatPercent
```

**Key exports:** `TorrentTable`, `DetailPane`, `TableMount`, formatters

### extension/

Chrome extension entry points. Minimal code - delegates to packages.

```
src/
  sw.ts                     ← Service worker (daemon lifecycle, external messages)
  lib/
    daemon-lifecycle-manager.ts
    native-connection.ts
  ui/
    app.html / app.tsx      ← Thin wrapper, imports from @jstorrent/client
    share.html / share.tsx  ← Share target handler
  magnet/
    magnet-handler.html/ts  ← Magnet link handler page

public/
  manifest.json             ← MV3 manifest
  icons/
```

### native-host/

Rust workspace with three binaries.

```
Cargo.toml                  ← Workspace root
src/                        ← native-host binary (coordination)
io-daemon/src/              ← io-daemon binary (I/O)
  main.rs
  ws.rs                     ← WebSocket server, TCP/UDP multiplexing
  files.rs                  ← File read/write endpoints
  hashing.rs                ← SHA1/SHA256 endpoints
  auth.rs                   ← Token validation middleware

installers/                 ← Platform installers (NSIS, pkgbuild)
manifests/                  ← Chrome native messaging manifests
scripts/                    ← Build and install scripts
verify_*.py                 ← Python integration tests
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

### Native Host (Rust)

```bash
cd native-host
cargo build --workspace --release    # Build all binaries
cargo test --workspace               # Run Rust tests

# Python verification tests
python verify_host.py
python verify_torrent.py
```

### TypeScript Editing Workflow

See `CLAUDE.md` for the required sequence after editing TypeScript:
1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`
4. `pnpm format:fix` (last, after all tests pass)
