# Daemon Communication Protocol

Reference for how the extension communicates with native daemons on each platform.

## Architecture Overview

| Aspect | Desktop | ChromeOS |
|--------|---------|----------|
| **Processes** | native-host (coordinator) + io-daemon (worker) | Android app (combined) |
| **Control channel** | Native messaging to native-host | WebSocket `/control` (0xE0/0xE1 frames) |
| **Data channel** | WebSocket `/io` to io-daemon | WebSocket `/io` to Android app |
| **File I/O** | HTTP to io-daemon | HTTP to Android app |
| **Bootstrap** | Chrome auto-launches native-host | User launches Android app via intent |

### Desktop

```
Chrome Extension
    │
    ├── Native Messaging ──────────► native-host (control: handshake, picker, events)
    │                                     │
    │                                     │ spawns
    │                                     ▼
    ├── WebSocket /io ─────────────► io-daemon (data: TCP/UDP multiplexing)
    │
    └── HTTP ──────────────────────► io-daemon (files: read/write/hash)
```

### ChromeOS

```
Chrome Extension
    │
    ├── Intent URLs ───────────────► Android app (launch, add-root)
    │
    ├── HTTP POST /pair ───────────► Android app (secure pairing flow)
    │
    ├── WebSocket /control ────────► Android app (DaemonBridge: roots, events)
    │
    ├── WebSocket /io ─────────────► Android app (DaemonConnection: TCP/UDP)
    │
    └── HTTP ──────────────────────► Android app (files: read/write/hash, status)
```

The extension's `DaemonBridge` class abstracts these differences, exposing a unified API to the service worker.

---

## Control Plane

### Desktop (Native Messaging)

Chrome's native messaging provides a bidirectional JSON channel. The native-host is auto-launched when the extension connects.

**Extension → Native Host:**

| Message | Purpose |
|---------|---------|
| `{op: "handshake", extensionId, installId, id}` | Initialize connection, get daemon info |
| `{op: "pickDownloadDirectory", id}` | Open OS folder picker |

**Native Host → Extension:**

| Message | Purpose |
|---------|---------|
| `{type: "DaemonInfo", payload: {port, token, version, roots}}` | Response to handshake |
| `{type: "RootAdded", id, ok, payload: {root}}` | Response to picker (or unsolicited on change) |
| `{event: "TorrentAdded", payload: {name, infohash, contentsBase64}}` | .torrent file opened |
| `{event: "MagnetAdded", payload: {link}}` | Magnet link opened |

### ChromeOS (WebSocket Control Frames)

Control messages piggyback on the data WebSocket using reserved opcodes (0xE0-0xEF).

**Frame structure:**
```
Byte 0:    Version (0x01)
Byte 1:    Opcode
Bytes 2-3: Flags (reserved, 0x0000)
Bytes 4-7: Request ID (little-endian uint32)
Bytes 8+:  Payload
```

**Control opcodes (Server → Client):**

| Opcode | Name | Payload | Purpose |
|--------|------|---------|---------|
| `0xE0` | ROOTS_CHANGED | JSON array of roots | Broadcast when roots change |
| `0xE1` | EVENT | JSON `{event, payload}` | Native events (TorrentAdded, MagnetAdded) |

**ROOTS_CHANGED payload:**
```json
[
  {
    "key": "abc123def456",
    "uri": "content://com.android.externalstorage.documents/tree/primary%3ADownload",
    "displayName": "Download",
    "removable": false,
    "lastStatOk": true,
    "lastChecked": 1702234567890
  }
]
```

**EVENT payload:**
```json
{"event": "TorrentAdded", "payload": {"name": "file.torrent", "infohash": "...", "contentsBase64": "..."}}
{"event": "MagnetAdded", "payload": {"link": "magnet:?xt=urn:btih:..."}}
```

### ChromeOS Bootstrap (Intent URLs)

Since there's no native messaging on Android, the extension uses intent URLs to communicate with the Android app:

| Intent | Purpose |
|--------|---------|
| `intent://pair?token=...#Intent;scheme=jstorrent;package=com.jstorrent.app;end` | Launch app and set auth token |
| `intent://add-root#Intent;scheme=jstorrent;package=com.jstorrent.app;end` | Open SAF folder picker |

After the intent completes, the extension detects changes via WebSocket control frames (ROOTS_CHANGED) or HTTP polling (/status for pairing).

