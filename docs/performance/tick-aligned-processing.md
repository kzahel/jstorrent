# Tick-Aligned Processing Architecture

## Problem Statement

At high download speeds (40-80 MB/s target), the current reactive callback model causes JS thread saturation:

```
Current: TCP data arrives → callback fires → processBuffer() → emit events → promises → job pump
         TCP data arrives → callback fires → processBuffer() → emit events → promises → job pump
         ... (unpredictable interleaving, 60+ callbacks queued)
```

Observed symptoms (from Pixel 7 logs at ~10 MB/s):
- JS thread latency: 1268ms (max 6369ms)
- TCP callback queue depth: 61 (BACKPRESSURE)
- Callback latency: avg 1826ms, max 2844ms
- JobPump: avg 838ms, max 2834ms

The problem is not individual operation cost - it's the chaotic interleaving of callbacks, protocol processing, and promise execution.

## Solution: Game Loop Architecture

Adopt a game engine tick model: gather inputs, process, render outputs, repeat.

```
┌─────────────────────────────────────────────────────────────┐
│                       TICK (100ms)                          │
├─────────────────────────────────────────────────────────────┤
│  1. GATHER INPUTS                                           │
│     - Drain TCP buffers (all peers)                         │
│     - Drain UDP buffers (DHT, trackers)                     │
│     - Drain disk completion callbacks                       │
│     - Drain hash verification results                       │
│                                                             │
│  2. PROCESS                                                 │
│     - Parse protocol messages                               │
│     - Update piece state                                    │
│     - Handle completed pieces                               │
│     - Run piece selection                                   │
│                                                             │
│  3. OUTPUT                                                  │
│     - Send REQUEST messages                                 │
│     - Send HAVE broadcasts                                  │
│     - Queue disk writes                                     │
│     - Emit UI state updates                                 │
│                                                             │
│  4. PUMP JOBS (single batch)                                │
└─────────────────────────────────────────────────────────────┘
```

Benefits:
- **Predictable timing** - all work at known intervals
- **Batchable operations** - process 20 peers in one loop, not 20 callbacks
- **No promise storms** - one controlled job pump per tick
- **Natural backpressure** - buffer size directly measurable
- **Platform-agnostic** - same behavior for Android and extension

## Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Download speed | ~10 MB/s | 80 MB/s |
| Tick budget | 50ms (but overruns) | ≤50ms |
| Callback queue depth | 61 | 0 (tick-driven) |
| FFI crossings per tick | ~80 | 1-2 |
| JS thread latency | 1268ms | <100ms |

At 80 MB/s with 100ms ticks:
- 8 MB data per tick
- ~8 pieces completing (1MB pieces)
- ~8 hash verifications
- ~8 disk writes

## Implementation Phases

### Phase 1: JS-Side Tick Alignment (No Kotlin Changes)

**Goal**: Eliminate processing during callbacks. Buffer only, process at tick.

**Changes**:

1. `PeerConnection.handleData()` - buffer only, no processing
```typescript
// Before
handleData(data: Uint8Array) {
  this.buffer.push(data)
  this.downloaded += data.length
  this.downloadSpeedCalculator.addBytes(data.length)
  this.emit('bytesDownloaded', data.length)
  this.processBuffer()  // ← All the work happens here
}

// After
handleData(data: Uint8Array) {
  this.buffer.push(data)
  this.pendingBytes += data.length
  // No processing - wait for tick
}
```

2. `PeerConnection.drainBuffer()` - new method for tick loop
```typescript
drainBuffer(): void {
  if (this.pendingBytes > 0) {
    this.downloaded += this.pendingBytes
    this.downloadSpeedCalculator.addBytes(this.pendingBytes)
    this.emit('bytesDownloaded', this.pendingBytes)
    this.pendingBytes = 0
  }
  this.processBuffer()
}
```

