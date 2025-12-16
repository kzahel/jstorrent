# Piece Picker: Rarest-First Selection Algorithm

## Overview

Replace sequential piece iteration with a proper rarest-first piece selection algorithm. This fixes deadlocks where pieces are reserved for peers that don't have them, causing "Cannot create piece N: at capacity" spam.

**Problem:** Current `getMissingPieces()` returns pieces in sequential order (0, 1, 2...). The `requestPieces()` loop fills active piece slots based on index order, not peer availability. If slots 0-149 are occupied by pieces that no current peer has, we can't request pieces peers *do* have.

**Solution:** 
1. Track piece availability (how many peers have each piece)
2. Select pieces the current peer has, sorted by: high priority → started (partial) → rarest
3. Remove the hard `maxActivePieces` cap (keep `maxBufferedBytes` as the real memory guard)

## Phase 1: Piece Availability Tracking

Track how many connected peers have each piece. This enables rarest-first selection.

### 1.1 Add availability array to Torrent

File: `packages/engine/src/core/torrent.ts`

Add new field after `_pieceClassification` (around line 136):

```typescript
private _pieceClassification: PieceClassification[] = []

/** Per-piece availability count (how many connected peers have each piece) */
private _pieceAvailability: Uint16Array | null = null
```

Add initialization method after `initBitfield()` (around line 465):

```typescript
initBitfield(pieceCount: number): void {
  this._bitfield = new BitField(pieceCount)
}

/**
 * Initialize piece availability tracking.
 * Call after metadata is available (same time as initBitfield).
 */
initPieceAvailability(pieceCount: number): void {
  this._pieceAvailability = new Uint16Array(pieceCount) // All zeros
}
```

Add getter for PiecePicker access (around line 630):

```typescript
get pieceAvailability(): Uint16Array | null {
  return this._pieceAvailability
}
```

### 1.2 Fix PeerConnection to avoid duplicate HAVE events

The HAVE handler currently sets the bitfield then emits. We need to only emit if the bit wasn't already set (to avoid double-counting availability on redundant HAVE messages).

File: `packages/engine/src/core/peer-connection.ts`

Find the HAVE case in `processMessage()` (around line 265):

```typescript
case MessageType.HAVE:
  this.bitfield?.set(message.index, true)
  this.emit('have', message.index)
  break
```

Replace with:

```typescript
case MessageType.HAVE:
  // Only emit if this is new information (avoid double-counting in availability)
  if (this.bitfield && !this.bitfield.get(message.index)) {
    this.bitfield.set(message.index, true)
    this.emit('have', message.index)
  }
  break
```

### 1.3 Update availability on BITFIELD

File: `packages/engine/src/core/torrent.ts`

Find the 'bitfield' handler in `setupPeerHandlers()` (around line 1903):

```typescript
peer.on('bitfield', (_bf) => {
  this.logger.debug('Bitfield received')
  // Update interest
  this.updateInterest(peer)
})
```

Replace with:

```typescript
peer.on('bitfield', (bf) => {
  this.logger.debug('Bitfield received')
  
  // Update piece availability
  if (this._pieceAvailability) {
    for (let i = 0; i < this.piecesCount; i++) {
      if (bf.get(i)) {
        this._pieceAvailability[i]++
      }
    }
  }
  
  // Update interest
  this.updateInterest(peer)
})
```

### 1.4 Update availability on HAVE

Find the 'have' handler (around line 1909):

```typescript
peer.on('have', (_index) => {
  this.logger.debug(`Have received ${_index}`)
  this.updateInterest(peer)
})
```

Replace with:

```typescript
peer.on('have', (index) => {
  this.logger.debug(`Have received ${index}`)
  
  // Update piece availability (peer.bitfield already updated before event)
  if (this._pieceAvailability && index < this._pieceAvailability.length) {
    this._pieceAvailability[index]++
  }
  
  this.updateInterest(peer)
})
```

### 1.5 Decrement availability on disconnect

Find `removePeer()` (around line 1975). Add availability decrement near the start, before the peer object is modified:

```typescript
private removePeer(peer: PeerConnection) {
  // Decrement piece availability for all pieces this peer had
  if (this._pieceAvailability && peer.bitfield) {
    for (let i = 0; i < this.piecesCount; i++) {
      if (peer.bitfield.get(i) && this._pieceAvailability[i] > 0) {
        this._pieceAvailability[i]--
      }
    }
  }

  // Clear pending requests for this peer
  // ... rest of existing code ...
```