---

## Data Plane (WebSocket `/io`)

Binary protocol for TCP/UDP socket multiplexing. Identical on both platforms.

**Frame structure:**
```
Byte 0:    Version (0x01)
Byte 1:    Opcode
Bytes 2-3: Flags (reserved)
Bytes 4-7: Request ID (little-endian uint32)
Bytes 8+:  Payload (opcode-specific)
```

### Handshake & Auth

| Opcode | Name | Direction | Payload |
|--------|------|-----------|---------|
| `0x01` | CLIENT_HELLO | C→S | (empty) |
| `0x02` | SERVER_HELLO | S→C | (empty) |
| `0x03` | AUTH | C→S | `[authType:1][token\0extensionId\0installId]` |
| `0x04` | AUTH_RESULT | S→C | `[status:1][errorMsg...]` (status 0=success) |

**AUTH payload format:** The payload contains authType (1 byte, always 0), followed by null-separated strings: token, extensionId, and installId. The extensionId is the Chrome extension ID and installId is a unique per-installation identifier stored in `chrome.storage.local`.

### TCP Operations

| Opcode | Name | Direction | Payload |
|--------|------|-----------|---------|
| `0x10` | TCP_CONNECT | C→S | `[socketId:4][port:2][hostname...]` |
| `0x11` | TCP_CONNECTED | S→C | `[socketId:4][status:1][errorCode:4]` |
| `0x12` | TCP_SEND | C→S | `[socketId:4][data...]` |
| `0x13` | TCP_RECV | S→C | `[socketId:4][data...]` |
| `0x14` | TCP_CLOSE | Both | `[socketId:4][hadError:1][errorCode:4]` |

### UDP Operations

| Opcode | Name | Direction | Payload |
|--------|------|-----------|---------|
| `0x20` | UDP_BIND | C→S | `[socketId:4][port:2][bindAddr...]` |
| `0x21` | UDP_BOUND | S→C | `[socketId:4][status:1][boundPort:2][errorCode:4]` |
| `0x22` | UDP_SEND | C→S | `[socketId:4][destPort:2][addrLen:2][addr...][data...]` |
| `0x23` | UDP_RECV | S→C | `[socketId:4][srcPort:2][addrLen:2][addr...][data...]` |
| `0x24` | UDP_CLOSE | Both | `[socketId:4][hadError:1][errorCode:4]` |

### Control (ChromeOS only)

| Opcode | Name | Direction | Payload |
|--------|------|-----------|---------|
| `0xE0` | ROOTS_CHANGED | S→C | JSON array of roots |
| `0xE1` | EVENT | S→C | JSON `{event, payload}` |

---

## File I/O (HTTP)

REST endpoints for file operations. Identical on both platforms.

### Read File

```
GET /read/{rootKey}
Headers:
  X-JST-Auth: {token}
  X-Path-Base64: {base64-encoded relative path}
  X-Offset: {byte offset, default 0}
  X-Length: {bytes to read, required}

Response: raw bytes
```

### Write File

```
POST /write/{rootKey}
Headers:
  X-JST-Auth: {token}
  X-Path-Base64: {base64-encoded relative path}
  X-Offset: {byte offset, default 0}
  X-Expected-SHA1: {hex hash for verification, optional}

Body: raw bytes

Response:
  200 OK
  409 Conflict (hash mismatch)
  507 Insufficient Storage
```

Write auto-creates parent directories. No separate mkdir needed.

### Hash

```
POST /hash/sha1
Headers:
  X-JST-Auth: {token}

Body: raw bytes

Response: raw 20-byte SHA1 hash
```

### ChromeOS-only Endpoints

| Endpoint | Method | Purpose | Auth | Origin Check |
|----------|--------|---------|------|--------------|
| `/health` | GET | Health check, returns "ok" | No | No |
| `/status` | POST | `{port, paired, extensionId, installId}` | No | Yes |
| `/pair` | POST | Initiate pairing, body: `{token}` | No | Yes |
| `/roots` | GET | `{roots: [...]}` - fetch current roots | Yes | No |
| `/control` | WebSocket | Control plane (ROOTS_CHANGED, events) | Yes | No |

**Origin check:** Validates `Origin: chrome-extension://...` header to ensure requests come from Chrome extension, not local Android apps hitting `127.0.0.1`.