3. `TorrentTickLoop.requestTick()` - drain before processing
```typescript
private requestTick(): void {
  const peers = this.callbacks.getConnectedPeers()

  // Phase 1: GATHER - drain all input buffers
  for (const peer of peers) {
    peer.drainBuffer()
  }

  // Phase 2: PROCESS - existing piece request logic
  // ... (unchanged)

  // Phase 3: OUTPUT - flush sends
  this.flushPeers(peers)
}
```

**Testing**:
- Unit test: `PeerConnection.handleData()` doesn't call `processBuffer()`
- Unit test: `drainBuffer()` processes accumulated data correctly
- Integration test: Download completes successfully with tick-aligned processing
- Benchmark: Measure callback latency before/after

**Metrics to validate**:
- Callback latency should drop to near-zero (just buffer append)
- Tick duration should increase slightly (doing all work)
- Overall throughput should improve or stay same

### Phase 2: Backpressure Signaling

**Goal**: Prevent unbounded buffer growth when JS can't keep up.

**Changes**:

1. Track total buffered bytes across all peers
```typescript
// In Torrent or TorrentTickLoop
private getTotalBufferedBytes(): number {
  let total = 0
  for (const peer of this.callbacks.getConnectedPeers()) {
    total += peer.buffer.length
  }
  return total
}
```

2. Signal backpressure to native layer
```typescript
// Constants
const BACKPRESSURE_HIGH_WATER = 16 * 1024 * 1024   // 16MB - activate
const BACKPRESSURE_LOW_WATER = 4 * 1024 * 1024    // 4MB - release (hysteresis)

// In tick loop
private checkBackpressure(): void {
  const buffered = this.getTotalBufferedBytes()

  if (!this.backpressureActive && buffered > BACKPRESSURE_HIGH_WATER) {
    this.backpressureActive = true
    this.callbacks.setBackpressure(true)
    this.logger.warn(`Backpressure ON: ${(buffered / 1024 / 1024).toFixed(1)}MB buffered`)
  } else if (this.backpressureActive && buffered < BACKPRESSURE_LOW_WATER) {
    this.backpressureActive = false
    this.callbacks.setBackpressure(false)
    this.logger.info(`Backpressure OFF: ${(buffered / 1024 / 1024).toFixed(1)}MB buffered`)
  }
}
```

3. Native binding for backpressure signal
```typescript
// bindings.d.ts
declare function __jstorrent_tcp_set_backpressure(active: boolean): void

// socket-factory or similar
setBackpressure(active: boolean): void {
  if (typeof __jstorrent_tcp_set_backpressure === 'function') {
    __jstorrent_tcp_set_backpressure(active)
  }
  // Extension: no-op, WebSocket has its own flow control
}
```

4. Kotlin side: pause/resume reads
```kotlin
// TcpBindings.kt or TcpSocketManager
fun setBackpressure(active: Boolean) {
  if (active) {
    tcpManager.pauseAllReads()
  } else {
    tcpManager.resumeAllReads()
  }
}

// TcpConnection.kt - add pause/resume capability
private var readsPaused = false

fun pauseReads() {
  readsPaused = true
}

fun resumeReads() {
  readsPaused = false
  // Restart read loop if it was waiting
}
```

**Testing**:
- Unit test: Backpressure activates at high water mark
- Unit test: Backpressure releases at low water mark (not high)
- Integration test: Simulate slow processing, verify reads pause
- Integration test: Verify recovery when processing catches up

**Metrics to validate**:
- Buffer size stays bounded under load
- No OOM crashes during fast downloads
- Throughput degrades gracefully under overload

### Phase 3: Kotlin-Side Batch Crossing

**Goal**: Single FFI boundary crossing per tick for all TCP data.

**Current flow** (per connection, per read):
```
I/O thread → onTcpData(socketId, data) → jsThread.post{} → FFI call
I/O thread → onTcpData(socketId, data) → jsThread.post{} → FFI call
... (20 connections × multiple reads = 60+ FFI calls)
```

**Target flow** (batched):
```
I/O threads → accumulate in ConcurrentQueue
Tick timer → flush queue → single jsThread.post{} → single FFI call
```

