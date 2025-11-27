# Engine v2 Implementation Plan

This document outlines the work needed to reach the architecture described in ARCHITECTURE-v2.md.

## Current State

The engine currently works as a "functional leecher" - it can download torrents from libtorrent seeders, verified by Python integration tests. However:

- Adapters are mixed into core code
- No clear preset pattern
- StorageRootManager doesn't exist (only a half-baked StorageResolver)
- Session persistence is unclear (metadataStorage on disk, wrong location)
- No ISessionStore interface

## Phase 1: Reorganize File Structure

**Goal**: Get the directory structure right without changing behavior.

### Tasks

1. **Create adapter directories**
   ```
   mkdir -p packages/engine/src/adapters/{daemon,node,memory,browser}
   mkdir -p packages/engine/src/presets
   ```

2. **Move existing adapters**
   - `src/node-env/` → `src/adapters/node/`
   - `src/in-memory-filesystem.ts` → `src/adapters/memory/`
   - `src/memory-socket-factory.ts` → `src/adapters/memory/`

3. **Create adapter index files**
   ```typescript
   // src/adapters/node/index.ts
   export { NodeFileSystem } from './node-filesystem'
   export { NodeSocketFactory } from './node-socket-factory'
   
   // src/adapters/memory/index.ts
   export { InMemoryFileSystem } from './in-memory-filesystem'
   export { MemorySocketFactory } from './memory-socket-factory'
   ```

4. **Update imports throughout codebase**

5. **Verify tests still pass**

**Estimated effort**: 2-4 hours

## Phase 2: Define ISessionStore Interface

**Goal**: Clean interface for resume data persistence.

### Tasks

1. **Create interface**
   ```typescript
   // src/interfaces/session-store.ts
   export interface ISessionStore {
     get(key: string): Promise<Uint8Array | null>
     set(key: string, value: Uint8Array): Promise<void>
     delete(key: string): Promise<void>
     keys(prefix?: string): Promise<string[]>
     clear(): Promise<void>
   }
   ```

2. **Create MemorySessionStore** (for testing)
   ```typescript
   // src/adapters/memory/memory-session-store.ts
   export class MemorySessionStore implements ISessionStore {
     private data: Map<string, Uint8Array> = new Map()
     // ... implement methods
   }
   ```

3. **Create IndexedDBSessionStore** (for browser)
   ```typescript
   // src/adapters/browser/indexeddb-session-store.ts
   export class IndexedDBSessionStore implements ISessionStore {
     constructor(private dbName: string) {}
     // ... implement methods
   }
   ```

4. **Create ChromeStorageSessionStore** (alternative browser impl)
   ```typescript
   // src/adapters/browser/chrome-storage-session-store.ts
   export class ChromeStorageSessionStore implements ISessionStore {
     // ... implement using chrome.storage.local
   }
   ```

5. **Add to BtEngine constructor options**
   ```typescript
   interface BtEngineOptions {
     // ... existing options
     sessionStore?: ISessionStore
   }
   ```

6. **Remove/deprecate metadataStorage from SessionManager**

**Estimated effort**: 1 day

## Phase 3: Implement StorageRootManager

**Goal**: Clean multi-root storage management.

### Tasks

1. **Create StorageRoot type**
   ```typescript
   // src/storage/types.ts
   export interface StorageRoot {
     token: string
     label: string
     path: string
   }
   ```

2. **Implement StorageRootManager**
   ```typescript
   // src/storage/storage-root-manager.ts
   export class StorageRootManager {
     private roots: Map<string, StorageRoot> = new Map()
     private torrentRoots: Map<string, string> = new Map()
     private defaultToken: string | null = null
     private createFileSystem: (token: string) => IFileSystem
     private fsCache: Map<string, IFileSystem> = new Map()
     
     constructor(createFs: (token: string) => IFileSystem) {
       this.createFileSystem = createFs
     }
     
     private normalizeId(id: string): string {
       return id.toLowerCase()
     }
     
     addRoot(root: StorageRoot): void
     removeRoot(token: string): void
     getRoots(): StorageRoot[]
     setDefaultRoot(token: string): void
     setRootForTorrent(torrentId: string, token: string): void
     getRootForTorrent(torrentId: string): StorageRoot | null
     getFileSystemForTorrent(torrentId: string): IFileSystem
   }
   ```

