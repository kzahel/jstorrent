Below is the **revised design document**, scoped _strictly_ to the **Native Messaging Host binary**, with all other system components removed or minimally referenced only as necessary context. The host is described as a **dumb, safe syscall proxy**, without any BitTorrent-specific logic or assumptions.

This version is **tight, technical, and focused entirely on the native host’s responsibilities, interfaces, and behavior.**

---

# **JSTorrent Native Messaging Host – Design Document**

_(Native Host Binary Only)_

## **0. Purpose and Scope**

This document defines the design of the **Native Messaging Host binary** used by a Chrome extension.
The host acts as a **minimal, cross-platform syscall proxy**, providing safe access to:

- TCP and UDP sockets
- Filesystem operations (random access, stat, directory ensure)
- Atomic file move
- Native folder picker dialog
- Optional hashing

The host contains **no domain logic** (e.g., no BitTorrent protocol).
It is intentionally “dumb”: it performs operations exactly as requested, within strict validation and safety rules.

This document **does not** describe the Chrome extension, JavaScript engine, torrent engine, or UI.

---

# **1. Overview**

The Native Host:

- Runs as a **subprocess of Chrome** via Chrome Native Messaging.
- Communicates using **stdin/stdout with strict binary framing**.
- Maintains ephemeral OS resources (socket/file handles).
- Executes operations requested by the extension.
- Emits asynchronous events for resource activity (e.g., incoming socket data).
- Exits immediately when Chrome disconnects.

The host is **stateless across invocations**.

---

# **2. Native Messaging Transport**

### **2.1 Process Launch**

Chrome spawns the host executable with:

- `stdin` for incoming requests
- `stdout` for outgoing responses/events

The host must:

- Continuously read messages from stdin
- Write framed responses to stdout
- Exit on EOF or any pipe failure

### **2.2 Message Framing**

Each message is:

```
[4-byte little-endian unsigned integer length]
[JSON UTF-8 payload of that length]
```

No newline or delimiter.

### **2.3 Message Types**

The host supports:

- **Requests** (incoming, must have `"id"` and `"op"`)
- **Responses** (outgoing, echoing `"id"`)
- **Events** (outgoing, unsolicited, no `"id"`)

Example request:

```json
{ "id": "123", "op": "openTcp", "host": "...", "port": 1234 }
```

Example response:

```json
{ "id": "123", "ok": true, "socketId": 5 }
```

Example event:

```json
{ "event": "tcpData", "socketId": 5, "data": "base64..." }
```

The host does not interpret JSON beyond what is required to validate and execute operations.

---

# **3. Functional Requirements**

## **3.1 TCP Operations**

### Supported operations:

- `openTcp(host, port)` → returns numeric `socketId`
- `writeTcp(socketId, data)`
- `closeTcp(socketId)`

### Events:

- `tcpData(socketId, data)`
- `tcpClosed(socketId)`
- `tcpError(socketId, error)`

### Behavior:

- Non-blocking, async I/O
- Fixed-size read buffers (e.g., 64 KiB)
- Immediately forward incoming data as events
- No accumulation or protocol interpretation
- Host is responsible for closing sockets on fatal errors

---

## **3.2 UDP Operations**

### Supported operations:

- `openUdp(bindHost?, bindPort?)` → returns `socketId`
- `sendUdp(socketId, remoteHost, remotePort, data)`
- `closeUdp(socketId)`

### Events:

- `udpData(socketId, data, remoteHost, remotePort)`
- `udpError(socketId, error)`

UDP packets are simply forwarded; host does not interpret content.

---

## **3.3 File I/O Operations**

### Supported operations:

- `ensureDir(path)`
- `readFile(path, offset, length)` → returns base64 content
- `writeFile(path, offset, data)`
- `statFile(path)` → returns `{ size, mtime, ... }`

### Behavior:

- All paths must be **absolute**
- Host must validate paths against a **configured download root** (see §7)
- Reject access outside allowed root
- Supports files >4GB
- Read/write bounds checked strictly
- No internal buffering beyond immediate I/O

---

## **3.4 Atomic Move Operation**

### Operation:

- `atomicMove(from, to, overwrite?)`

### Behavior:

- Use platform atomic rename
- Fail on cross-device rename (EXDEV)
- If overwrite=false, fail if destination exists
- No directory creation; caller must ensure proper structure
- Host does not update any internal mapping—just performs rename

---

## **3.5 Folder Picker**

### Operation:

- `pickDownloadDirectory()`

Returns an absolute directory path or an error.

### Behavior:

- Use native UI (rfd crate or platform-specific implementations)
- If user cancels, return error
- If running headless, return error

---

## **3.6 Optional Hashing**

### Operation:

- `hashSha1(data)` or `hashFile(path, offset, length)`

This is optional and only provided if needed for performance.

