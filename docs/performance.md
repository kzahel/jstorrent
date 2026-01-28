# Performance Analysis: Android Download Throughput

## Summary

Investigation into ~40MB/s download speed bottleneck on Android (Pixel 7a). Target was understanding why we're not achieving higher throughput.

## Key Findings

### 1. Download Rate Reporting Bug (FIXED)

**Problem**: UI was showing 70-85 MB/s but actual throughput was ~40-45 MB/s.

**Root Cause**: Double-counting bytes in `peer-connection.ts:503`. In the zero-copy PIECE handling path, `pendingBytes` was incremented again after bytes were already counted when TCP data arrived in `handleData()`.

**Fix**: Removed the erroneous `this.pendingBytes += totalLength` line.

### 2. Tick Interval Latency

**Problem**: Tick interval is ~147ms instead of target 100ms, limiting piece completion rate.

**Observed metrics** (during 1GB download):
- 34 ticks in 5 seconds = 147ms average interval
- Tick execution: ~22ms (P1=17ms input, P3=4ms requests, P4=0.5ms output)
- Scheduled interval: 100ms
- **Missing time: ~25ms of Handler queue latency**

**Breakdown**:
```
147ms actual = 100ms scheduled + 22ms execution + 25ms queue delay
```

**Root Cause**: The `setInterval` implementation schedules the next tick AFTER the callback completes, via `handler.postDelayed()`. Meanwhile, job pump batches are queued via `handler.post()` and run between ticks, adding latency.

Current flow:
1. Timer fires, runs tick callback (22ms)
2. `jsThread.scheduleJobPump(ctx)` posts job pump to Handler queue
3. `handler.postDelayed(this, 100ms)` schedules next tick
4. Job pump runs (2.5ms × ~3 batches = 7.5ms)
5. Next tick fires 100ms after step 3, but waits behind queued messages

### 3. Piece Completion Rate

**Observation**: Only 6-7 pieces complete per tick, matching block reception rate.

**Math**:
- ~400 blocks received per tick × 16KB = 6.4MB per tick
- 1MB pieces need 64 blocks each
- 6.4MB / 1MB = ~6.4 pieces per tick

This is **correct behavior** - batch size is limited by piece completion rate, not queue capacity.

### 4. Job Pump Timing

**Observed**:
- Startup: 71 batches, avg 5.5ms, **max 174ms** (initialization spike)
- Steady-state: 97 batches, avg 2.4ms, max 7-9ms

The 174ms spike is one-time startup cost, not recurring.

## Proposed Optimizations

### Option 1: Synchronous Job Pump (Recommended)

Change timer callbacks to pump jobs synchronously instead of via Handler queue:

```kotlin
// Current (async - causes queue delay):
ctx.callGlobalFunction("__jstorrent_timer_dispatch", callbackId.toString())
jsThread.scheduleJobPump(ctx)  // Posts to Handler queue

// Proposed (sync - no queue delay):
ctx.callGlobalFunction("__jstorrent_timer_dispatch", callbackId.toString())
ctx.executeAllPendingJobs()  // Immediate, same thread
```

**Expected improvement**: Eliminates ~25ms queue latency per tick.

**Files to modify**:
- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/PolyfillBindings.kt`
  - `setTimeout` callback (line 361-366)
  - `setInterval` callback (line 382-386)

**Risk**: The original comment said "avoid deadlock" but QuickJS is designed to have `executePendingJob()` called after any JS execution. Should be safe.

### Option 2: Reduce Scheduled Interval

If sync job pump isn't feasible, reduce interval to compensate:

```kotlin
// Instead of 100ms, use 75ms to achieve ~100ms actual
handler.postDelayed(this, 75)  // 75 + 22 execution + some queue = ~100ms
```

**Downside**: Doesn't fix the root cause, just compensates.

### Option 3: Adaptive Interval

Measure actual tick-to-tick time and adjust:

```kotlin
val actualInterval = now - lastTickTime
val adjustment = targetInterval - actualInterval
val nextDelay = max(10, intervalMs + adjustment)
handler.postDelayed(this, nextDelay)
```

## Instrumentation Added

Added `fullyRespondedCount` to backpressure log to track pieces awaiting write:

```
Backpressure: 30 active (1 partial, 21 awaiting write), 30.00MB buffered,
500 outstanding requests, disk queue: 0 pending/21 running, disk write: 39.7MB/s
```

This shows:
- `partial`: Pieces still downloading blocks
- `awaiting write`: Pieces complete, waiting for disk write callback

## Theoretical Maximum Throughput

With optimizations:
- Target tick interval: 100ms (10 ticks/sec)
- If we could complete 10 pieces per tick: 10 × 1MB × 10 = 100 MB/s
- Current: 6-7 pieces × 1MB × 7 ticks/sec = ~45 MB/s

The bottleneck shifts to:
1. Network reception rate (how fast blocks arrive)
2. Tick execution time (P1 phase processing incoming data)

## Related Files

- `packages/engine/src/core/peer-connection.ts` - Byte counting fix
- `packages/engine/src/core/torrent-tick-loop.ts` - Tick timing, backpressure logging
- `packages/engine/src/adapters/native/native-batching-disk-queue.ts` - Batch write stats
- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/PolyfillBindings.kt` - Timer implementation
- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/JsThread.kt` - Job pump scheduling

---

## Single-Peer Throughput Analysis (2025-01-28)

### Test Setup

- Device: Pixel 7a (physical device)
- Torrent: 1GB test file with 1MB pieces
- Seeder: LAN machine capable of 100+ MB/s
- Result: **45 MB/s achieved** (expected 100+ MB/s)

### Key Metrics from Logs

```
EngineController: Tick: 880 ticks, avg 3.3ms (js=2.9ms pump=0.4ms), max 37ms, work=100%
  | 1 peers, 11 active | BLOCKS:recv=15.5/sent=15.5, PIPE:100% of 500, hash=3, buf=14KB

