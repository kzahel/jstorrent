# BitTorrent Engine Architecture Overview

## High-Level Architecture

The `packages/engine` implements a modern, platform-agnostic BitTorrent client in TypeScript. The architecture follows a layered design with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                   Client Layer                          │
│  Client (main entry) + SessionManager (persistence)     │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│                  Torrent Layer                          │
│  Torrent (per-torrent state machine)                    │
└─────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Tracker    │  │     Peer     │  │   Storage    │
│   Layer      │  │   Layer      │  │   Layer      │
└──────────────┘  └──────────────┘  └──────────────┘
```

## Core Components

### 1. **Client Layer**

#### **Client** (`core/client.ts`)
- **Role**: Top-level coordinator and entry point
- **Responsibilities**:
  - Manages multiple torrents
  - Generates/maintains peer ID
  - Listens for incoming peer connections
  - Routes incoming connections to appropriate torrents
- **Key Methods**:
  - `addTorrent(buffer)` - Add from .torrent file
  - `addMagnet(magnetLink)` - Add from magnet link
  - `getTorrent(infoHash)` - Retrieve torrent by hash

#### **SessionManager** (`core/session-manager.ts`)
- **Role**: Persistence and session recovery
- **Responsibilities**:
  - Saves/loads session state (active torrents)
  - Manages torrent resume data
  - Integrates with StorageManager for file locations
- **Key Methods**:
  - `save()` / `load()` - Session persistence
  - `saveTorrentResume()` - Save individual torrent state

### 2. **Torrent Layer**

#### **Torrent** (`core/torrent.ts`)
- **Role**: Per-torrent state machine and coordinator
- **Responsibilities**:
  - Manages all peers for this torrent
  - Coordinates piece downloading strategy
  - Handles tracker announces
  - Supports both metadata phase (magnet) and download phase
- **Key Properties**:
  - `infoHash` - Unique torrent identifier
  - `peers[]` - Connected peer connections
  - `pieceManager` - Piece/block state tracking
  - `contentStorage` - Disk I/O manager
  - `trackerManager` - Tracker communication
  - `bitfield` - Which pieces we have
- **Lifecycle States**:
  - **Metadata Phase**: Fetch info dict from peers (magnet links)
  - **Download Phase**: Download pieces from swarm
  - **Seeding Phase**: Upload to other peers

#### **PieceManager** (`core/piece-manager.ts`)
- **Role**: Tracks piece and block completion state
- **Responsibilities**:
  - Maintains bitfield of completed pieces
  - Tracks individual blocks within pieces
  - Tracks which blocks are requested vs received
  - Validates piece hashes
- **Block Size**: 16KB (standard)
- **Key Methods**:
  - `hasPiece(index)` - Check if piece is complete
  - `getMissingPieces()` - Get pieces we need
  - `needsBlock(index, begin)` - Check if block needed
  - `verifyPiece(index, data)` - Validate piece hash

#### **TorrentContentStorage** (`core/torrent-content-storage.ts`)
- **Role**: Disk I/O abstraction for torrent data
- **Responsibilities**:
  - Maps piece/offset to file paths
  - Handles multi-file torrents
  - Opens/closes file handles on demand
  - Reads/writes piece data
- **Key Methods**:
  - `read(index, begin, length)` - Read piece data
  - `write(index, begin, data)` - Write piece data
  - `open(files, pieceLength)` - Initialize with file layout

### 3. **Peer Layer**

#### **PeerConnection** (`core/peer-connection.ts`)
- **Role**: Per-peer wire protocol handler
- **Responsibilities**:
  - Implements BitTorrent wire protocol (BEP 3)
  - Handles handshake, messages, and extensions
  - Maintains peer state (choking, interested)
  - Supports extended messages (BEP 10)
- **State Tracking**:
  - `peerChoking` / `amChoking` - Choking state
  - `peerInterested` / `amInterested` - Interest state
  - `bitfield` - Pieces peer has
  - `requestsPending` - Outstanding requests
- **Extension Support**:
  - Extended handshake
  - ut_metadata (magnet link metadata exchange)
- **Events**: `handshake`, `message`, `bitfield`, `have`, `piece`, `choke`, `unchoke`, `interested`, `extended`, etc.

#### **WireProtocol** (`protocol/wire-protocol.ts`)
- **Role**: Low-level message encoding/decoding
- **Message Types**: CHOKE, UNCHOKE, INTERESTED, NOT_INTERESTED, HAVE, BITFIELD, REQUEST, PIECE, CANCEL, EXTENDED
- **Static Methods**:
  - `parseHandshake()` - Decode handshake message
  - `createMessage()` - Encode messages
  - `createRequest()` - Create REQUEST message

### 4. **Tracker Layer**

#### **TrackerManager** (`tracker/tracker-manager.ts`)
- **Role**: Multi-tracker coordinator
- **Responsibilities**:
  - Manages HTTP and UDP trackers
  - Deduplicates discovered peers
  - Handles tier-based fallback
- **Events**: `peer` (discovered peer), `error`, `warning`

#### **HttpTracker** (`tracker/http-tracker.ts`)
- **Role**: HTTP/HTTPS tracker implementation (BEP 3)
- **Features**:
  - Compact peer response format
  - Query string building with URL encoding
  - Uses MinimalHttpClient for requests

#### **UdpTracker** (`tracker/udp-tracker.ts`)
- **Role**: UDP tracker implementation (BEP 15)
- **Features**:
  - Connection ID management (60s TTL)
  - Transaction ID matching
  - Binary protocol implementation

### 5. **Storage Layer**

#### **StorageManager** (`io/storage-manager.ts`)
- **Role**: Registry of available storage locations
- **Purpose**: Support multiple storage backends (downloads folder, external drives, etc.)
- **Methods**: `register()`, `get()`, `unregister()`, `getAll()`

#### **IStorageHandle** Interface (`io/storage-handle.ts`)
- **Role**: Abstraction for storage location
- **Properties**:
  - `id` - Unique identifier
  - `name` - Human-readable name
  - `getFileSystem()` - Returns IFileSystem

#### **IFileSystem** Interface (`interfaces/filesystem.ts`)
- **Role**: Platform-agnostic file system operations
- **Methods**: `open()`, `stat()`, `mkdir()`, `exists()`, `readdir()`, `unlink()`
- **Implementations**:
  - `NodeFileSystem` - Node.js fs wrapper
  - `InMemoryFileSystem` - Testing/mock implementation
  - `ScopedNodeFileSystem` - Chrooted filesystem

### 6. **Platform Abstraction (Interfaces)**

#### **ISocketFactory** (`interfaces/socket.ts`)
- **Role**: Creates platform-specific socket implementations
- **Methods**:
  - `createTcpServer()` - Create listening server
  - `createUdpSocket()` - Create UDP socket
  - `wrapTcpSocket()` - Wrap native socket

#### **ITcpSocket** Interface
- Standard methods: `send()`, `onData()`, `onClose()`, `onError()`, `close()`
- Optional: `connect()` - For initiating connections

#### **IUdpSocket** Interface
- Methods: `send()`, `onMessage()`, `close()`

**Implementations**:
- `NodeTcpSocket`, `NodeUdpSocket`, `NodeSocketFactory` - Node.js
- `MemorySocket` - In-memory for testing

### 7. **Utilities**

#### **Bencode** (`utils/bencode.ts`)
- Encodes/decodes bencoded data
- Special method `getRawInfo()` - Extracts raw info dict for hashing

#### **BitField** (`utils/bitfield.ts`)
- Efficient bit array for piece availability
- Methods: `get()`, `set()`, `count()`, `toBuffer()`

#### **TorrentParser** (`core/torrent-parser.ts`)
- Parses .torrent files
- Calculates info hash
- Extracts file layout, piece hashes, announce URLs

#### **TorrentCreator** (`core/torrent-creator.ts`)
- Creates .torrent files from local files/folders
- Calculates piece hashes
- Supports multi-file torrents

#### **MagnetParser** (`utils/magnet.ts`)
- Parses magnet links
- Extracts info hash, trackers, display name

### 8. **Extensions**

#### **PexHandler** (`extensions/pex-handler.ts`)
- Implements Peer Exchange (BEP 11)
- Discovers peers from connected peers
- Reduces tracker load

## Data Flow Examples

### **Adding a Torrent File**
```
Client.addTorrent(buffer)
  → TorrentParser.parse(buffer)
  → Create PieceManager, TorrentContentStorage
  → Create Torrent instance
  → TrackerManager.announce('started')
  → Receive peers from tracker
  → Connect to peers
  → PeerConnection handshake
  → Begin piece download
