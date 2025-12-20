# Refactoring Plan: ActivePiece Model with Lazy Instantiation

## Design Philosophy

### The Lazy Instantiation Pattern

The core idea: **Objects representing entities are lazily created when first needed and remain stable references while "active".**

Benefits:
1. **Single source of truth** - All state for an entity lives in one object
2. **Easy debugging** - Inspect one object to see complete state
3. **Memory efficient** - Only active entities consume memory
4. **Predictable lifecycle** - Clear creation/destruction points
5. **Natural garbage collection** - Remove object when no longer active

### Pattern Implementation

```typescript
class Manager<K, V> {
  private items: Map<K, V> = new Map()
  
  // Lazy instantiation - get or create
  getOrCreate(key: K): V {
    let item = this.items.get(key)
    if (!item) {
      item = this.createItem(key)
      this.items.set(key, item)
    }
    return item
  }
  
  // Get without creating (for checking existence)
  get(key: K): V | undefined {
    return this.items.get(key)
  }
  
  // Explicit removal when done
  remove(key: K): void {
    const item = this.items.get(key)
    if (item) {
      this.destroyItem(item)
      this.items.delete(key)
    }
  }
  
  // Iteration over active items
  get active(): V[] {
    return Array.from(this.items.values())
  }
  
  protected abstract createItem(key: K): V
  protected destroyItem(item: V): void { /* cleanup */ }
}
```

### Applying to JSTorrent Engine

| Entity | Key | When Active | When Removed |
|--------|-----|-------------|--------------|
| ActivePiece | pieceIndex | Being downloaded | Verified or abandoned |
| Peer | `${ip}:${port}` | Connected | Disconnected |
| Tracker | url | Announcing | Stopped |
| Torrent | infoHash | Added | Removed |

## Current Architecture Problems

### State Fragmentation

Currently, piece download state is spread across:

1. **PieceManager**
   - `bitfield: BitField` - verified pieces (global)
   - `pieces[index].blocks: BitField` - received blocks
   - `pieces[index].requested: BitField` - requested blocks (THE PROBLEM)

2. **PieceBufferManager**
   - `buffers: Map<number, PieceBuffer>` - in-memory block data

3. **PieceBuffer**
   - `blocks: Map<number, BlockInfo>` - actual block data
   - `lastActivity: number` - for timeout

4. **Implicit in Torrent**
   - Request sending logic
   - No tracking of which peer requested what

### The Problem

When a peer disconnects or times out:
- `PieceManager.pieces[i].requested` still has bits set
- `isBlockRequested()` returns true
- We skip requesting those blocks
- Nobody will ever respond → **stall**

## New Architecture: ActivePiece Model

### Core Classes

```
┌─────────────────────────────────────────────────────────────┐
│                         Torrent                              │
├─────────────────────────────────────────────────────────────┤
│  - pieceManager: PieceManager        (verified state only)  │
│  - activePieces: ActivePieceManager  (download state)       │
│  - peers: PeerConnection[]                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    ActivePieceManager                        │
├─────────────────────────────────────────────────────────────┤
│  - pieces: Map<number, ActivePiece>                         │
│  - maxActivePieces: number                                  │
│  - config: ActivePieceConfig                                │
│                                                              │
│  + getOrCreate(index): ActivePiece | null                   │
│  + get(index): ActivePiece | undefined                      │
│  + remove(index): void                                      │
│  + clearRequestsForPeer(peerId): void                       │
│  + checkTimeouts(): void                                    │
│  + getTotalBufferedBytes(): number                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       ActivePiece                            │
├─────────────────────────────────────────────────────────────┤
│  index: number                                               │
│  length: number                                              │
│  blocksNeeded: number                                        │
│                                                              │
│  // Block data                                               │
│  - blockData: Map<blockIndex, Uint8Array>                   │
│                                                              │
│  // Request tracking (THE KEY CHANGE)                        │
│  - blockRequests: Map<blockIndex, RequestInfo[]>            │
│                                                              │
│  // Computed state                                           │
│  + haveAllBlocks: boolean      (all data received)          │
│  + isRequested(blockIndex): boolean                         │
│  + bufferedBytes: number                                    │
│  + lastActivity: number                                     │
│                                                              │
│  // Methods                                                  │
│  + addRequest(blockIndex, peerId): void                     │
│  + addBlock(blockIndex, data, peerId): boolean              │
│  + getNeededBlocks(peerBitfield?, maxBlocks?): BlockInfo[]  │
│  + clearRequestsForPeer(peerId): void                       │
│  + checkTimeouts(timeoutMs): number  (returns cleared count)│
│  + assemble(): Uint8Array                                   │
│  + getContributingPeers(): Set<string>                      │
└─────────────────────────────────────────────────────────────┘
```

