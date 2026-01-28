# Download Bottleneck Analysis

**Date:** 2026-01-28
**Test Setup:** Pixel 7a downloading 1GB test file from local seeder (capable of 90+ MB/s)
**Observed Rate:** ~35 MB/s
**Goal:** Identify what's limiting throughput

## Executive Summary

The primary bottleneck is **QuickJS message processing time** in Phase 1 of the tick loop, specifically due to **triple-copy overhead** when parsing PIECE messages. Processing takes ~24ms per tick to handle ~6MB of data, leaving the system CPU-bound rather than I/O-bound.

## Instrumentation Data

Added detailed per-tick instrumentation showing:

```
Tick: 33 ticks, avg 27.5ms (P1:23.0/P3:4.0/P4:0.5), max 38ms, 28 active, 1 peers
BUF:6181KB, BLOCKS:recv=385.5/sent=385.5, PIPE:100% of 500
```

**Key metrics:**
- **P1 (drain/process):** 23-24ms average - THE BOTTLENECK
- **P3 (request):** 4ms average
- **P4 (output/flush):** 0.5ms average
- **Blocks received:** 385 blocks/tick × 16KB = 6.2MB/tick
- **Pipeline utilization:** 100% of 500 slots
- **Disk write rate:** 34 MB/s (not the bottleneck)

## Ruled Out Bottlenecks

### 1. Backpressure Threshold (16MB → 64MB)
Tested increasing from 16MB to 64MB. **No improvement.** The system still processed at the same rate because the bottleneck is CPU processing, not memory limits.

### 2. Disk I/O
```
disk queue: 0 pending/18 running, disk write: 34MB/s
```
Disk is keeping up fine. The batch write system with 30 workers is working well.

### 3. Request Pipeline
Pipeline is 100% full (500/500 outstanding requests). Request generation is not the bottleneck.

### 4. Network
The seeder can deliver 90+ MB/s to desktop clients. Network is not the limit.

## Root Cause: Triple-Copy in PIECE Message Parsing

When a PIECE message arrives, it goes through three copy operations:

### Copy 1: ChunkedBuffer.consume()
```typescript
// peer-connection.ts:459
const message = this.buffer.consume(totalLength)
```
`consume()` allocates a new `Uint8Array(length)` and copies data from the ChunkedBuffer.

### Copy 2: parseMessage() payload slice
```typescript
// wire-protocol.ts:110
const payload = buffer.slice(5, 4 + length)
```
Creates another copy of the message payload (minus length prefix + type byte).

### Copy 3: parseMessage() block slice
```typescript
// wire-protocol.ts:135
message.block = payload.slice(8)
```
Creates yet another copy for just the block data.

### Copy 4: Final piece assembly
```typescript
// active-piece.ts:283
this.buffer.set(data, offset)
```
Copies into the pre-allocated piece buffer.

**Total: 4 copies of every 16KB block**

At 385 blocks/tick:
- 385 × 16KB × 3 extra copies = ~18MB of unnecessary allocations per tick
- Plus GC pressure from all those temporary arrays

## Proposed Solution: Zero-Copy PIECE Fast Path

### Approach

Add a callback-based fast path that bypasses the normal parsing for PIECE messages:

```typescript
// In PeerConnection
public onPieceBlockZeroCopy?: (
  pieceIndex: number,
  blockOffset: number,
  buffer: ChunkedBuffer,
  dataOffset: number,
  dataLength: number,
) => void
```

### Modified processBuffer() Flow

```typescript
while (this.buffer.length > 4) {
  const length = this.buffer.peekUint32(0)
  if (length === null) break

  const totalLength = 4 + length
  if (this.buffer.length < totalLength) break

  // Fast path: PIECE messages with zero-copy callback
  if (this.onPieceBlockZeroCopy && this.buffer.length >= 5) {
    const msgType = this.buffer.peekByte(4)  // Need to add this method
    if (msgType === MessageType.PIECE && length >= 9) {
      // Peek header without copying
      const headerBytes = this.buffer.peekBytes(5, 8)
      if (headerBytes) {
        const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, 8)
        const pieceIndex = view.getUint32(0, false)
        const blockOffset = view.getUint32(4, false)
        const dataLength = length - 9  // total - type - index - begin

        // Call handler with ChunkedBuffer reference
        // Handler copies directly to piece buffer: ONE copy
        this.onPieceBlockZeroCopy(
          pieceIndex,
          blockOffset,
          this.buffer,
          13,  // offset: 4 (len) + 1 (type) + 4 (index) + 4 (begin)
          dataLength
        )

        // Now discard the message
        this.buffer.discard(totalLength)

        // Update stats
        this.pendingBytes += totalLength
        continue
      }
    }
  }

  // Slow path: other message types (unchanged)
  const message = this.buffer.consume(totalLength)
  // ... existing code
}
```

