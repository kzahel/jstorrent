# Task: Extract FilePriorityManager from Torrent

## Overview

Extract file priority management into a separate `FilePriorityManager` class following the established pattern from `MetadataFetcher` and `TorrentUploader`.

## Pattern to Follow

Look at these files for the established pattern:
- `packages/engine/src/core/metadata-fetcher.ts` (~240 lines)
- `packages/engine/src/core/torrent-uploader.ts` (~197 lines)

The pattern is:
1. Class extends `EngineComponent` (for logging)
2. Dependencies passed via constructor config object
3. Callbacks for accessing Torrent state (instead of direct references)
4. Clean public interface with getters and methods
5. Torrent creates instance and delegates to it

## What to Extract

### State (from torrent.ts)
```typescript
private _filePriorities: number[] = []           // line 196
private _pieceClassification: PieceClassification[] = []  // line 198
```

### Type (from torrent.ts line 86)
```typescript
export type PieceClassification = 'wanted' | 'boundary' | 'blacklisted'
```

### Methods to Move
- `recomputePieceClassification()` - lines 1179-1233 (core logic)
- `setFilePriority()` - line 953
- `setFilePriorities()` (bulk) - around line 1001
- `initializeFilePriorities()` - around line 1049
- `restoreFilePriorities()` - around line 1072
- `isFileSkipped()` - line 927
- `isPieceWanted()` - line 1139

### Getters that Delegate
- `filePriorities` - line 871
- `pieceClassification` - line 878
- `wantedPiecesCount` - line 716
- `completedWantedPiecesCount` - line 726

## Dependencies Needed

The FilePriorityManager needs:
```typescript
interface FilePriorityManagerConfig {
  engine: ILoggingEngine
  infoHash: Uint8Array

  // Callbacks to access Torrent state
  getPiecesCount: () => number
  getPieceLength: (index: number) => number
  getFiles: () => Array<{ offset: number; length: number }>
  hasMetadata: () => boolean

  // Callback to propagate priorities to storage
  onPrioritiesChanged: (filePriorities: number[], classification: PieceClassification[]) => void
}
```

## Expected Interface

```typescript
export class FilePriorityManager extends EngineComponent {
  static override logName = 'fileprio'

  // Getters
  get filePriorities(): number[]
  get pieceClassification(): PieceClassification[]

  // Methods
  setFilePriority(fileIndex: number, priority: number): boolean
  setFilePriorities(priorities: Map<number, number>): boolean
  initializeFilePriorities(fileCount: number): void
  restoreFilePriorities(priorities: number[]): void

  isFileSkipped(fileIndex: number): boolean
  isPieceWanted(pieceIndex: number): boolean
  getClassification(pieceIndex: number): PieceClassification | undefined

  // For stats
  getWantedPiecesCount(): number
  getCompletedWantedCount(bitfield: BitField): number
}
```

## Steps

1. **Create the new file**: `packages/engine/src/core/file-priority-manager.ts`

2. **Move the type**: `PieceClassification` should be exported from the new file (or a shared types file)

3. **Implement the class** following MetadataFetcher/TorrentUploader patterns

4. **Update Torrent**:
   - Add import
   - Add `private _filePriorityManager!: FilePriorityManager`
   - Create in constructor after metadata fetcher
   - Replace state fields with delegation
   - Update `contentStorage` setter to call `onPrioritiesChanged` callback

5. **Handle the contentStorage dependency**:
   - `recomputePieceClassification()` calls `this.contentStorage.setFilePriorities()`
   - Use a callback pattern: when priorities change, call back to Torrent which updates storage

6. **Handle activePieces cleanup** (lines 1234+):
   - When pieces become blacklisted, active pieces need clearing
   - Pass a callback `onBlacklistPieces: (indices: number[]) => void`

## Verification

```bash
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm format:fix
```

## Notes

- The `recomputePieceClassification` method has side effects (clears active pieces, updates storage)
- Use callbacks for these side effects rather than direct references
- The classification depends on `pieceLength` and file offsets - these come from Torrent/contentStorage
- Some methods reference `this.activePieces` for cleanup - use callback pattern

## Line Count Target

Current torrent.ts: ~4200 lines
Expected reduction: ~200-300 lines
New file: ~250-300 lines