### RequestInfo Structure

```typescript
interface RequestInfo {
  peerId: string
  timestamp: number
  // Future: could add retryCount, etc.
}

interface BlockInfo {
  begin: number
  length: number
}

interface ActivePieceConfig {
  requestTimeoutMs: number      // default: 30000
  maxActivePieces: number       // default: 20  
  maxBufferedBytes: number      // default: 16MB
  cleanupIntervalMs: number     // default: 10000
}
```

## Implementation Plan

### Phase 1: Create ActivePiece Class

**File: `packages/engine/src/core/active-piece.ts`**

```typescript
import { BLOCK_SIZE } from './piece-manager'

export interface RequestInfo {
  peerId: string
  timestamp: number
}

export class ActivePiece {
  readonly index: number
  readonly length: number
  readonly blocksNeeded: number
  
  // Block data storage
  private blockData: Map<number, Uint8Array> = new Map()
  
  // Request tracking - supports multiple requests per block (endgame)
  private blockRequests: Map<number, RequestInfo[]> = new Map()
  
  // Activity tracking
  private _lastActivity: number = Date.now()
  
  constructor(index: number, length: number) {
    this.index = index
    this.length = length
    this.blocksNeeded = Math.ceil(length / BLOCK_SIZE)
  }
  
  // --- State Queries ---
  
  get haveAllBlocks(): boolean {
    return this.blockData.size === this.blocksNeeded
  }
  
  get lastActivity(): number {
    return this._lastActivity
  }
  
  get bufferedBytes(): number {
    let total = 0
    for (const data of this.blockData.values()) {
      total += data.length
    }
    return total
  }
  
  get blocksReceived(): number {
    return this.blockData.size
  }
  
  hasBlock(blockIndex: number): boolean {
    return this.blockData.has(blockIndex)
  }
  
  isBlockRequested(blockIndex: number, timeoutMs?: number): boolean {
    const requests = this.blockRequests.get(blockIndex)
    if (!requests || requests.length === 0) return false
    
    if (timeoutMs !== undefined) {
      const now = Date.now()
      // Check if any non-timed-out request exists
      return requests.some(r => now - r.timestamp < timeoutMs)
    }
    return true
  }
  
  // --- Mutations ---
  
  addRequest(blockIndex: number, peerId: string): void {
    let requests = this.blockRequests.get(blockIndex)
    if (!requests) {
      requests = []
      this.blockRequests.set(blockIndex, requests)
    }
    requests.push({ peerId, timestamp: Date.now() })
    this._lastActivity = Date.now()
  }
  
  addBlock(blockIndex: number, data: Uint8Array, peerId: string): boolean {
    if (this.blockData.has(blockIndex)) {
      return false // Duplicate
    }
    
    this.blockData.set(blockIndex, data)
    this._lastActivity = Date.now()
    
    // Clear requests for this block - it's been fulfilled
    this.blockRequests.delete(blockIndex)
    
    return true
  }
  
  // --- Request Management ---
  
  clearRequestsForPeer(peerId: string): number {
    let cleared = 0
    for (const [blockIndex, requests] of this.blockRequests) {
      const filtered = requests.filter(r => r.peerId !== peerId)
      if (filtered.length !== requests.length) {
        cleared += requests.length - filtered.length
        if (filtered.length === 0) {
          this.blockRequests.delete(blockIndex)
        } else {
          this.blockRequests.set(blockIndex, filtered)
        }
      }
    }
    return cleared
  }
  
  checkTimeouts(timeoutMs: number): number {
    const now = Date.now()
    let cleared = 0
    
    for (const [blockIndex, requests] of this.blockRequests) {
      const filtered = requests.filter(r => now - r.timestamp < timeoutMs)
      if (filtered.length !== requests.length) {
        cleared += requests.length - filtered.length
        if (filtered.length === 0) {
          this.blockRequests.delete(blockIndex)
        } else {
          this.blockRequests.set(blockIndex, filtered)
        }
      }
    }
    return cleared
  }
  
  // --- Block Selection ---
  
  getNeededBlocks(maxBlocks: number = Infinity): BlockInfo[] {
    const needed: BlockInfo[] = []
    
    for (let i = 0; i < this.blocksNeeded && needed.length < maxBlocks; i++) {
      // Skip if we have the data
      if (this.blockData.has(i)) continue
      
      // Skip if already requested (with valid non-timed-out request)
      // Note: Caller can pass timeoutMs to isBlockRequested for timeout-aware check
      if (this.blockRequests.has(i) && this.blockRequests.get(i)!.length > 0) continue
      
      const begin = i * BLOCK_SIZE
      const length = Math.min(BLOCK_SIZE, this.length - begin)
      needed.push({ begin, length })
    }
    
    return needed
  }
  
  // For endgame: get blocks that are requested but not received
  getRequestedButNotReceivedBlocks(): number[] {
    const blocks: number[] = []
    for (let i = 0; i < this.blocksNeeded; i++) {
      if (!this.blockData.has(i)) {
        blocks.push(i)
      }
    }
    return blocks
  }
  
  // --- Assembly ---
  
  assemble(): Uint8Array {
    if (!this.haveAllBlocks) {
      throw new Error(`Cannot assemble piece ${this.index}: missing blocks`)
    }
    
    const result = new Uint8Array(this.length)
    for (let i = 0; i < this.blocksNeeded; i++) {
      const data = this.blockData.get(i)!
      const offset = i * BLOCK_SIZE
      result.set(data, offset)
    }
    return result
  }
  
  getContributingPeers(): Set<string> {
    // For suspicious peer tracking on hash failure
    // We'd need to track which peer sent which block
    // For now, return empty - can enhance later
    return new Set()
  }
  
  // --- Cleanup ---
  
  clear(): void {
    this.blockData.clear()
    this.blockRequests.clear()
  }
}
```

