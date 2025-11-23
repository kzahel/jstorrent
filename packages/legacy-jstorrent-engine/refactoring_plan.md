# JSTorrent Refactoring Plan

## Objective
Rewrite the legacy JSTorrent core into a modern, platform-agnostic TypeScript library (`@jstorrent/engine`). The new engine will be decoupled from specific runtime environments (Chrome Apps, Node.js) via abstract I/O interfaces, allowing it to run anywhere (Browser, Node, Electron, etc.).

## 1. Project Structure (Monorepo)

We will organize the repository into a monorepo structure to keep the legacy reference code close to the new implementation.

```text
/
├── legacy-jstorrent-engine/    # The original JS code (moved from current js/ folder)
├── packages/
│   ├── engine/                 # The new pure TypeScript implementation
│   │   ├── src/
│   │   │   ├── interfaces/     # ISocket, IFileSystem, etc.
│   │   │   ├── core/           # Torrent, Piece, Peer classes
│   │   │   ├── protocol/       # Wire protocol parsing/serialization
│   │   │   └── utils/          # BitField, hashing, etc.
│   │   ├── test/               # Unit and integration tests
│   │   └── index.ts
│   ├── io-node/                # Node.js implementations of ISocket/IFileSystem
│   └── io-browser/             # Browser implementations (WebSocket/WebRTC/OPFS)
└── package.json
```

## 2. Core Interfaces (The "Ports")

The most critical step is defining the boundaries. The engine should not know *how* it reads a file or opens a socket.

*   **`ISocket`**: Abstracts TCP/UDP sockets.
    *   Methods: `connect`, `write`, `close`, `on('data')`, `on('error')`.
    *   Implementations: `NodeSocket` (net module), `ChromeSocket` (chrome.sockets), `ProxySocket` (over WebSocket).
*   **`IFileSystem`**: Abstracts file storage.
    *   Methods: `open`, `read`, `write`, `close`, `stat`.
    *   Implementations: `NodeFS` (fs module), `OPFS` (Origin Private File System), `MemoryFS` (for testing).

*(See `interfaces_draft.md` for detailed definitions)*

## 3. Implementation Phases

### Phase 1: Foundation & Utilities
*   Set up TypeScript build system (tsup/vite).
*   Implement core data structures:
    *   `BitField`: Bit manipulation logic.
    *   `BufferUtils`: Unified buffer handling (Uint8Array vs Buffer).
    *   `BEncoding`: Modern parser/serializer for bencode.

### Phase 2: The Wire Protocol
*   Implement `PeerWireProtocol` class.
    *   Pure logic class: Takes a buffer, returns parsed messages. Takes a message object, returns a buffer.
    *   Stateless and easy to test.
*   Implement `PeerConnection` (The Controller).
    *   Uses `ISocket`.
    *   Manages handshake, choking state, and message flow.

### Phase 3: Piece & Data Management
*   Implement `PieceManager`.
    *   Logic for tracking missing blocks.
    *   Endgame mode logic (referencing legacy `torrent.js`).
*   Implement `DiskManager`.
    *   Uses `IFileSystem`.
    *   Manages the read/write queue (modernizing `diskio.js`).

### Phase 4: Torrent & Session
*   Implement `Torrent`.
    *   The state machine (hashing, downloading, seeding).
    *   Orchestrates Peers and Pieces.
*   Implement `Client` / `Session`.
    *   Manages multiple torrents.
    *   Global settings (download limits, etc.).

## 4. Testing Strategy

*   **Unit Tests**: Test individual classes (`BitField`, `BEncode`) in isolation using Vitest/Jest.
*   **Mocked Integration**: Use `MemoryFS` and `MockSocket` to test a full download cycle in memory without touching the network or disk.
*   **Legacy Comparison**: Create tests that feed the same inputs (e.g., a specific sequence of peer messages) to both the legacy engine and the new engine to verify identical behavior.
*   **Proxy Bridge**: As requested, use a "Proxy I/O" implementation to run the engine in Node.js but have it drive a remote process (or the legacy Chrome App) to verify real-world connectivity.

## 5. Migration Checklist

- [ ] Create `legacy-jstorrent-engine` folder and move existing `js/` files.
- [ ] Initialize `packages/engine` with TypeScript configuration.
- [ ] Define `ISocket` and `IFileSystem` interfaces.
- [ ] Port `bencode.js` -> `packages/engine/src/utils/bencode.ts`.
- [ ] Port `bitfield` logic.
- [ ] Implement `PeerConnection` using `ISocket`.
- [ ] Implement `Torrent` logic using `IFileSystem`.
