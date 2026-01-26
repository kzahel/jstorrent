# Zero-Copy Buffer Optimization Plan

## Overview

This document outlines the implementation plan for optimizing the torrent engine's data path to minimize memory copies during downloads. The current implementation performs multiple unnecessary copies per block of data received; this optimization reduces it to a single copy.

### Current Hot Path (2+ copies per block)

```
Network packet arrives (Uint8Array)
    ↓ COPY 1: concat to peer buffer (O(buffer_size) on EVERY packet!)
peer.buffer = [...old buffer, ...new data]
    ↓ COPY 2: slice message out
message = buffer.slice(0, messageLength)
    ↓ (block reference stored in Map - no copy)
ActivePiece.blockData.set(index, block)
    ↓ COPY 3: assemble all blocks into piece
piece.assemble() → new buffer with all blocks copied in
    ↓
Send to storage layer
```

### Optimized Hot Path (1 copy per block)

```
Network packet arrives (Uint8Array)
    ↓ O(1) push to chunks array
chunkedBuffer.push(data)
    ↓ peek header across chunks (no copy)
parse message length
    ↓ COPY: write block directly to pre-allocated piece buffer
chunkedBuffer.copyTo(pieceBuffer, destOffset, srcOffset, length)
    ↓ discard consumed chunks
chunkedBuffer.discard(messageLength)
    ↓ piece buffer IS the assembled piece (no assembly copy)
Send to storage layer
```

### Expected Impact

- **CPU reduction**: Eliminates O(buffer_size) copy on every packet
- **Memory reduction**: No intermediate buffers, optional pooling reduces GC
- **Throughput increase**: Estimated 20-50% improvement on CPU-bound devices

---

## Phase 1: ChunkedBuffer Class

**Goal**: Create a zero-copy receive buffer that stores chunks by reference and supports efficient cross-chunk operations.

### 1.1 Create ChunkedBuffer

**File**: `packages/engine/src/core/chunked-buffer.ts`

```typescript
export class ChunkedBuffer {
  private chunks: Uint8Array[] = []
  private totalLength = 0
  private consumedInFirstChunk = 0  // bytes already consumed from chunks[0]

  // O(1) - just push reference
  push(data: Uint8Array): void

  // Total available bytes
  get length(): number

  // Read bytes across chunk boundaries without consuming
  peek(offset: number, length: number): Uint8Array

  // Read a big-endian uint32 at offset (for message length parsing)
  peekUint32(offset: number): number | null

  // Copy bytes directly to destination buffer (the ONE copy we allow)
  copyTo(dest: Uint8Array, destOffset: number, srcOffset: number, length: number): void

  // Discard bytes from the front (after message consumed)
  discard(length: number): void

  // For small messages: extract and consume (allocates new buffer)
  consume(length: number): Uint8Array
}
```

### 1.2 Unit Tests

**File**: `packages/engine/src/core/chunked-buffer.test.ts`

Test cases:
- [ ] `push()` increases length correctly
- [ ] `peekUint32()` reads within single chunk
- [ ] `peekUint32()` reads across chunk boundary (bytes 2-3 in chunk 1, bytes 0-1 in chunk 2)
- [ ] `peekUint32()` returns null when insufficient data
- [ ] `copyTo()` copies within single chunk
- [ ] `copyTo()` copies across multiple chunks
- [ ] `discard()` removes bytes from front
- [ ] `discard()` handles discarding entire chunks
- [ ] `discard()` handles partial chunk discard
- [ ] `consume()` returns correct bytes and advances position
- [ ] Stress test: many small chunks, large reads across them

### 1.3 Success Criteria