### Phase 2: Create ActivePieceManager Class

**File: `packages/engine/src/core/active-piece-manager.ts`**

```typescript
import { ActivePiece } from './active-piece'
import { EngineComponent, ILoggingEngine } from '../logging/logger'

export interface ActivePieceConfig {
  requestTimeoutMs: number
  maxActivePieces: number
  maxBufferedBytes: number
  cleanupIntervalMs: number
}

const DEFAULT_CONFIG: ActivePieceConfig = {
  requestTimeoutMs: 30000,
  maxActivePieces: 20,
  maxBufferedBytes: 16 * 1024 * 1024,
  cleanupIntervalMs: 10000,
}

export class ActivePieceManager extends EngineComponent {
  static logName = 'active-pieces'
  
  private pieces: Map<number, ActivePiece> = new Map()
  private config: ActivePieceConfig
  private cleanupInterval?: ReturnType<typeof setInterval>
  private pieceLengthFn: (index: number) => number
  
  constructor(
    engine: ILoggingEngine,
    pieceLengthFn: (index: number) => number,
    config: Partial<ActivePieceConfig> = {}
  ) {
    super(engine)
    this.pieceLengthFn = pieceLengthFn
    this.config = { ...DEFAULT_CONFIG, ...config }
    
    // Start periodic cleanup
    this.cleanupInterval = setInterval(
      () => this.checkTimeouts(),
      this.config.cleanupIntervalMs
    )
  }
  
  // --- Lazy Instantiation ---
  
  getOrCreate(index: number): ActivePiece | null {
    let piece = this.pieces.get(index)
    if (piece) return piece
    
    // Check limits before creating
    if (this.pieces.size >= this.config.maxActivePieces) {
      // Try to clean up stale pieces first
      this.cleanupStale()
      if (this.pieces.size >= this.config.maxActivePieces) {
        this.logger.debug(`Cannot create piece ${index}: at capacity (${this.pieces.size})`)
        return null
      }
    }
    
    // Check memory limit
    if (this.totalBufferedBytes >= this.config.maxBufferedBytes) {
      this.logger.debug(`Cannot create piece ${index}: memory limit reached`)
      return null
    }
    
    const length = this.pieceLengthFn(index)
    piece = new ActivePiece(index, length)
    this.pieces.set(index, piece)
    this.logger.debug(`Created active piece ${index}`)
    return piece
  }
  
  get(index: number): ActivePiece | undefined {
    return this.pieces.get(index)
  }
  
  has(index: number): boolean {
    return this.pieces.has(index)
  }
  
  remove(index: number): void {
    const piece = this.pieces.get(index)
    if (piece) {
      piece.clear()
      this.pieces.delete(index)
      this.logger.debug(`Removed active piece ${index}`)
    }
  }
  
  // --- Iteration ---
  
  get activeIndices(): number[] {
    return Array.from(this.pieces.keys())
  }
  
  get activePieces(): ActivePiece[] {
    return Array.from(this.pieces.values())
  }
  
  get activeCount(): number {
    return this.pieces.size
  }
  
  // --- Memory Tracking ---
  
  get totalBufferedBytes(): number {
    let total = 0
    for (const piece of this.pieces.values()) {
      total += piece.bufferedBytes
    }
    return total
  }
  
  // --- Cleanup ---
  
  clearRequestsForPeer(peerId: string): number {
    let totalCleared = 0
    for (const piece of this.pieces.values()) {
      totalCleared += piece.clearRequestsForPeer(peerId)
    }
    if (totalCleared > 0) {
      this.logger.debug(`Cleared ${totalCleared} requests for peer ${peerId}`)
    }
    return totalCleared
  }
  
  checkTimeouts(): number {
    let totalCleared = 0
    for (const piece of this.pieces.values()) {
      totalCleared += piece.checkTimeouts(this.config.requestTimeoutMs)
    }
    if (totalCleared > 0) {
      this.logger.debug(`Cleared ${totalCleared} timed-out requests`)
    }
    return totalCleared
  }
  
  private cleanupStale(): void {
    const now = Date.now()
    const staleThreshold = this.config.requestTimeoutMs * 2
    
    for (const [index, piece] of this.pieces) {
      // Remove pieces that have no activity and no data
      if (now - piece.lastActivity > staleThreshold && piece.blocksReceived === 0) {
        this.logger.debug(`Removing stale piece ${index}`)
        piece.clear()
        this.pieces.delete(index)
      }
    }
  }
  
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    for (const piece of this.pieces.values()) {
      piece.clear()
    }
    this.pieces.clear()
  }
}
```

