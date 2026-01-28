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
