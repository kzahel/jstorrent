# JSTorrent Architecture

## What It Is

Chrome extension BitTorrent client. TypeScript engine, Rust native components, Kotlin Android daemon, React+Solid UI.

## Core Architectural Decisions

### 1. Engine Location

Currently the BtEngine runs in the UI page (same JS heap as React UI). This allows zero-serialization access to engine state - UI can read `engine.torrents[0].progress` directly.

**Potential future:** Engine may move to service worker (or offscreen document) to support background downloading when user closes all UI windows. This would be a user setting. The service worker lifecycle is tied to native-host connection - Chrome won't reap a SW that's actively using a native messaging channel.

**Current implication:** Closing all JSTorrent tabs stops downloads.

### 2. IO Bridge (Multi-Platform Connection)

The IO Bridge is a state machine that manages connections to I/O daemons across platforms. It abstracts the difference between desktop (native messaging) and ChromeOS (HTTP to Android container).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  extension/src/lib/io-bridge/                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  types.ts                 ← Shared types (DaemonInfo, Platform, States)     │
│  io-bridge-state.ts       ← Pure state machine (states, events, transition) │
│  io-bridge-store.ts       ← StateStore (holds state, notifies listeners)    │
│  io-bridge-effects.ts     ← Side effect runner (async ops, timers)          │
│  io-bridge-service.ts     ← Public API, coordinates store + effects         │
│  io-bridge-adapter.ts     ← IIOBridgeAdapter interface                      │
│                                                                             │
│  adapters/                                                                  │
│    desktop-adapter.ts     ← Native messaging (Win/Mac/Linux)                │
│    chromeos-adapter.ts    ← HTTP to Android container (100.115.92.2)        │
│    mock-adapter.ts        ← For unit tests                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**State Machine:**

```
INITIALIZING
    │
    │ START
    ▼
PROBING ─────────────────────────────────────────┐
    │                                            │
    ├── PROBE_SUCCESS ──► CONNECTED              │
    │                                            │
    └── PROBE_FAILED                             │
            │                                    │
            ├── (desktop) ──► INSTALL_PROMPT     │
            │                      │ RETRY       │
            │                      └─────────────┤
            │                                    │
            └── (chromeos) ──► LAUNCH_PROMPT     │
                                   │ USER_LAUNCH │
                                   ▼             │
                            AWAITING_LAUNCH      │
                                   │             │
                    ┌──────────────┼──────────┐  │
                    │ DAEMON_      │ LAUNCH_  │  │
                    │ CONNECTED    │ TIMEOUT  │  │
                    ▼              ▼          │  │
                CONNECTED     LAUNCH_FAILED   │  │
                    │              │ RETRY    │  │
                    │              └──────────┤  │
                    │ DAEMON_DISCONNECTED     │  │
                    ▼                         │  │
                DISCONNECTED ─────────────────┘  │
                    │ RETRY                      │
                    └────────────────────────────┘
```

### 3. Three-Process Native Architecture (Desktop)

```
Chrome Extension
    │
    │ chrome.runtime.connectNative()
    ▼
┌─────────────────┐
│  jstorrent-host │ ← Coordination, config, download roots
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
- `jstorrent-host`: Only Chrome can launch it (native messaging). Owns config, download roots.
- `io-daemon`: High-performance I/O. Child of jstorrent-host, dies when host exits.
- `link-handler`: OS-registered handler. Reads rpc-info - if host running, forwards directly. Otherwise opens browser which triggers extension.

### 4. ChromeOS Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ChromeOS Device                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Chrome Browser                      Android Container         │
│   ┌─────────────────┐                ┌─────────────────┐       │
│   │  Extension      │                │  android-io-    │       │
│   │                 │  HTTP/WS       │  daemon         │       │
│   │  @jstorrent/    │◄──────────────►│                 │       │
│   │  engine         │ 100.115.92.2   │  (Kotlin)       │       │
│   │  @jstorrent/    │                │                 │       │
│   │  client + ui    │                └─────────────────┘       │
│   └─────────────────┘                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

On ChromeOS, there's no native messaging. Instead:
- Extension connects via HTTP/WebSocket to `100.115.92.2` (stable ARC bridge IP)
- Android app (`android-io-daemon`) provides identical I/O endpoints as Rust daemon
- User must launch Android app (extension shows launch prompt)

### 5. Adapter Pattern

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

### 6. Hybrid React/Solid UI

React controls layout and component mounting. Solid.js handles high-frequency data display.

```
React Shell (App.tsx)
    │
    ├── TorrentTable ──► TableMount ──► VirtualTable.solid.tsx
    │                         │
    └── DetailPane            └── Solid component with RAF loop
        ├── PeerTable              reads engine data every frame
        ├── PieceTable
        ├── FileTable
        └── LogTable
```

**Why:** React for ecosystem/familiarity. Solid for 60fps updates without React re-render overhead.

### 7. Download Root Tokens

Users select download folders via native file picker. Each folder gets a stable opaque token:
```
token = sha256(salt + realpath)
```

The extension never sees real paths - only tokens. io-daemon validates tokens on every request.

### 8. Package Structure

Three main TypeScript packages with clear responsibilities:

```
packages/
├── engine/    ← Platform-agnostic BitTorrent protocol
│                No browser/Node APIs - everything through interfaces
│                Exports: BtEngine, Torrent, PeerConnection, adapters
│
├── client/    ← Chrome-specific app shell  
│                Connects engine to chrome APIs, IO Bridge UI
│                Exports: App, EngineManager, SystemBridgePanel
│
└── ui/        ← Presentational components
                 Virtualized tables (Solid.js), formatting utilities
                 Exports: TorrentTable, DetailPane, formatters
```

## Solved Constraints

### Mixed Content (jstorrent.com → io-daemon)

`https://jstorrent.com` cannot directly call `http://127.0.0.1` io-daemon.

**Solution:** Service worker proxy. The SW is exempt from mixed content restrictions. External page sends messages to SW, SW calls io-daemon, relays response.

### Hashing on HTTP Origins

`crypto.subtle` requires secure context. Dev server at `http://local.jstorrent.com` can't use it.

**Solution:** io-daemon handles all hashing. Piece writes include `X-Expected-SHA1` header for atomic write+verify. Engine rarely hashes internally.

## Data Flow

### Adding a Torrent (Desktop)

```
User clicks magnet link
    │
    ▼
link-handler reads rpc-info.json
    │
    ├─► jstorrent-host reachable? ──► Forward to extension via native-host
    │
    └─► Not reachable? ──► Open browser to jstorrent.com/launch#magnet=...
                               │
                               ▼
                          Extension detects, spawns native stack, adds torrent
```

### Adding a Torrent (ChromeOS)

```
User clicks magnet link
    │
    ▼
Android app registered as magnet handler
    │
    ├─► App already running? ──► Handle directly, notify extension
    │
    └─► App not running? ──► App launches, extension detects via polling
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

1. IO Bridge state machine for multi-platform connection management
2. Three-process native architecture (jstorrent-host, io-daemon, link-handler)
3. Adapter pattern with interface injection
4. Download root token model (opaque tokens, never raw paths)
5. React shell + Solid tables hybrid
6. Service worker lifecycle tied to daemon connection