### 1.6 Initialize availability when metadata received

Find where `initBitfield()` is called (in `setMetadataFromTorrent()` around line 380 and other places). Add availability initialization alongside:

```typescript
this.initBitfield(numPieces)
this.initPieceAvailability(numPieces)
```

Search for all `initBitfield` calls and add `initPieceAvailability` after each.

### 1.7 Unit tests for availability tracking

File: `packages/engine/test/piece-availability.test.ts` (new file)

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Torrent } from '../src/core/torrent'
import { BitField } from '../src/utils/bitfield'

// Mock minimal engine
const mockEngine = {
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  getLogger: () => mockEngine.logger,
}

describe('Piece Availability Tracking', () => {
  let torrent: Torrent

  beforeEach(() => {
    // Create torrent with minimal setup
    torrent = new Torrent(mockEngine as any, {
      infoHash: new Uint8Array(20),
      name: 'test',
    })
    // Simulate metadata received
    ;(torrent as any).piecesCount = 10
    torrent.initBitfield(10)
    ;(torrent as any).initPieceAvailability(10)
  })

  it('starts with zero availability', () => {
    const avail = torrent.pieceAvailability!
    for (let i = 0; i < 10; i++) {
      expect(avail[i]).toBe(0)
    }
  })

  it('increments on bitfield', () => {
    const avail = torrent.pieceAvailability!
    
    // Simulate bitfield [1,0,1,0,1,0,0,0,0,0]
    const bf = new BitField(10)
    bf.set(0, true)
    bf.set(2, true)
    bf.set(4, true)
    
    // Call the handler directly
    ;(torrent as any).handleBitfieldForAvailability(bf)
    
    expect(avail[0]).toBe(1)
    expect(avail[1]).toBe(0)
    expect(avail[2]).toBe(1)
    expect(avail[3]).toBe(0)
    expect(avail[4]).toBe(1)
  })

  it('increments on HAVE', () => {
    const avail = torrent.pieceAvailability!
    
    ;(torrent as any).handleHaveForAvailability(3)
    expect(avail[3]).toBe(1)
    
    ;(torrent as any).handleHaveForAvailability(3) // Different peer
    expect(avail[3]).toBe(2)
  })

  it('decrements on disconnect', () => {
    const avail = torrent.pieceAvailability!
    
    // Simulate peer with bitfield
    const bf = new BitField(10)
    bf.set(0, true)
    bf.set(5, true)
    
    // Peer connected
    ;(torrent as any).handleBitfieldForAvailability(bf)
    expect(avail[0]).toBe(1)
    expect(avail[5]).toBe(1)
    
    // Peer disconnects
    ;(torrent as any).handleDisconnectForAvailability(bf)
    expect(avail[0]).toBe(0)
    expect(avail[5]).toBe(0)
  })

  it('handles multiple peers correctly', () => {
    const avail = torrent.pieceAvailability!
    
    // Peer A: [1,1,0,0,...]
    const bfA = new BitField(10)
    bfA.set(0, true)
    bfA.set(1, true)
    ;(torrent as any).handleBitfieldForAvailability(bfA)
    
    // Peer B: [0,1,1,0,...]
    const bfB = new BitField(10)
    bfB.set(1, true)
    bfB.set(2, true)
    ;(torrent as any).handleBitfieldForAvailability(bfB)
    
    expect(avail[0]).toBe(1)  // Only A
    expect(avail[1]).toBe(2)  // A and B
    expect(avail[2]).toBe(1)  // Only B
    
    // A disconnects
    ;(torrent as any).handleDisconnectForAvailability(bfA)
    expect(avail[0]).toBe(0)
    expect(avail[1]).toBe(1)  // Still B
    expect(avail[2]).toBe(1)
  })

  it('handles HAVE after BITFIELD correctly', () => {
    const avail = torrent.pieceAvailability!
    
    // Peer connects with [1,0,0,...]
    const bf = new BitField(10)
    bf.set(0, true)
    ;(torrent as any).handleBitfieldForAvailability(bf)
    expect(avail[0]).toBe(1)
    expect(avail[1]).toBe(0)
    
    // Peer sends HAVE(1) - simulate bitfield update + availability increment
    bf.set(1, true)
    ;(torrent as any).handleHaveForAvailability(1)
    expect(avail[1]).toBe(1)
    
    // Peer disconnects - both pieces should decrement
    ;(torrent as any).handleDisconnectForAvailability(bf)
    expect(avail[0]).toBe(0)
    expect(avail[1]).toBe(0)
  })

  it('never goes negative', () => {
    const avail = torrent.pieceAvailability!
    
    // Try to decrement without prior increment
    const bf = new BitField(10)
    bf.set(0, true)
    ;(torrent as any).handleDisconnectForAvailability(bf)
    
    expect(avail[0]).toBe(0)  // Clamped to 0, not -1
  })
})
```

Note: You may need to expose helper methods or adjust the test approach based on how the handlers are structured. The key is testing the invariants:
- BITFIELD increments for each bit=1
- HAVE increments by 1
- Disconnect decrements for each bit=1 in peer's bitfield
- Multiple peers accumulate correctly
- Never goes negative

## Phase 2: High Priority Support

Extend file priority from `normal | skip` to `high | normal | skip`.

### 2.1 Update file priority type

File: `packages/engine/src/core/torrent.ts`

Find the file priority type/constants (search for `fileprio` or `FilePriority`). Update to support three levels:

```typescript
/** File priority levels */
export type FilePriority = 0 | 1 | 2  // 0=skip, 1=normal, 2=high