### Phase 3: Update Torrent Class

**File: `packages/engine/src/core/torrent.ts`**

Key changes:

```typescript
// Replace pieceBufferManager with activePieces
private activePieces?: ActivePieceManager

// Initialize in constructor or when pieceManager is ready
private initActivePieces(): void {
  if (this.activePieces || !this.pieceManager) return
  
  this.activePieces = new ActivePieceManager(
    this.engineInstance,
    (index) => this.pieceManager!.getPieceLength(index),
    {
      requestTimeoutMs: 30000,
      maxActivePieces: 20,
      maxBufferedBytes: 16 * 1024 * 1024,
    }
  )
}

// Updated requestPieces
private requestPieces(peer: PeerConnection): void {
  if (peer.peerChoking) return
  if (!this.pieceManager) return
  
  this.initActivePieces()
  if (!this.activePieces) return
  
  const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
  const missing = this.pieceManager.getMissingPieces()
  
  const MAX_PIPELINE = 200
  let requestsMade = 0
  
  for (const index of missing) {
    if (peer.requestsPending >= MAX_PIPELINE) break
    
    // Check peer has this piece
    if (!peer.bitfield?.get(index)) continue
    
    // Get or create active piece
    let piece = this.activePieces.get(index)
    
    // If piece is complete (has all blocks), skip
    if (piece?.haveAllBlocks) continue
    
    // Try to create if doesn't exist
    if (!piece) {
      piece = this.activePieces.getOrCreate(index)
      if (!piece) continue // At capacity
    }
    
    // Get blocks we can request
    const neededBlocks = piece.getNeededBlocks(MAX_PIPELINE - peer.requestsPending)
    
    for (const block of neededBlocks) {
      peer.sendRequest(index, block.begin, block.length)
      peer.requestsPending++
      piece.addRequest(Math.floor(block.begin / BLOCK_SIZE), peerId)
      requestsMade++
    }
  }
  
  this.logger.debug(`requestPieces: made ${requestsMade} requests`)
}

// Updated handleBlock
private async handleBlock(peer: PeerConnection, msg: WireMessage): Promise<void> {
  if (msg.index === undefined || msg.begin === undefined || !msg.block) return
  
  if (peer.requestsPending > 0) peer.requestsPending--
  
  this.initActivePieces()
  if (!this.activePieces) return
  
  const piece = this.activePieces.get(msg.index)
  if (!piece) {
    this.logger.warn(`Received block for unknown piece ${msg.index}`)
    return
  }
  
  const blockIndex = Math.floor(msg.begin / BLOCK_SIZE)
  const peerId = peer.peerId ? toHex(peer.peerId) : 'unknown'
  
  const isNew = piece.addBlock(blockIndex, msg.block, peerId)
  if (!isNew) {
    this.logger.debug(`Duplicate block ${msg.index}:${msg.begin}`)
    return
  }
  
  // Check if piece is complete
  if (piece.haveAllBlocks) {
    await this.finalizePiece(msg.index, piece)
  }
  
  // Request more
  this.requestPieces(peer)
}

// Updated finalizePiece
private async finalizePiece(index: number, piece: ActivePiece): Promise<void> {
  const data = piece.assemble()
  
  // Verify hash
  const expectedHash = this.pieceManager?.getPieceHash(index)
  if (expectedHash) {
    const actualHash = await sha1(data)
    if (compare(actualHash, expectedHash) !== 0) {
      this.logger.warn(`Piece ${index} failed hash check`)
      this.pieceManager?.resetPiece(index)
      this.activePieces?.remove(index)
      return
    }
  }
  
  // Write to storage
  if (this.contentStorage) {
    await this.contentStorage.writePiece(index, data)
  }
  
  // Mark verified
  this.pieceManager?.markVerified(index)
  this.activePieces?.remove(index)
  
  this.logger.info(`Piece ${index} complete`)
  this.emit('piece', index)
  this.checkCompletion()
}

// Updated removePeer - CRITICAL for the stall fix
private removePeer(peer: PeerConnection): void {
  const index = this.peers.indexOf(peer)
  if (index !== -1) {
    this.peers.splice(index, 1)
  }
  
  // Clear requests for this peer
  const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
  const cleared = this.activePieces?.clearRequestsForPeer(peerId) || 0
  this.logger.debug(`Peer ${peerId} disconnected, cleared ${cleared} pending requests`)
  
  // Try to request from remaining peers
  for (const remainingPeer of this.peers) {
    if (!remainingPeer.peerChoking) {
      this.requestPieces(remainingPeer)
    }
  }
}
```

