# File Priority and .parts Handling - Test Plan

## Overview

Unit tests for the file priority and `.parts` file handling feature. Tests organized by component/concern.

## Test Files

```
packages/engine/test/core/piece-classification.test.ts
packages/engine/test/core/parts-file.test.ts
packages/engine/test/core/advertised-bitfield.test.ts
packages/engine/test/core/file-skip.test.ts
packages/engine/test/core/piece-selection-filtering.test.ts
packages/engine/test/core/materialize.test.ts
packages/engine/test/core/recheck-parts.test.ts
packages/engine/test/core/parts-file-atomic.test.ts
packages/engine/test/core/session-fileprio.test.ts
```

---

## 1. Piece Classification (`piece-classification.test.ts`)

Tests for `pieceClassification` computation based on file priorities.

```typescript
describe('Piece Classification', () => {
  describe('single file torrent', () => {
    it('all pieces wanted when file is normal', () => {
      // Setup: 1 file, priority = normal
      // Expect: all pieces classified as 'wanted'
    })

    it('all pieces blacklisted when file is skipped', () => {
      // Setup: 1 file, priority = skip
      // Expect: all pieces classified as 'blacklisted'
    })
  })

  describe('multi-file torrent', () => {
    it('piece entirely in non-skipped file → wanted', () => {
      // Setup: piece bytes 0-16384, file A bytes 0-50000 (normal)
      // Expect: piece classified as 'wanted'
    })

    it('piece entirely in skipped file → blacklisted', () => {
      // Setup: piece bytes 0-16384, file A bytes 0-50000 (skip)
      // Expect: piece classified as 'blacklisted'
    })

    it('piece spans 2 files, one skipped → boundary', () => {
      // Setup: piece spans file A (normal) and file B (skip)
      // Expect: piece classified as 'boundary'
    })

    it('piece spans 2 files, both normal → wanted', () => {
      // Setup: piece spans file A (normal) and file B (normal)
      // Expect: piece classified as 'wanted'
    })

    it('piece spans 2 files, both skipped → blacklisted', () => {
      // Setup: piece spans file A (skip) and file B (skip)
      // Expect: piece classified as 'blacklisted'
    })

    it('piece spans 3 files, middle one skipped → boundary', () => {
      // Setup: piece spans A (normal), B (skip), C (normal)
      // Expect: piece classified as 'boundary'
    })

    it('piece spans 3 files, first and last skipped → boundary', () => {
      // Setup: piece spans A (skip), B (normal), C (skip)
      // Expect: piece classified as 'boundary'
    })
  })

  describe('all files same priority', () => {
    it('all files skipped → all pieces blacklisted', () => {
      // Setup: 5 files, all skip
      // Expect: every piece classified as 'blacklisted'
    })

    it('all files normal → all pieces wanted', () => {
      // Setup: 5 files, all normal
      // Expect: every piece classified as 'wanted'
    })
  })

  describe('reclassification on priority change', () => {
    it('piece reclassified when file priority changes', () => {
      // Setup: piece in file A (normal) → wanted
      // Action: set file A to skip
      // Expect: piece now classified as 'blacklisted'
    })

    it('boundary piece becomes wanted when skipped file un-skipped', () => {
      // Setup: piece spans A (normal) + B (skip) → boundary
      // Action: set file B to normal
      // Expect: piece now classified as 'wanted'
    })
  })
})
```

---

## 2. PartsFile Class (`parts-file.test.ts`)

Tests for the `.parts` file bencode operations.

```typescript
describe('PartsFile', () => {
  describe('read/write roundtrip', () => {
    it('write single piece, read back identical', () => {
      // Write piece 42 with known data
      // Read back, verify identical bytes
    })

    it('write multiple pieces, read back all', () => {
      // Write pieces 10, 20, 30
      // Read back, verify all present with correct data
    })

    it('empty file returns empty dict', () => {
      // Create new PartsFile with no data
      // Expect: getPieces() returns {}
    })
  })

  describe('add piece', () => {
    it('add to empty file', () => {
      // Start with no .parts file
      // Add piece 5
      // Verify file created, piece present
    })

    it('add to existing file preserves other pieces', () => {
      // Start with pieces 1, 2, 3
      // Add piece 4
      // Verify all 4 pieces present
    })

    it('overwrite existing piece', () => {
      // Start with piece 5 = dataA
      // Add piece 5 = dataB
      // Verify piece 5 = dataB
    })
  })

  describe('remove piece', () => {
    it('remove existing piece', () => {
      // Start with pieces 1, 2, 3
      // Remove piece 2
      // Verify only 1, 3 remain
    })

    it('remove non-existent piece is no-op', () => {
      // Start with pieces 1, 2
      // Remove piece 99
      // Verify 1, 2 still present, no error
    })

    it('remove last piece returns empty dict', () => {
      // Start with piece 1 only
      // Remove piece 1
      // Verify empty dict
    })
  })

  describe('has()', () => {
    it('returns true for present piece', () => {
      // Add piece 42
      // Expect: has(42) === true
    })

    it('returns false for absent piece', () => {
      // Add piece 42
      // Expect: has(99) === false
    })
  })

  describe('getPieceIndices()', () => {
    it('returns all piece indices', () => {
      // Add pieces 5, 10, 15
      // Expect: getPieceIndices() === [5, 10, 15] (sorted)
    })
  })

  describe('error handling', () => {
    it('corrupt bencode throws descriptive error', () => {
      // Write garbage bytes to .parts file
      // Attempt to load
      // Expect: throws with message about corrupt file
    })

    it('wrong bencode type throws', () => {
      // Write valid bencode but list instead of dict
      // Attempt to load
      // Expect: throws
    })
  })
})
```

