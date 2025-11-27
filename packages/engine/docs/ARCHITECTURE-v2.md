# JSTorrent Engine Architecture v2

## Overview

The JSTorrent engine (`@jstorrent/engine`) is a platform-agnostic BitTorrent client core. It handles the BitTorrent protocol, piece management, and peer connections while delegating platform-specific concerns (filesystem, sockets, session persistence) to adapters.

## Design Principles

1. **Core is platform-agnostic** - No Node.js, browser, or daemon dependencies in core
2. **Adapters are separate** - Platform-specific code lives in `/adapters/*`
3. **Presets wire it together** - Convenience functions that assemble adapters for common scenarios
4. **Extension provides minimal glue** - Just config, not wiring

## Package Structure

```
@jstorrent/engine
├── src/
│   ├── core/                    # Platform-agnostic engine
│   │   ├── bt-engine.ts         # Main entry point
│   │   ├── torrent.ts           # Per-torrent state machine
│   │   ├── peer-connection.ts   # Wire protocol handler
│   │   ├── piece-manager.ts     # Block/piece tracking
│   │   └── torrent-content-storage.ts
│   │
│   ├── interfaces/              # Abstract contracts
│   │   ├── filesystem.ts        # IFileSystem, IFileHandle
│   │   ├── socket.ts            # ISocketFactory, ITcpSocket, IUdpSocket
│   │   └── session-store.ts     # ISessionStore
│   │
│   ├── storage/
│   │   └── storage-root-manager.ts  # Manages download locations
│   │
│   ├── protocol/                # BitTorrent protocol implementation
│   │   ├── wire-protocol.ts     # Message parsing/creation
│   │   ├── bencode.ts           # Bencoding
│   │   └── metadata-exchange.ts # BEP 9/10
│   │
│   ├── tracker/
│   │   ├── tracker-manager.ts
│   │   ├── http-tracker.ts
│   │   └── udp-tracker.ts
│   │
│   ├── logging/
│   │   ├── logger.ts            # EngineComponent, scoped logging
│   │   └── ring-buffer-logger.ts
│   │
│   └── index.ts                 # Core exports only
│
├── adapters/
│   ├── daemon/                  # io-daemon integration
│   │   ├── daemon-connection.ts
│   │   ├── daemon-filesystem.ts
│   │   ├── daemon-socket-factory.ts
│   │   └── index.ts
│   │
│   ├── node/                    # Node.js native
│   │   ├── node-filesystem.ts
│   │   ├── node-socket-factory.ts
│   │   └── index.ts
│   │
│   ├── memory/                  # Testing
│   │   ├── in-memory-filesystem.ts
│   │   ├── memory-socket-factory.ts
│   │   ├── memory-session-store.ts
│   │   └── index.ts
│   │
│   └── browser/                 # Browser APIs
│       ├── opfs-filesystem.ts
│       ├── indexeddb-session-store.ts
│       ├── chrome-storage-session-store.ts
│       └── index.ts
│
├── presets/
│   ├── daemon.ts                # createDaemonEngine()
│   ├── daemon-opfs.ts           # createDaemonWithOPFSEngine()
│   ├── node.ts                  # createNodeEngine()
│   └── memory.ts                # createMemoryEngine()
│
└── node-rpc/                    # HTTP RPC server (for testing)
    ├── server.ts
    └── controller.ts
```

## Core Interfaces

### IFileSystem

```typescript
interface IFileSystem {
  open(path: string, mode: 'r' | 'w' | 'r+'): Promise<IFileHandle>
  stat(path: string): Promise<IFileStat>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  exists(path: string): Promise<boolean>
  readdir(path: string): Promise<string[]>
  unlink(path: string): Promise<void>
}

interface IFileHandle {
  read(buffer: Uint8Array, offset: number): Promise<number>
  write(buffer: Uint8Array, offset: number): Promise<number>
  truncate(length: number): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

interface IFileStat {
  size: number
  isFile: boolean
  isDirectory: boolean
}
```

### ISocketFactory

