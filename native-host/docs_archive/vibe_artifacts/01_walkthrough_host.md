# JSTorrent Native Host Walkthrough

I have implemented the JSTorrent Native Messaging Host in Rust. This binary acts as a safe, minimal syscall proxy for the Chrome extension.

## Features Implemented

### 1. Native Messaging Protocol

- **Framing**: Implemented 4-byte length-prefixed JSON messaging in `src/ipc.rs`.
- **Protocol**: Defined all request/response/event types in `src/protocol.rs`.
- **Event Loop**: Implemented a non-blocking event loop in `src/main.rs` using `tokio::select!` to handle incoming requests and outgoing events concurrently.

### 2. TCP & UDP Operations

- **TCP**: `openTcp`, `writeTcp`, `closeTcp` implemented in `src/tcp.rs`. Incoming data is streamed as `tcpData` events.
- **UDP**: `openUdp`, `sendUdp`, `closeUdp` implemented in `src/udp.rs`. Incoming packets are streamed as `udpData` events.

### 3. File System Safety

- **Confinement**: Implemented strict path validation in `src/path_safety.rs`. All file operations are confined to the configured download root.
- **Canonicalization**: Paths are canonicalized to resolve symlinks and `..` traversal attempts.
- **SetDownloadRoot**: Added a `setDownloadRoot` operation to allow the extension (or user via `pickDownloadDirectory`) to set the root.

### 4. File Operations

- **Basic I/O**: `ensureDir`, `readFile`, `writeFile`, `statFile` implemented in `src/fs.rs`.
- **Atomic Move**: `atomicMove` implemented in `src/atomic_move.rs` using platform-native atomic rename.
- **Folder Picker**: `pickDownloadDirectory` implemented in `src/folder_picker.rs` using the `rfd` crate (requires GTK on Linux).

### 5. Hashing

- **SHA1**: `hashSha1` and `hashFile` implemented in `src/hashing.rs` for efficient hashing.

## Verification

### Unit Tests

- **IPC**: Verified message framing and JSON serialization.
- **Path Safety**: Verified that paths outside the root are rejected and `..` traversal is correctly handled.

### Integration Tests

I created a Python script `verify_host.py` that tests the compiled binary end-to-end:

- **Handshake**: Successfully sets the download root.
- **File I/O**: Verifies `ensureDir`, `writeFile`, `readFile`, `statFile`.
- **Atomic Move**: Verifies file renaming.
- **Hashing**: Verifies SHA1 hashing correctness.
- **TCP Echo**: Spawns a real TCP server and verifies the host can connect, send, and receive data.

All tests passed successfully.

## Usage

To use the host, you need to register it with Chrome using a manifest file. The binary is located at `target/debug/jstorrent-host`.
