# Zero-Copy Optimization: Follow-up Improvements

**Date:** 2026-01-28
**Current State:** 70 MB/s (up from 35 MB/s after eliminating 3 intermediate copies)
**Seeder Capacity:** 150+ MB/s

## Implemented Optimization

Reduced PIECE message handling from 4 copies to 1 copy:

**Before:**
```
ChunkedBuffer.consume() → parseMessage() slice → payload.slice(8) → piece.buffer.set()
       copy 1                  copy 2              copy 3              copy 4
```

**After:**
```
peekByte/peekUint32 → onPieceBlock callback → piece.addBlockFromChunked()
    no allocation        no allocation               ONE copy
```

## Remaining Optimization Opportunities

### 1. Allocation-Free peekUint32 (Low Effort, Small Gain)

**Current:** `peekUint32()` calls `peekBytes(offset, 4)` which allocates a 4-byte array.

**Proposed:** Direct cross-chunk uint32 reading without allocation:

```typescript
peekUint32Direct(offset: number): number | null {
  if (this._length < offset + 4) return null

  // Find starting chunk and position
  let chunkIndex = 0
  let posInChunk = this.consumedInFirstChunk + offset
  while (posInChunk >= this.chunks[chunkIndex].length) {
    posInChunk -= this.chunks[chunkIndex].length
    chunkIndex++
  }

  const chunk = this.chunks[chunkIndex]
  const remaining = chunk.length - posInChunk

  if (remaining >= 4) {
    // Fast path: all 4 bytes in same chunk
    return (chunk[posInChunk] << 24) |
           (chunk[posInChunk + 1] << 16) |
           (chunk[posInChunk + 2] << 8) |
           chunk[posInChunk + 3]
  }

  // Slow path: spans chunks (rare for small offsets)
  let result = 0
  for (let i = 0; i < 4; i++) {
    if (posInChunk >= this.chunks[chunkIndex].length) {
      chunkIndex++
      posInChunk = 0
    }
    result = (result << 8) | this.chunks[chunkIndex][posInChunk++]
  }
  return result
}
```

**Impact:** Eliminates ~770 small allocations per tick (385 blocks × 2 peekUint32 calls). Minor GC reduction.

### 2. Kotlin Per-Socket Buffers (Medium Effort, Medium Gain)

**Current:** Kotlin batches all socket data into a single `packed` ArrayBuffer. JS creates views into it, but must copy before the next batch arrives (buffer is reused).

**Proposed:** Kotlin allocates a separate ArrayBuffer per socket read that JS can take ownership of:

```kotlin
// Instead of packing into shared buffer:
fun onSocketData(socketId: Int, data: ByteArray) {
    // Create a new ArrayBuffer that JS owns
    val jsBuffer = quickJs.createArrayBuffer(data.size)
    data.copyInto(jsBuffer)
    dispatchToJs(socketId, jsBuffer)  // JS can hold reference
}
```

**JS side:**
```typescript
// ChunkedBuffer can now hold references to incoming buffers directly
socket.onData((data) => {
  this.buffer.pushOwned(data)  // No copy - we own this buffer
})
```

**Impact:** Eliminates the copy from batch buffer to ChunkedBuffer chunks. Reduces to true zero-copy until piece assembly.

**Trade-off:** More allocations on Kotlin side, but they're larger buffers (less overhead than many small JS allocations).

### 3. Pre-Parsed PIECE Headers from Kotlin (Medium Effort, Medium Gain)

**Current:** JS parses every message to detect PIECE type and extract pieceIndex/blockOffset.

**Proposed:** Kotlin pre-parses PIECE messages and provides structured data:

```kotlin
// Kotlin side - during batch assembly
if (messageType == 7 && length >= 9) {  // PIECE
    // Pack as: [socketId][PIECE_FLAG][pieceIndex][blockOffset][dataLen][data...]
    writePieceHeader(socketId, pieceIndex, blockOffset, data)
} else {
    // Pack as: [socketId][len][rawData...]
    writeRawMessage(socketId, data)
}
```

