# Implementation Plan - Core Torrent Engine Extraction

## Goal Description
Extract the core BitTorrent engine logic from the legacy JSTorrent codebase into a new, modern, platform-agnostic TypeScript library (`@jstorrent/engine`). The engine will be decoupled from specific runtime environments via abstract `ISocket` and `IFileSystem` interfaces, allowing it to run in Node.js, Browsers, and Electron.

## User Review Required
> [!IMPORTANT]
> This plan focuses on **Phase 1 (Foundation)** and **Phase 2 (Wire Protocol)** of the refactoring plan. We will establish the package structure, core interfaces, and implement the first pure logic components with robust tests.

## Proposed Changes

### Package Structure
We will create a new package `packages/engine`.

#### [NEW] `packages/engine/package.json`
- Define package metadata.
- **Dependencies**: Use `pnpm` workspace features.
- **Scripts**: `build`, `test`, `lint` (delegating to root or local configs as appropriate).

#### [NEW] `packages/engine/tsconfig.json`
- Extend the root `tsconfig.json` to inherit strict settings.
- ```json
  {
    "extends": "../../tsconfig.json",
    "compilerOptions": {
      "outDir": "./dist",
      "rootDir": "./src"
    },
    "include": ["src"]
  }
  ```

#### Linting
- Leverage the root `eslint.config.js`. No separate config needed unless specific overrides are required.

### Core Interfaces
Define the boundaries for I/O.

#### [NEW] `packages/engine/src/interfaces/socket.ts`
- `ISocket`, `ITcpSocket`, `IUdpSocket` interfaces.
- **Alignment**: These should be compatible with the existing `ITcpSocket` and `IUdpSocket` in `extension/src/lib/sockets.ts`.
- **Goal**: The engine will use these interfaces. The `extension` will eventually implement these interfaces using its `Sockets` class (which wraps the daemon connection).
- **Refinement**: We will add `connect` method to `ITcpSocket` to allow the engine to initiate connections, whereas the current extension interface assumes the factory creates a connected socket.

#### [NEW] `packages/engine/src/interfaces/filesystem.ts`
- `IFileSystem`, `IFileHandle`, `IFileStat` interfaces.

### Foundation & Utilities
Port essential data structures.

#### [NEW] `packages/engine/src/utils/bitfield.ts`
- `BitField` class for managing piece availability.
- Methods: `get`, `set`, `hasAll`, `hasNone`, `buffer`.

#### [NEW] `packages/engine/test/utils/bitfield.spec.ts`
- Unit tests for `BitField`.

### Wire Protocol
Implement the peer wire protocol parser/serializer.

#### [NEW] `packages/engine/src/protocol/wire-protocol.ts`
- `PeerWireProtocol` class.
- Methods to parse raw buffers into message objects.
- Methods to serialize message objects into buffers.
- Stateless and synchronous.

#### [NEW] `packages/engine/test/protocol/wire-protocol.spec.ts`
- Unit tests for message parsing and serialization.

## Verification Plan

### Automated Tests
We will use **Vitest** for fast, headless unit testing in Node.js.

1.  **Run all tests**:
    ```bash
    cd packages/engine
    npm test
    ```

2.  **BitField Tests**:
    - Verify setting/getting bits.
    - Verify buffer synchronization.
    - Verify hex output.

3.  **Wire Protocol Tests**:
    - Verify handshake parsing/serialization.
    - Verify standard messages (choke, unchoke, interested, not interested, have, bitfield, request, piece, cancel).
    - Verify edge cases (partial messages, buffer concatenation).

## Phase 2: Peer Connection & Piece Management

### Goal
Implement the core logic for managing a connection with a peer (`PeerConnection`) and tracking the state of pieces (`PieceManager`).

### Proposed Changes

