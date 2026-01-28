# Batch Verified Writes Design

## Problem

Currently, each verified write is a separate FFI call from JS → Kotlin:

```
Piece 1 completes → __jstorrent_file_write_verified() → FFI call #1
Piece 2 completes → __jstorrent_file_write_verified() → FFI call #2
Piece 3 completes → __jstorrent_file_write_verified() → FFI call #3
```

FFI overhead is significant on Android (~1ms per call). With fast downloads completing multiple pieces per tick, this becomes a bottleneck.

**Current architecture:**
- Request side (JS→Kotlin): Individual FFI calls per write
- Response side (Kotlin→JS): Already batched via `__jstorrent_file_flush()` / `__jstorrent_file_dispatch_batch`

## Solution

Batch write requests at tick boundary, matching the existing response batching:

```
GATHER phase:
  Piece 1 completes → queue write locally (no FFI)
  Piece 2 completes → queue write locally (no FFI)
  Piece 3 completes → queue write locally (no FFI)

WRITE phase (end of tick):
  flushPending() → single FFI call with all 3 writes
```

## Design

### JS Side

#### 1. NativeBatchingDiskQueue

New disk queue implementation for Android that collects writes instead of dispatching immediately.

```typescript
interface PendingVerifiedWrite {
  rootKey: string
  path: string
  position: number
  data: ArrayBuffer
  expectedHashHex: string
  callbackId: string
  resolve: (result: { bytesWritten: number }) => void
  reject: (error: Error) => void
}

class NativeBatchingDiskQueue implements IDiskQueue {
  private pending: PendingVerifiedWrite[] = []

  // Called by NativeFileHandle.writeVerified()
  queueVerifiedWrite(
    rootKey: string,
    path: string,
    position: number,
    data: ArrayBuffer,
    expectedHashHex: string,
  ): Promise<{ bytesWritten: number }> {
    return new Promise((resolve, reject) => {
      const callbackId = `vw_${nextCallbackId++}`

      // Register callback for when result comes back
      globalThis.__jstorrent_file_write_callbacks[callbackId] = (bytesWritten, resultCode) => {
        if (resultCode === 0) resolve({ bytesWritten })
        else if (resultCode === 1) reject(new HashMismatchError(...))
        else reject(new Error(`Write failed: ${resultCode}`))
      }

      this.pending.push({
        rootKey, path, position, data, expectedHashHex, callbackId, resolve, reject
      })
    })
  }

  // Called at end of tick
  flushPending(): void {
    if (this.pending.length === 0) return

    // Pack into binary format and send single FFI call
    const packed = this.packBatch(this.pending)
    __jstorrent_file_write_verified_batch(packed)
    this.pending = []
  }

  private packBatch(writes: PendingVerifiedWrite[]): ArrayBuffer {
    // Format matches existing JNI batch patterns (tcp_send_batch, etc.)
    // All multi-byte integers are little-endian.
    //
    // [count: u32 LE] then for each write:
    //   [rootKeyLen: u8] [rootKey: UTF-8 bytes]
    //   [pathLen: u16 LE] [path: UTF-8 bytes]
    //   [position: u64 LE]
    //   [dataLen: u32 LE] [data: bytes]
    //   [hashHex: 40 bytes]  (fixed size - SHA1 hex is always 40 chars)
    //   [callbackIdLen: u8] [callbackId: UTF-8 bytes]
    ...
  }

  // IDiskQueue interface methods - delegate or no-op as needed
  enqueue(...) { /* for non-verified writes, if any */ }
  drain() { /* wait for pending results */ }
  resume() { /* no-op */ }
  getSnapshot() { /* return pending count */ }
}
```

#### 2. Modify NativeFileHandle

Update `writeVerified()` to use the batching queue instead of direct FFI:

```typescript
private writeVerified(...): Promise<{ bytesWritten: number }> {
  // Instead of calling __jstorrent_file_write_verified directly,
  // delegate to the batching disk queue
  return this.diskQueue.queueVerifiedWrite(
    this.rootKey, this.path, position, data, expectedHashHex
  )
}
```

#### 3. Tick Loop Integration

Add WRITE phase after OUTPUT:

```typescript
tick(): void {
  // Phase 1: GATHER
  for (const peer of connectedPeers) peer.drainBuffer()

  // Phase 2: PROCESS
  this.cleanupStuckPieces()

  // Phase 3: REQUEST
  for (const peer of connectedPeers) { ... }

  // Phase 4: OUTPUT
  this.flushHaves(connectedPeers)
  this.flushPeers(connectedPeers)

  // Phase 5: WRITE (new)
  this.callbacks.getDiskQueue().flushPending?.()
}
```

### Kotlin Side

#### 1. New Batch Binding

```kotlin
// __jstorrent_file_write_verified_batch(packed: ArrayBuffer): void
ctx.setGlobalFunctionWithBinary("__jstorrent_file_write_verified_batch", 0) { _, packed ->
    if (packed == null) return@setGlobalFunctionWithBinary null

    val writes = unpackBatch(packed)

    // Launch all writes in parallel on IO dispatcher
    for (write in writes) {
        ioScope.launch {
            try {
                val actualHash = Hasher.sha1(write.data)
                val actualHashHex = actualHash.toHexString()

                if (!actualHashHex.equals(write.expectedHashHex, ignoreCase = true)) {
                    queueDiskWriteResult(write.callbackId, -1, WriteResultCode.HASH_MISMATCH)
                    return@launch
                }

                fileManager.write(write.rootUri, write.path, write.offset, write.data)
                queueDiskWriteResult(write.callbackId, write.data.size, WriteResultCode.SUCCESS)

            } catch (e: Exception) {
                queueDiskWriteResult(write.callbackId, -1, WriteResultCode.IO_ERROR)
            }
        }
    }
    null
}

private fun unpackBatch(packed: ByteArray): List<WriteRequest> {
    // Parse the binary format from JS
    ...
}
```

#### 2. Results Still Use Existing Batch Mechanism

Results already queue to `pendingDiskWriteResults` and flush via `__jstorrent_file_flush()` / `__jstorrent_file_dispatch_batch`. No changes needed here.

## Implementation Phases

### Phase 1: JS Infrastructure
1. Create `NativeBatchingDiskQueue` class with pending queue and `flushPending()`
2. Add binary packing for write requests
3. Add `flushPending()` to `IDiskQueue` interface (optional method or no-op default)
4. Unit tests for queue and packing logic

### Phase 2: Kotlin Binding
1. Add `__jstorrent_file_write_verified_batch` binding
2. Add unpacking logic
3. Launch parallel writes, queue results as before
4. Integration test: single batch with multiple writes

### Phase 3: Wire Up
1. Inject `NativeBatchingDiskQueue` for Android instead of `TorrentDiskQueue`
2. Modify `NativeFileHandle.writeVerified()` to use queue
3. Add `flushPending()` call to tick loop
4. End-to-end test: download torrent, verify batching in logs

### Phase 4: Metrics & Tuning
1. Add logging: batch size, pack time, FFI time
2. Compare before/after download speeds

## Testing Strategy

### Unit Tests (JS)
- `NativeBatchingDiskQueue.queueVerifiedWrite()` adds to pending
- `flushPending()` clears pending and calls mock FFI
- Binary packing produces correct format
- Promises resolve/reject correctly when callbacks fire

### Unit Tests (Kotlin)
- `unpackBatch()` correctly parses binary format
- Multiple writes process in parallel
- Results queue correctly for each callbackId
- Errors (hash mismatch, I/O) queue correct result codes

### Integration Tests
- Download small torrent with batching enabled
- Verify pieces complete and verify correctly
- Hash mismatch handling still works (use corrupted seeder?)
- Disk queue drain() waits for pending results

### Performance Tests
- Benchmark: download same torrent with/without batching
- Measure FFI calls per second
- Measure tick duration with many piece completions

## Metrics to Track

Add logging for:
```
Batch write: N writes, packed M bytes, FFI took X ms
```

Compare before/after:
- Pieces/second at high speeds
- Tick duration when pieces completing
- Total FFI calls per download

## Design Notes

- **No memory limit needed**: JNI has no practical limit. Typical batch sizes (5-20 pieces × 256KB-4MB) are well under 100MB.
- **Non-verified writes**: Not used in practice - all piece writes go through verified write path.
- **Browser fallback**: `TorrentDiskQueue` stays as-is for extension. `flushPending()` is no-op or not called.
- **Format consistency**: Binary format matches existing JNI batches (`tcp_send_batch`, etc.) - simple count + packed records.