---

## 3. Advertised Bitfield (`advertised-bitfield.test.ts`)

Tests for advertised vs internal bitfield logic.

```typescript
describe('Advertised Bitfield', () => {
  describe('no .parts pieces', () => {
    it('advertised equals internal when partsFilePieces empty', () => {
      // Setup: internal bitfield [1,1,0,1,0], no .parts
      // Expect: advertised === [1,1,0,1,0]
    })
  })

  describe('with .parts pieces', () => {
    it('masks off pieces in .parts', () => {
      // Setup: internal [1,1,1,1,1], partsFilePieces = {1, 3}
      // Expect: advertised === [1,0,1,0,1]
    })

    it('piece not in internal stays 0 in advertised', () => {
      // Setup: internal [1,0,1,0,1], partsFilePieces = {2}
      // Expect: advertised === [1,0,0,0,1]
      // (piece 2 was 1 internally but in .parts, now 0)
    })
  })

  describe('dynamic updates', () => {
    it('piece materialized from .parts → advertised gains bit', () => {
      // Setup: internal [1,1,1], partsFilePieces = {1} → advertised [1,0,1]
      // Action: materialize piece 1, remove from partsFilePieces
      // Expect: advertised now [1,1,1]
    })

    it('piece added to .parts → advertised loses bit', () => {
      // Setup: internal [1,1,1], partsFilePieces = {} → advertised [1,1,1]
      // Action: add piece 1 to .parts
      // Expect: advertised now [1,0,1]
    })
  })

  describe('getAdvertisedBitfield()', () => {
    it('returns new BitField instance', () => {
      // Verify not returning reference to internal
    })

    it('used by sendBitfield to peers', () => {
      // Integration: verify peer receives advertised, not internal
    })
  })
})
```

---

## 4. Skip Prevention (`file-skip.test.ts`)

Tests for preventing skip on completed files.

```typescript
describe('File Skip Prevention', () => {
  describe('completion detection', () => {
    it('file with all pieces complete → cannot skip', () => {
      // Setup: file spans pieces 0-5, all have bitfield=1
      // Action: attempt to skip file
      // Expect: skip rejected (or silently ignored)
    })

    it('file with some pieces complete → can skip', () => {
      // Setup: file spans pieces 0-5, pieces 0-2 complete
      // Action: skip file
      // Expect: skip allowed
    })

    it('file with no pieces complete → can skip', () => {
      // Setup: file spans pieces 0-5, none complete
      // Action: skip file
      // Expect: skip allowed
    })
  })

  describe('multi-select skip', () => {
    it('mixed completion: only incomplete files skipped', () => {
      // Setup: files A (complete), B (partial), C (empty)
      // Action: skip all three
      // Expect: B and C skipped, A unchanged
    })

    it('all complete: none skipped', () => {
      // Setup: files A, B, C all complete
      // Action: skip all three
      // Expect: none skipped
    })

    it('all incomplete: all skipped', () => {
      // Setup: files A, B, C all empty
      // Action: skip all three
      // Expect: all skipped
    })
  })

  describe('boundary piece completion', () => {
    it('file complete even if boundary pieces in .parts', () => {
      // Setup: file's non-boundary pieces complete, boundary pieces in .parts
      // Question: is this file "complete" for skip prevention?
      // Current decision: boundary pieces in .parts count as complete for that file
    })
  })

  describe('single-file torrent', () => {
    it('100% complete → skip rejected', () => {
      // Setup: single file, all pieces complete
      // Action: skip
      // Expect: rejected
    })

    it('partial → skip allowed', () => {
      // Setup: single file, 50% complete
      // Action: skip
      // Expect: allowed (download effectively stops)
    })
  })
})
```

---

## 5. Piece Selection Filtering (`piece-selection-filtering.test.ts`)