- [ ] All unit tests pass
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run lint` passes

---

## Phase 2: Integrate ChunkedBuffer into PeerConnection

**Goal**: Replace the naive buffer concatenation in `peer-connection.ts` with `ChunkedBuffer`.

### 2.1 Modify PeerConnection

**File**: `packages/engine/src/core/peer-connection.ts`

Changes:
1. Replace `private buffer: Uint8Array = new Uint8Array(0)` with `private buffer = new ChunkedBuffer()`
2. Update `handleData()` to use `buffer.push(data)` instead of concat
3. Update `processBuffer()` to use `buffer.peekUint32()` and `buffer.consume()`

**Before**:
```typescript
private handleData(data: Uint8Array) {
  const newBuffer = new Uint8Array(this.buffer.length + data.length)
  newBuffer.set(this.buffer)
  newBuffer.set(data, this.buffer.length)
  this.buffer = newBuffer
  this.processBuffer()
}
```

**After**:
```typescript
private handleData(data: Uint8Array) {
  this.buffer.push(data)
  this.processBuffer()
}
```

### 2.2 Update processBuffer()

**Before**:
```typescript
while (this.buffer.length > 4) {
  const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
  const length = view.getUint32(0, false)
  const totalLength = 4 + length

  if (this.buffer.length >= totalLength) {
    const message = this.buffer.slice(0, totalLength)
    this.buffer = this.buffer.slice(totalLength)
    const msg = PeerWireProtocol.parseMessage(message)
    // ...
  }
}
```

**After**:
```typescript
while (this.buffer.length > 4) {
  const length = this.buffer.peekUint32(0)
  if (length === null) break

  const totalLength = 4 + length
  if (this.buffer.length < totalLength) break

  const message = this.buffer.consume(totalLength)
  const msg = PeerWireProtocol.parseMessage(message)
  // ...
}
```

### 2.3 Handle Handshake Parsing

The handshake parsing also needs updating - it currently uses `this.buffer.slice(68)`.

### 2.4 Integration Tests

Run existing peer connection tests to ensure no regressions:
```bash
pnpm test --filter=engine -- peer-connection
```

### 2.5 Success Criteria

- [ ] All existing peer-connection tests pass
- [ ] No regressions in torrent download functionality
- [ ] `pnpm run typecheck` passes

---

## Phase 3: Pre-allocated Piece Buffer

**Goal**: Modify `ActivePiece` to accept a pre-allocated buffer and write blocks directly to their final positions, eliminating the assembly copy.

### 3.1 Modify ActivePiece

**File**: `packages/engine/src/core/active-piece.ts`

Changes:
1. Add `buffer: Uint8Array` field (pre-allocated to piece length)
2. Change `blockData: Map<number, Uint8Array>` to `blockReceived: boolean[]` (just track receipt)
3. Modify `addBlock()` to write directly to buffer position
4. Modify `assemble()` to just return the buffer (no copy)

**Before**:
```typescript
export class ActivePiece {
  private blockData: Map<number, Uint8Array> = new Map()

  addBlock(blockIndex: number, data: Uint8Array, peerId: string): boolean {
    if (this.blockData.has(blockIndex)) return false
    this.blockData.set(blockIndex, data)  // store reference
    // ...
  }

  assemble(): Uint8Array {
    const result = new Uint8Array(this.length)
    for (let i = 0; i < this.blocksNeeded; i++) {
      result.set(this.blockData.get(i)!, i * BLOCK_SIZE)  // COPY
    }
    return result
  }
}
```

**After**:
```typescript
export class ActivePiece {
  private buffer: Uint8Array
  private blockReceived: boolean[]

  constructor(index: number, length: number, buffer?: Uint8Array) {
    // ...
    this.buffer = buffer ?? new Uint8Array(length)
    this.blockReceived = new Array(this.blocksNeeded).fill(false)
  }

  addBlock(blockIndex: number, data: Uint8Array, peerId: string): boolean {
    if (this.blockReceived[blockIndex]) return false

    const offset = blockIndex * BLOCK_SIZE
    this.buffer.set(data, offset)  // Write directly to final position
    this.blockReceived[blockIndex] = true
    // ...
  }

  assemble(): Uint8Array {
    return this.buffer  // Already assembled!
  }
}
```

### 3.2 Add Variant: addBlockFromChunked()

For full zero-copy from chunked buffer to piece buffer:

```typescript
addBlockFromChunked(
  blockIndex: number,
  source: ChunkedBuffer,
  sourceOffset: number,
  length: number,
  peerId: string
): boolean {
  if (this.blockReceived[blockIndex]) return false

  const destOffset = blockIndex * BLOCK_SIZE
  source.copyTo(this.buffer, destOffset, sourceOffset, length)
  this.blockReceived[blockIndex] = true
  // ...
}
```

### 3.3 Unit Tests

**File**: `packages/engine/src/core/active-piece.test.ts`

Additional test cases:
- [ ] Pre-allocated buffer receives blocks correctly
- [ ] Blocks written to correct offsets
- [ ] `assemble()` returns buffer without copying
- [ ] `addBlockFromChunked()` copies from chunked buffer correctly
- [ ] Out-of-order block receipt works
- [ ] Duplicate block rejection still works
- [ ] `bufferedBytes` calculation still correct
- [ ] `haveAllBlocks` detection still works

### 3.4 Success Criteria

- [ ] All unit tests pass
- [ ] Existing active-piece tests pass
- [ ] `pnpm run typecheck` passes

---

## Phase 4: Buffer Pool (Optional Enhancement)

**Goal**: Add buffer pooling to reduce allocation/GC overhead.

### 4.1 Create PieceBufferPool

**File**: `packages/engine/src/core/piece-buffer-pool.ts`

```typescript
export class PieceBufferPool {
  private available: Uint8Array[] = []
  private bufferSize: number
  private maxPoolSize: number

  constructor(bufferSize: number, maxPoolSize: number = 64) {
    this.bufferSize = bufferSize
    this.maxPoolSize = maxPoolSize
  }

  acquire(): Uint8Array {
    return this.available.pop() ?? new Uint8Array(this.bufferSize)
  }