### Phase 4: Simplify PieceManager

Remove request tracking from PieceManager - it now only tracks:
- Global bitfield (verified pieces)
- Piece hashes for verification
- Basic piece info (length, block count)

```typescript
// Remove from Piece class:
// - requested: BitField
// - isRequested()
// - setRequested()

// Remove from PieceManager:
// - addRequested()
// - isBlockRequested()
// - clearAllRequested()
// - clearRequestedForPiece()
```

### Phase 5: Remove PieceBufferManager

Delete `piece-buffer.ts` and `piece-buffer-manager.ts` - their functionality is now in `ActivePiece` and `ActivePieceManager`.

### Phase 6: Update Exports

Update `packages/engine/src/index.ts` to export new classes.

## Migration Checklist

- [ ] Create `active-piece.ts` with `ActivePiece` class
- [ ] Create `active-piece-manager.ts` with `ActivePieceManager` class
- [ ] Update `torrent.ts` to use `ActivePieceManager`
- [ ] Update `requestPieces()` to use new model
- [ ] Update `handleBlock()` to use new model
- [ ] Update `removePeer()` to clear requests
- [ ] Update `finalizePiece()` to use new model
- [ ] Add destroy/cleanup in torrent stop
- [ ] Remove `requested` tracking from `PieceManager`
- [ ] Delete `piece-buffer.ts` and `piece-buffer-manager.ts`
- [ ] Update imports/exports
- [ ] Run Python tests

## Testing

After refactoring, all these should pass:

```bash
cd packages/engine
./tests/python/.venv/bin/pytest tests/python/test_handshake.py -v
./tests/python/.venv/bin/pytest tests/python/test_download.py -v
./tests/python/.venv/bin/pytest tests/python/test_resume.py -v
```

## Future: Extending the Pattern

The lazy instantiation pattern can be applied to:

### Peers
```typescript
class ActivePeerManager {
  private peers: Map<string, PeerConnection> = new Map()
  
  getOrCreate(ip: string, port: number): PeerConnection { ... }
  get(ip: string, port: number): PeerConnection | undefined { ... }
  remove(ip: string, port: number): void { ... }
}
```

### Trackers
```typescript
class ActiveTrackerManager {
  private trackers: Map<string, Tracker> = new Map()
  
  getOrCreate(url: string): Tracker { ... }
}
```

### Files (for sparse allocation)
```typescript
class ActiveFileManager {
  private files: Map<number, FileHandle> = new Map()
  
  getOrCreate(fileIndex: number): FileHandle { ... }
}
```

This creates a consistent pattern throughout the engine where:
1. Entities are identified by unique keys
2. Objects are created on first access
3. Objects hold all their own state
4. Cleanup is explicit and centralized