export const FILE_PRIORITY = {
  SKIP: 0 as FilePriority,
  NORMAL: 1 as FilePriority,
  HIGH: 2 as FilePriority,
}
```

### 2.2 Derive piece priority from file priorities

Piece priority = max priority of files it touches.

Add a new field and method:

```typescript
/** Per-piece priority derived from file priorities (0=skip, 1=normal, 2=high) */
private _piecePriority: Uint8Array | null = null

/**
 * Recompute piece priorities from file priorities.
 * Called when file priorities change.
 * 
 * Piece priority = max(priority of files it touches)
 * Exception: boundary pieces (mixed skip/non-skip) get priority of their non-skipped files
 */
private recomputePiecePriority(): void {
  if (!this._filePriorities || !this.files || this.piecesCount === 0) return
  
  if (!this._piecePriority) {
    this._piecePriority = new Uint8Array(this.piecesCount)
  }
  
  for (let pieceIdx = 0; pieceIdx < this.piecesCount; pieceIdx++) {
    let maxPriority = 0
    const pieceStart = pieceIdx * this.pieceLength
    const pieceEnd = Math.min(pieceStart + this.pieceLength, this.totalSize)
    
    for (let fileIdx = 0; fileIdx < this.files.length; fileIdx++) {
      const file = this.files[fileIdx]
      const fileStart = file.offset
      const fileEnd = file.offset + file.length
      
      // Check if piece overlaps file
      if (pieceStart < fileEnd && pieceEnd > fileStart) {
        const filePriority = this._filePriorities[fileIdx] ?? 1
        maxPriority = Math.max(maxPriority, filePriority)
      }
    }
    
    this._piecePriority[pieceIdx] = maxPriority
  }
}
```

Add getter:

```typescript
get piecePriority(): Uint8Array | null {
  return this._piecePriority
}
```

### 2.3 Call recomputePiecePriority when file priorities change

Find `setFilePriorities()` or similar method and add call to `recomputePiecePriority()`.

Also call it when metadata is first received (after `recomputePieceClassification()`).

### 2.4 Update shouldRequestPiece to use priority

```typescript
shouldRequestPiece(index: number): boolean {
  // Already have it
  if (this._bitfield?.get(index)) return false

  // Check priority (0 = skip)
  if (this._piecePriority && this._piecePriority[index] === 0) return false

  return true
}
```

## Phase 3: PiecePicker Algorithm

Create a first-class algorithm class for piece selection, similar to `unchoke-algorithm.ts`.

### 3.1 Create PiecePicker class

File: `packages/engine/src/core/piece-picker.ts` (new file)

```typescript
import { BitField } from '../utils/bitfield'

/**
 * Input data for piece selection.
 * All fields are read-only views - PiecePicker has no side effects.
 */
export interface PiecePickerInput {
  /** Peer's bitfield - which pieces they have */
  peerBitfield: BitField
  /** Our bitfield - which pieces we have */
  ownBitfield: BitField
  /** Per-piece priority (0=skip, 1=normal, 2=high) */
  piecePriority: Uint8Array
  /** Per-piece availability (peer count) */
  pieceAvailability: Uint16Array
  /** Set of piece indices with partial downloads */
  startedPieces: Set<number>
  /** Maximum pieces to return */
  maxPieces: number
}

