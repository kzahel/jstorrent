# JSTorrent Architecture

## What It Is

Chrome extension BitTorrent client. TypeScript engine, Rust native components, Kotlin Android daemon, React+Solid UI.

## Core Architectural Decisions

### 1. Engine Location

Currently the BtEngine runs in the UI page (same JS heap as React UI). This allows zero-serialization access to engine state - UI can read `engine.torrents[0].progress` directly.

**Potential future:** Engine may move to service worker (or offscreen document) to support background downloading when user closes all UI windows. This would be a user setting. The service worker lifecycle is tied to native-host connection - Chrome won't reap a SW that's actively using a native messaging channel.

**Current implication:** Closing all JSTorrent tabs stops downloads.

### 2. Daemon Bridge (Multi-Platform Connection)

The Daemon Bridge manages connections to I/O daemons across platforms. It abstracts the difference between desktop (native messaging) and ChromeOS (HTTP/WebSocket to Android container).

```
extension/src/lib/daemon-bridge.ts
```

**Three states:**

```
connecting ◄──────► connected ◄──────► disconnected
```

The bridge exposes a unified API regardless of platform:
- `connect()` / `disconnect()`
- `pickDownloadFolder()` - triggers native picker on desktop, SAF picker on ChromeOS
- `triggerLaunch()` - opens Android app on ChromeOS (no-op on desktop)
- `subscribe()` for state changes (status, roots)
- `onEvent()` for native events (TorrentAdded, MagnetAdded)

**Platform differences are hidden:**

| Aspect | Desktop | ChromeOS |
|--------|---------|----------|
| Control channel | Native messaging | WebSocket control frames (0xE0/0xE1) |
| Data channel | WebSocket `/io` to io-daemon | Same WebSocket `/io` to Android |
| Bootstrap | Chrome auto-launches native-host | Intent URL + HTTP `POST /pair` |
| Auth | Token from DaemonInfo | Token + extensionId + installId + user approval |

UI components decide what prompts to show based on `status + hasEverConnected + platform`, not encoded in the bridge itself.

See `DAEMON-PROTOCOL.md` for wire-level protocol details and the "Platform Differences" section below for detailed comparison.

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

## Platform Differences

### Bootstrap & Connection

| Aspect | Desktop | ChromeOS |
|--------|---------|----------|
| **Launch** | `chrome.runtime.connectNative()` auto-launches native-host | Intent URL `jstorrent://launch` opens Android app |
| **Control channel** | Native messaging (JSON over stdio) | WebSocket `/io` with control frames (0xE0/0xE1) |
| **Data channel** | WebSocket `/io` to io-daemon | Same WebSocket `/io` |
| **Daemon host** | `127.0.0.1` | `100.115.92.2` (ARC bridge IP) |
| **Daemon port** | Returned in DaemonInfo | Probed from list: 7800, 7805, 7814, 7827, 7844 |

### Authentication

**Desktop:**
- Native-host generates token on launch, sends in `DaemonInfo` response
- Extension stores token, uses for all subsequent requests
- Single-step: native messaging implies trust

**ChromeOS:**
- Extension generates token, sends via `POST /pair` endpoint
- Android app shows user approval dialog
- Extension polls `/status` until `paired: true` with matching identity
- Identity tracking: `extensionId` (Chrome extension ID) + `installId` (per-installation UUID)
- Silent re-pair if same identity reconnects (token refresh, no dialog)
- Re-approval required if `installId` changes (extension reinstalled)

**Why identity tracking on ChromeOS?**
- Intents are untrusted (any app can send them) - used only for launching
- Origin header validation blocks local Android apps hitting `127.0.0.1`
- `installId` detects extension reinstalls, prompts user to re-approve

### Storage & Paths

| Aspect | Desktop | ChromeOS |
|--------|---------|----------|
| **Root selection** | Native OS file picker via native-host | SAF (Storage Access Framework) picker |
| **Root URI format** | Filesystem path | Content URI (e.g., `content://com.android.externalstorage.documents/tree/...`) |
| **Token derivation** | `sha256(salt + realpath)` | `sha256(salt + uri)` |
| **Cloud storage** | N/A | Blocked - SAF only accepts local providers |
| **Permission persistence** | Filesystem permissions | `takePersistableUriPermission()` |

**Why block cloud storage on ChromeOS?**
Cloud providers (Google Drive, Dropbox, OneDrive) don't reliably support random access writes via SAF, which torrents require. The folder picker validates the provider and shows an error for cloud-backed locations.

