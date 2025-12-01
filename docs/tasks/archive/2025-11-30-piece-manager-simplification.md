# PieceManager Simplification

## Goal

Eliminate `PieceManager` and the internal `Piece` class. Move essential functionality directly onto `Torrent`. This simplifies the codebase by removing redundant abstractions — `ActivePiece` already handles block-level tracking during download, and seeding bypasses `Piece` entirely.

## Current State

```
Torrent
  ├── pieceManager: PieceManager
  │     ├── pieces: Piece[]           # Tracks block-level completion (redundant with ActivePiece)
  │     ├── pieceHashes: Uint8Array[] # SHA1 hashes for verification
  │     ├── piecesCount: number
  │     ├── completedPieces: number   # Derived from bitfield
  │     └── (reference to torrent.bitfield)
  │
  ├── activePieces: ActivePieceManager
  │     └── pieces: Map<number, ActivePiece>  # Block data + request tracking
  │
  ├── bitfield: BitField              # What pieces we have (owned by Torrent)
  └── contentStorage: TorrentContentStorage
```

Problems:
1. `Piece` class tracks block completion, but `ActivePiece` does this better
2. `PieceManager` is mostly a thin wrapper around `Torrent.bitfield`
3. Seeding reads directly from `contentStorage`, bypassing `Piece` entirely
4. Two parallel hierarchies (`Piece` vs `ActivePiece`) with unclear relationship

## Target State

```
Torrent
  ├── bitfield: BitField              # What pieces we have
  ├── pieceHashes: Uint8Array[]       # SHA1 hashes for verification
  ├── pieceLength: number             # Standard piece size
  ├── lastPieceLength: number         # Size of final piece
  ├── piecesCount: number             # Total piece count
  │
  ├── activePieces: ActivePieceManager
  │     └── pieces: Map<number, ActivePiece>
  │
  └── contentStorage: TorrentContentStorage
```

## Migration Steps

### Phase 1: Add fields to Torrent

Add new fields to `Torrent` class (can coexist with `PieceManager` temporarily):

```typescript
// In torrent.ts
class Torrent {
  // New fields
  public pieceHashes: Uint8Array[] = []
  public pieceLength: number = 0
  public lastPieceLength: number = 0
  public piecesCount: number = 0
}
```

### Phase 2: Add helper methods to Torrent

Move methods from `PieceManager` to `Torrent`:

```typescript
// In torrent.ts
class Torrent {
  // --- Piece Metadata ---
  
  getPieceHash(index: number): Uint8Array | undefined {
    return this.pieceHashes[index]
  }

  getPieceLength(index: number): number {
    if (index === this.piecesCount - 1) {
      return this.lastPieceLength
    }
    return this.pieceLength
  }

  // --- Bitfield Helpers ---

  hasPiece(index: number): boolean {
    return this.bitfield?.get(index) ?? false
  }

  markPieceVerified(index: number): void {
    this.bitfield?.set(index, true)
  }

  resetPiece(index: number): void {
    this.bitfield?.set(index, false)
  }

  getMissingPieces(): number[] {
    if (!this.bitfield) return []
    const missing: number[] = []
    for (let i = 0; i < this.piecesCount; i++) {
      if (!this.bitfield.get(i)) {
        missing.push(i)
      }
    }
    return missing
  }

  // --- Progress ---

  get completedPiecesCount(): number {
    return this.bitfield?.count() ?? 0
  }

  get progress(): number {
    if (this.piecesCount === 0) return 0
    return this.completedPiecesCount / this.piecesCount
  }

  get isDownloadComplete(): boolean {
    return this.completedPiecesCount === this.piecesCount
  }

  // --- Session Restore ---

  restoreBitfieldFromHex(hex: string): void {
    this.bitfield?.restoreFromHex(hex)
  }
}
```

### Phase 3: Update initialization code

Modify `BtEngine.addTorrent()` and related code to populate `Torrent` fields directly instead of creating `PieceManager`:

**In bt-engine.ts `initComponents()`:**

```typescript
// Before:
const pieceManager = new PieceManager(
  this,
  torrent,
  parsedTorrent.pieces.length,
  parsedTorrent.pieceLength,
  parsedTorrent.length % parsedTorrent.pieceLength || parsedTorrent.pieceLength,
  parsedTorrent.pieces,
)
torrent.pieceManager = pieceManager

// After:
torrent.initPieceInfo(
  parsedTorrent.pieces,          // pieceHashes
  parsedTorrent.pieceLength,
  parsedTorrent.length % parsedTorrent.pieceLength || parsedTorrent.pieceLength,
)
```

**Add to Torrent:**

```typescript
initPieceInfo(pieceHashes: Uint8Array[], pieceLength: number, lastPieceLength: number): void {
  this.pieceHashes = pieceHashes
  this.pieceLength = pieceLength
  this.lastPieceLength = lastPieceLength
  this.piecesCount = pieceHashes.length
}
```

### Phase 4: Update all call sites

Find and update all references to `pieceManager`:

| Old Call | New Call |
|----------|----------|
| `torrent.pieceManager.hasPiece(i)` | `torrent.hasPiece(i)` |
| `torrent.pieceManager.getPieceHash(i)` | `torrent.getPieceHash(i)` |
| `torrent.pieceManager.getPieceLength(i)` | `torrent.getPieceLength(i)` |
| `torrent.pieceManager.getPieceCount()` | `torrent.piecesCount` |
| `torrent.pieceManager.getCompletedCount()` | `torrent.completedPiecesCount` |
| `torrent.pieceManager.getMissingPieces()` | `torrent.getMissingPieces()` |
| `torrent.pieceManager.getProgress()` | `torrent.progress` |
| `torrent.pieceManager.isComplete()` | `torrent.isDownloadComplete` |
| `torrent.pieceManager.markVerified(i)` | `torrent.markPieceVerified(i)` |
| `torrent.pieceManager.resetPiece(i)` | `torrent.resetPiece(i)` |
| `torrent.pieceManager.restoreFromHex(hex)` | `torrent.restoreBitfieldFromHex(hex)` |
| `torrent.pieceManager.getBitField()` | `torrent.bitfield` |
| `torrent.pieceManager?.isPieceComplete(i)` | (remove - not needed, use `hasPiece`) |
| `torrent.pieceManager?.addReceived(i, begin)` | (remove - ActivePiece tracks this) |

