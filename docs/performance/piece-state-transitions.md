# Piece State Transitions: Aligning with libtorrent

**Created**: 2025-01-27
**Status**: Implementation needed
**Related**: [piece-picker-overhaul.md](./piece-picker-overhaul.md)

## Problem

Our partial piece cap causes download stalls in single-peer scenarios because we treat "fully requested" pieces the same as "partially requested" pieces. libtorrent avoids this by tracking piece states more granularly.

## libtorrent's Piece States

libtorrent uses these states (from `piece_picker.hpp:171-233`):

| State | Meaning | Counts toward partial cap? |
|-------|---------|---------------------------|
| `piece_open` | Not yet started | No |
| `piece_downloading` | Has unrequested blocks | **Yes** |
| `piece_full` | All blocks requested, not all received | **No** |
| `piece_finished` | All blocks received, awaiting hash | No |

The key insight: **`piece_full` pieces don't count against the partial cap**.

When a peer requests the last unrequested block of a piece, it transitions from `piece_downloading` → `piece_full`. This immediately allows new pieces to start.

## Our Current States

| State | Map | Counts toward cap? |
|-------|-----|-------------------|
| Not started | (not tracked) | No |
| Partial (any) | `_partialPieces` | **Yes** |
| Complete, awaiting hash | `_pendingPieces` | No |

We're missing the `piece_full` state. A piece with all 16 blocks requested still lives in `_partialPieces` and counts against the cap.

## The Fix

### Option A: Add `_fullPieces` map (libtorrent way)

Add a third map for pieces where all blocks are requested but not all received:

```typescript
class ActivePieceManager {
  private _partialPieces: Map<number, ActivePiece>  // has unrequested blocks
  private _fullPieces: Map<number, ActivePiece>     // all blocks requested (NEW)
  private _pendingPieces: Map<number, ActivePiece>  // all blocks received

  // Cap only counts partials
  shouldPrioritizePartials(peerCount: number): boolean {
    return this._partialPieces.size > this.getMaxPartials(peerCount)
  }

  // Transition when last block requested
  promoteToFull(pieceIndex: number): void {
    const piece = this._partialPieces.get(pieceIndex)
    if (piece && !piece.hasUnrequestedBlocks()) {
      this._partialPieces.delete(pieceIndex)
      this._fullPieces.set(pieceIndex, piece)
    }
  }

  // Transition when last block received
  promoteToPending(pieceIndex: number): void {
    const piece = this._fullPieces.get(pieceIndex) ?? this._partialPieces.get(pieceIndex)
    if (piece?.haveAllBlocks) {
      this._partialPieces.delete(pieceIndex)
      this._fullPieces.delete(pieceIndex)
      this._pendingPieces.set(pieceIndex, piece)
    }
  }
}
```

### Option B: Keep current fix (pragmatic)

Our current fix achieves the same result without adding a new map:

```typescript
if (this.activePieces.shouldPrioritizePartials(connectedPeerCount)) {
  if (this.activePieces.hasUnrequestedBlocks()) {
    return // Block phase 2
  }
  // Fall through: no unrequested blocks, allow new pieces
}
```

This effectively treats "no unrequested blocks" as the `piece_full` state.

### Recommendation: Option A

Option A is cleaner because:
1. Matches libtorrent's proven model
2. `shouldPrioritizePartials()` becomes O(1) - just check map size
3. No need for `hasUnrequestedBlocks()` scan in hot path
4. Clearer semantics and easier to reason about
5. Makes iteration faster - Phase 1 only iterates pieces with work to do

## Implementation Plan

### 1. Add `_fullPieces` map to ActivePieceManager

```typescript
private _fullPieces: Map<number, ActivePiece> = new Map()

get fullCount(): number {
  return this._fullPieces.size
}

// Update iteration methods
partialValues(): IterableIterator<ActivePiece> {
  return this._partialPieces.values()  // Only pieces with unrequested blocks
}

fullValues(): IterableIterator<ActivePiece> {
  return this._fullPieces.values()
}

// Combined for Phase 1 (need to check both for incoming blocks)
*downloadingValues(): IterableIterator<ActivePiece> {
  yield* this._partialPieces.values()
  yield* this._fullPieces.values()
}
```