```typescript
// JS side - dispatch knows message type
__jstorrent_tcp_dispatch_batch = (packed: ArrayBuffer) => {
  // ...
  if (flags & PIECE_FLAG) {
    const pieceIndex = view.getUint32(offset)
    const blockOffset = view.getUint32(offset + 4)
    // Direct to piece handler, no parsing needed
    handlers.onPieceBlock(pieceIndex, blockOffset, packed, dataOffset, dataLen)
  }
}
```

**Impact:** Eliminates peekByte/peekUint32 calls entirely for PIECE messages. Kotlin does the work once; JS just routes.

### 4. Memory-Mapped Piece Buffers (High Effort, High Gain)

**Current:** Piece data is assembled in JS heap, then copied to Kotlin for disk write.

**Proposed:** Kotlin provides memory-mapped buffers that JS writes to directly:

```kotlin
// Kotlin allocates piece buffer in native memory
fun allocatePieceBuffer(pieceIndex: Int, size: Int): DirectByteBuffer {
    return ByteBuffer.allocateDirect(size)
}

// JS writes blocks directly to this buffer
// When complete, Kotlin writes to disk from same buffer (no copy)
fun finalizePiece(pieceIndex: Int) {
    val buffer = pieceBuffers[pieceIndex]
    // Hash and write directly from buffer
    fileChannel.write(buffer)
}
```

**Impact:** Eliminates the final copy from JS heap to native for disk writes. True zero-copy from network to disk.

**Challenge:** QuickJS ArrayBuffer interop with DirectByteBuffer; need to verify this is possible.

### 5. Vectored/Scatter-Gather Disk Writes (Medium Effort, Small Gain)

**Current:** Each piece is written as a single contiguous buffer.

**Proposed:** For pieces spanning multiple files, use vectored writes:

```kotlin
fun writePieceVectored(pieceIndex: Int, segments: List<FileSegment>) {
    // Use FileChannel.write(ByteBuffer[]) for atomic multi-file write
    val buffers = segments.map { it.buffer }
    fileChannel.write(buffers.toTypedArray())
}
```

**Impact:** Reduces syscalls for boundary pieces. Minor improvement.

### 6. Tick-Driven vs Event-Driven Processing

**Current:** 100ms tick interval. Process whatever data accumulated.

**Observation:** At 70 MB/s, we process ~7MB per tick. If processing takes 10ms, we're idle for 90ms.

**Alternative approaches:**

a) **Shorter tick interval (50ms):** Process more frequently, smaller batches
b) **Adaptive ticking:** Process when buffer exceeds threshold OR tick fires
c) **Immediate processing:** Process each batch as it arrives (current infra doesn't support this well)

**Trade-off:** More frequent processing = more overhead, but lower latency and potentially better throughput by keeping pipeline full.

## Measurement Plan

Before implementing any of these, instrument to find the actual bottleneck:

```typescript
// In processBuffer fast path
const t0 = performance.now()
const msgType = this.buffer.peekByte(4)  // measure peek time
const t1 = performance.now()
const pieceIndex = this.buffer.peekUint32(5)
const blockOffset = this.buffer.peekUint32(9)
const t2 = performance.now()
this.onPieceBlock(...)  // measure callback time
const t3 = performance.now()
this.buffer.discard(totalLength)  // measure discard time
const t4 = performance.now()

// Accumulate: peekTime, callbackTime, discardTime
```

This tells us whether peekUint32 allocation, the callback overhead, or something else is the remaining bottleneck.

## Priority Order

1. **Measure first** - Find actual bottleneck
2. **Allocation-free peekUint32** - Easy win, validates measurement
3. **Kotlin per-socket buffers** - Bigger win, moderate effort
4. **Pre-parsed PIECE headers** - Only if peek overhead is significant
5. **Memory-mapped buffers** - Major refactor, save for later

## Files Involved

- `packages/engine/src/core/chunked-buffer.ts` - peekUint32 optimization
- `packages/engine/src/adapters/native/callback-manager.ts` - batch dispatch changes
- `android/app/src/main/java/com/jstorrent/app/engine/TcpBindings.kt` - Kotlin buffer allocation
- `packages/engine/src/core/peer-connection.ts` - processBuffer changes