The host does no interpretation of hash usage.

---

# **4. Resource Management**

The host maintains:

- `TcpSockets: HashMap<SocketId, TcpState>`
- `UdpSockets: HashMap<SocketId, UdpState>`
- `OpenFiles` (if persistent handles are used; otherwise operate on paths directly)
- `Config` including the validated download root

Resource identifiers (`socketId`, etc.) are opaque integers chosen by the host.

On exit:

- All resources are automatically cleaned up by OS
- No persistent state is written

---

# **5. Error Handling**

If an operation fails:

- Respond with `{ "id": ..., "ok": false, "error": "..." }`

Errors include:

- Invalid op
- Missing/invalid fields
- Path outside allowed root
- Permission denied
- Disk full / file too large
- Cross-device atomic move attempted
- Socket closed / unreachable host
- Invalid base64 payload

The host should **never panic** on user input; instead, return an error or exit cleanly for fatal IPC failures.

---

# **6. Socket Read Strategy**

The host uses a **fixed-size per-read buffer** (e.g. 64 KiB).

Procedure:

1. Attempt to read up to N bytes
2. If >0, send a `tcpData` event with exactly the bytes read
3. If 0, treat as remote close → emit `tcpClosed`
4. On any fatal read error → emit `tcpError` then close socket

Host does not:

- Buffer message streams
- Interpret data
- Attempt to parse protocols
- Accumulate partial data

This ensures bounded memory usage.

---

# **7. Filesystem Safety Model**

The host enforces strict root confinement:

- The JS caller must specify a **download root directory** during initialization (or it is configured externally).
- For any path:
  1. Canonicalize (`realpath`/equivalent)
  2. Ensure canonical path starts with canonical root prefix

If the root is not set or not valid, host returns an error.

The host also prevents:

- `..` traversal
- symlink escape (to the extent possible via canonicalization)
- access to unrelated filesystem locations

---

# **8. Security Considerations**

### 8.1 Input Validation

Every request is validated:

- `id` must exist
- `op` must be known
- Parameter types and ranges validated
- Base64 properly decoded
- Data lengths do not exceed safe limits

Malformed framing or JSON → immediate exit.

### 8.2 No Trust in Message Source

The host must assume:

- Messages could be malicious
- Chrome extension could be compromised
- Chrome could be compromised

Therefore all I/O must be validated and confined.

### 8.3 No Unsolicited External Connections

All networking is initiated by explicit requests from extension.
Host never initiates outbound connections except those requested.

### 8.4 No Inter-host Communication

Only Chrome can spawn the host and attach pipes; other processes cannot connect to its stdin/stdout.

---

# **9. Process Lifecycle**

### Host must:

- Start up, initialize state
- Enter blocking IPC loop
- Exit when:
  - stdin closes (Chrome shut down or port closed)
  - write to stdout fails
  - fatal parse error
  - unrecoverable internal error

### No background threads must hold the process open after Chrome disconnects.

All background tasks use async tasks that are dropped when main loop exits.

---

# **10. Logging**

Logging should be:

- Minimal
- Disabled or low-verbosity by default
- Redirectable (e.g., stderr)

Logs must not print raw socket/file contents unless explicitly configured.

---

# **11. Implementation Outline (Rust)**

### Suggested modules:

```
src/
  main.rs            // entry point, IPC loop
  ipc.rs             // framing, JSON decode/encode
  protocol.rs        // request/response/event types
  state.rs           // resource tables
  tcp.rs             // TCP socket implementation
  udp.rs             // UDP implementation
  fs.rs              // filesystem operations
  atomic_move.rs     // atomic rename logic
  folder_picker.rs   // native folder picking
  hashing.rs         // optional hashing
  path_safety.rs     // canonicalization + root confinement
```

### Runtime

Tokio or async-std is recommended.

---

# **12. Testing Strategy (Host-Only)**

Host-level tests must mock Chrome’s role, simulating stdin/stdout streams.

### **Unit tests**

- Framing parse errors
- Path confinement logic
- Atomic move semantics
- JSON mapping + validation
- Maximum payload constraints
- Base64 decoding

### **Integration tests**

- TCP echo tests
- UDP loopback tests
- File read/write with temp directories
- Simulated disconnect (stdin EOF)
- Cross-device rename testing where feasible

### **Security tests**

- Path traversal attempts
- Invalid/malformed requests
- Extreme sizes in request payloads
- Abrupt pipe closures

Host is tested in complete isolation from the extension or any BitTorrent logic.

---

# **13. Summary**

The Native Messaging Host is:

- A **strictly minimal syscall proxy**
- Cross-platform Rust binary
- Invoked solely via Chrome Native Messaging
- Stateless and ephemeral
- Highly validated and sandboxed
- Responsible only for raw OS operations, not protocol logic

This document describes only the host binary itself.