3. **Integrate into BtEngine**
   - Add `storageRootManager` property
   - Update Torrent to get filesystem from manager
   - Remove old `downloadPath` + `fileSystem` options (or deprecate)

4. **Remove StorageResolver** (the half-baked version)

5. **Add unit tests for StorageRootManager**

**Estimated effort**: 1-2 days

## Phase 4: Create Node Preset

**Goal**: `createNodeEngine()` that wires Node adapters.

### Tasks

1. **Create preset**
   ```typescript
   // src/presets/node.ts
   import { BtEngine } from '../core/bt-engine'
   import { NodeFileSystem } from '../adapters/node'
   import { NodeSocketFactory } from '../adapters/node'
   import { MemorySessionStore } from '../adapters/memory'
   import { StorageRootManager } from '../storage/storage-root-manager'
   
   export interface NodeEngineConfig {
     downloadPath: string
     sessionStore?: ISessionStore
     port?: number
     onLog?: (entry: LogEntry) => void
   }
   
   export function createNodeEngine(config: NodeEngineConfig): BtEngine {
     const sessionStore = config.sessionStore ?? new MemorySessionStore()
     
     const storageRootManager = new StorageRootManager((token) => {
       // For Node, token IS the path
       return new NodeFileSystem(token)
     })
     
     // Register downloadPath as default root
     storageRootManager.addRoot({
       token: config.downloadPath,
       label: 'Downloads',
       path: config.downloadPath
     })
     storageRootManager.setDefaultRoot(config.downloadPath)
     
     return new BtEngine({
       socketFactory: new NodeSocketFactory(),
       storageRootManager,
       sessionStore,
       port: config.port,
       onLog: config.onLog
     })
   }
   ```

2. **Update node-rpc to use preset**
   ```typescript
   // src/node-rpc/controller.ts
   import { createNodeEngine } from '../presets/node'
   
   export class EngineController {
     async start(downloadPath: string) {
       this.engine = createNodeEngine({ downloadPath })
       // ...
     }
   }
   ```

3. **Verify Python tests still pass**

**Estimated effort**: 4-8 hours

## Phase 5: Create Memory Preset

**Goal**: `createMemoryEngine()` for unit testing.

### Tasks

1. **Create preset**
   ```typescript
   // src/presets/memory.ts
   export function createMemoryEngine(config?: MemoryEngineConfig): BtEngine {
     const sessionStore = config?.sessionStore ?? new MemorySessionStore()
     
     const storageRootManager = new StorageRootManager((token) => {
       return new InMemoryFileSystem()
     })
     
     storageRootManager.addRoot({
       token: 'memory',
       label: 'Memory',
       path: '/memory'
     })
     storageRootManager.setDefaultRoot('memory')
     
     return new BtEngine({
       socketFactory: new MemorySocketFactory(),
       storageRootManager,
       sessionStore,
       onLog: config?.onLog
     })
   }
   ```

2. **Update memory-swarm test to use preset**

**Estimated effort**: 2-4 hours

## Phase 6: Implement DaemonFileSystem

**Goal**: Filesystem adapter that talks to io-daemon via HTTP.

### Prerequisite

io-daemon needs these endpoints (may already exist, need to verify):
- `POST /file/open` - Open file handle
- `POST /file/read` - Read bytes
- `POST /file/write` - Write bytes
- `POST /file/close` - Close handle
- `GET /file/stat` - File metadata
- `POST /dir/mkdir` - Create directory
- `GET /dir/list` - List directory

### Tasks

1. **Create DaemonConnection class**
   ```typescript
   // src/adapters/daemon/daemon-connection.ts
   export class DaemonConnection {
     constructor(
       private port: number,
       private authToken: string
     ) {}
     
     async request(method: string, path: string, body?: unknown): Promise<unknown>
     
     static async connect(port: number, authToken: string): Promise<DaemonConnection>
   }
   ```