**POST /pair responses:**
- `200 OK` + `{status: "approved"}` - Same extensionId+installId, token updated silently
- `202 Accepted` + `{status: "pending"}` - Dialog shown, poll `/status`
- `409 Conflict` - Dialog already showing for another request

---

## Connection Lifecycle

### Desktop

1. Extension calls `chrome.runtime.connectNative('com.anthropic.jstorrent')`
2. Chrome launches native-host (if not running)
3. Extension sends `{op: "handshake", ...}`
4. Native-host responds with `{type: "DaemonInfo", payload: {...}}`
5. Extension connects WebSocket to `ws://127.0.0.1:{port}/io`
6. WebSocket auth handshake (CLIENT_HELLO → SERVER_HELLO → AUTH → AUTH_RESULT)
7. Ready for data operations

Disconnection detected via native messaging port `onDisconnect`.

### ChromeOS

**Initial pairing:**
1. Extension checks `POST /status` on known ports (7800, 7805, 7814...)
2. If not reachable, open intent URL to launch Android app, then poll
3. If reachable but not paired (or paired with different installId):
   - `POST /pair` with `{token}` body
   - Android app shows approval dialog
   - Poll `/status` until `paired: true` with matching extensionId/installId
4. DaemonBridge connects to `ws://100.115.92.2:{port}/control`
5. WebSocket auth handshake (AUTH includes token + extensionId + installId)
6. Ready for control operations (ROOTS_CHANGED, events)

**Engine connection (per-torrent):**
1. DaemonConnection connects to `ws://100.115.92.2:{port}/io`
2. WebSocket auth handshake
3. Ready for TCP/UDP socket operations

Disconnection detected via WebSocket `onclose` or failed health checks.

---

## Security

### Auth Token & Identity

Both platforms use a shared secret token plus identity verification:

- **Desktop:** Native-host generates token, sends in DaemonInfo, extension stores and uses for all requests
- **ChromeOS:** Extension generates token, sends via HTTP `POST /pair` endpoint, Android app stores after user approval

**ChromeOS identity tracking:**
- `extensionId`: Chrome extension ID (e.g., `dbokmlpefliilbjldladbimlcfgbolhk`)
- `installId`: Unique per-installation UUID stored in `chrome.storage.local`

The Android app tracks which extensionId+installId is paired. If the installId changes (extension reinstalled), the user must re-approve pairing. This prevents one extension from impersonating another.

Token + identity is required for:
- WebSocket AUTH frame (both `/io` and `/control`)
- HTTP requests (`X-JST-Auth`, `X-JST-ExtensionId`, `X-JST-InstallId` headers)

### Download Root Tokens

File paths are never exposed to the extension. Instead:

1. User selects folder via OS picker (native dialog or SAF)
2. Daemon generates opaque key: `sha256(salt + realpath)` (desktop) or `sha256(salt + uri)` (ChromeOS)
3. Extension only sees the key, uses it in `/read/{key}` and `/write/{key}`
4. Daemon validates key on every request

---

## Why Different Control Channels?

| Concern | Desktop | ChromeOS |
|---------|---------|----------|
| **Bootstrap** | Native messaging auto-launches native-host | Intent URL launches app, `POST /pair` for auth |
| **Bidirectional push** | Native messaging supports it natively | Dedicated `/control` WebSocket |
| **File picker** | Native-host shows OS dialog, responds via native msg | Android Activity, broadcasts via `/control` WebSocket |
| **I/O operations** | `/io` WebSocket to io-daemon | `/io` WebSocket to Android app |

**Why separate `/control` and `/io` on ChromeOS?**

Originally both shared `/io`, but this caused issues:
- Control messages (ROOTS_CHANGED, events) should only go to DaemonBridge, not DaemonConnection
- Different lifecycle: DaemonBridge stays connected for the extension's lifetime; DaemonConnection connects per-engine
- Opcode validation: prevents accidental mixing of control and I/O operations

The separation mirrors desktop's architecture where native messaging handles control and `/io` handles data.

From `DaemonBridge`'s perspective, both platforms expose the same API:
- `connect()` / `disconnect()`
- `pickDownloadFolder()`
- `onEvent()` for native events
- `subscribe()` for state changes (including roots)

The transport differences are hidden behind this abstraction.