Tick-loop: Tick: 882 ticks, avg 1.7ms (P1:0.8/P3:0.3/P4:0.2), max 21ms,
  10 active, 1 peers | BUF:254KB, BLOCKS:recv=15.4/sent=15.4, PIPE:100% of 500

Backpressure: 10 active (1 partial, 1 awaiting write), 10.00MB buffered,
  500 outstanding requests, disk queue: 0 pending/0 running, disk write: 43.3MB/s

BatchWrite: Stats: 220 batches, 220 writes, 220.00MB total,
  avg 1.0 writes/batch, avg pack 0.3ms, avg FFI 2.2ms
```

### Effective RTT Analysis

**The download speed is network-limited, not disk-limited.**

Calculating effective round-trip time from pipeline metrics:

```
Pipeline: 500 requests × 16KB/block = 8 MB in flight
Block rate: 15.5 blocks/tick × 180 ticks/sec = 2,790 blocks/sec = 44.6 MB/s
Effective RTT = Pipeline Size / Throughput = 8 MB / 45 MB/s = 178ms
```

**178ms RTT on LAN is extremely high** - actual network RTT should be <5ms.

The ~170ms of latency comes from the tick-based request/response architecture:

1. **Request batching delay**: Requests queue until end of tick (~5-20ms)
2. **Response batching delay**: TCP data queued by I/O thread, delivered at next tick (~5-20ms)
3. **Seeder processing**: Time to read from disk and send (~unknown)
4. **Multiple round-trips**: With 180 ticks/sec, each tick adds latency to in-flight requests

### Why Batching Shows "1 Write Per Batch"

This is **expected behavior**, not a bug:

```
Download rate: 45 MB/s with 1 MB pieces = 45 pieces/sec
Tick rate: ~180 ticks/sec
Pieces per tick: 45/180 = 0.25 pieces/tick on average
```

Most ticks complete 0-1 pieces. The batching infrastructure works correctly - there simply aren't multiple pieces completing in the same tick at this throughput level.

### Partial Cap Limitation

With only 1 peer connected, the partial piece cap is very restrictive:

```typescript
// From active-piece-manager.ts
maxPartials = Math.min(
  Math.floor(connectedPeerCount * 1.5),  // 1 peer → 1
  Math.floor(2048 / blocksPerPiece)       // 64 blocks/piece → 32
) = 1
```

Logs confirmed: `1 partial, 1 awaiting write` - only 1 piece can actively receive blocks at a time.

The other 8-9 "active" pieces are in `fullyRequested` state (all 64 blocks requested, waiting for responses). This is correct behavior per libtorrent's algorithm.

### Buffered Data Analysis

```
Active pieces: 10 (well under 10,000 limit)
Buffered bytes: 10 MB (well under 128 MB limit)
```

**Backpressure is NOT limiting throughput.** The 128 MB buffer limit is nowhere near being hit.

### Bandwidth-Delay Product Analysis

To achieve 100 MB/s with current effective RTT:

```
Required BDP = 100 MB/s × 178ms = 17.8 MB in flight
Current pipeline = 500 × 16KB = 8 MB
Shortfall = 17.8 - 8 = 9.8 MB
```

To fill the pipe, we'd need either:
- **Increase pipeline depth** to ~1100+ requests, OR
- **Reduce effective RTT** by processing data more frequently

### Bottleneck Hierarchy

1. **Effective RTT (~178ms)** - Primary bottleneck
   - Tick-based batching adds latency to every request/response cycle
   - Single TCP connection can't parallelize

2. **Pipeline depth (500 requests = 8 MB)** - Secondary bottleneck
   - Insufficient for high-bandwidth, high-latency scenarios

3. **Partial cap (1 with single peer)** - Not a bottleneck
   - Pieces cycle through partial→fullyRequested→fullyResponded quickly

4. **Disk I/O (~43 MB/s)** - NOT a bottleneck
   - Disk write rate matches download rate
   - Buffer utilization is low (10 MB / 128 MB)

### Recommendations

#### Quick Wins

1. **Increase MAX_PIPELINE_DEPTH** from 500 to 1000-1500
   - File: `packages/engine/src/core/peer-connection.ts:143`
   - Doubles in-flight data to ~16-24 MB

2. **Reduce MIN_TICK_INTERVAL_MS** from 5ms to 1-2ms
   - File: `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/EngineController.kt:112`
   - Reduces tick batching latency

#### Architectural Improvements

3. **Decouple data pump from tick loop**
   - Process TCP data immediately when it arrives
   - Only use ticks for request scheduling and maintenance

4. **Allow multiple connections to same peer** (if seeder supports)
   - Parallelizes TCP flows to better utilize bandwidth

5. **Investigate seeder-side delays**
   - The seeder software may have upload throttling enabled
   - Disk read latency on seeder could contribute to RTT

### Test Validation

To validate this analysis, try:

1. **Increase pipeline depth** to 1000 and measure throughput
2. **Use multiple seeders** to see if throughput scales linearly
3. **Profile seeder** to measure its request processing latency
4. **Test with faster tick rate** (1-2ms minimum interval)
