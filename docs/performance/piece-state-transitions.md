# Piece State Transitions: Aligning with libtorrent

**Created**: 2025-01-27
**Status**: Option A implemented (three-state model)
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

## Our Current States (Option A Implemented)

| State | Map | Counts toward cap? |
|-------|-----|-------------------|
| Not started | (not tracked) | No |
| Partial (has unrequested blocks) | `_partialPieces` | **Yes** |
| Full (all blocks requested) | `_fullPieces` | **No** |
| Pending (awaiting hash) | `_pendingPieces` | No |

This matches libtorrent's model exactly. When a piece has all blocks requested, it transitions to `_fullPieces` and no longer counts against the partial cap.

## Current Implementation (Option A - Three-State Model)

As of 2025-01-27, Option A is implemented with a three-state model matching libtorrent.

### Key Components

**ActivePieceManager** (`active-piece-manager.ts`):
- `_partialPieces`: Pieces with unrequested blocks (counts against cap)
- `_fullPieces`: Pieces with all blocks requested (does NOT count against cap)
- `_pendingPieces`: Pieces awaiting hash verification

**State Transitions**:
- `promoteToFull(pieceIndex)`: Partial → Full (when all blocks requested)
- `demoteToPartial(pieceIndex)`: Full → Partial (when request cancelled/timed out)
- `promoteToPending(pieceIndex)`: Full/Partial → Pending (when all blocks received)

**Torrent.ts Integration**:
After each `addRequest()` call, check if piece should be promoted:
```typescript
piece.addRequest(blockIndex, peerId)
if (!piece.hasUnrequestedBlocks()) {
  this.activePieces.promoteToFull(piece.index)
}
```

The Phase 2 cap check is now simple (no workaround needed):
```typescript
if (this.activePieces.shouldPrioritizePartials(connectedPeerCount)) {
  return // Partial pieces have unrequested blocks - prioritize completion
}
```

**Automatic Demotion**:
- `clearRequestsForPeer()` automatically demotes full pieces when requests are cleared
- `checkTimeouts()` automatically demotes full pieces when requests timeout
- `cleanupStuckPieces()` checks full pieces for stale requests and demotes as needed

## Implementation Options

### Option A: Three-State Model (IMPLEMENTED)

The three-state model with `_fullPieces` map, matching libtorrent:

```typescript
class ActivePieceManager {
  private _partialPieces: Map<number, ActivePiece>  // has unrequested blocks
  private _fullPieces: Map<number, ActivePiece>     // all blocks requested
  private _pendingPieces: Map<number, ActivePiece>  // all blocks received

  // Cap only counts partials - O(1) check
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

  // Transition when request cancelled
  demoteToPartial(pieceIndex: number): void {
    const piece = this._fullPieces.get(pieceIndex)
    if (piece && piece.hasUnrequestedBlocks()) {
      this._fullPieces.delete(pieceIndex)
      this._partialPieces.set(pieceIndex, piece)
    }
  }

  // Transition when last block received
  promoteToPending(pieceIndex: number): void {
    const piece = this._fullPieces.get(pieceIndex) ?? this._partialPieces.get(pieceIndex)
    if (piece) {
      this._fullPieces.delete(pieceIndex)
      this._partialPieces.delete(pieceIndex)
      this._pendingPieces.set(pieceIndex, piece)
    }
  }
}
```

**Benefits**:
1. Matches libtorrent's proven model exactly
2. `shouldPrioritizePartials()` is O(1) - just check map size
3. No `hasUnrequestedBlocks()` scan in hot path
4. Clearer semantics and easier to reason about
5. Phase 1 iteration is faster - only iterates pieces with work to do

### Option B: Workaround (SUPERSEDED)

The previous workaround checked `hasUnrequestedBlocks()` in the Phase 2 cap:

```typescript
if (this.activePieces.shouldPrioritizePartials(connectedPeerCount)) {
  if (this.activePieces.hasUnrequestedBlocks()) {
    return // Block phase 2
  }
  // Fall through: no unrequested blocks, allow new pieces
}
```

This was simpler but required an O(partials × blocks) scan on each `requestPieces()` call.

## Implementation Summary (Option A)

The three-state model is implemented in:

### ActivePieceManager (`active-piece-manager.ts`)

- `_fullPieces` map added alongside `_partialPieces` and `_pendingPieces`
- `promoteToFull()` / `demoteToPartial()` / `promoteToPending()` handle transitions
- `fullCount` / `isFull()` / `fullValues()` for state introspection
- `downloadingValues()` iterates both partial and full pieces
- `clearRequestsForPeer()` and `checkTimeouts()` auto-demote full pieces

### Torrent (`torrent.ts`)

- After `addRequest()`, calls `promoteToFull()` if piece is fully requested
- `cleanupStuckPieces()` checks full pieces for stale requests
- Phase 2 cap check simplified (no `hasUnrequestedBlocks()` workaround)

## Tests

Tests for the three-state model are in `packages/engine/test/core/partial-piece-limiting.test.ts`:

- `promoteToFull` - Tests partial → full transitions
- `demoteToPartial` - Tests full → partial transitions
- `three-state transitions` - Tests complete lifecycle
- `full pieces and partial cap` - Validates cap only counts partials
- `fullValues and downloadingValues iterators` - Tests iteration helpers
- `clearRequestsForPeer with full pieces` - Tests auto-demotion

## Migration Notes

Option A was implemented in a single commit with:

1. Added `_fullPieces` map to `ActivePieceManager`
2. Added `promoteToFull()`, `demoteToPartial()` methods
3. Updated `get()`, `has()`, `promoteToPending()` to check all three maps
4. Added `isFull()`, `fullCount`, `fullValues()`, `downloadingValues()`
5. Updated `clearRequestsForPeer()` and `checkTimeouts()` to auto-demote
6. Updated `torrent.ts` to call `promoteToFull()` after `addRequest()`
7. Updated `cleanupStuckPieces()` to check full pieces for stale requests
8. Removed the `hasUnrequestedBlocks()` workaround from Phase 2 cap check
9. Added comprehensive tests for three-state transitions

## Verification

### Unit Tests

Run the unit tests:
```bash
pnpm test packages/engine/test/core/partial-piece-limiting.test.ts
```

### E2E Verification

Validate with the e2e download test:
```bash
./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.jstorrent.app.e2e.DownloadE2ETest
```

Expected observations:
- Consistent download speed (no stalls)
- `partialCount` staying low (0-2)
- `fullCount` growing as pieces fill up
- Pipeline staying full (~500 requests)
- No `hasUnrequestedBlocks()` calls in request hot path