/**
 * Result of piece selection.
 * Includes stats for debugging/logging.
 */
export interface PiecePickerResult {
  /** Selected piece indices in priority order */
  pieces: number[]
  /** Stats */
  stats: {
    considered: number
    skippedOwned: number
    skippedPeerLacks: number
    skippedLowPriority: number
  }
}

/**
 * Internal candidate representation for sorting.
 */
interface PieceCandidate {
  index: number
  priority: number      // 2=high, 1=normal
  availability: number  // lower = rarer
  started: boolean      // has partial data
}

/**
 * Piece selection algorithm.
 * 
 * Selection order:
 * 1. High priority pieces first
 * 2. Started (partial) pieces before new ones (complete what we started)
 * 3. Rarest pieces first (lowest availability)
 * 
 * This is a pure function - no side effects, easy to test.
 */
export class PiecePicker {
  /**
   * Select pieces to request from a peer.
   * 
   * @param input - Read-only input data
   * @returns Ordered piece indices and stats
   */
  selectPieces(input: PiecePickerInput): PiecePickerResult {
    const {
      peerBitfield,
      ownBitfield,
      piecePriority,
      pieceAvailability,
      startedPieces,
      maxPieces,
    } = input

    const candidates: PieceCandidate[] = []
    let skippedOwned = 0
    let skippedPeerLacks = 0
    let skippedLowPriority = 0

    const pieceCount = piecePriority.length

    for (let i = 0; i < pieceCount; i++) {
      // Skip if we already have it
      if (ownBitfield.get(i)) {
        skippedOwned++
        continue
      }

      // Skip if peer doesn't have it
      if (!peerBitfield.get(i)) {
        skippedPeerLacks++
        continue
      }

      // Skip if priority is 0 (skip)
      const priority = piecePriority[i]
      if (priority === 0) {
        skippedLowPriority++
        continue
      }

      candidates.push({
        index: i,
        priority,
        availability: pieceAvailability[i],
        started: startedPieces.has(i),
      })
    }

    // Sort: priority DESC, started DESC, availability ASC
    candidates.sort((a, b) => {
      // Higher priority first
      if (a.priority !== b.priority) return b.priority - a.priority
      // Started pieces first
      if (a.started !== b.started) return a.started ? -1 : 1
      // Rarer pieces first (lower availability)
      return a.availability - b.availability
    })

    return {
      pieces: candidates.slice(0, maxPieces).map((c) => c.index),
      stats: {
        considered: candidates.length,
        skippedOwned,
        skippedPeerLacks,
        skippedLowPriority,
      },
    }
  }
}
```

### 3.2 Unit tests for PiecePicker

File: `packages/engine/test/piece-picker.test.ts` (new file)

```typescript
import { describe, it, expect } from 'vitest'
import { PiecePicker, PiecePickerInput } from '../src/core/piece-picker'
import { BitField } from '../src/utils/bitfield'