**Changes**:

1. Accumulator for pending TCP data
```kotlin
// TcpBindings.kt
private val pendingTcpData = ConcurrentLinkedQueue<TcpDataEvent>()

data class TcpDataEvent(
  val socketId: Int,
  val data: ByteArray,
  val timestamp: Long = System.currentTimeMillis()
)

override fun onTcpData(socketId: Int, data: ByteArray) {
  // Don't post immediately - accumulate
  pendingTcpData.add(TcpDataEvent(socketId, data))
}
```

2. Periodic flush (aligned with JS tick)
```kotlin
// Called by timer or triggered by JS
fun flushTcpData() {
  if (pendingTcpData.isEmpty()) return

  // Drain queue
  val batch = mutableListOf<TcpDataEvent>()
  while (true) {
    val event = pendingTcpData.poll() ?: break
    batch.add(event)
  }

  if (batch.isEmpty()) return

  // Pack into binary format: [count:u32] [socketId:u32 len:u32 data:bytes]...
  val packed = packTcpBatch(batch)

  jsThread.post {
    ctx.callGlobalFunctionWithBinary(
      "__jstorrent_tcp_dispatch_batch",
      packed,
      0
    )
    jsThread.scheduleJobPump(ctx)
  }
}

private fun packTcpBatch(batch: List<TcpDataEvent>): ByteArray {
  val totalSize = 4 + batch.sumOf { 8 + it.data.size }
  val buf = ByteBuffer.allocate(totalSize).order(ByteOrder.LITTLE_ENDIAN)
  buf.putInt(batch.size)
  for (event in batch) {
    buf.putInt(event.socketId)
    buf.putInt(event.data.size)
    buf.put(event.data)
  }
  return buf.array()
}
```

3. JS-side batch receiver
```typescript
// callback-manager.ts or native bindings
globalThis.__jstorrent_tcp_dispatch_batch = (packed: ArrayBuffer) => {
  const view = new DataView(packed)
  let offset = 0
  const count = view.getUint32(offset, true)
  offset += 4

  for (let i = 0; i < count; i++) {
    const socketId = view.getUint32(offset, true)
    offset += 4
    const len = view.getUint32(offset, true)
    offset += 4
    const data = new Uint8Array(packed, offset, len)
    offset += len

    // Dispatch to socket handler (just buffers, no processing)
    const handlers = tcpHandlers.get(socketId)
    handlers?.onData?.(data)
  }
}
```

4. Tick-aligned flush trigger
```kotlin
// Option A: Timer on Kotlin side (100ms)
private val flushTimer = Timer().apply {
  scheduleAtFixedRate(object : TimerTask() {
    override fun run() {
      flushTcpData()
    }
  }, 100, 100)
}

// Option B: JS requests flush at start of tick
// __jstorrent_tcp_flush() called from requestTick()
```

**Testing**:
- Unit test: Multiple onTcpData calls accumulate in queue
- Unit test: flushTcpData packs correctly
- Unit test: JS unpacks and dispatches to correct sockets
- Benchmark: Measure FFI calls per second before/after
- Integration test: High-speed download with batched crossing

**Metrics to validate**:
- FFI crossings per tick: 60+ → 1-2
- Callback latency: near-zero (just queue append)
- Overall throughput improvement

### Phase 4: Extend to Other Callbacks

Apply same pattern to other high-frequency callbacks:

1. **UDP data** (DHT, trackers)
   - Same batch accumulation pattern
   - Lower volume than TCP, but benefits from consistency

2. **Disk completion callbacks**
   - `onWriteComplete`, `onHashComplete`
   - Batch into single crossing per tick

3. **Hash results**
   - Already async, but callback delivery can be batched

**Changes mirror Phase 3 for each callback type.**

### Phase 5: HAVE Broadcast Batching

**Problem**: Currently sends HAVE to each peer individually on piece completion.