2. **Create DaemonFileSystem**
   ```typescript
   // src/adapters/daemon/daemon-filesystem.ts
   export class DaemonFileSystem implements IFileSystem {
     constructor(
       private connection: DaemonConnection,
       private rootToken: string
     ) {}
     
     async open(path: string, mode: 'r' | 'w' | 'r+'): Promise<IFileHandle>
     async stat(path: string): Promise<IFileStat>
     async mkdir(path: string): Promise<void>
     async exists(path: string): Promise<boolean>
     async readdir(path: string): Promise<string[]>
   }
   ```

3. **Create DaemonFileHandle**
   ```typescript
   // src/adapters/daemon/daemon-file-handle.ts
   export class DaemonFileHandle implements IFileHandle {
     constructor(
       private connection: DaemonConnection,
       private handleId: string
     ) {}
     
     async read(buffer: Uint8Array, offset: number): Promise<number>
     async write(buffer: Uint8Array, offset: number): Promise<number>
     async truncate(length: number): Promise<void>
     async sync(): Promise<void>
     async close(): Promise<void>
   }
   ```

4. **Add Vitest integration test** (spawns real io-daemon)
   ```typescript
   // test/integration/daemon-filesystem.spec.ts
   // See detailed sketch in discussion
   ```

**Estimated effort**: 2-3 days

## Phase 7: Create Daemon Preset

**Goal**: `createDaemonEngine()` for extension use.

### Tasks

1. **Create preset**
   ```typescript
   // src/presets/daemon.ts
   export async function createDaemonEngine(
     config: DaemonEngineConfig
   ): Promise<BtEngine> {
     const connection = await DaemonConnection.connect(
       config.daemon.port,
       config.daemon.authToken
     )
     
     const storageRootManager = new StorageRootManager((token) => {
       return new DaemonFileSystem(connection, token)
     })
     
     for (const root of config.contentRoots) {
       storageRootManager.addRoot(root)
     }
     
     if (config.defaultContentRoot) {
       storageRootManager.setDefaultRoot(config.defaultContentRoot)
     }
     
     return new BtEngine({
       socketFactory: new DaemonSocketFactory(connection),
       storageRootManager,
       sessionStore: config.sessionStore,
       port: config.port,
       onLog: config.onLog
     })
   }
   ```

2. **Test in extension E2E** (Playwright)

**Estimated effort**: 1 day

## Phase 8: Browser Adapters

**Goal**: OPFS filesystem and browser session stores.

### Tasks

1. **OPFSFileSystem**
   ```typescript
   // src/adapters/browser/opfs-filesystem.ts
   export class OPFSFileSystem implements IFileSystem {
     private root: FileSystemDirectoryHandle | null = null
     
     async init(): Promise<void> {
       this.root = await navigator.storage.getDirectory()
     }
     
     // ... implement IFileSystem using File System Access API
   }
   ```

2. **createDaemonWithOPFSEngine preset**
   ```typescript
   // src/presets/daemon-opfs.ts
   export async function createDaemonWithOPFSEngine(
     config: DaemonOPFSEngineConfig
   ): Promise<BtEngine> {
     const opfs = new OPFSFileSystem()
     await opfs.init()
     
     const storageRootManager = new StorageRootManager(() => opfs)
     storageRootManager.addRoot({
       token: 'opfs',
       label: 'Browser Storage',
       path: 'opfs://root'
     })
     storageRootManager.setDefaultRoot('opfs')
     
     // ... rest similar to daemon preset but with OPFS
   }
   ```

**Estimated effort**: 1-2 days

## Phase 9: Session Persistence Integration

**Goal**: Actually use ISessionStore for resume data.

### Tasks

1. **Define session data format**
   ```typescript
   // Key: torrent:{infohash}:state
   interface TorrentSessionState {
     bitfield: Uint8Array
     downloaded: number
     uploaded: number
     addedAt: number
     completedAt?: number
   }
   
   // Key: torrent:{infohash}:peers
   interface CachedPeer {
     ip: string
     port: number
     lastSeen: number
     uploaded: number
     downloaded: number
   }
   ```