  release(buffer: Uint8Array): void {
    if (buffer.length === this.bufferSize && this.available.length < this.maxPoolSize) {
      this.available.push(buffer)
    }
    // Otherwise let GC handle it (wrong size or pool full)
  }

  clear(): void {
    this.available.length = 0
  }
}
```

### 4.2 Integrate with ActivePieceManager

**File**: `packages/engine/src/core/active-piece-manager.ts`

Changes:
1. Add `bufferPool: PieceBufferPool` field
2. When creating `ActivePiece`, acquire buffer from pool
3. When removing `ActivePiece`, release buffer back to pool

### 4.3 Handle Variable Piece Sizes

The last piece is often smaller. Options:
- A. Separate pool for common size, allocate for last piece
- B. Always allocate full-size, use subarray for last piece
- C. Multiple pools for different sizes

Recommend option A for simplicity.

### 4.4 Unit Tests

- [ ] Pool returns new buffer when empty
- [ ] Pool returns reused buffer when available
- [ ] Pool respects maxPoolSize
- [ ] Pool rejects wrong-sized buffers

### 4.5 Success Criteria

- [ ] All tests pass
- [ ] Memory profile shows reduced allocations during download

---

## Phase 5: Wire It Together in Torrent

**Goal**: Connect the optimized path from peer message receipt through to piece completion.

### 5.1 Modify Block Handling in torrent.ts

Currently blocks flow through events. We need to enable the zero-copy path:

**Option A**: Pass ChunkedBuffer reference through event system
- More invasive change
- Maximum efficiency

**Option B**: Keep current event structure, use pre-allocated piece buffers only
- Less invasive
- Still eliminates assembly copy
- Keeps the peer-connection ChunkedBuffer optimization separate

Recommend starting with **Option B** for safer incremental change.

### 5.2 Integration Test

**File**: `packages/engine/src/core/torrent.integration.test.ts` (or use existing)

Test the full download path:
1. Mock peer sends PIECE messages
2. Verify blocks written to piece buffer
3. Verify completed piece has correct data
4. Verify hash verification passes

### 5.3 End-to-End Test

Use the existing e2e test infrastructure:
```bash
pnpm seed-for-test &
# Run download test
```

Compare throughput before/after on same hardware.

### 5.4 Success Criteria

- [ ] All integration tests pass
- [ ] E2E download completes successfully
- [ ] No memory leaks (buffer pool releases working)

---

## Phase 6: Benchmarking

**Goal**: Measure the performance improvement.

### 6.1 Create Microbenchmark

**File**: `packages/engine/benchmarks/buffer-copy.bench.ts`

Benchmark scenarios:
1. Old way: concat buffer on each packet
2. New way: ChunkedBuffer push
3. Old way: assemble piece from Map of blocks
4. New way: pre-allocated buffer (no assembly)

### 6.2 Create Throughput Benchmark

Measure pieces/second and MB/s:
- Single peer, fast local connection
- Multiple peers
- Various piece sizes

### 6.3 Real-World Test

Test on the Chromebook via ADB to measure actual improvement.

### 6.4 Success Criteria

- [ ] Microbenchmarks show expected improvement
- [ ] Real-world Chromebook throughput increases
- [ ] No regressions on fast hardware (MacBook)

---

## Implementation Order

| Phase | Description | Complexity | Dependencies |
|-------|-------------|------------|--------------|
| 1 | ChunkedBuffer class | Medium | None |
| 2 | Integrate into PeerConnection | Medium | Phase 1 |
| 3 | Pre-allocated piece buffer | Medium | None (can parallel with 1-2) |
| 4 | Buffer pool | Low | Phase 3 |
| 5 | Wire together | Medium | Phases 2, 3 |
| 6 | Benchmarking | Low | Phase 5 |

Phases 1-2 and 3-4 can be developed in parallel, then integrated in Phase 5.

---

## Rollback Plan

Each phase is independently testable. If issues arise:

1. **Phase 2 issues**: Revert to old buffer concat (ChunkedBuffer still available for future)
2. **Phase 3 issues**: Revert to Map-based block storage
3. **Phase 4 issues**: Disable pooling (still use pre-allocated buffers, just don't reuse)

The changes are additive and the old code paths can be preserved behind flags if needed.

---

## Files Changed Summary

| File | Change |
|------|--------|
| `packages/engine/src/core/chunked-buffer.ts` | NEW |
| `packages/engine/src/core/chunked-buffer.test.ts` | NEW |
| `packages/engine/src/core/piece-buffer-pool.ts` | NEW |
| `packages/engine/src/core/piece-buffer-pool.test.ts` | NEW |
| `packages/engine/src/core/peer-connection.ts` | Modified |
| `packages/engine/src/core/active-piece.ts` | Modified |
| `packages/engine/src/core/active-piece-manager.ts` | Modified |
| `packages/engine/src/core/torrent.ts` | Minor modifications |