```typescript
interface ISocketFactory {
  createTcpSocket(): ITcpSocket
  createTcpServer(port: number): Promise<ITcpServer>
  createUdpSocket(): IUdpSocket
}

interface ITcpSocket {
  connect(host: string, port: number): Promise<void>
  send(data: Uint8Array): Promise<void>
  onData(callback: (data: Uint8Array) => void): void
  onClose(callback: () => void): void
  onError(callback: (error: Error) => void): void
  close(): void
  
  readonly remoteAddress?: string
  readonly remotePort?: number
}

interface ITcpServer {
  onConnection(callback: (socket: ITcpSocket) => void): void
  close(): void
  readonly port: number
}

interface IUdpSocket {
  bind(port: number): Promise<void>
  send(data: Uint8Array, host: string, port: number): Promise<void>
  onMessage(callback: (data: Uint8Array, rinfo: { address: string, port: number }) => void): void
  close(): void
}
```

### ISessionStore

For persisting resume data (bitfields, progress, peer cache).

```typescript
interface ISessionStore {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  clear(): Promise<void>
}
```

Key naming convention:
- `torrent:{infohash}:bitfield` - Piece completion bitmap
- `torrent:{infohash}:metadata` - Torrent file/magnet metadata
- `torrent:{infohash}:progress` - Download stats, timestamps
- `torrent:{infohash}:peers` - Cached peer list with last-seen times

## StorageRootManager

Manages multiple download locations. Each location is identified by an opaque token (provided by native-host for daemon roots).

```typescript
interface StorageRoot {
  token: string      // Opaque identifier
  label: string      // Human-readable: "Downloads", "External SSD"
  path: string       // Full path (for UI display only)
}

class StorageRootManager {
  private roots: Map<string, StorageRoot>
  private torrentRoots: Map<string, string>  // infohash -> token
  private defaultToken: string | null
  private createFileSystem: (token: string) => IFileSystem
  private fsCache: Map<string, IFileSystem>
  
  constructor(createFs: (token: string) => IFileSystem)
  
  // Root management
  addRoot(root: StorageRoot): void
  removeRoot(token: string): void
  getRoots(): StorageRoot[]
  setDefaultRoot(token: string): void
  
  // Torrent assignment
  setRootForTorrent(torrentId: string, token: string): void
  getRootForTorrent(torrentId: string): StorageRoot | null
  
  // Internal - used by engine
  getFileSystemForTorrent(torrentId: string): IFileSystem
  
  // Normalization (lowercase hex)
  private normalizeId(id: string): string
}
```

## Three Storage Concerns

The architecture separates three distinct storage needs:

### 1. Content Storage (Torrent Data)

Where downloaded files (movies, documents, etc.) are saved.

- **User controls**: Picks location per-torrent or uses default
- **Multiple roots**: Downloads folder, external drives, etc.
- **Identified by**: Opaque tokens (daemon) or paths (node)
- **Managed by**: StorageRootManager
- **Implementations**: DaemonFileSystem, NodeFileSystem, OPFSFileSystem, InMemoryFileSystem

### 2. Session Storage (Resume Data)

Bitfields, progress, peer cache - data needed to resume after restart.

- **Engine controls**: User doesn't pick location
- **Single location**: One store per engine instance
- **Lives in**: Extension context (chrome.storage, IndexedDB, OPFS)
- **Managed by**: ISessionStore implementation
- **Implementations**: IndexedDBSessionStore, ChromeStorageSessionStore, MemorySessionStore

### 3. RPC Info (Native Host Config)

Daemon port, auth token, known storage roots.

- **Native host controls**: Writes rpc-info.json
- **Extension reads**: On startup
- **Not engine's concern**: Extension passes relevant parts to engine

## Presets

### createDaemonEngine

Full daemon mode - sockets and content via io-daemon, session in extension-provided store.

```typescript
interface DaemonEngineConfig {
  daemon: {
    port: number
    authToken: string
  }
  contentRoots: StorageRoot[]
  defaultContentRoot?: string  // Token, optional
  sessionStore: ISessionStore
  onLog?: (entry: LogEntry) => void
  maxConnections?: number
  port?: number  // Listen port for incoming connections
}

async function createDaemonEngine(config: DaemonEngineConfig): Promise<BtEngine>
```

### createDaemonWithOPFSEngine

Daemon for sockets only, OPFS for content and session. Good for streaming/ephemeral use.

```typescript
interface DaemonOPFSEngineConfig {
  daemon: {
    port: number
    authToken: string
  }
  sessionStore?: ISessionStore  // Defaults to OPFS-based
  onLog?: (entry: LogEntry) => void
}

async function createDaemonWithOPFSEngine(config: DaemonOPFSEngineConfig): Promise<BtEngine>
```

