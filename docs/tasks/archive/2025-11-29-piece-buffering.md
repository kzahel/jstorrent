# Piece Buffering and CORS Optimization

## Overview

Two performance improvements:

1. **Buffer pieces in memory** - Instead of writing each 16KB block to disk immediately, buffer blocks in memory and write the complete piece only after hash verification passes.

2. **Add CORS Max-Age header** - Reduce OPTIONS preflight requests by caching CORS response.

## Why Buffer Pieces in Memory?

**Current flow** (inefficient for HTTP-based storage):
```
block received → HTTP POST 16KB → next block → HTTP POST 16KB → ... → hash (read back from disk) → done/fail
```

**New flow**:
```
block received → buffer in memory → ... → all blocks → hash in memory → verified? → single HTTP POST full piece
```

Benefits:
- Single write per piece instead of ~16-256 writes (typical piece = 256KB-4MB)
- Hash verification before any I/O - no corrupt partial data on disk
- Can track which peers contributed to each piece (for suspicious peer detection)
- Simpler retry on hash failure (just discard buffer)
- Fewer HTTP requests = less overhead

## Task 1: Add CORS Layer to io-daemon

**Update file**: `native-host/io-daemon/Cargo.toml`

Add tower-http with cors feature:
```toml
[dependencies]
tower-http = { version = "0.5", features = ["trace", "cors"] }
```

**Update file**: `native-host/io-daemon/src/main.rs`

Add CORS layer with max-age:

```rust
use tower_http::cors::{CorsLayer, Any};
use std::time::Duration;

// ... in main() where app is built:

let cors = CorsLayer::new()
    .allow_origin(Any)  // localhost only anyway
    .allow_methods(Any)
    .allow_headers(Any)
    .max_age(Duration::from_secs(86400));  // Cache preflight for 24 hours

let app = Router::new()
    .route("/health", get(|| async { "ok" }))
    .merge(files::routes())
    .merge(hashing::routes())
    .merge(ws::routes())
    .merge(control::routes())
    .merge(config::routes())
    .layer(cors)  // Add CORS layer BEFORE auth
    .layer(axum::middleware::from_fn_with_state(state.clone(), auth::middleware))
    .layer(TraceLayer::new_for_http())
    .with_state(state.clone());
```

## Task 2: Create PieceBuffer Class

**Create file**: `packages/engine/src/core/piece-buffer.ts`

```typescript
import { BLOCK_SIZE } from './piece-manager'

export interface BlockInfo {
  begin: number
  data: Uint8Array
  peerId: string
}

/**
 * Buffers blocks for a single piece in memory until complete.
 * Tracks which peers contributed blocks for suspicious peer detection.
 */
export class PieceBuffer {
  private blocks: Map<number, BlockInfo> = new Map()
  private blocksNeeded: number
  public readonly pieceIndex: number
  public readonly pieceLength: number
  public lastActivity: number = Date.now()

  constructor(pieceIndex: number, pieceLength: number) {
    this.pieceIndex = pieceIndex
    this.pieceLength = pieceLength
    this.blocksNeeded = Math.ceil(pieceLength / BLOCK_SIZE)
  }

  /**
   * Add a received block to the buffer.
   * Returns true if this block was new (not a duplicate).
   */
  addBlock(begin: number, data: Uint8Array, peerId: string): boolean {
    const blockIndex = Math.floor(begin / BLOCK_SIZE)
    
    if (this.blocks.has(blockIndex)) {
      return false // Duplicate
    }

    this.blocks.set(blockIndex, { begin, data, peerId })
    this.lastActivity = Date.now()
    return true
  }

  /**
   * Check if all blocks have been received.
   */
  isComplete(): boolean {
    return this.blocks.size === this.blocksNeeded
  }

  /**
   * Get the number of blocks received so far.
   */
  get blocksReceived(): number {
    return this.blocks.size
  }

  /**
   * Assemble all blocks into a single Uint8Array.
   * Only call this when isComplete() returns true.
   */
  assemble(): Uint8Array {
    const result = new Uint8Array(this.pieceLength)
    
    for (let i = 0; i < this.blocksNeeded; i++) {
      const block = this.blocks.get(i)
      if (!block) {
        throw new Error(`Missing block ${i} in piece ${this.pieceIndex}`)
      }
      result.set(block.data, block.begin)
    }
    
    return result
  }

  /**
   * Get set of peer IDs that contributed to this piece.
   * Used for suspicious peer tracking when hash fails.
   */
  getContributingPeers(): Set<string> {
    const peers = new Set<string>()
    for (const block of this.blocks.values()) {
      peers.add(block.peerId)
    }
    return peers
  }

  /**
   * Get list of missing block indices.
   */
  getMissingBlocks(): number[] {
    const missing: number[] = []
    for (let i = 0; i < this.blocksNeeded; i++) {
      if (!this.blocks.has(i)) {
        missing.push(i)
      }
    }
    return missing
  }

  /**
   * Clear all buffered data.
   */
  clear(): void {
    this.blocks.clear()
  }
}
```