Tests for piece picker respecting classifications.

```typescript
describe('Piece Selection Filtering', () => {
  describe('shouldRequestPiece()', () => {
    it('blacklisted piece → false', () => {
      // Setup: piece 5 classified as blacklisted
      // Expect: shouldRequestPiece(5) === false
    })

    it('boundary piece → true', () => {
      // Setup: piece 5 classified as boundary, not yet have
      // Expect: shouldRequestPiece(5) === true
    })

    it('wanted piece → true', () => {
      // Setup: piece 5 classified as wanted, not yet have
      // Expect: shouldRequestPiece(5) === true
    })

    it('already have piece → false regardless of classification', () => {
      // Setup: piece 5 wanted, internalBitfield[5] = 1
      // Expect: shouldRequestPiece(5) === false
    })
  })

  describe('getNeededPieces()', () => {
    it('excludes blacklisted pieces', () => {
      // Setup: pieces 0-9, pieces 3,4,5 blacklisted
      // Expect: getNeededPieces() excludes 3,4,5
    })

    it('includes boundary pieces', () => {
      // Setup: pieces 0-9, piece 5 is boundary
      // Expect: getNeededPieces() includes 5
    })

    it('excludes already-have pieces', () => {
      // Setup: pieces 0-9, have pieces 0,1,2
      // Expect: getNeededPieces() excludes 0,1,2
    })
  })

  describe('rarest-first respects classification', () => {
    it('does not pick blacklisted even if rarest', () => {
      // Setup: piece 5 is rarest but blacklisted
      // Expect: picks next rarest non-blacklisted
    })
  })
})
```

---

## 6. Materialization (`materialize.test.ts`)

Tests for un-skip / materialization flow.

```typescript
describe('Materialization', () => {
  describe('single piece materialization', () => {
    it('piece read from .parts, written to file', () => {
      // Setup: piece 5 in .parts, file B was skipped
      // Action: un-skip file B
      // Expect: piece 5 data written to correct offset in file B
    })

    it('piece removed from .parts after materialization', () => {
      // Setup: piece 5 in .parts
      // Action: materialize piece 5
      // Expect: .parts no longer contains piece 5
    })

    it('advertised bitfield gains the bit', () => {
      // Setup: piece 5 in .parts, advertised[5] = 0
      // Action: materialize
      // Expect: advertised[5] = 1
    })
  })

  describe('multiple pieces', () => {
    it('multiple pieces materialized in one operation', () => {
      // Setup: pieces 5, 10, 15 in .parts, all touch file B
      // Action: un-skip file B
      // Expect: all three written to files, removed from .parts
    })
  })

  describe('partial un-skip', () => {
    it('piece spans 2 files, only one un-skipped → stays in .parts', () => {
      // Setup: piece 5 spans A (normal) + B (skip), piece in .parts
      // Action: un-skip file A (already normal, no-op)
      // Expect: piece 5 stays in .parts (still needs B)
    })

    it('piece spans 2 files, second un-skipped → materializes', () => {
      // Setup: piece 5 spans A (normal) + B (skip), piece in .parts
      // Action: un-skip file B
      // Expect: piece 5 written to both A and B, removed from .parts
    })
  })

  describe('.parts file cleanup', () => {
    it('.parts deleted when empty', () => {
      // Setup: .parts has only piece 5
      // Action: materialize piece 5
      // Expect: .parts file deleted from disk
    })

    it('.parts kept when other pieces remain', () => {
      // Setup: .parts has pieces 5, 10
      // Action: materialize only piece 5
      // Expect: .parts file still exists with piece 10
    })
  })

  describe('disk queue integration', () => {
    it('disk queue drained before materialization', () => {
      // Verify drain() called before any file writes
    })

    it('disk queue resumed after materialization', () => {
      // Verify resume() called after all writes complete
    })
  })

  describe('network pause', () => {
    it('network paused during materialization', () => {
      // Verify no new pieces accepted during materialization
    })

    it('network resumed after materialization', () => {
      // Verify network active after materialization complete
    })
  })

  describe('HAVE messages', () => {
    it('sends HAVE for materialized pieces', () => {
      // Setup: piece 5 materialized
      // Expect: HAVE(5) sent to all connected peers
    })
  })
})
```

---

## 7. Recheck with .parts (`recheck-parts.test.ts`)

Tests for recheck handling .parts pieces.