### createNodeEngine

For Node.js environments - Python integration tests, CLI tools.

```typescript
interface NodeEngineConfig {
  downloadPath: string
  sessionStore?: ISessionStore  // Defaults to in-memory
  port?: number
  onLog?: (entry: LogEntry) => void
}

function createNodeEngine(config: NodeEngineConfig): BtEngine
```

### createMemoryEngine

Pure in-memory for unit tests.

```typescript
interface MemoryEngineConfig {
  sessionStore?: ISessionStore
  onLog?: (entry: LogEntry) => void
}

function createMemoryEngine(config?: MemoryEngineConfig): BtEngine
```

## Extension Integration

### Startup Flow

```typescript
// extension/src/lib/client.ts

import { createDaemonEngine } from '@jstorrent/engine/presets/daemon'
import { IndexedDBSessionStore } from '@jstorrent/engine/adapters/browser'

class Client extends EventEmitter {
  engine: BtEngine | null = null
  
  async init() {
    // 1. Get daemon info from native host
    const rpcInfo = await this.nativeHost.getRpcInfo()
    
    // 2. Get user preferences
    const prefs = await chrome.storage.local.get(['defaultContentRoot'])
    
    // 3. Create session store
    const sessionStore = new IndexedDBSessionStore('jstorrent-session')
    
    // 4. Create engine
    this.engine = await createDaemonEngine({
      daemon: {
        port: rpcInfo.port,
        authToken: rpcInfo.authToken
      },
      contentRoots: rpcInfo.roots,
      defaultContentRoot: prefs.defaultContentRoot,
      sessionStore,
      onLog: (entry) => this.emit('log', entry)
    })
    
    // 5. Restore incomplete torrents
    await this.engine.restoreSession()
  }
}
```

### Adding a Torrent

```typescript
async addTorrent(magnetOrBuffer: string | Uint8Array, rootToken?: string) {
  const torrent = await this.engine.addTorrent(magnetOrBuffer)
  
  if (rootToken) {
    this.engine.storageRootManager.setRootForTorrent(torrent.id, rootToken)
  }
  // If no rootToken and no default, torrent waits for assignment
  
  return torrent
}
```

### Adding a New Download Location

```typescript
async pickNewRoot(): Promise<StorageRoot> {
  // Native host shows OS folder picker, returns new root
  const root = await this.nativeHost.showFolderPicker()
  
  // Register with engine
  this.engine.storageRootManager.addRoot(root)
  
  return root
}
```

## InfoHash Normalization

To avoid bugs from inconsistent casing, all infohash/torrentId values are normalized to lowercase hex internally.

```typescript
// In StorageRootManager and anywhere else that indexes by infohash
private normalizeId(id: string): string {
  return id.toLowerCase()
}
```

Consider using branded types at API boundaries:

```typescript
type InfoHash = string & { __brand: 'InfoHash' }

function normalizeInfoHash(hash: string): InfoHash {
  return hash.toLowerCase() as InfoHash
}
```

## Logging

The engine uses scoped, filterable logging via EngineComponent base class.

```typescript
// Component-scoped logging
class Torrent extends EngineComponent {
  static logName = 'torrent'
  
  constructor(engine: BtEngine, infoHash: string) {
    super(engine, infoHash)  // instanceValue for filtering
    this.log.info('Torrent created')
  }
}

// Ring buffer for UI integration
const logger = new RingBufferLogger(500)
logger.onEntry((entry) => {
  // Push to UI
})

// Filtering
const entries = logger.getEntries({
  level: 'info',
  component: 'peer',
  instanceValue: 'abc123...'  // Specific torrent
})
```

## Current State vs Target

### Working Now
- Wire protocol (handshake, piece, request, bitfield, extended)
- Metadata exchange (BEP 9/10)
- HTTP and UDP trackers
- Multi-file torrents
- Piece verification
- Basic download from libtorrent seeders (verified by Python tests)

### Needs Implementation
- StorageRootManager (new)
- ISessionStore interface and implementations
- DaemonFileSystem adapter
- Preset functions
- Peer connection limits
- Rate tracking
- Choking algorithm (tit-for-tat)
- Rarest-first piece selection

### Not Yet Planned
- DHT
- µTP
- Encryption (MSE/PE)