## Task 3: Create PieceBufferManager

**Create file**: `packages/engine/src/core/piece-buffer-manager.ts`

```typescript
import { PieceBuffer } from './piece-buffer'
import { BLOCK_SIZE } from './piece-manager'

export interface PieceBufferManagerConfig {
  maxActivePieces?: number      // Max pieces buffered at once (default: 20)
  staleTimeoutMs?: number       // Timeout for inactive pieces (default: 60000)
}

/**
 * Manages in-memory buffers for pieces being downloaded.
 * Limits memory usage by capping active pieces and timing out stale ones.
 */
export class PieceBufferManager {
  private buffers: Map<number, PieceBuffer> = new Map()
  private maxActivePieces: number
  private staleTimeoutMs: number
  private cleanupInterval?: ReturnType<typeof setInterval>

  constructor(
    private pieceLength: number,
    private lastPieceLength: number,
    private totalPieces: number,
    config: PieceBufferManagerConfig = {}
  ) {
    this.maxActivePieces = config.maxActivePieces ?? 20
    this.staleTimeoutMs = config.staleTimeoutMs ?? 60000

    // Periodic cleanup of stale pieces
    this.cleanupInterval = setInterval(() => this.cleanupStale(), 10000)
  }

  /**
   * Get or create a buffer for a piece.
   * Returns null if we've hit the max active pieces limit.
   */
  getOrCreate(pieceIndex: number): PieceBuffer | null {
    let buffer = this.buffers.get(pieceIndex)
    if (buffer) {
      return buffer
    }

    // Check limit
    if (this.buffers.size >= this.maxActivePieces) {
      // Try to clean up stale ones first
      this.cleanupStale()
      
      if (this.buffers.size >= this.maxActivePieces) {
        return null // Still at limit
      }
    }

    // Create new buffer
    const length = pieceIndex === this.totalPieces - 1 
      ? this.lastPieceLength 
      : this.pieceLength
    
    buffer = new PieceBuffer(pieceIndex, length)
    this.buffers.set(pieceIndex, buffer)
    return buffer
  }

  /**
   * Get existing buffer for a piece (doesn't create).
   */
  get(pieceIndex: number): PieceBuffer | undefined {
    return this.buffers.get(pieceIndex)
  }

  /**
   * Remove a buffer (after piece is complete or failed).
   */
  remove(pieceIndex: number): void {
    this.buffers.delete(pieceIndex)
  }

  /**
   * Check if a piece is being actively buffered.
   */
  has(pieceIndex: number): boolean {
    return this.buffers.has(pieceIndex)
  }

  /**
   * Get count of active buffers.
   */
  get activeCount(): number {
    return this.buffers.size
  }

  /**
   * Get list of piece indices being buffered.
   */
  getActivePieces(): number[] {
    return Array.from(this.buffers.keys())
  }

  /**
   * Clean up stale buffers that haven't seen activity.
   */
  private cleanupStale(): void {
    const now = Date.now()
    const stale: number[] = []

    for (const [index, buffer] of this.buffers) {
      if (now - buffer.lastActivity > this.staleTimeoutMs) {
        stale.push(index)
      }
    }

    for (const index of stale) {
      this.buffers.delete(index)
    }
  }

  /**
   * Cleanup on destroy.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.buffers.clear()
  }
}
```