### 2. Add `promoteToFull()` method

Called when a request is added and piece becomes fully-requested:

```typescript
promoteToFull(pieceIndex: number): void {
  const piece = this._partialPieces.get(pieceIndex)
  if (!piece) return

  if (!piece.hasUnrequestedBlocks()) {
    this._partialPieces.delete(pieceIndex)
    this._fullPieces.set(pieceIndex, piece)
    this.logger.debug(`Piece ${pieceIndex} promoted to full (all blocks requested)`)
  }
}
```

### 3. Update `addRequest()` call site in torrent.ts

After adding a request, check if piece should be promoted:

```typescript
piece.addRequest(blockIndex, peerId)

// Check if piece is now fully requested
if (!piece.hasUnrequestedBlocks()) {
  this.activePieces.promoteToFull(piece.index)
}
```

### 4. Update `promoteToPending()` to check both maps

```typescript
promoteToPending(pieceIndex: number): void {
  // Check full pieces first (most likely)
  let piece = this._fullPieces.get(pieceIndex)
  if (piece) {
    this._fullPieces.delete(pieceIndex)
    this._pendingPieces.set(pieceIndex, piece)
    return
  }

  // Also check partials (edge case: received blocks without requesting)
  piece = this._partialPieces.get(pieceIndex)
  if (piece) {
    this._partialPieces.delete(pieceIndex)
    this._pendingPieces.set(pieceIndex, piece)
  }
}
```

### 5. Update `get()` and `has()` to check all three maps

```typescript
get(index: number): ActivePiece | undefined {
  return this._partialPieces.get(index)
    ?? this._fullPieces.get(index)
    ?? this._pendingPieces.get(index)
}

has(index: number): boolean {
  return this._partialPieces.has(index)
    || this._fullPieces.has(index)
    || this._pendingPieces.has(index)
}
```

### 6. Handle request cancellation (piece goes back to partial)

When a request is cancelled (timeout, peer disconnect), piece may need to move back:

```typescript
demoteToPartial(pieceIndex: number): void {
  const piece = this._fullPieces.get(pieceIndex)
  if (piece && piece.hasUnrequestedBlocks()) {
    this._fullPieces.delete(pieceIndex)
    this._partialPieces.set(pieceIndex, piece)
    this.logger.debug(`Piece ${pieceIndex} demoted to partial (has unrequested blocks)`)
  }
}
```

### 7. Remove the `hasUnrequestedBlocks()` workaround

The Phase 2 cap check becomes simple again:

```typescript
if (this.activePieces.shouldPrioritizePartials(connectedPeerCount)) {
  return  // Only partials count, and they have work to do
}
```

## Tests

### Test 1: Piece state transitions

```typescript
describe('Piece State Transitions', () => {
  it('should start pieces in partial state', () => {
    const piece = manager.getOrCreate(0)
    expect(manager.isPartial(0)).toBe(true)
    expect(manager.isFull(0)).toBe(false)
    expect(manager.partialCount).toBe(1)
  })

  it('should promote to full when all blocks requested', () => {
    const piece = manager.getOrCreate(0)!

    // Request all blocks
    for (let i = 0; i < piece.blocksNeeded; i++) {
      piece.addRequest(i, 'peer1')
    }
    manager.promoteToFull(0)

    expect(manager.isPartial(0)).toBe(false)
    expect(manager.isFull(0)).toBe(true)
    expect(manager.partialCount).toBe(0)
    expect(manager.fullCount).toBe(1)
  })

  it('should demote to partial when request cancelled', () => {
    const piece = manager.getOrCreate(0)!
    for (let i = 0; i < piece.blocksNeeded; i++) {
      piece.addRequest(i, 'peer1')
    }
    manager.promoteToFull(0)

    // Cancel a request
    piece.cancelRequest(0, 'peer1')
    manager.demoteToPartial(0)

    expect(manager.isPartial(0)).toBe(true)
    expect(manager.isFull(0)).toBe(false)
  })

  it('should promote to pending when all blocks received', () => {
    const piece = manager.getOrCreate(0)!
    for (let i = 0; i < piece.blocksNeeded; i++) {
      piece.addBlock(i, new Uint8Array(BLOCK_SIZE), 'peer1')
    }
    manager.promoteToPending(0)

    expect(manager.isFull(0)).toBe(false)
    expect(manager.isPending(0)).toBe(true)
  })
})
```