### WebSocket AUTH Frame

The AUTH frame payload differs slightly:

```
Format: authType(1) + token + '\0' + extensionId + '\0' + installId
```

- `authType`: Always `0` (unified format)
- `token`: Shared secret
- `extensionId`: Chrome extension ID
- `installId`: Per-installation UUID (from `chrome.storage.local`)

Desktop io-daemon extracts token by finding the first null byte; ignores extensionId/installId. Android daemon validates all three fields.

### Control Frame Protocol (ChromeOS Only)

Control messages use reserved opcodes on the data WebSocket:

| Opcode | Name | Direction | Payload |
|--------|------|-----------|---------|
| `0xE0` | ROOTS_CHANGED | S→C | JSON array of roots |
| `0xE1` | EVENT | S→C | JSON `{event, payload}` |

Events include `TorrentAdded`, `MagnetAdded` - same as native messaging events on desktop.

### HTTP Endpoints

**Shared (both platforms):**
- `GET /read/{rootKey}` - Read file bytes
- `POST /write/{rootKey}` - Write file bytes
- `POST /hash/sha1` - Hash bytes

**ChromeOS-only:**
- `GET /health` - Health check
- `POST /status` - Get port, pairing status, identity
- `POST /pair` - Initiate pairing
- `GET /roots` - Get configured roots

Desktop handles root management via native messaging; ChromeOS needs HTTP endpoints since there's no persistent control channel until WebSocket connects.

### Connection State

The `DaemonBridge` exposes a unified state machine:

```
connecting ←──────→ connected ←──────→ disconnected
```

**What happens in each state:**

| State | Desktop | ChromeOS |
|-------|---------|----------|
| `connecting` | Native messaging handshake | Port probe → HTTP pairing → WebSocket auth |
| `connected` | Native port + WebSocket active | WebSocket authenticated, health check running |
| `disconnected` | Native port closed or timed out | WebSocket closed or health check failed |

UI decisions (show install prompt vs launch prompt) are based on `status + hasEverConnected + platform`, not embedded in the state machine.

### Folder Picker Flow

**Desktop:**
1. Extension sends `{op: "pickDownloadDirectory", id}` via native messaging
2. Native-host opens OS file picker
3. Response `{type: "RootAdded", id, ok, payload: {root}}` via native messaging

**ChromeOS:**
1. Extension opens intent `jstorrent://add-root`
2. Android `AddRootActivity` launches SAF picker immediately
3. User selects folder (cloud providers blocked)
4. Activity calls `takePersistableUriPermission()`, adds to `RootStore`
5. Android daemon broadcasts `ROOTS_CHANGED` via WebSocket
6. Extension receives updated roots array automatically

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
    ├─► App already running? ──► Handle directly
    │                               │
    │                               ▼
    │                          Send EVENT (0xE1) via WebSocket
    │                               │
    │                               ▼
    │                          Extension receives, opens UI
    │
    └─► App not running? ──► App launches
                               │
                               ▼
                          Extension detects via health poll
                               │
                               ▼
                          Connects, magnet added from intent
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

1. **DaemonBridge abstraction** - Unified API hiding platform differences
2. **Three-process native architecture on desktop** (jstorrent-host, io-daemon, link-handler)
3. **Single Android daemon on ChromeOS** - Combined control + I/O
4. **Adapter pattern** with interface injection (engine remains platform-agnostic)
5. **Download root token model** - Opaque tokens, never raw paths
6. **React shell + Solid tables hybrid** - React for layout, Solid for 60fps data
7. **WebSocket binary protocol** - Same frame format and opcodes on both platforms
8. **Secure pairing on ChromeOS** - User approval required, identity tracking

## Invariants

Hard constraints. Violating these causes subtle bugs that are difficult to diagnose.

### Single Native Host Connection

There is exactly ONE `chrome.runtime.connectNative()` port per extension lifecycle. Never create a second connection. All native host communication goes through this single port.

**Why:** Chrome's native messaging spawns a new host process per port. Multiple ports means multiple processes. Responses go to the port that made the request - if handlers are registered on a different port, messages are lost. The native host is stateful (auth token, download roots) - a second process starts with none of that state.

**Enforcement:** `NativeHostConnection` is a singleton. The constructor throws if called twice. Use `getNativeConnection()` to obtain the instance.

**Reconnection:** If the native host crashes, the singleton can reconnect by calling `connect()` again. It resets internal state and creates a fresh `connectNative()` port. This spawns a new native host process. The IOBridgeService state machine handles triggering reconnection attempts.