### Phase 5: Update checks for "has metadata"

Currently code checks `if (torrent.pieceManager)` to see if metadata is available. Replace with:

```typescript
// Before:
if (!this.pieceManager) return

// After:
if (!this.hasMetadata) return

// Add to Torrent:
get hasMetadata(): boolean {
  return this.piecesCount > 0
}
```

### Phase 6: Delete PieceManager

1. Remove `piece-manager.ts`
2. Remove import from `torrent.ts`
3. Remove `pieceManager` field from `Torrent`
4. Update `index.ts` exports if needed

### Phase 7: Update tests

Update any tests that directly use `PieceManager`:
- `test/core/piece-manager.spec.ts` → delete or convert to test `Torrent` methods
- Any tests that mock `pieceManager`

## Files to Modify

1. **packages/engine/src/core/torrent.ts** - Add fields and methods
2. **packages/engine/src/core/bt-engine.ts** - Update initialization
3. **packages/engine/src/core/session-persistence.ts** - Update restore logic
4. **packages/engine/src/core/engine-state.ts** - Update state serialization
5. **packages/engine/src/core/torrent-file-info.ts** - Change to use Torrent instead of PieceManager
6. **packages/engine/src/core/active-piece.ts** - Move BLOCK_SIZE here (or to constants.ts)
7. **packages/engine/src/core/piece-manager.ts** - Delete
8. **packages/engine/test/core/piece-manager.spec.ts** - Delete or convert
9. **packages/engine/test/core/bt-engine.spec.ts** - Update mocks/assertions
10. **packages/engine/src/index.ts** - Remove PieceManager export if present

### TorrentFileInfo Changes

`TorrentFileInfo` currently takes a `PieceManager` reference. Change it to take `Torrent` instead:

```typescript
// Before:
export class TorrentFileInfo {
  constructor(
    private file: TorrentFile,
    private pieceManager: PieceManager,
    private pieceLength: number,
  ) {}

// After:
export class TorrentFileInfo {
  constructor(
    private file: TorrentFile,
    private torrent: Torrent,
  ) {}

  get downloaded(): number {
    if (!this.torrent.bitfield) return 0
    // ... use this.torrent.hasPiece(i), this.torrent.getPieceLength(i), this.torrent.pieceLength
  }
}
```

### BLOCK_SIZE Location

Move `BLOCK_SIZE` from `piece-manager.ts` to `active-piece.ts` since that's where it's primarily used:

```typescript
// In active-piece.ts
export const BLOCK_SIZE = 16384
```

Update imports in `torrent.ts`:
```typescript
// Before:
import { PieceManager, BLOCK_SIZE } from './piece-manager'

// After:
import { BLOCK_SIZE } from './active-piece'
```

## Call Sites to Update

There are ~60 references to `pieceManager` across the codebase. Here are the key files:

### torrent.ts (~30 references)
- Constructor parameter and field assignment
- `initFiles()` - creates TorrentFileInfo with pieceManager
- `downloadProgress` getter
- `isReady` getter (checks `!!this.pieceManager`)
- `getPieceAvailability()` 
- `addPeer()` - creates BitField with pieceManager.getPieceCount()
- `requestPieces()` - uses getMissingPieces, getPieceLength
- `handlePiece()` - lazy init of activePieces uses pieceManager
- `verifyPiece()` - uses getPieceHash, getPieceLength
- `onPieceComplete()` - uses resetPiece, markVerified, getPieceCount, getCompletedCount
- `recheckData()` - iterates all pieces, uses hasPiece, markVerified, resetPiece
- `checkCompletion()` - uses isComplete()

### bt-engine.ts (~10 references)
- `initComponents()` - creates PieceManager
- `initTorrentFromSavedMetadata()` - creates PieceManager
- Constructor passes `undefined` for pieceManager

### session-persistence.ts (~5 references)
- Restore logic checks `torrent.pieceManager` to know if ready
- Calls `pieceManager.restoreFromHex()`

### engine-state.ts (~4 references)
- `hasMetadata` check: `!!torrent.pieceManager`
- Serializes `pieceCount`, `pieceLength`, `completedPieces`

### torrent-file-info.ts (~4 references)
- Constructor takes PieceManager
- Uses `hasPiece()`, `getPieceLength()`

Run these searches to find all usages:

```bash
# Find all pieceManager references
grep -r "pieceManager" packages/engine/src --include="*.ts"
grep -r "PieceManager" packages/engine/src --include="*.ts"

# Find in tests too
grep -r "pieceManager" packages/engine/test --include="*.ts"
grep -r "PieceManager" packages/engine/test --include="*.ts"
```

## Verification

After migration:

1. `pnpm tsc --noEmit` - No type errors
2. `pnpm test` - All tests pass
3. Manual test: Add torrent, download a few pieces, verify progress
4. Manual test: Restart, verify session restore works
5. Manual test: Complete download, verify seeding works

## Notes

- `ActivePiece` / `ActivePieceManager` remain unchanged
- `TorrentContentStorage` remains unchanged  
- The `BLOCK_SIZE` constant moves from `piece-manager.ts` to `active-piece.ts` or a shared constants file
- `BitField.count()` method must exist (verify it does)
