# JSTorrent ChromeOS Strategy

**Date:** December 2025

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
| I/O daemon | Rust (`io-daemon`) | Kotlin (`android-io-daemon`) |
| Connection | `127.0.0.1` via native messaging | `100.115.92.2` via HTTP/WS |

**Why this works:** We tested direct HTTP from Chrome to an Android app on ChromeOS. The IP `100.115.92.2` (the ARC bridge) has been stable for 8+ years.

---

## Minimal Required API

After auditing actual usage, the surface area is much smaller than the Rust codebase suggests. Session persistence uses `chrome.storage.local`, NOT the daemon filesystem. Content storage only does read/write operations.

### Actually Used Endpoints

**1. WebSocket `/io`** — TCP/UDP multiplexing

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
  0x03 AUTH           → [authType:1][token...]
  0x04 AUTH_RESULT    ← [status:1] (0=success)
```

**2. `GET /read/{root}`** — Read file bytes

Headers:
- `X-Path-Base64`: base64-encoded relative path
- `X-Offset`: byte offset (optional, default 0)
- `X-Length`: bytes to read (required)

Returns: raw bytes

**3. `POST /write/{root}`** — Write file bytes

Headers:
- `X-Path-Base64`: base64-encoded relative path
- `X-Offset`: byte offset (optional, default 0)
- `X-Expected-SHA1`: hex hash for verification (optional)

Body: raw bytes

**Important:** Write auto-creates parent directories. No separate mkdir needed.

Returns: 200 OK, 409 Conflict (hash mismatch), 507 Insufficient Storage

**4. `POST /hash/sha1`** — Hash bytes

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

**Auth token via intent:** Desktop uses native messaging to securely pass the auth token. On ChromeOS, the extension generates a token and launches the Android app via intent URL:

```
intent://pair?token=abc123#Intent;scheme=jstorrent;package=com.jstorrent;end
```

The Android app extracts the token from the intent and stores it. Both sides now share the secret. This ensures only the JSTorrent extension can connect to the daemon.

**Simplified root handling:** Desktop uses opaque tokens to hide file paths from the extension. On Android, use a single root (app's download directory). The `{root}` in `/read/{root}` and `/write/{root}` can be a fixed value like `"default"`.

**No native messaging:** Desktop uses Chrome's native messaging to discover the daemon port. On ChromeOS, the extension connects directly to `http://100.115.92.2:7800`.

**Port selection:** If port 7800 is taken, use deterministic alternative ports: `port = 7800 + 4*retry + retry²` (7800, 7805, 7814, 7827...). Daemon exposes actual port via `GET /status`.

**Manifest host permission:** The extension manifest needs `"host_permissions": ["http://100.115.92.2/*"]` to reach the Android container. This will be visible to Chrome Web Store reviewers and users.

---

## Extension Changes

The extension needs:

1. **Manifest**: Add `"host_permissions": ["http://100.115.92.2/*"]`
2. **Platform detection**: Check if running on ChromeOS, use Android daemon instead of native host
3. **Pairing flow**: Generate token → open intent URL → store token
4. **AndroidDaemonConnection class**: Like `DaemonConnection` but connects to `100.115.92.2` and uses stored token

Pairing flow (one-time):
1. User clicks "Connect to Android app" in extension
2. Extension generates random token, stores in `chrome.storage.local`
3. Extension opens `intent://pair?token=...#Intent;scheme=jstorrent;package=com.jstorrent;end`
4. Android app launches, extracts token, stores it
5. Extension connects to daemon, sends token in AUTH handshake

For jstorrent.com: the website talks to the extension via `externally_connectable`, and the extension bridges to the daemon (same pattern as desktop for mixed-content bypass).

---

## Open Questions

**Storage location:** Start with Android private storage. Test if ChromeOS Files app can access it. Add SAF folder picker later if users need it.

**Service lifecycle:** Does an Android app with active WebSocket stay alive on ChromeOS without a foreground notification? Needs testing. Fallback: show notification during active downloads.

**Protocol handlers:** Android app registers intent filters for `magnet:` and `.torrent` files. Extension doesn't need to register handlers on ChromeOS.

---

## Phases

### Phase 1: MVP (4-6 weeks)

**Android app:**
- Kotlin HTTP + WebSocket server (Ktor)
- Implement socket/file/hash endpoints matching existing protocol
- Intent filter for `jstorrent://pair?token=...` (pairing)
- Intent filters for `magnet:` URIs and `.torrent` files
- Service that stays alive during connections

**Extension:**
- Add `100.115.92.2` to manifest host permissions
- Pairing flow: generate token, open intent URL, store token
- `AndroidDaemonConnection` class (uses stored token)
- Detect platform, connect to `100.115.92.2` on ChromeOS
- "Install Android app" prompt if connection fails

### Phase 2: Polish (3-4 weeks)

- Handle reconnection edge cases
- SAF folder picker if needed
- Notifications (download complete)
- Test on various ChromeOS devices

### Phase 3: Launch Both Platforms

With this architecture, ChromeOS and desktop share nearly everything. Once ChromeOS is stable, desktop launch follows quickly.

---

## Why Not JNI/React Native?

We considered running the engine inside Android via React Native + Hermes or reusing the Rust io-daemon via JNI. Both would require maintaining a separate JS runtime or complex native bridges. The local HTTP discovery (`100.115.92.2`) made this unnecessary—engine runs in browser on all platforms, only the I/O daemon differs per platform.

---

## Immediate Action

Push an update to Chrome Apps with a banner:

> ⚠️ **JSTorrent is getting an upgrade.** Chrome Apps are being retired by Google, but we're building a new version. [Join the waitlist] to get notified.

This stops user bleed and captures intent for launch.
