# Wire Disk Queue to I/O Operations

## Overview

Connect the existing TorrentDiskQueue infrastructure to actual disk I/O operations. After this task, piece writes will flow through the queue and be visible in the UI's Disk tab.

**Prerequisites:** The disk queue class, tests, and UI are already implemented. This task wires them to the engine.

## File Changes

```
packages/engine/src/core/torrent.ts                   ← Add diskQueue instance + getter
packages/engine/src/core/torrent-content-storage.ts  ← Accept queue, use for writes
packages/engine/src/core/torrent-initializer.ts      ← Pass torrent's queue to storage
packages/client/src/adapters/types.ts                ← Call torrent.getDiskQueueSnapshot()
```

## Phase 1: Add Disk Queue to Torrent

### 1.1 Modify `packages/engine/src/core/torrent.ts`

**Add import** at top with other imports (around line 4-20):

```typescript
import { TorrentDiskQueue, DiskQueueSnapshot } from './disk-queue'
```

**Add private field** after the `contentStorage` declaration (around line 83):

Find:
```typescript
public contentStorage?: TorrentContentStorage
```

Add immediately after:
```typescript
private _diskQueue: TorrentDiskQueue = new TorrentDiskQueue()
```

**Add getter and snapshot method** after the `errorMessage` field (around line 205-210).

Find a good spot after the existing getters (after `errorMessage` declaration) and add:

```typescript
/**
 * Get the disk queue for this torrent.
 * Used by TorrentContentStorage to queue disk operations.
 */
get diskQueue(): TorrentDiskQueue {
  return this._diskQueue
}

/**
 * Get disk queue snapshot for UI display.
 */
getDiskQueueSnapshot(): DiskQueueSnapshot {
  return this._diskQueue.getSnapshot()
}
```

## Phase 2: Update TorrentContentStorage

### 2.1 Modify `packages/engine/src/core/torrent-content-storage.ts`

**Add import** at top:

```typescript
import { IDiskQueue } from './disk-queue'
```

**Modify constructor** to accept optional queue.

Find:
```typescript
constructor(
  engine: ILoggingEngine,
  private storageHandle: IStorageHandle,
) {
```

Replace with:
```typescript
constructor(
  engine: ILoggingEngine,
  private storageHandle: IStorageHandle,
  private diskQueue?: IDiskQueue,
) {
```

**Add helper method** to count files touched by a piece. Add this after the `pieceSpansSingleFile` method (around line 148):

```typescript
/**
 * Count how many files a write at the given torrent offset and length touches.
 */
private countFilesTouched(torrentOffset: number, length: number): number {
  let count = 0
  let remaining = length
  let currentOffset = torrentOffset

  for (const file of this.files) {
    const fileEnd = file.offset + file.length
    if (currentOffset >= file.offset && currentOffset < fileEnd) {
      count++
      const bytesInFile = Math.min(remaining, fileEnd - currentOffset)
      remaining -= bytesInFile
      currentOffset += bytesInFile
      if (remaining === 0) break
    }
  }
  return count
}
```

**Replace the `writePieceVerified` method** (around line 161-186).

Find and replace the entire method:

```typescript
/**
 * Write a complete piece with optional hash verification.
 * If a disk queue is configured, the write is queued for concurrency control.
 * If expectedHash is provided and the piece fits in a single file with a handle
 * that supports verified writes, the hash verification happens atomically
 * in the io-daemon.
 *
 * @param pieceIndex The piece index
 * @param data The piece data
 * @param expectedHash Optional SHA1 hash to verify (raw bytes, not hex)
 * @returns true if verified write was used, false if caller should verify
 */
async writePieceVerified(
  pieceIndex: number,
  data: Uint8Array,
  expectedHash?: Uint8Array,
): Promise<boolean> {
  const torrentOffset = pieceIndex * this.pieceLength
  const fileCount = this.countFilesTouched(torrentOffset, data.length)

  // The actual write logic
  const doWrite = async (): Promise<boolean> => {
    // Check if we can use verified write
    if (expectedHash) {
      const singleFile = this.pieceSpansSingleFile(pieceIndex, data.length)
      if (singleFile) {
        const handle = await this.getFileHandle(singleFile.path)
        if (supportsVerifiedWrite(handle)) {
          // Use verified write - hash check happens in io-daemon
          const fileRelativeOffset = torrentOffset - singleFile.offset

          handle.setExpectedHashForNextWrite(expectedHash)
          await handle.write(data, 0, data.length, fileRelativeOffset)
          return true // Verified write was used
        }
      }
    }

    // Fall back to regular write (caller should verify hash)
    await this.write(pieceIndex, 0, data)
    return false
  }

  // If no queue configured, execute directly
  if (!this.diskQueue) {
    return doWrite()
  }

  // Queue the write for concurrency control
  let result = false
  await this.diskQueue.enqueue(
    {
      type: 'write',
      pieceIndex,
      fileCount,
      size: data.length,
    },
    async () => {
      result = await doWrite()
    },
  )
  return result
}
```

## Phase 3: Pass Queue When Creating Storage

### 3.1 Modify `packages/engine/src/core/torrent-initializer.ts`

**Update `initializeTorrentMetadata` function** (around line 74).

Find:
```typescript
const contentStorage = new TorrentContentStorage(engine, storageHandle)
```

Replace with:
```typescript
const contentStorage = new TorrentContentStorage(engine, storageHandle, torrent.diskQueue)
```

**Update `initializeTorrentStorage` function** (around line 110).

Find:
```typescript
const contentStorage = new TorrentContentStorage(engine, storageHandle)
```

Replace with:
```typescript
const contentStorage = new TorrentContentStorage(engine, storageHandle, torrent.diskQueue)
```

## Phase 4: Wire Up Adapter

### 4.1 Modify `packages/client/src/adapters/types.ts`

**Update the `getDiskQueueSnapshot` method** in `DirectEngineAdapter` class (around line 88-94).

Find:
```typescript
getDiskQueueSnapshot(infoHash: string): DiskQueueSnapshot | null {
  const torrent = this.engine.getTorrent(infoHash)
  if (!torrent) return null
  // TODO: Return torrent.getDiskQueueSnapshot() once wired up
  // For now return empty snapshot
  return { pending: [], running: [], draining: false }
}
```

Replace with:
```typescript
getDiskQueueSnapshot(infoHash: string): DiskQueueSnapshot | null {
  const torrent = this.engine.getTorrent(infoHash)
  if (!torrent) return null
  return torrent.getDiskQueueSnapshot()
}
```

## Verification

Run from monorepo root:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

All commands should pass.

## Manual Testing

1. Start the extension in dev mode (`pnpm dev`)
2. Load the extension in Chrome from `extension/dist/`
3. Add a torrent and start downloading
4. Open the detail pane and click the "Disk" tab
5. You should see write jobs appearing briefly:
   - ▶ = running job
   - ⏳ = pending job (rare unless disk is slow)
6. Jobs appear and disappear as writes complete
7. Empty table = healthy, no backlog
8. Items visible = writes in progress or queued

## Expected Behavior

- Each piece write creates a disk job visible in the UI
- Jobs show: status (▶/⏳), type (write), piece index, file count, size, elapsed time
- Running jobs show elapsed time updating
- When write completes, job disappears from snapshot
- Queue has 4 workers by default - up to 4 parallel writes
- Hash verification still happens in io-daemon (verified write) or TypeScript (fallback)

## Notes

- Read operations are NOT queued in this implementation (reads are less critical for backpressure)
- The queue is per-torrent, not global
- If you don't see jobs in the Disk tab during download, that's normal - writes complete quickly
- To see queue activity, download a large torrent with many small pieces