```

### **Adding a Magnet Link**
```
Client.addMagnet(link)
  → parseMagnet(link) → extract infoHash
  → Create Torrent (no PieceManager yet)
  → TrackerManager.announce('started')
  → Connect to peers
  → PeerConnection: extended handshake
  → Request ut_metadata pieces
  → Reconstruct info dict
  → Verify infoHash
  → Create PieceManager, TorrentContentStorage
  → Begin piece download
```

### **Downloading a Piece**
```
Torrent: Determine needed piece
  → Check PeerConnection.bitfield
  → Find peer with piece
  → PeerConnection.sendRequest(index, begin, length)
  → Peer sends PIECE message
  → PeerConnection emits 'piece' event
  → Torrent receives data
  → TorrentContentStorage.write(index, begin, data)
  → PieceManager.setBlock(index, blockIndex)
  → When piece complete: verify hash
  → If valid: broadcast HAVE to all peers
```

## Current State & Gaps

According to `ENGINE_ANALYSIS.md`, the engine is a **functional skeleton** with critical gaps:

### ✅ **Implemented**
- Core data structures (Client, Torrent, PieceManager, PeerConnection)
- Wire protocol encoding/decoding
- Tracker support (HTTP/UDP)
- File I/O abstraction (not end to end tested)
- Bencode, BitField utilities
- .torrent parsing and creation

### ⚠️ **Partially Implemented**
- Magnet link support (may not be fully implemented)
- Peer management (basic connection, no choking algorithm)
- Piece selection (sequential, not rarest-first)

### ❌ **Missing/Critical Gaps**
1. **TrackerManager integration** - may not be working
2. **ut_metadata extension** - may not be seeding ut_metadata
3. **Choking algorithm** - No tit-for-tat
4. **Rarest-first piece selection** - Sequential only
5. **End-game mode** - Not implemented
6. **PEX** - Stub only
7. **Resume/recheck** - Incomplete

## Design Patterns

- **Event-Driven Architecture**: Heavy use of EventEmitter for decoupling
- **Dependency Injection**: Interfaces for sockets, filesystem, trackers
- **Strategy Pattern**: Platform-specific implementations via interfaces
- **State Machine**: Torrent lifecycle (metadata → download → seed)
- **Observer Pattern**: Event emission for peer discovery, piece completion

## Cross-Platform Support

This architecture enables cross-platform support (Node.js, browser extension, potentially mobile) through abstraction layers while maintaining a clean separation between protocol logic and platform-specific I/O.

The key abstractions are:
- **IFileSystem** / **IStorageHandle** - Platform-agnostic file operations
- **ISocketFactory** / **ITcpSocket** / **IUdpSocket** - Platform-agnostic networking
- **ITracker** - Tracker implementation interface

This allows the same core engine code to run on:
- Node.js (using `NodeFileSystem`, `NodeTcpSocket`)
- Browser Extension (using Chrome FileSystem API wrappers, chrome.sockets API)
- In-memory testing (using `InMemoryFileSystem`, `MemorySocket`)

## File Structure

```
packages/engine/src/
├── core/                    # Core BitTorrent logic
│   ├── client.ts           # Main client entry point
│   ├── torrent.ts          # Per-torrent state machine
│   ├── peer-connection.ts  # Peer wire protocol handler
│   ├── piece-manager.ts    # Piece/block state tracking
│   ├── torrent-content-storage.ts  # Disk I/O manager
│   ├── session-manager.ts  # Session persistence
│   ├── torrent-parser.ts   # .torrent file parser
│   ├── torrent-creator.ts  # .torrent file creator
│   ├── torrent-file.ts     # File metadata interface
│   └── torrent-file-info.ts # File info wrapper
├── protocol/               # Wire protocol implementation
│   └── wire-protocol.ts    # Message encoding/decoding
├── tracker/                # Tracker implementations
│   ├── tracker-manager.ts  # Multi-tracker coordinator
│   ├── http-tracker.ts     # HTTP/HTTPS tracker
│   └── udp-tracker.ts      # UDP tracker
├── io/                     # Storage abstraction
│   ├── storage-handle.ts   # Storage location interface
│   ├── storage-manager.ts  # Storage registry
│   ├── filesystem-storage-handle.ts
│   ├── node/               # Node.js implementations
│   │   ├── node-filesystem.ts
│   │   ├── node-socket.ts
│   │   └── node-storage-handle.ts
│   └── memory/             # In-memory testing implementations
│       ├── memory-filesystem.ts
│       └── memory-socket.ts
├── interfaces/             # Platform abstraction interfaces
│   ├── filesystem.ts       # IFileSystem, IFileHandle
│   ├── socket.ts           # ISocketFactory, ITcpSocket, IUdpSocket
│   └── tracker.ts          # ITracker, PeerInfo
├── utils/                  # Utilities
│   ├── bencode.ts          # Bencode encoder/decoder
│   ├── bitfield.ts         # Bit array implementation
│   ├── hash.ts             # Hashing utilities
│   ├── infohash.ts         # InfoHash utilities
│   ├── magnet.ts           # Magnet link parser
│   └── minimal-http-client.ts
└── extensions/             # Protocol extensions
    └── pex-handler.ts      # Peer Exchange (BEP 11)