## Task 4: Update Torrent to Use Piece Buffering

**Update file**: `packages/engine/src/core/torrent.ts`

Add imports:
```typescript
import { PieceBuffer } from './piece-buffer'
import { PieceBufferManager } from './piece-buffer-manager'
```

Add property to Torrent class:
```typescript
private pieceBufferManager?: PieceBufferManager
```

Initialize in the metadata handler (where pieceManager is created):
```typescript
// After pieceManager is created, create buffer manager
this.pieceBufferManager = new PieceBufferManager(
  parsedTorrent.pieceLength,
  parsedTorrent.length % parsedTorrent.pieceLength || parsedTorrent.pieceLength,
  parsedTorrent.pieces.length,
  { maxActivePieces: 20, staleTimeoutMs: 60000 }
)
```

Replace the `handlePiece` method:

```typescript
private async handlePiece(peer: PeerConnection, msg: WireMessage) {
  if (msg.index === undefined || msg.begin === undefined || !msg.block) {
    return
  }

  if (peer.requestsPending > 0) peer.requestsPending--

  // Get or create buffer for this piece
  if (!this.pieceBufferManager) {
    this.logger.warn('Received piece data but buffer manager not initialized')
    return
  }

  const buffer = this.pieceBufferManager.getOrCreate(msg.index)
  if (!buffer) {
    this.logger.debug(`Cannot buffer piece ${msg.index} - at capacity`)
    return
  }

  // Get peer ID for tracking
  const peerId = peer.remotePeerId ? toHex(peer.remotePeerId) : 'unknown'

  // Add block to buffer
  const isNew = buffer.addBlock(msg.begin, msg.block, peerId)
  if (!isNew) {
    this.logger.debug(`Duplicate block ${msg.index}:${msg.begin}`)
  }

  // Update piece manager tracking
  this.pieceManager?.addReceived(msg.index, msg.begin)

  // Check if piece is complete
  if (buffer.isComplete()) {
    await this.finalizePiece(msg.index, buffer)
  }

  // Continue requesting
  this.requestPieces(peer)
}

private async finalizePiece(index: number, buffer: PieceBuffer): Promise<void> {
  // Assemble the complete piece
  const pieceData = buffer.assemble()

  // Verify hash BEFORE writing to disk
  const expectedHash = this.pieceManager?.getPieceHash(index)
  if (expectedHash) {
    const actualHash = await sha1(pieceData)
    
    if (compare(actualHash, expectedHash) !== 0) {
      // Hash failed - track suspicious peers
      const contributors = buffer.getContributingPeers()
      this.logger.warn(
        `Piece ${index} failed hash check. Contributors: ${Array.from(contributors).join(', ')}`
      )
      
      // TODO: Increment suspicion count for these peers
      // TODO: Ban peers with too many failed pieces
      
      // Reset piece state
      this.pieceManager?.resetPiece(index)
      this.pieceBufferManager?.remove(index)
      return
    }
  }

  // Hash verified - write to storage
  if (this.contentStorage) {
    try {
      await this.contentStorage.writePiece(index, pieceData)
    } catch (e) {
      this.logger.error(`Failed to write piece ${index}:`, e)
      this.pieceManager?.resetPiece(index)
      this.pieceBufferManager?.remove(index)
      return
    }
  }

  // Mark as verified
  this.pieceManager?.markVerified(index)
  this.pieceBufferManager?.remove(index)

  this.logger.info(`Piece ${index} verified and written`)
  this.emit('piece', index)

  // Emit verified event for persistence
  if (this.bitfield) {
    this.emit('verified', {
      bitfield: this.bitfield.toHex(),
    })
  }

  // Send HAVE message to all peers
  for (const p of this.peers) {
    if (p.handshakeReceived) {
      p.sendHave(index)
    }
  }

  this.checkCompletion()
}
```