### Test 2: Partial cap only counts partials

```typescript
describe('Partial Cap with State Transitions', () => {
  it('should not count full pieces against cap', () => {
    // 1 peer = cap of 1
    expect(manager.shouldPrioritizePartials(1)).toBe(false)

    // Create piece 0 and fully request it
    const piece0 = manager.getOrCreate(0)!
    for (let i = 0; i < piece0.blocksNeeded; i++) {
      piece0.addRequest(i, 'peer1')
    }
    manager.promoteToFull(0)

    // Still under cap because full pieces don't count
    expect(manager.shouldPrioritizePartials(1)).toBe(false)
    expect(manager.partialCount).toBe(0)
    expect(manager.fullCount).toBe(1)

    // Can create another piece
    const piece1 = manager.getOrCreate(1)!
    expect(piece1).not.toBeNull()
    expect(manager.partialCount).toBe(1)
  })

  it('should allow filling pipeline with single peer', () => {
    const pipelineDepth = 500
    const blocksPerPiece = 16
    const piecesNeeded = Math.ceil(pipelineDepth / blocksPerPiece)  // 32 pieces

    for (let p = 0; p < piecesNeeded; p++) {
      const piece = manager.getOrCreate(p)
      expect(piece).not.toBeNull()

      // Request all blocks
      for (let b = 0; b < piece!.blocksNeeded; b++) {
        piece!.addRequest(b, 'peer1')
      }
      manager.promoteToFull(p)

      // Should never be blocked by cap (all promoted to full)
      expect(manager.shouldPrioritizePartials(1)).toBe(false)
    }

    expect(manager.fullCount).toBe(piecesNeeded)
    expect(manager.partialCount).toBe(0)
  })
})
```

### Test 3: Single-peer download flow

```typescript
describe('Single-Peer Download Flow', () => {
  it('should not stall with single fast peer', () => {
    const peerCount = 1
    const pipelineDepth = 500
    let totalRequests = 0

    while (totalRequests < pipelineDepth) {
      // Should never be blocked
      expect(manager.shouldPrioritizePartials(peerCount)).toBe(false)

      // Start a new piece
      const pieceIndex = manager.activeCount
      const piece = manager.getOrCreate(pieceIndex)!

      // Request all blocks
      for (let b = 0; b < piece.blocksNeeded && totalRequests < pipelineDepth; b++) {
        piece.addRequest(b, 'peer1')
        totalRequests++
      }

      // Promote if fully requested
      if (!piece.hasUnrequestedBlocks()) {
        manager.promoteToFull(pieceIndex)
      }
    }

    expect(totalRequests).toBe(pipelineDepth)
    expect(manager.partialCount).toBeLessThanOrEqual(1)  // At most 1 partial
  })
})
```

## Migration

1. Implement changes in `active-piece-manager.ts`
2. Update call sites in `torrent.ts` to call `promoteToFull()` and `demoteToPartial()`
3. Add tests
4. Remove the `hasUnrequestedBlocks()` workaround from Phase 2 cap check
5. Update design doc to reflect new state model

## Verification

After implementation, test with:
```bash
./scripts/dev-test-native.sh pixel7a --size 1gb
```

Should see:
- Consistent download speed (no stalls)
- `partialCount` staying low (0-2)
- `fullCount` growing as pieces fill up
- Pipeline staying full (~500 requests)