```typescript
describe('Recheck with .parts', () => {
  describe('pieces in .parts only', () => {
    it('hash verified from .parts data', () => {
      // Setup: piece 5 in .parts with valid data
      // Action: recheck
      // Expect: piece 5 passes verification
    })

    it('corrupt .parts data fails verification', () => {
      // Setup: piece 5 in .parts with wrong data
      // Action: recheck
      // Expect: piece 5 fails, removed from .parts, bitfield[5] = 0
    })
  })

  describe('pieces in files only', () => {
    it('normal recheck flow', () => {
      // Setup: piece 5 in files (not skipped)
      // Action: recheck
      // Expect: reads from file, hashes, verifies
    })
  })

  describe('boundary overlap verification', () => {
    it('overlap data matches → piece passes', () => {
      // Setup: piece 5 in .parts, spans A (normal) + B (skip)
      //        portion in A also written to file A
      // Action: recheck
      // Expect: read overlap from file A, compare to .parts, they match, hash passes
    })

    it('overlap data mismatch → piece fails', () => {
      // Setup: piece 5 in .parts, but file A has different bytes at overlap
      // Action: recheck
      // Expect: overlap mismatch detected, piece fails verification
    })

    it('overlap check uses correct byte ranges', () => {
      // Verify the exact byte offsets checked for overlap
    })
  })

  describe('mixed torrent', () => {
    it('some pieces in files, some in .parts', () => {
      // Setup: pieces 0-4 in files, pieces 5-6 in .parts
      // Action: recheck all
      // Expect: each piece verified via appropriate path
    })
  })
})
```

---

## 8. Atomic Write (`parts-file-atomic.test.ts`)

Tests for atomic `.parts` file operations.

```typescript
describe('PartsFile Atomic Write', () => {
  describe('write sequence', () => {
    it('writes to .parts.tmp first', async () => {
      // Action: add piece to .parts
      // Expect: .parts.tmp created during write
    })

    it('renames .tmp to .parts after write', async () => {
      // Expect: .parts.tmp removed, .parts exists with new content
    })

    it('fsync called before rename', async () => {
      // Verify fsync/flush called on .tmp before rename
    })
  })

  describe('failure scenarios', () => {
    it('existing .parts preserved if write fails', async () => {
      // Setup: .parts with pieces 1, 2
      // Action: attempt to add piece 3, simulate write failure
      // Expect: .parts still has pieces 1, 2 only
    })

    it('no .tmp file left after failure', async () => {
      // After failed write, .parts.tmp should be cleaned up
    })
  })

  describe('concurrent access', () => {
    it('read during write gets old data', async () => {
      // Setup: .parts with piece 1
      // Action: start write to add piece 2, read during write
      // Expect: read sees only piece 1 (atomic)
    })
  })
})
```

---

## 9. Session Persistence (`session-fileprio.test.ts`)

Tests for file priority persistence.

```typescript
describe('Session File Priority Persistence', () => {
  describe('save', () => {
    it('fileprio saved on change', async () => {
      // Action: set file 2 to skip
      // Expect: session storage updated with new fileprio array
    })

    it('fileprio array matches file count', () => {
      // Verify array length === number of files
    })
  })

  describe('restore', () => {
    it('fileprio restored on load', async () => {
      // Setup: session has fileprio [0, 1, 0, 1]
      // Action: load torrent
      // Expect: filePriorities === [0, 1, 0, 1]
    })

    it('missing fileprio defaults to all normal', async () => {
      // Setup: session has no fileprio key
      // Action: load torrent
      // Expect: filePriorities === [0, 0, 0, ...] (all normal)
    })
  })

  describe('.parts reconstruction', () => {
    it('partsFilePieces reconstructed from .parts file on startup', async () => {
      // Setup: .parts file exists with pieces 5, 10
      // Action: load torrent
      // Expect: partsFilePieces === Set{5, 10}
    })

    it('missing .parts file → empty partsFilePieces', async () => {
      // Setup: no .parts file
      // Action: load torrent
      // Expect: partsFilePieces === Set{}
    })
  })

  describe('advertised bitfield on restore', () => {
    it('advertised bitfield correct after restore with .parts', async () => {
      // Setup: internal bitfield has 5, 10 set; .parts has 5
      // Action: restore
      // Expect: advertised has 10 set, not 5
    })
  })
})
```

---

## Integration Tests (Future)

These would be Python integration tests against libtorrent:

- Download with skipped files, verify .parts created
- Un-skip mid-download, verify materialization
- Seed to libtorrent, verify only non-.parts pieces served
- Recheck torrent with .parts, verify integrity

---

## Test Utilities Needed

```typescript
// test/helpers/torrent-fixtures.ts

/** Create a mock torrent with specified file layout */
function createMockTorrentWithFiles(files: { name: string; size: number }[]): MockTorrent

/** Create a .parts file with specified pieces */
function createPartsFile(pieces: Map<number, Uint8Array>): Uint8Array

/** Calculate which pieces touch which files */
function getPiecesForFile(fileIndex: number, files: TorrentFile[], pieceLength: number): number[]
```