```

## Key Dependencies

From `package.json`:
- **TypeScript 5.0+** - Language and type system
- **Vitest** - Testing framework
- **Node.js 20+** - Runtime (for Node.js implementation)
- **bittorrent-tracker** (dev) - For integration testing

## Testing Strategy

The engine includes several test categories:

1. **Unit Tests** (`test/core/`, `test/utils/`, `test/protocol/`)
   - Test individual components in isolation
   - Use mock implementations (MemorySocket, InMemoryFileSystem)

2. **Integration Tests** (`test/integration/`)
   - `memory-swarm.spec.ts` - Two clients in same process
   - `tracker-announce.spec.ts` - Real tracker communication
   - `node-download.spec.ts` - Full download scenario

3. **Test Utilities** (`test/mocks/`)
   - Mock socket implementations
   - Mock filesystem implementations
   - Test fixtures

## Future Architectural Considerations

### Performance Optimizations
- **Piece caching** - Keep hot pieces in memory
- **Parallel piece verification** - Use worker threads
- **Disk I/O batching** - Reduce syscalls

### Scalability
- **Connection pooling** - Limit total connections across torrents
- **Bandwidth management** - Global rate limiting
- **Memory management** - Limit buffer sizes, implement backpressure

### Additional Features
- **DHT support** (BEP 5) - Trackerless peer discovery
- **µTP support** (BEP 29) - UDP-based transport
- **Encryption** (BEP 3, MSE) - Protocol encryption
- **Super-seeding** - Optimized initial seeding
- **Web seeding** (BEP 19) - HTTP fallback sources

---

*Document generated: November 26, 2025*
*Based on codebase analysis of packages/engine*