#### [NEW] `packages/engine/src/core/peer-connection.ts`
- `PeerConnection` class.
- **Dependencies**: `ISocket`, `PeerWireProtocol`, `BitField`.
- **Responsibilities**:
    - Manage the socket lifecycle (connect, close, error).
    - Handle the handshake.
    - Process incoming messages using `PeerWireProtocol`.
    - Maintain state (choked, interested, peerChoked, peerInterested).
    - Emit events (handshake, message, close).

#### [NEW] `packages/engine/test/core/peer-connection.spec.ts`
- Unit tests using a mock `ISocket`.
- Verify handshake flow.
- Verify state updates on choke/unchoke messages.

#### [NEW] `packages/engine/src/core/piece-manager.ts`
- `PieceManager` class.
- **Dependencies**: `BitField`.
- **Responsibilities**:
    - Track which pieces we have and which we need.
    - Select pieces to request (rarest first - simple version first).
    - Mark pieces as complete/verified.

#### [NEW] `packages/engine/test/core/piece-manager.spec.ts`
- Unit tests for piece tracking.

## Phase 3: Disk Manager & Torrent Orchestration

### Goal
Implement the storage layer (`DiskManager`) and the central coordinator (`Torrent`).

### Proposed Changes

#### [NEW] `packages/engine/src/core/disk-manager.ts`
- `DiskManager` class.
- **Dependencies**: `IFileSystem`.
- **Responsibilities**:
    - Manages the mapping of torrent pieces to actual files on disk.
    - Supports multi-file torrents where pieces may span across file boundaries.
    - Handles different download roots (e.g., USB drives vs internal storage).
    - **Methods**:
        - `open(files: TorrentFile[])`: Initialize with list of files and their lengths.
        - `write(index: number, begin: number, data: Uint8Array)`: Write a block to the appropriate file(s).
        - `read(index: number, begin: number, length: number)`: Read a block from the appropriate file(s).
        - `close()`: Close all open file handles.

#### [NEW] `packages/engine/src/core/torrent-file.ts`
- `TorrentFile` interface/class.
- Properties: `path`, `length`, `offset` (start byte in the torrent).

#### [NEW] `packages/engine/test/mocks/memory-filesystem.ts`
- `MemoryFileSystem` implementation of `IFileSystem` for testing.

#### [NEW] `packages/engine/test/core/disk-manager.spec.ts`
- Unit tests using `MemoryFileSystem`.

#### [NEW] `packages/engine/src/core/torrent.ts`
- `Torrent` class.
- **Dependencies**: `PeerConnection`, `PieceManager`, `DiskManager`, `BitField`.
- **Responsibilities**:
    - Initialize components.
    - Manage list of peers.
    - Handle peer events (e.g., when a peer sends a piece, write to disk, update manager).
    - Handle peer requests (read from disk, send piece).
    - Simple "endgame" or "rarest-first" logic (basic version).

#### [NEW] `packages/engine/test/core/torrent.spec.ts`
- Integration-like unit tests.
- Simulate a peer sending a piece and verify it gets written to disk.

## Verification Plan

### Automated Tests
1.  **DiskManager Tests**:
    - Write data to a "piece" and read it back.
    - Verify offsets are calculated correctly (if implementing multi-file).

2.  **Torrent Tests**:
    - Create a `Torrent` with a mock peer.
    - Simulate handshake.
    - Simulate receiving a `PIECE` message.
    - Verify `PieceManager` is updated.
    - Verify `DiskManager` write is called.

## Phase 4: Node.js Adapters & Integration

### Goal
Implement real Node.js adapters for `ISocket` and `IFileSystem` to verify the engine can run in a real Node.js environment.

### Proposed Changes

#### [NEW] `packages/engine/src/io/node/node-socket.ts`
- `NodeTcpSocket` implements `ITcpSocket`.
- Uses Node's `net` module.
- `NodeSocketFactory` implements `ISocketFactory`.

