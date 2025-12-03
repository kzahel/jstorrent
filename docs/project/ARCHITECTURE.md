# JSTorrent Architecture

## What It Is

Chrome extension BitTorrent client. TypeScript engine, Rust native components, React+Solid UI.

## Core Architectural Decisions

### 1. Engine Location

Currently the BtEngine runs in the UI page (same JS heap as React UI). This allows zero-serialization access to engine state - UI can read `engine.torrents[0].progress` directly.

**Potential future:** Engine may move to service worker (or offscreen document) to support background downloading when user closes all UI windows. This would be a user setting. The service worker lifecycle is tied to native-host connection - Chrome won't reap a SW that's actively using a native messaging channel.

**Current implication:** Closing all JSTorrent tabs stops downloads.

### 2. Three-Process Native Architecture

```
Chrome Extension
    │
    │ chrome.runtime.connectNative()
    ▼
┌─────────────────┐
│  native-host    │ ← Coordination, config, download roots
│  (Rust)         │
└────────┬────────┘
         │ spawns as child process
         ▼
┌─────────────────┐
│  io-daemon      │ ← TCP/UDP sockets, filesystem, hashing
│  (Rust)         │
└─────────────────┘

┌─────────────────┐
│  link-handler   │ ← OS-level magnet://.torrent handler
│  (Rust)         │   Reads rpc-info, checks if native-host running
└─────────────────┘
```

**Why three processes:**
- `native-host`: Only Chrome can launch it (native messaging). Owns config, download roots.
- `io-daemon`: High-performance I/O. Child of native-host, dies when native-host exits.
- `link-handler`: OS-registered handler. Reads rpc-info - if native-host running, forwards directly. Otherwise opens browser which triggers extension.

### 3. Adapter Pattern

Engine is platform-agnostic. Adapters wire it to specific backends:

```
packages/engine/src/
  core/           ← Platform-agnostic (Torrent, PeerConnection, PieceManager)
  interfaces/     ← IFileSystem, ISocketFactory, ISessionStore, IHasher
  adapters/
    daemon/       ← io-daemon (production)
    node/         ← Node.js fs/net (testing)
    memory/       ← In-memory (unit tests)
    browser/      ← OPFS, chrome.storage
```

### 4. Hybrid React/Solid UI

React controls layout and component mounting. Solid.js handles high-frequency data display.

```
React Shell (App.tsx)
    │
    ├── TorrentTable ──► TableMount ──► VirtualTable.solid.tsx
    │                         │
    └── DetailPane            └── Solid component with RAF loop
        ├── PeerTable              reads engine data every frame
        └── PieceTable
```

**Why:** React for ecosystem/familiarity. Solid for 60fps updates without React re-render overhead.

### 5. Download Root Tokens

Users select download folders via native file picker. Each folder gets a stable opaque token:
```
token = sha256(salt + realpath)
```

The extension never sees real paths - only tokens. io-daemon validates tokens on every request.

### 6. Package Structure

Three main TypeScript packages with clear responsibilities:

```
packages/
├── engine/    ← Platform-agnostic BitTorrent protocol
│                No browser/Node APIs - everything through interfaces
│                Exports: BtEngine, Torrent, PeerConnection, adapters
│
├── client/    ← Chrome-specific app shell  
│                Connects engine to chrome APIs and daemon
│                Exports: App, EngineAdapter, DaemonManager
│
└── ui/        ← Presentational components
                 Virtualized tables (Solid.js), formatting utilities
                 Exports: TorrentTable, DetailPane, formatters
```

## Solved Constraints

### Mixed Content (jstorrent.com → io-daemon)

`https://jstorrent.com` cannot directly call `http://127.0.0.1` io-daemon.

**Solution:** Service worker proxy. The SW is exempt from mixed content restrictions. External page sends messages to SW, SW calls io-daemon, relays response. Straightforward to implement.

### Hashing on HTTP Origins

`crypto.subtle` requires secure context. Dev server at `http://local.jstorrent.com` can't use it.

**Solution:** io-daemon handles all hashing. Piece writes include `X-Expected-SHA1` header for atomic write+verify. Engine rarely hashes internally.

## Data Flow

### Adding a Torrent

```
User clicks magnet link
    │
    ▼
link-handler reads rpc-info.json
    │
    ├─► native-host reachable? ──► Forward to extension via native-host
    │
    └─► Not reachable? ──► Open browser to jstorrent.com/launch#magnet=...
                               │
                               ▼
                          Extension detects, spawns native stack, adds torrent
```

### Downloading

```
UI Page                    io-daemon                    Internet
   │                           │                            │
   │ TCP_CONNECT (peer)        │                            │
   │ ─────────────────────────►│ ───────────────────────────►
   │                           │                            │
   │ TCP_RECV (piece data)     │                            │
   │ ◄─────────────────────────│ ◄───────────────────────────
   │                           │                            │
   │ POST /write/{root_token}  │                            │
   │ ─────────────────────────►│ ──► Write to disk          │
```

## What Won't Change

1. Three-process native architecture (native-host, io-daemon, link-handler)
2. Adapter pattern with interface injection
3. Download root token model (opaque tokens, never raw paths)
4. React shell + Solid tables hybrid
5. Service worker lifecycle tied to native-host connection