2. **Add save/restore to Torrent class**
   ```typescript
   class Torrent {
     async saveState(): Promise<void> {
       const state: TorrentSessionState = {
         bitfield: this.pieceManager.getBitfield(),
         downloaded: this.downloaded,
         uploaded: this.uploaded,
         addedAt: this.addedAt,
         completedAt: this.completedAt
       }
       await this.engine.sessionStore.set(
         `torrent:${this.id}:state`,
         encode(state)
       )
     }
     
     async restoreState(): Promise<boolean> {
       const data = await this.engine.sessionStore.get(`torrent:${this.id}:state`)
       if (!data) return false
       const state = decode(data) as TorrentSessionState
       this.pieceManager.setBitfield(state.bitfield)
       // ...
       return true
     }
   }
   ```

3. **Add BtEngine.restoreSession()**
   ```typescript
   async restoreSession(): Promise<void> {
     const keys = await this.sessionStore.keys('torrent:')
     const infoHashes = new Set(
       keys.map(k => k.split(':')[1])
     )
     
     for (const infoHash of infoHashes) {
       // Restore torrent from session data
     }
   }
   ```

4. **Hook saveState() into piece completion**

**Estimated effort**: 1-2 days

## Phase 10: Quick Wins from Gap Analysis

These can be done in parallel with other phases.

### Peer Connection Limits (2 hours)

```typescript
// In torrent.ts connectToPeer()
if (this.peers.length >= this.maxPeers) {
  this.log.debug('Max peers reached, skipping connection')
  return
}
```

### Rate Tracking (4 hours)

```typescript
class RateTracker {
  private samples: { time: number, bytes: number }[] = []
  private windowMs = 5000
  
  addSample(bytes: number): void
  getRate(): number  // bytes per second
}

// Add to Torrent
this.downloadRateTracker = new RateTracker()
this.uploadRateTracker = new RateTracker()
```

### RingBufferLogger (4 hours)

```typescript
// src/logging/ring-buffer-logger.ts
export class RingBufferLogger {
  private entries: LogEntry[] = []
  private maxEntries: number
  private listeners: ((entry: LogEntry) => void)[] = []
  
  constructor(maxEntries = 500)
  
  add(entry: LogEntry): void
  getEntries(filter?: LogFilter): LogEntry[]
  onEntry(callback: (entry: LogEntry) => void): () => void
}
```

## Testing Strategy

### Unit Tests (Vitest)

- StorageRootManager
- RingBufferLogger
- RateTracker
- Session stores
- InfoHash normalization

### Integration Tests (Vitest + subprocess)

- DaemonFileSystem (spawns io-daemon)
- DaemonSocketFactory (spawns io-daemon)

### Protocol Tests (Python + libtorrent)

- Download from seeder
- Multi-file torrents
- Resume/recheck
- Multiple download roots (NEW)

### E2E Tests (Playwright)

- Full extension flow with native host
- Download via daemon
- UI interactions

## Suggested Order

1. **Phase 1** (file reorg) - Foundation, low risk
2. **Phase 2** (ISessionStore) - Enables clean persistence
3. **Phase 3** (StorageRootManager) - Core abstraction
4. **Phase 4** (Node preset) - Validates design with existing tests
5. **Phase 5** (Memory preset) - Quick, useful for unit tests
6. **Quick wins** (peer limits, rate tracking, ring buffer)
7. **Phase 6** (DaemonFileSystem) - Bigger lift, needs io-daemon work
8. **Phase 7** (Daemon preset) - Ties it together
9. **Phase 8** (Browser adapters) - Nice to have
10. **Phase 9** (Session persistence) - Can be incremental

## Open Questions

1. **io-daemon filesystem endpoints** - Do they exist? What's the API?

2. **Multiple roots in Python tests** - Worth adding test for different download folders?

3. **InfoHash type branding** - Worth the complexity or just normalize internally?

4. **Peer list caching** - Include in v1 or defer?

5. **Session store location in Node preset** - In-memory default, or file-based?

## Success Criteria

- [ ] `createNodeEngine()` works, Python tests pass
- [ ] `createMemoryEngine()` works, memory-swarm test passes
- [ ] `createDaemonEngine()` works, E2E test passes
- [ ] StorageRootManager handles multiple roots
- [ ] Session data persists across restarts
- [ ] Peer limits prevent resource exhaustion
- [ ] Rate tracking shows accurate speeds
- [ ] Logs visible in extension UI