#### [NEW] `packages/engine/src/io/node/node-filesystem.ts`
- `NodeFileSystem` implements `IFileSystem`.
- Uses Node's `fs/promises` module.
- `NodeFileHandle` implements `IFileHandle`.

#### [NEW] `packages/engine/test/integration/node-download.spec.ts`
- Real integration test.
- Start a mock TCP peer server (using `net.createServer`).
- Initialize `Torrent` with `NodeSocketFactory` and `NodeFileSystem`.
- Connect to the mock peer.
- Verify handshake and data transfer.
- Verify file is written to disk (in a temp dir).

## Verification Plan

### Automated Tests
1.  **NodeSocket Tests**:
    - Connect to a local echo server.
    - Send/Receive data.

2.  **NodeFileSystem Tests**:
    - Create/Write/Read files in a temp directory.

3.  **Full Integration**:
    - The `node-download.spec.ts` will serve as the proof of concept.


    - The `node-download.spec.ts` will serve as the proof of concept.

## Phase 5: Trackers & Peer Exchange (PEX)

### Goal
Implement peer discovery mechanisms via HTTP/UDP Trackers and Peer Exchange (PEX).

### Proposed Changes

#### [NEW] `packages/engine/src/interfaces/tracker.ts`
- `ITracker` interface.
- Methods: `announce(event: 'started' | 'stopped' | 'completed' | 'update')`.
- Events: `peer` (when new peers are found).

#### [NEW] `packages/engine/src/tracker/http-tracker.ts`
- `HttpTracker` class implements `ITracker`.
- Handles HTTP GET requests to tracker announce URLs.
- Parses compact and non-compact responses.

#### [NEW] `packages/engine/src/tracker/udp-tracker.ts`
- `UdpTracker` class implements `ITracker`.
- Implements BEP 15 (UDP Tracker Protocol).
- Connect, Announce, Scrape.
- Requires `IUdpSocket` (which needs Node.js adapter).

#### [NEW] `packages/engine/src/tracker/tracker-manager.ts`
- Manages multiple trackers (BEP 12).
- Aggregates peers found from all trackers.

#### [NEW] `packages/engine/src/protocol/pex.ts`
- PEX logic (BEP 11).
- Parsing/Serializing PEX messages (Extension Protocol).
- `PexHandler` class to manage peer lists exchanged via PEX.

#### [MODIFY] `packages/engine/src/protocol/wire-protocol.ts`
- Add support for Extension Protocol handshake (BEP 10).
- Add support for Extended Messages (ID 20).

#### [MODIFY] `packages/engine/src/core/peer-connection.ts`
- Handle Extended Handshake.
- Handle PEX messages.

## Verification Plan

### Automated Tests
1.  **Tracker Tests**:
    - Mock HTTP server to verify `HttpTracker` announce.
    - Mock UDP server to verify `UdpTracker` announce.

2.  **PEX Tests**:
    - Verify PEX message parsing/serialization.
    - Simulate PEX exchange between two peers.

## Phase 6: Client & Session Management

### Goal
Implement the high-level `Client` class and session management to orchestrate multiple torrents and handle persistence.

### Proposed Changes

#### [NEW] `packages/engine/src/core/client.ts`
- `Client` class.
- **Responsibilities**:
    - Entry point for the engine.
    - Manages a list of `Torrent` instances.
    - Handles global settings (download limits, ports).
    - Emits global events.

#### [NEW] `packages/engine/src/core/session-manager.ts`
- `SessionManager` class.
- **Responsibilities**:
    - Load/Save session state (list of torrents, progress).
    - Auto-resume torrents on startup.

#### [NEW] `packages/engine/test/core/client.spec.ts`
- Unit tests for `Client`.

## Verification Plan

### Automated Tests
1.  **Client Tests**:
    - Add/Remove torrents.
    - Verify global limits (if implemented).
2.  **Session Tests**:
    - Save session state to disk (mocked).
    - Load session state and verify torrents are restored.