### Handler Implementation

```typescript
// In torrent-peer-handler.ts or torrent.ts
peer.onPieceBlockZeroCopy = (pieceIndex, blockOffset, buffer, dataOffset, dataLength) => {
  // Directly copy from ChunkedBuffer to piece buffer
  const piece = this.activePieces.get(pieceIndex)
  if (piece) {
    const blockIndex = Math.floor(blockOffset / BLOCK_SIZE)
    piece.addBlockFromChunkedDirect(blockIndex, buffer, dataOffset, dataLength, peerId)
  }

  // Decrement requestsPending
  if (peer.requestsPending > 0) peer.requestsPending--
  peer.recordBlockReceived()
}
```

### ChunkedBuffer Addition

```typescript
// Add to chunked-buffer.ts
peekByte(offset: number): number | null {
  if (this._length <= offset) return null
  // Navigate to correct chunk and return byte
  // Similar logic to peekBytes but for single byte
}
```

### Expected Impact

**Before:** 4 copies per block (consume + 2 slices + set)
**After:** 1 copy per block (direct copyTo from ChunkedBuffer to piece buffer)

**Estimated improvement:**
- 75% reduction in memory allocations
- Reduced GC pressure
- P1 time could drop from 24ms to ~8-10ms
- Potential throughput increase to 50-60+ MB/s

## Additional Optimizations (Lower Priority)

### 1. Use subarray() Instead of slice() for Non-PIECE Messages

For messages where we don't need to own the data long-term, `subarray()` creates a view without copying:

```typescript
// Instead of:
const payload = buffer.slice(5, 4 + length)

// Use:
const payload = buffer.subarray(5, 4 + length)
```

Caveat: The view becomes invalid after `buffer` is modified/reused. Safe for immediate parsing.

### 2. Reduce EventEmitter Overhead

The 'message' event is emitted for every message, then checked if it's PIECE:
```typescript
peer.on('message', (msg) => {
  if (msg.type === MessageType.PIECE) {
    this.callbacks.onBlock(peer, msg)
  }
})
```

With 385 blocks/tick, that's 385 event emissions through Node's EventEmitter. A direct callback would be faster.

### 3. toHex() Called Per Block

```typescript
// torrent.ts:2267
const peerId = peer.peerId ? toHex(peer.peerId) : 'unknown'
```

This converts the 20-byte peer ID to hex string for every block. Could cache this on the peer object.

### 4. Consider Larger Tick Interval for Batching

Current: 100ms ticks
If processing 6MB takes 24ms, we're idle for 76ms waiting for the next tick.

Alternative: Process when buffer reaches threshold OR tick fires, whichever comes first.

## Files to Modify

1. **packages/engine/src/core/chunked-buffer.ts**
   - Add `peekByte(offset)` method

2. **packages/engine/src/core/peer-connection.ts**
   - Add `onPieceBlockZeroCopy` callback property
   - Add fast path in `processBuffer()`

3. **packages/engine/src/core/active-piece.ts**
   - Add or verify `addBlockFromChunkedDirect()` (similar to existing `addBlockFromChunked`)

4. **packages/engine/src/core/torrent-peer-handler.ts** or **torrent.ts**
   - Wire up the zero-copy callback when setting up peer handlers

## Testing Plan

1. Run baseline: `./scripts/dev-test-native.sh pixel7a --size 1gb`
2. Note P1 time and total throughput
3. Implement zero-copy fast path
4. Re-run same test
5. Compare P1 time (target: <10ms) and throughput (target: >50 MB/s)

## Appendix: Instrumentation Code Added

```typescript
// torrent-tick-loop.ts - tick() method
// Bottleneck instrumentation accumulators
private _totalBufferedBytes = 0
private _totalBlocksReceived = 0
private _totalRequestsSent = 0
private _totalPipelineSlots = 0
private _totalPipelineFilled = 0
private _phase1TotalMs = 0
private _phase3TotalMs = 0
private _phase4TotalMs = 0
```

Log output format:
```
Tick: {count} ticks, avg {total}ms (P1:{drain}/P3:{request}/P4:{output}), max {max}ms,
{active} active, {peers} peers | BUF:{kb}KB, BLOCKS:recv={recv}/sent={sent}, PIPE:{util}% of {depth}
```