Also update `stop()` to cleanup:
```typescript
async stop() {
  this.logger.info('Stopping')
  
  // Cleanup buffer manager
  this.pieceBufferManager?.destroy()
  
  // ... rest of existing stop() code
}
```

## Task 5: Add writePiece Method to TorrentContentStorage

**Update file**: `packages/engine/src/core/torrent-content-storage.ts`

Add a method to write a complete piece:

```typescript
/**
 * Write a complete piece (all data at once).
 * More efficient than multiple write() calls for small blocks.
 */
async writePiece(pieceIndex: number, data: Uint8Array): Promise<void> {
  const pieceOffset = pieceIndex * this.pieceLength
  
  // Determine which files this piece spans
  let bytesWritten = 0
  let currentOffset = pieceOffset
  
  while (bytesWritten < data.length) {
    // Find which file contains this offset
    const { fileIndex, fileOffset } = this.mapPieceOffsetToFile(currentOffset)
    const file = this.files[fileIndex]
    
    // How many bytes can we write to this file?
    const bytesRemaining = data.length - bytesWritten
    const bytesInFile = Math.min(
      bytesRemaining,
      file.length - fileOffset
    )
    
    // Get the slice of data for this file
    const slice = data.subarray(bytesWritten, bytesWritten + bytesInFile)
    
    // Write to file
    const handle = await this.getHandle(fileIndex)
    await handle.write(slice, 0, slice.length, fileOffset)
    
    bytesWritten += bytesInFile
    currentOffset += bytesInFile
  }
}

private mapPieceOffsetToFile(globalOffset: number): { fileIndex: number, fileOffset: number } {
  let cumulative = 0
  for (let i = 0; i < this.files.length; i++) {
    if (globalOffset < cumulative + this.files[i].length) {
      return { fileIndex: i, fileOffset: globalOffset - cumulative }
    }
    cumulative += this.files[i].length
  }
  throw new Error(`Offset ${globalOffset} out of bounds`)
}
```

## Task 6: Add Unit Tests

**Create file**: `packages/engine/test/core/piece-buffer.spec.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { PieceBuffer } from '../../src/core/piece-buffer'
import { BLOCK_SIZE } from '../../src/core/piece-manager'

describe('PieceBuffer', () => {
  it('should track blocks correctly', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 4) // 4 blocks
    
    expect(buffer.isComplete()).toBe(false)
    expect(buffer.blocksReceived).toBe(0)
    
    buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
    expect(buffer.blocksReceived).toBe(1)
    
    buffer.addBlock(BLOCK_SIZE, new Uint8Array(BLOCK_SIZE), 'peer2')
    expect(buffer.blocksReceived).toBe(2)
    expect(buffer.isComplete()).toBe(false)
  })

  it('should detect duplicates', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 2)
    
    expect(buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')).toBe(true)
    expect(buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')).toBe(false)
  })

  it('should assemble complete piece', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 2)
    
    const block1 = new Uint8Array(BLOCK_SIZE).fill(1)
    const block2 = new Uint8Array(BLOCK_SIZE).fill(2)
    
    buffer.addBlock(0, block1, 'peer1')
    buffer.addBlock(BLOCK_SIZE, block2, 'peer2')
    
    expect(buffer.isComplete()).toBe(true)
    
    const assembled = buffer.assemble()
    expect(assembled.length).toBe(BLOCK_SIZE * 2)
    expect(assembled[0]).toBe(1)
    expect(assembled[BLOCK_SIZE]).toBe(2)
  })

  it('should track contributing peers', () => {
    const buffer = new PieceBuffer(0, BLOCK_SIZE * 3)
    
    buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
    buffer.addBlock(BLOCK_SIZE, new Uint8Array(BLOCK_SIZE), 'peer2')
    buffer.addBlock(BLOCK_SIZE * 2, new Uint8Array(BLOCK_SIZE), 'peer1')
    
    const peers = buffer.getContributingPeers()
    expect(peers.size).toBe(2)
    expect(peers.has('peer1')).toBe(true)
    expect(peers.has('peer2')).toBe(true)
  })

  it('should handle last piece with odd size', () => {
    const oddSize = BLOCK_SIZE + 100 // 1.x blocks
    const buffer = new PieceBuffer(0, oddSize)
    
    buffer.addBlock(0, new Uint8Array(BLOCK_SIZE), 'peer1')
    expect(buffer.isComplete()).toBe(false)
    
    buffer.addBlock(BLOCK_SIZE, new Uint8Array(100), 'peer1')
    expect(buffer.isComplete()).toBe(true)
    
    const assembled = buffer.assemble()
    expect(assembled.length).toBe(oddSize)
  })
})
```