describe('PiecePicker', () => {
  const picker = new PiecePicker()

  function makeInput(overrides: Partial<PiecePickerInput> = {}): PiecePickerInput {
    const pieceCount = 10
    return {
      peerBitfield: new BitField(pieceCount).fill(true), // Peer has all
      ownBitfield: new BitField(pieceCount), // We have none
      piecePriority: new Uint8Array(pieceCount).fill(1), // All normal
      pieceAvailability: new Uint16Array(pieceCount).fill(5), // All same availability
      startedPieces: new Set(),
      maxPieces: 50,
      ...overrides,
    }
  }

  it('returns pieces peer has that we need', () => {
    const input = makeInput()
    const result = picker.selectPieces(input)
    
    expect(result.pieces.length).toBe(10)
    expect(result.stats.skippedOwned).toBe(0)
    expect(result.stats.skippedPeerLacks).toBe(0)
  })

  it('skips pieces we already have', () => {
    const ownBitfield = new BitField(10)
    ownBitfield.set(0, true)
    ownBitfield.set(5, true)
    
    const input = makeInput({ ownBitfield })
    const result = picker.selectPieces(input)
    
    expect(result.pieces).not.toContain(0)
    expect(result.pieces).not.toContain(5)
    expect(result.stats.skippedOwned).toBe(2)
  })

  it('skips pieces peer lacks', () => {
    const peerBitfield = new BitField(10)
    peerBitfield.set(0, true)
    peerBitfield.set(1, true)
    // Peer only has pieces 0 and 1
    
    const input = makeInput({ peerBitfield })
    const result = picker.selectPieces(input)
    
    expect(result.pieces).toEqual([0, 1])
    expect(result.stats.skippedPeerLacks).toBe(8)
  })

  it('skips low priority (skip) pieces', () => {
    const piecePriority = new Uint8Array([1, 1, 0, 0, 1, 1, 0, 1, 1, 1])
    // Pieces 2, 3, 6 are skipped
    
    const input = makeInput({ piecePriority })
    const result = picker.selectPieces(input)
    
    expect(result.pieces).not.toContain(2)
    expect(result.pieces).not.toContain(3)
    expect(result.pieces).not.toContain(6)
    expect(result.stats.skippedLowPriority).toBe(3)
  })

  it('prioritizes high priority pieces', () => {
    const piecePriority = new Uint8Array([1, 1, 2, 1, 2, 1, 1, 1, 1, 1])
    // Pieces 2 and 4 are high priority
    
    const input = makeInput({ piecePriority })
    const result = picker.selectPieces(input)
    
    // High priority should come first
    expect(result.pieces[0]).toBe(2)
    expect(result.pieces[1]).toBe(4)
  })

  it('prioritizes started pieces over new ones', () => {
    const startedPieces = new Set([5, 7])
    
    const input = makeInput({ startedPieces })
    const result = picker.selectPieces(input)
    
    // Started pieces should come first (within same priority)
    expect(result.pieces[0]).toBe(5)
    expect(result.pieces[1]).toBe(7)
  })

  it('prioritizes rarer pieces (lower availability)', () => {
    const pieceAvailability = new Uint16Array([10, 5, 15, 1, 8, 3, 20, 7, 2, 12])
    // Rarity order: 3(1), 8(2), 5(3), 1(5), 7(7), 4(8), 0(10), 9(12), 2(15), 6(20)
    
    const input = makeInput({ pieceAvailability })
    const result = picker.selectPieces(input)
    
    expect(result.pieces[0]).toBe(3)  // availability 1
    expect(result.pieces[1]).toBe(8)  // availability 2
    expect(result.pieces[2]).toBe(5)  // availability 3
  })

  it('applies priority > started > availability order', () => {
    // Piece 0: normal, not started, availability 1 (very rare)
    // Piece 1: high, not started, availability 10 (common)
    // Piece 2: normal, started, availability 10 (common)
    // Piece 3: high, started, availability 5
    
    const piecePriority = new Uint8Array([1, 2, 1, 2])
    const pieceAvailability = new Uint16Array([1, 10, 10, 5])
    const startedPieces = new Set([2, 3])
    const peerBitfield = new BitField(4).fill(true)
    const ownBitfield = new BitField(4)
    
    const input = makeInput({
      piecePriority,
      pieceAvailability,
      startedPieces,
      peerBitfield,
      ownBitfield,
      maxPieces: 50,
    })
    const result = picker.selectPieces(input)
    
    // Order should be:
    // 1. Piece 3: high priority, started
    // 2. Piece 1: high priority, not started
    // 3. Piece 2: normal, started
    // 4. Piece 0: normal, not started (even though rarest)
    expect(result.pieces).toEqual([3, 1, 2, 0])
  })

  it('respects maxPieces limit', () => {
    const input = makeInput({ maxPieces: 3 })
    const result = picker.selectPieces(input)
    
    expect(result.pieces.length).toBe(3)
  })

  it('handles empty peer bitfield', () => {
    const peerBitfield = new BitField(10) // Peer has nothing
    
    const input = makeInput({ peerBitfield })
    const result = picker.selectPieces(input)
    
    expect(result.pieces).toEqual([])
    expect(result.stats.skippedPeerLacks).toBe(10)
  })

  it('handles all pieces owned', () => {
    const ownBitfield = new BitField(10).fill(true) // We have everything
    
    const input = makeInput({ ownBitfield })
    const result = picker.selectPieces(input)
    
    expect(result.pieces).toEqual([])
    expect(result.stats.skippedOwned).toBe(10)
  })
})
```

## Phase 4: Wire PiecePicker into Torrent

### 4.1 Add PiecePicker instance to Torrent

File: `packages/engine/src/core/torrent.ts`

Add import:

```typescript
import { PiecePicker } from './piece-picker'
```

Add field (around line 150):

```typescript
private _piecePicker = new PiecePicker()
```

### 4.2 Replace getMissingPieces iteration with selectPieces

Find `requestPieces()` method (around line 2244). Replace the sequential iteration with PiecePicker:

Current code:
```typescript
const missing = this.getMissingPieces()
// ... loop over missing ...
```

Replace with:
```typescript
// Select pieces using rarest-first algorithm
if (!this._pieceAvailability || !this._piecePriority || !this._bitfield || !peer.bitfield) {
  return
}