```
Piece completes → emit('have') → 15× peer.sendHave() → 15× FFI calls
```

**Solution**: Batch HAVEs at end of tick.

```typescript
// In tick loop output phase
private pendingHaves: number[] = []

onPieceVerified(index: number) {
  this.pendingHaves.push(index)
}

// At end of tick
flushHaves() {
  if (this.pendingHaves.length === 0) return

  const peers = this.callbacks.getConnectedPeers()
  for (const peer of peers) {
    for (const index of this.pendingHaves) {
      peer.queueHave(index)  // Queue, don't send yet
    }
  }
  this.pendingHaves = []
  // flushPeers() sends all queued messages
}
```

## Migration Strategy

Each phase is independently deployable and testable:

| Phase | Risk | Rollback | Dependencies |
|-------|------|----------|--------------|
| 1. JS tick alignment | Low | Feature flag | None |
| 2. Backpressure | Low | Remove checks | Phase 1 |
| 3. Kotlin batching | Medium | Revert to per-callback | Phase 1 |
| 4. Other callbacks | Low | Per-callback type | Phase 3 |
| 5. HAVE batching | Low | Revert to immediate | Phase 1 |

Recommended order: 1 → 2 → 3 → 5 → 4

Phase 1 alone should provide significant improvement. Phase 3 is the biggest win for Android but also the most complex.

## Compatibility

**Extension (WebSocket)**:
- Phase 1-2: Works identically, WebSocket callbacks just buffer
- Phase 3-4: No-op (no Kotlin), but JS side still tick-aligned
- Same predictable behavior on both platforms

**Node.js (if applicable)**:
- Same pattern applies to Node socket callbacks

## Observability

Add metrics for monitoring:

```typescript
interface TickMetrics {
  // Existing
  tickCount: number
  tickDurationMs: number

  // New
  bytesProcessedPerTick: number
  messagesProcessedPerTick: number
  bufferedBytesAtTickStart: number
  backpressureActivations: number
  ffiCrossingsPerTick: number  // Android only
}
```

Log format:
```
[Tick] duration=45ms, processed=850KB/124msgs, buffered=2.1MB, backpressure=off
```

## Appendix: Data Flow Diagrams

### Current (Reactive)

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  I/O Thread │───▶│ jsThread.post│───▶│  Callback   │
│  (per conn) │    │  (per read)  │    │ processData │
└─────────────┘    └──────────────┘    └──────┬──────┘
                                              │
                         ┌────────────────────┘
                         ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Promises  │◀───│ Event Emit   │◀───│Parse Message│
│  (per msg)  │    │  (per msg)   │    │  (per msg)  │
└──────┬──────┘    └──────────────┘    └─────────────┘
       │
       ▼
┌─────────────┐
│  Job Pump   │ (after each callback)
│ (variable)  │
└─────────────┘
```

### Proposed (Tick-Aligned)

```
┌─────────────┐    ┌──────────────┐
│  I/O Thread │───▶│    Queue     │  (just append, no post)
│  (per conn) │    │ (lock-free)  │
└─────────────┘    └──────┬───────┘
                          │
        ┌─────────────────┘
        │ (100ms timer)
        ▼
┌───────────────┐    ┌──────────────┐
│ Pack & Post   │───▶│  Single FFI  │
│ (all data)    │    │   Crossing   │
└───────────────┘    └──────┬───────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────┐
│                      TICK                           │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────┐  │
│  │ Drain   │─▶│ Process │─▶│ Output  │─▶│ Pump  │  │
│  │ Buffers │  │  All    │  │  All    │  │ Once  │  │
│  └─────────┘  └─────────┘  └─────────┘  └───────┘  │
└─────────────────────────────────────────────────────┘
```

## References

- [hashing-performance.md](./hashing-performance.md) - FFI overhead analysis
- [piece-picker-overhaul.md](./piece-picker-overhaul.md) - Piece selection performance
- Game loop pattern: https://gameprogrammingpatterns.com/game-loop.html
