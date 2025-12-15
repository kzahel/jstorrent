# File Priority and .parts File Handling

## Overview

Add file skipping capability with `.parts` file handling for boundary pieces. Users can skip files mid-download; pieces that span skipped and non-skipped files are stored in a `.parts` file until materialization.

## Core Concepts

### File Priority Model

Binary for now: **skip** or **normal**.

Storage location: `session:torrent:{infohash}:fileprio` as `number[]` where index = file index, value = 0 (normal) or 1 (skip).

### Piece Classification

Given current file priorities, each piece falls into one category:

| Category | Files Touched | Action |
|----------|---------------|--------|
| Wanted | Only non-skipped | Request, write to files normally |
| Boundary | Mixed (some skipped, some not) | Request, write WHOLE piece to `.parts` |
| Blacklisted | Only skipped | Don't request, discard if received |

### .parts File

- **Filename:** `{infohash}.parts`
- **Location:** Torrent's content storage directory
- **Format:** Bencoded dictionary `{pieceIndex: rawPieceData, ...}`
- **Pieces stored whole:** The entire piece data, not just the skipped portions

### Advertised vs Internal Bitfield

```
advertisedBitfield = internalBitfield AND NOT partsFilePieces
```

- Internal bitfield: what we have (verified pieces in files OR `.parts`)
- Advertised bitfield: what we tell peers (only pieces we can serve from files)
- Never send HAVE for pieces in `.parts`
- No need for DONT_HAVE since we only HAVE after full disk persistence

## Flows

### Piece Download (with skipped files)

```
Piece arrives, hash verified
    │
    ├─► Touches ONLY non-skipped files?
    │       └─► Write to files normally (existing flow)
    │
    ├─► Touches ONLY skipped files?
    │       └─► Discard (should not happen - piece selection prevents)
    │
    └─► Boundary piece (mixed)?
            └─► Write whole piece to .parts
                1. Drain disk queue
                2. Read existing .parts (or empty dict)
                3. Add {pieceIndex: data}
                4. Write to .parts.tmp
                5. fsync
                6. Rename .parts.tmp → .parts
                7. Resume disk queue
                8. Update partsFilePieces set
                9. Set internalBitfield[piece] = 1
               10. Do NOT send HAVE (not in advertisedBitfield)
```

### Skip File

```
User skips file(s)
    │
    ├─► Filter out already-completed files (silently ignore)
    │
    └─► For remaining files:
            1. Update fileprio array
            2. Persist to session storage
            3. Reclassify all pieces (wanted/boundary/blacklisted)
            4. Active pieces touching newly-skipped files:
               - Let in-flight downloads complete
               - On completion, route to .parts if boundary
```

**Skip prevention:** If ALL pieces touching a file have bitfield=1, the file is complete. Silently ignore skip requests for completed files.

### Un-skip File (Materialization)

```
User un-skips file(s)
    │
    1. Pause network for torrent
    2. Drain disk queue
    │
    3. For each piece in .parts touching newly-enabled files:
    │   a. Read piece data from .parts
    │   b. Write to appropriate file regions
    │   c. Remove entry from .parts dict
    │
    4. Write updated .parts (atomic: tmp + fsync + rename)
    │   - If empty, delete .parts file
    │
    5. Update advertised bitfield (these pieces now serveable)
    6. Send HAVE messages to peers for newly-advertisable pieces
    │
    7. Resume disk queue
    8. Resume network
    │
    9. Update fileprio array + persist
```

### Recheck (with .parts)

```
For each piece:
    │
    ├─► Piece in .parts?
    │       1. Read complete piece from .parts
    │       2. Read overlapping regions from file boundaries
    │       3. Verify overlap data is identical
    │       4. Hash complete piece, compare to expected
    │       5. If valid: internalBitfield[piece] = 1
    │
    └─► Piece in files only?
            └─► Normal recheck flow (read from files, hash, verify)
```

### Startup / Session Restore

```
1. Load fileprio from session storage
2. If .parts file exists:
   a. Parse bencoded content
   b. Populate partsFilePieces set
3. Reconstruct advertisedBitfield from internalBitfield - partsFilePieces
```

### Completion Check

```
Torrent complete when:
  - All WANTED pieces have internalBitfield = 1
  - Blacklisted pieces don't count toward completion
  - Boundary pieces in .parts count as complete for non-skipped portions

Delete .parts when:
  - All files un-skipped AND
  - All pieces materialized to files AND
  - .parts dict is empty
```

## Data Structures

### New Fields on Torrent

```typescript
// Piece classification cache (recomputed on fileprio change)
private pieceClassification: Array<'wanted' | 'boundary' | 'blacklisted'>

// Pieces currently in .parts file
private partsFilePieces: Set<number> = new Set()

// File priorities (0 = normal, 1 = skip)
private filePriorities: number[] = []
```

### Session Storage

```
session:torrent:{infohash}:fileprio = [0, 0, 1, 0, 1, ...]  // per-file
```

### .parts File Format

```
d
  i42e    # piece index as integer key
  32768:  # raw piece bytes (32KB example)
  ...
  i108e
  32768:
  ...
e
```

## Piece Selection Changes

Current logic picks any needed piece. New logic:

```typescript
function shouldRequestPiece(index: number): boolean {
  if (internalBitfield.get(index)) return false  // Already have it
  if (pieceClassification[index] === 'blacklisted') return false  // Don't want it
  return true  // Wanted or boundary - both get requested
}
```

## Implementation Phases

### Phase 1: File Priority State

- Add `filePriorities` to Torrent
- Persist/restore from session storage
- Compute `pieceClassification` array
- Skip prevention logic (completed files)

### Phase 2: Piece Selection Filtering

- Modify piece picker to check classification
- Blacklisted pieces not requested
- UI: Files tab with skip toggle

### Phase 3: .parts File Writing

- Atomic write implementation
- Integrate with disk queue (drain/resume)
- Track `partsFilePieces` set
- Boundary pieces route to `.parts`

### Phase 4: Advertised Bitfield

- Compute advertised vs internal bitfield
- Modify `sendBitfield()` to use advertised
- Suppress HAVE for `.parts` pieces

### Phase 5: Materialization (Un-skip)

- Pause network + drain queue
- Read from `.parts`, write to files
- Update `.parts` file
- Update bitfield, send HAVEs
- Resume

### Phase 6: Recheck Support

- Handle `.parts` pieces in recheck
- Verify overlap identity at boundaries
- Hash from `.parts` data

## Edge Cases

**Skip while piece downloading:** Let it complete, then route based on current classification.

**User skips all files:** All pieces blacklisted, download effectively paused. Resume when any file un-skipped.

**Magnet without metadata:** No files yet, skip UI disabled until metadata received.

**Single-file torrent:** Skip = don't download. Simple case, no boundary pieces.

**Piece spans 3+ files, middle one skipped:** Still a boundary piece. Whole piece goes to `.parts`.

## File Locations

```
packages/engine/src/core/torrent.ts              ← filePriorities, pieceClassification, partsFilePieces
packages/engine/src/core/torrent-content-storage.ts ← .parts read/write
packages/engine/src/core/parts-file.ts           ← NEW: PartsFile class (bencode, atomic write)
packages/engine/src/core/session-persistence.ts  ← fileprio storage
packages/ui/src/tables/FileTable.tsx             ← Skip toggle UI
```