const result = this._piecePicker.selectPieces({
  peerBitfield: peer.bitfield,
  ownBitfield: this._bitfield,
  piecePriority: this._piecePriority,
  pieceAvailability: this._pieceAvailability,
  startedPieces: new Set(this.activePieces?.activeIndices ?? []),
  maxPieces: 100, // Reasonable upper bound
})

for (const index of result.pieces) {
  if (peer.requestsPending >= peer.pipelineDepth) break
  
  // ... rest of existing block request logic ...
}
```

The rest of the loop body (getting/creating ActivePiece, getting needed blocks, sending requests) stays the same.

### 4.3 Remove getMissingPieces (or keep for other uses)

The `getMissingPieces()` method may still be useful for:
- Progress calculation
- Endgame detection
- UI display

If still needed, keep it but don't use it in `requestPieces()`.

## Phase 5: Remove maxActivePieces Cap

### 5.1 Update ActivePieceManager config

File: `packages/engine/src/core/active-piece-manager.ts`

Change the default config (around line 11):

```typescript
const DEFAULT_CONFIG: ActivePieceConfig = {
  requestTimeoutMs: 30000,
  maxActivePieces: 10000,  // Was 150, effectively unlimited now
  maxBufferedBytes: 128 * 1024 * 1024, // 128 MB - this is the real limit
  cleanupIntervalMs: 10000,
}
```

### 5.2 Simplify getOrCreate (optional)

The capacity check can be simplified since we rely on `maxBufferedBytes`:

```typescript
getOrCreate(index: number): ActivePiece | null {
  let piece = this.pieces.get(index)
  if (piece) return piece

  // Memory limit is the real constraint
  if (this.totalBufferedBytes >= this.config.maxBufferedBytes) {
    this.logger.debug(`Cannot create piece ${index}: memory limit reached`)
    return null
  }

  // Piece count is now a soft limit (log spam prevention)
  if (this.pieces.size >= this.config.maxActivePieces) {
    this.cleanupStale()
    // Continue anyway - memory limit is the real guard
  }

  const length = this.pieceLengthFn(index)
  piece = new ActivePiece(index, length)
  this.pieces.set(index, piece)
  this.logger.debug(`Created active piece ${index}`)
  return piece
}
```

## Phase 6: Integration Testing

### 6.1 Test with real torrent

Manual testing checklist:
1. Start a multi-piece torrent
2. Verify pieces are requested rarest-first (check logs)
3. Verify high-priority file pieces come first
4. Verify started pieces are prioritized over new ones
5. Verify no "at capacity" log spam
6. Verify download completes successfully

### 6.2 Add integration test

File: `packages/engine/integration/python/test_rarest_first.py` (new file)

```python
"""
Test that rarest-first piece selection works correctly.
Uses libtorrent to create a controlled scenario.
"""
import asyncio
import libtorrent as lt
from pathlib import Path
# ... test implementation ...
```

This is lower priority - manual testing is sufficient for initial validation.

## Verification

After implementation, run:

```bash
# Type check
pnpm typecheck

# Unit tests
pnpm test

# Lint
pnpm lint

# Format
pnpm format:fix
```

## Summary of Changes

| File | Change |
|------|--------|
| `peer-connection.ts` | Only emit 'have' for new pieces |
| `torrent.ts` | Add availability tracking, piece priority, use PiecePicker |
| `piece-picker.ts` | New file - rarest-first algorithm |
| `active-piece-manager.ts` | Remove/raise maxActivePieces cap |
| `test/piece-availability.test.ts` | New tests for availability tracking |
| `test/piece-picker.test.ts` | New tests for picker algorithm |

## Future Work

- **HAVE_ALL support (BEP 6):** Currently not implemented. When added, need to increment availability for all pieces when HAVE_ALL received.
- **Sequential mode:** For streaming, add option to prefer sequential pieces over rarest.
- **Strict priority:** Option to only request high-priority until complete, then normal.
