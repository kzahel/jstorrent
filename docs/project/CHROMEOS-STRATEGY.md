# JSTorrent ChromeOS Strategy

**Date:** December 2025  
**Status:** ✅ Phase 1-2 Complete, Phase 3 In Progress

---

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Android IO daemon | ✅ Complete | Kotlin/Ktor, 20MB/s throughput |
| Extension ChromeOS adapter | ✅ Complete | HTTP to 100.115.92.2 |
| IO Bridge state machine | ✅ Complete | Multi-platform connection management |
| Pairing flow | ✅ Complete | Intent URL token exchange |
| System Bridge UI | ✅ Complete | Status indicator + config panel |
| SAF folder picker | ⏳ Pending | Files in app private storage for now |
| Play Store listing | ⏳ Pending | Unlisted beta planned |

---

## The Opportunity

Chrome Apps are dying. Google shows deprecation warnings to users, and JSTorrent's ChromeOS user base is shrinking (~15K → ~9.5K this year). These users need a migration path.

**Why ChromeOS first:**
- Active user base is ChromeOS (Windows/Mac "users" in analytics are phantom syncs—the app doesn't work there)
- No viable competition on the platform
- Desktop has mature alternatives; desktop native host is mostly done but lower urgency

---

## Architecture

The engine runs in the browser (same as desktop). The Android app is a thin I/O daemon—it only handles sockets, files, and hashing.

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

This mirrors the desktop architecture:

| | Desktop | ChromeOS |
|---|---------|----------|
| Engine runs in | Browser | Browser |
| I/O daemon | Rust (`io-daemon`) | Kotlin (`android`) |
| Connection | `127.0.0.1` via native messaging | `100.115.92.2` via HTTP/WS |

**Why this works:** We tested direct HTTP from Chrome to an Android app on ChromeOS. The IP `100.115.92.2` (the ARC bridge) has been stable for 8+ years.

---

## Minimal Required API

After auditing actual usage, the surface area is much smaller than the Rust codebase suggests. Session persistence uses `chrome.storage.local`, NOT the daemon filesystem. Content storage only does read/write operations.

### Actually Used Endpoints

**1. WebSocket `/io`** — TCP/UDP multiplexing (data plane)

Used by the engine's DaemonConnection for actual socket I/O operations.

```
Frame: [version:1][opcode:1][flags:2][reqId:4][payload...]

TCP:
  0x10 TCP_CONNECT    → [socketId:4][port:2][hostname...]
  0x11 TCP_CONNECTED  ← [socketId:4][status:1]
  0x12 TCP_SEND       → [socketId:4][data...]
  0x13 TCP_RECV       ← [socketId:4][data...]
  0x14 TCP_CLOSE      ↔ [socketId:4]

UDP:
  0x20 UDP_BIND       → [socketId:4][port:2][bindAddr...]
  0x21 UDP_BOUND      ← [socketId:4][status:1][boundPort:2]
  0x22 UDP_SEND       → [socketId:4][destPort:2][addrLen:2][addr...][data...]
  0x23 UDP_RECV       ← [socketId:4][srcPort:2][addrLen:2][addr...][data...]
  0x24 UDP_CLOSE      ↔ [socketId:4]

Handshake:
  0x01 CLIENT_HELLO   → (empty)
  0x02 SERVER_HELLO   ← (empty)
  0x03 AUTH           → [authType:1][token + \0 + extensionId + \0 + installId]
  0x04 AUTH_RESULT    ← [status:1] (0=success)
```

The `/io` endpoint only accepts handshake opcodes (0x01-0x04) and I/O opcodes (0x10-0x24).

**2. WebSocket `/control`** — Control plane (DaemonBridge)

Used by the extension's service worker for pairing state, root changes, and native events.

```
Frame: [version:1][opcode:1][flags:2][reqId:4][payload...]

Control (Server → Client):
  0xE0 ROOTS_CHANGED  ← [JSON array of roots]
  0xE1 EVENT          ← [JSON {event, payload}]
```

The `/control` endpoint only accepts handshake opcodes (0x01-0x04) and control opcodes (0xE0-0xE1).

**4. `GET /read/{root}`** — Read file bytes

Headers:
- `X-Path-Base64`: base64-encoded relative path
- `X-Offset`: byte offset (optional, default 0)
- `X-Length`: bytes to read (required)

Returns: raw bytes

**5. `POST /write/{root}`** — Write file bytes

Headers:
- `X-Path-Base64`: base64-encoded relative path
- `X-Offset`: byte offset (optional, default 0)
- `X-Expected-SHA1`: hex hash for verification (optional)

Body: raw bytes

**Important:** Write auto-creates parent directories. No separate mkdir needed.

Returns: 200 OK, 409 Conflict (hash mismatch), 507 Insufficient Storage

**6. `POST /hash/sha1`** — Hash bytes

Body: raw bytes  
Returns: raw 20-byte SHA1 hash

### Not Needed (Dead Code)

These exist in the Rust daemon and TypeScript adapters but are never called:
- `/ops/stat` — stat() method exists but unused
- `/ops/list` — readdir() method exists but unused
- `/ops/delete` — delete() method exists but unused
- `/ops/truncate` — truncate() method exists but unused
- `/files/ensure_dir` — mkdir() method exists but write auto-creates dirs

### TypeScript Interfaces (Reference)

The engine uses these interfaces, but only a subset of methods are called:

```typescript
// packages/engine/src/interfaces/socket.ts
interface ITcpSocket {
  connect(port: number, host: string): Promise<void>
  send(data: Uint8Array): void
  onData(cb: (data: Uint8Array) => void): void
  onClose(cb: (hadError: boolean) => void): void
  onError(cb: (err: Error) => void): void
  close(): void
}

interface IUdpSocket {
  send(addr: string, port: number, data: Uint8Array): void
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void
  close(): void
}

// packages/engine/src/interfaces/filesystem.ts
// Only these methods are actually called:
interface IFileHandle {
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  write(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>
  close(): Promise<void>
}

// packages/engine/src/interfaces/hasher.ts
interface IHasher {
  sha1(data: Uint8Array): Promise<Uint8Array>
}
```

---

## Key Differences from Desktop

**Auth token via intent:** ✅ Implemented. Desktop uses native messaging to securely pass the auth token. On ChromeOS, the extension generates a token and launches the Android app via intent URL:

```
intent://pair?token=abc123#Intent;scheme=jstorrent;package=com.jstorrent.iodaemon;end
```

The Android app extracts the token from the intent and stores it. Both sides now share the secret. This ensures only the JSTorrent extension can connect to the daemon.

**Simplified root handling:** ✅ Implemented. Desktop uses opaque tokens to hide file paths from the extension. On Android, use a single root (app's download directory). The `{root}` in `/read/{root}` and `/write/{root}` is a fixed value `"default"`.

**No native messaging:** ✅ Implemented. Desktop uses Chrome's native messaging to discover the daemon port. On ChromeOS, the extension connects directly to `http://100.115.92.2:7800`.

**Port selection:** ✅ Implemented. If port 7800 is taken, use deterministic alternative ports: `port = 7800 + 4*retry + retry²` (7800, 7805, 7814, 7827...). Daemon exposes actual port via `GET /status`.

**Manifest host permission:** ✅ Implemented. The extension manifest has `"host_permissions": ["http://100.115.92.2/*"]` to reach the Android container.

---

## Extension Changes

✅ All implemented via IO Bridge architecture:

1. **Manifest**: Added `"host_permissions": ["http://100.115.92.2/*"]`
2. **Platform detection**: `extension/src/lib/platform.ts` detects ChromeOS
3. **Pairing flow**: Handled by `chromeos-adapter.ts`
4. **ChromeOSAdapter class**: In `extension/src/lib/io-bridge/adapters/chromeos-adapter.ts`

Pairing flow (one-time):
1. User clicks "Connect to Android app" in extension (System Bridge panel)
2. Extension generates random token, stores in `chrome.storage.local`
3. Extension opens intent URL via `chrome.tabs.create()`
4. Android app launches, extracts token, stores it
5. Extension polls `100.115.92.2`, sends token in AUTH handshake

For jstorrent.com: the website talks to the extension via `externally_connectable`, and the extension bridges to the daemon (same pattern as desktop for mixed-content bypass).

---

## Remaining Work

**Storage location:** Currently using Android private storage. ChromeOS Files app *can* access it via Android/data/com.jstorrent.iodaemon/ path, but it's not ideal. SAF folder picker would let users choose a visible location.

**Service lifecycle:** Testing confirmed Android app with active WebSocket stays alive on ChromeOS without foreground notification. No additional work needed.

**Protocol handlers:** Android app registers intent filters for `magnet:` URIs. Working on ChromeOS - opens app which notifies extension.

---

## Phases

### Phase 1: MVP ✅ Complete

**Android app:**
- ✅ Kotlin HTTP + WebSocket server (Ktor)
- ✅ Socket/file/hash endpoints matching existing protocol
- ✅ Intent filter for `jstorrent://pair?token=...` (pairing)
- ✅ Intent filters for `magnet:` URIs
- ✅ Service that stays alive during connections

**Extension:**
- ✅ Added `100.115.92.2` to manifest host permissions
- ✅ Pairing flow: generate token, open intent URL, store token
- ✅ `ChromeOSAdapter` class (uses stored token)
- ✅ Detect platform, connect to `100.115.92.2` on ChromeOS
- ✅ "Launch Android app" prompt if connection fails

### Phase 2: Polish ✅ Complete

- ✅ IO Bridge state machine with reconnection handling
- ✅ System Bridge UI (indicator + panel)
- ✅ Throughput optimization (128KB buffers → 20MB/s)
- ⏳ SAF folder picker (deferred)
- ⏳ Download complete notifications (deferred)

### Phase 3: Launch (In Progress)

With this architecture, ChromeOS and desktop share nearly everything. Can launch both platforms together.

- ⏳ Play Store listing (unlisted beta)
- ⏳ Windows/macOS testing
- ⏳ User migration from Chrome App

---

## Why Not JNI/React Native?

We considered running the engine inside Android via React Native + Hermes or reusing the Rust io-daemon via JNI. Both would require maintaining a separate JS runtime or complex native bridges. The local HTTP discovery (`100.115.92.2`) made this unnecessary—engine runs in browser on all platforms, only the I/O daemon differs per platform.

---

## Chrome App Migration

Push an update to Chrome Apps with a banner:

> ⚠️ **JSTorrent is getting an upgrade.** Chrome Apps are being retired by Google, but we're building a new version. [Join the waitlist] to get notified.

Email capture system is in place. Notify users when extension + Android app are published.