**Create file**: `packages/engine/test/core/piece-buffer-manager.spec.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PieceBufferManager } from '../../src/core/piece-buffer-manager'
import { BLOCK_SIZE } from '../../src/core/piece-manager'

describe('PieceBufferManager', () => {
  let manager: PieceBufferManager

  afterEach(() => {
    manager?.destroy()
  })

  it('should create buffers for pieces', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10)
    
    const buffer = manager.getOrCreate(0)
    expect(buffer).not.toBeNull()
    expect(manager.activeCount).toBe(1)
  })

  it('should return existing buffer', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10)
    
    const buffer1 = manager.getOrCreate(0)
    const buffer2 = manager.getOrCreate(0)
    expect(buffer1).toBe(buffer2)
    expect(manager.activeCount).toBe(1)
  })

  it('should enforce max active pieces limit', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 100, {
      maxActivePieces: 3
    })
    
    expect(manager.getOrCreate(0)).not.toBeNull()
    expect(manager.getOrCreate(1)).not.toBeNull()
    expect(manager.getOrCreate(2)).not.toBeNull()
    expect(manager.getOrCreate(3)).toBeNull() // At limit
    expect(manager.activeCount).toBe(3)
  })

  it('should remove completed pieces', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10, {
      maxActivePieces: 2
    })
    
    manager.getOrCreate(0)
    manager.getOrCreate(1)
    expect(manager.getOrCreate(2)).toBeNull()
    
    manager.remove(0)
    expect(manager.getOrCreate(2)).not.toBeNull()
  })

  it('should use correct length for last piece', () => {
    const lastPieceLength = BLOCK_SIZE + 500
    manager = new PieceBufferManager(BLOCK_SIZE * 4, lastPieceLength, 10)
    
    const regularBuffer = manager.getOrCreate(0)
    const lastBuffer = manager.getOrCreate(9)
    
    expect(regularBuffer?.pieceLength).toBe(BLOCK_SIZE * 4)
    expect(lastBuffer?.pieceLength).toBe(lastPieceLength)
  })
})
```

## Verification

```bash
# Build io-daemon
cd native-host
cargo build

# Run engine tests
cd ../packages/engine
pnpm test

# Run Python integration tests
cd tests/python
uv run pytest -v
```

## Summary

**io-daemon changes:**
- Add CORS layer with 24-hour max-age to cache preflight responses

**Engine changes:**
- New `PieceBuffer` class - buffers blocks for a single piece, tracks contributing peers
- New `PieceBufferManager` class - manages active buffers, enforces limits, cleans up stale pieces
- Updated `Torrent.handlePiece()` - buffer blocks in memory instead of writing immediately
- New `Torrent.finalizePiece()` - verify hash, then write complete piece
- New `TorrentContentStorage.writePiece()` - write complete piece in one operation

**Benefits:**
- ~16-256x fewer HTTP requests per piece
- Hash verification before any disk I/O
- Suspicious peer tracking built-in
- Cleaner retry on hash failure
- CORS preflight cached for 24 hours
