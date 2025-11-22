# Implementation Plan - JSTorrent Native Host

This plan outlines the development of the `jstorrent-host` binary, a minimal, safe syscall proxy for the JSTorrent Chrome extension.

## User Review Required

> [!IMPORTANT]
> This implementation assumes a fresh Rust project. I will initialize it with `cargo init`.

## Proposed Changes

### Project Structure

I will initialize a new Rust project and structure it as follows:

```
src/
  main.rs            // Entry point, event loop
  ipc.rs             // Message framing (length-prefixed JSON)
  protocol.rs        // Serde structs for Requests, Responses, Events
  state.rs           // Resource management (Socket maps, etc.)
  tcp.rs             // TCP implementation
  udp.rs             // UDP implementation
  fs.rs              // File I/O implementation
  path_safety.rs     // Path canonicalization and confinement
  atomic_move.rs     // Atomic file move
  folder_picker.rs   // Native folder picker (using `rfd` or similar)
  hashing.rs         // SHA1 hashing
```

### Dependencies

I will add the following dependencies to `Cargo.toml`:

- `tokio` (full features) - Async runtime
- `serde`, `serde_json` - JSON handling
- `byteorder` - Endianness for framing
- `thiserror`, `anyhow` - Error handling
- `rfd` - Native dialogs (Folder picker)
- `sha1` - Hashing
- `base64` - Binary data encoding

### Component Details

#### [NEW] [main.rs](file:///home/kgraehl/code/jstorrent-host/src/main.rs)
- Sets up the Tokio runtime.
- Reads from `stdin` in a loop using `ipc::read_message`.
- Dispatches requests to appropriate handlers.
- Writes responses/events to `stdout` using `ipc::write_message`.

#### [NEW] [ipc.rs](file:///home/kgraehl/code/jstorrent-host/src/ipc.rs)
- `read_message`: Reads 4 bytes length, then reads N bytes, decodes JSON.
- `write_message`: Encodes JSON, writes 4 bytes length, then bytes.

#### [NEW] [protocol.rs](file:///home/kgraehl/code/jstorrent-host/src/protocol.rs)
- Defines `Request`, `Response`, `Event` enums/structs.

#### [NEW] [path_safety.rs](file:///home/kgraehl/code/jstorrent-host/src/path_safety.rs)
- Implements `validate_path(path, root)` to ensure `path` is within `root`.

#### [NEW] [tcp.rs](file:///home/kgraehl/code/jstorrent-host/src/tcp.rs) / [udp.rs](file:///home/kgraehl/code/jstorrent-host/src/udp.rs)
- Manages `TcpStream` / `UdpSocket` instances.
- Spawns read tasks that emit events back to the main loop via a channel.

## Verification Plan

### Automated Tests
- **Unit Tests**: I will write unit tests for:
    - `ipc.rs`: Verify framing logic.
    - `path_safety.rs`: Verify confinement (e.g., `..` traversal attempts).
    - `protocol.rs`: Verify JSON serialization/deserialization.
- **Integration Test Script**: I will create a Python script `verify_host.py` that:
    - Spawns the host binary.
    - Sends handshake/requests via stdin.
    - Asserts on responses from stdout.
    - Tests TCP echo by spawning a local TCP server and having the host connect to it.

### Manual Verification
- Run `cargo run` and manually pipe JSON to it to see if it responds (basic sanity check).
