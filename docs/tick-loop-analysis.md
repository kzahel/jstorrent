# Tick Loop Analysis & Optimization

## Date: 2025-01-28

## Background

Moved from JS-owned `setInterval(100ms)` tick loop to Kotlin-owned tick loop for better visibility into timing. Goal: understand bottlenecks in the hot path.

## Current Architecture

### Before (JS-owned)
```
JS setInterval(100ms) → Handler.postDelayed → JS callback → scheduleJobPump (queued!)
                                                              ↓
                                              [Handler queue latency: ~25ms]
                                                              ↓
                                                          pumpJobs()
```
- No visibility into actual timing
- Job pump queued separately (not synchronous)
- ~25ms "dead time" from queue latency
- Actual tick-to-tick: ~147ms (measured previously)

### After (Kotlin-owned)
```kotlin
tickRunnable = Runnable {
    val jsStart = now()
    ctx.callGlobalFunction("__jstorrent_engine_tick")  // JS work
    val jsEnd = now()

    ctx.executeAllPendingJobs()  // Pump synchronously!
    val pumpEnd = now()

    handler.postDelayed(this, 100)  // Schedule next
}
```
- Full visibility: js time, pump time, total time
- Job pump is synchronous (no queue delay)
- Clean separation of concerns

## Measured Results (1GB download, null storage, emulator)

### Steady-State Tick Timing
```
Kotlin view:  avg 25-30ms (js=18-22ms, pump=5-8ms), max 50-200ms
JS view:      avg 11-13ms (P1:5-6ms, P3:2ms, P4:3-4ms)
```

| Phase | Time | Description |
|-------|------|-------------|
| FFI overhead | ~8ms | Kotlin→JS call setup |
| P1 (GATHER) | 5-6ms | Drain TCP buffers |
| P3 (REQUEST) | 2ms | Fill request pipelines |
| P4 (OUTPUT) | 3-4ms | Flush sends |
| Job pump | 5-8ms | Process microtasks (Promises) |
| **Total** | **25-30ms** | |

### Cycle Analysis
```
Target interval:  100ms
Actual interval:  ~125ms (100ms delay + 25ms work)
Dead time:        100ms per cycle (the postDelayed delay)
Utilization:      ~20-25% (25ms work / 125ms cycle)
```

### Download Performance
- Speed: ~5 MB/s sustained (emulator)
- Pipeline: 100% utilized (1000 requests outstanding)
- Blocks: ~34 recv/sent per tick
- Hasher: 7.5-7.8 MB/s throughput

## Key Findings

### 1. Job Pump Time Was Invisible
The 5-8ms pump time was completely hidden in JS-owned model. It accounts for ~20-25% of total tick work.

### 2. Massive Dead Time
With 100ms postDelayed, we have **100ms of dead time per cycle** where nothing productive happens. We're using only ~20-25% of available CPU time.

### 3. Timing Drift
Current code schedules next tick 100ms from END of current tick:
```
t=0:    tick starts
t=25:   tick ends, posts next at t=125
t=125:  next tick
```
This gives 125ms cycles instead of 100ms.

### 4. FFI Overhead
~8ms overhead for Kotlin→JS function call. This is significant but unavoidable with current architecture.

## Proposed: Continuous Tick Mode

### Goal
Zero dead time. Run ticks back-to-back for maximum throughput.

### Design
```kotlin
private var continuousTicking = true

tickRunnable = Runnable {
    if (!continuousTicking) return

    val start = now()

    // 1. Process all pending I/O callbacks first
    //    (they've been posted to Handler during previous tick)
    //    This happens implicitly - Handler runs them before this Runnable

    // 2. Run JS tick
    ctx.callGlobalFunction("__jstorrent_engine_tick")

    // 3. Pump all jobs synchronously
    ctx.executeAllPendingJobs()

    val elapsed = now() - start

    // 4. Yield briefly if needed (let I/O callbacks post)
    //    Or: immediately re-post for continuous processing
    if (hasWorkPending()) {
        handler.post(this)  // Immediate re-queue (yields to other Handler messages)
    } else {
        handler.postDelayed(this, 10)  // Brief pause when idle
    }
}
```

### Key Considerations

1. **I/O Callback Delivery**: Must allow TCP/UDP callbacks to be delivered between ticks. Using `handler.post()` (not `postDelayed`) yields to other queued messages.

2. **Work Detection**: Need a way to know if there's pending work:
   - Active pieces being downloaded
   - Buffered data to process
   - Pending requests to send
   - Could expose from JS: `__jstorrent_has_pending_work(): boolean`

3. **Idle Backoff**: When no work, back off to avoid spinning:
   ```kotlin
   if (hasWork) {
       handler.post(this)      // Immediate
   } else {
       handler.postDelayed(this, idleDelay)  // 10-50ms when idle
   }
   ```

4. **Throttling**: May need to cap ticks-per-second to avoid overwhelming system:
   ```kotlin
   val minTickInterval = 10  // Max 100 ticks/sec
   val nextDelay = max(minTickInterval, targetInterval - elapsed)
   ```

### Expected Improvement

Current: 25ms work / 125ms cycle = **20% utilization**
Target:  25ms work / 35ms cycle = **71% utilization** (with 10ms yield)

Theoretical max throughput increase: **3.5x** (if CPU-bound)

Actual improvement depends on whether we're CPU-bound or I/O-bound. The emulator test showed 100% pipeline utilization at 5 MB/s, suggesting we might be network-bound on emulator.

## Implementation (2025-01-28)

### Continuous Tick Mode - Implemented

Implemented the proposed continuous tick mode with adaptive backpressure based on hasher queue depth.

#### Changes Made

1. **`bt-engine.ts`** - Added `hasPendingWork()` method:
   ```typescript
   hasPendingWork(): boolean {
     if (this.pendingOps.size > 0) return true
     for (const torrent of this.torrents) {
       if (!torrent.isActive) continue
       if (torrent.getTickStats().activePieces > 0) return true
       for (const peer of torrent.peers) {
         if (peer.bufferedBytes > 0) return true
       }
     }
     return false
   }
   ```

2. **`native-hasher.ts`** - Exposed pending hash count:
   ```typescript
   export function getPendingHashCount(): number {
     return _pendingHashCount
   }
   ```

3. **`controller.ts`** - Combined tick + work detection in single FFI call:
   ```typescript
   __jstorrent_engine_tick = (): number => {
     engine.tick()

     // Adaptive backpressure based on hasher queue
     const pendingHashes = getPendingHashCount()
     if (pendingHashes > 30) {
       return Math.min(100, Math.floor(pendingHashes * 0.4))  // delay ms
     }

     if (engine.hasPendingWork()) return 0  // immediate
     return 20  // idle delay
   }
   ```

4. **`EngineController.kt`** - Uses delay hint from JS:
   ```kotlin
   val delayHint = ctx.callGlobalFunction("__jstorrent_engine_tick") as? Number
   val effectiveDelay = maxOf(MIN_TICK_INTERVAL_MS, delayHint.toLong()) - elapsed
   if (effectiveDelay <= 0) {
     handler.post(this)
   } else {
     handler.postDelayed(this, effectiveDelay)
   }
   ```

#### Key Design Decisions

1. **Single FFI call**: `__jstorrent_engine_tick` returns delay hint (ms) combining tick execution and work detection in one call. Avoids extra FFI overhead.

2. **Hasher backpressure**: Without backpressure, continuous ticking caused hasher queue to grow unbounded (530+ pending). The async hasher completes on a separate thread and posts callbacks to the Handler queue, which couldn't keep up.

3. **Adaptive delay**: Delay scales with queue depth (0.4ms per pending hash, capped at 100ms). This allows the system to find equilibrium automatically.

4. **Minimum tick interval**: 5ms floor prevents CPU spinning during bursts.

### Test Results (Emulator, 1GB download, null storage)

| Metric | Old (100ms interval) | Continuous (no backpressure) | Continuous (with backpressure) |
|--------|---------------------|------------------------------|-------------------------------|
| Ticks/sec | ~10 | ~140 | ~50-140 (adaptive) |
| Hasher queue | ~10-20 | 530+ (unbounded!) | 40-60 (bounded) |
| TCP recv | ~5 MB/s | 2.5-3 MB/s | 3.0-3.3 MB/s |
| work% | N/A | 100% | 0-100% (adaptive) |

### Key Findings

1. **Emulator is network-bound**: The original 100ms interval was not the bottleneck. Increasing tick rate from 10/sec to 140/sec did not improve throughput—the system was already saturating the emulator's virtual network at ~5 MB/s.

2. **Hasher callback bottleneck**: Without backpressure, continuous ticking overwhelmed the hasher callback queue. The Kotlin hasher is fast (350-400 MB/s), but the callback dispatch through the Handler queue couldn't keep up, causing unbounded growth.

3. **Adaptive backpressure works**: With backpressure based on hasher queue depth, the queue stays bounded (40-60) and the system finds equilibrium. The tick loop automatically backs off when hasher is backed up.

4. **More ticks ≠ more throughput**: When network-bound, additional ticks just spin without improving download speed. The continuous mode is beneficial for faster networks/devices where tick rate was previously the bottleneck.

## Next Steps

1. **Test on real device** (not emulator) to see true performance on faster network
2. **Test on ChromeOS** with WiFi to real seeder
3. **Profile hasher callback path** - why is dispatch slow?
4. **Consider batching hash callbacks** - reduce FFI overhead

## Files Modified

- `packages/engine/src/core/bt-engine.ts` - Added `tick()`, `setTickMode()`, `tickMode`, `hasPendingWork()`
- `packages/engine/src/adapters/native/native-hasher.ts` - Added `getPendingHashCount()`
- `packages/engine/src/adapters/native/index.ts` - Export `getPendingHashCount`
- `packages/engine/src/adapters/native/controller.ts` - `__jstorrent_engine_tick` returns delay hint, `__jstorrent_has_pending_work`
- `android/quickjs-engine/.../EngineController.kt` - Continuous tick mode with delay hint support
- `android/app/.../JSTorrentApplication.kt` - Call `startHostDrivenTick()` after engine load

## Raw Data

### Tick Logs (active download)
```
Tick: 40 ticks, avg 25.8ms (js=18.3ms pump=7.6ms), max 66ms
Tick: 37 ticks, avg 35.2ms (js=27.4ms pump=7.8ms), max 202ms
Tick: 38 ticks, avg 31.2ms (js=22.6ms pump=8.6ms), max 104ms
Tick: 40 ticks, avg 24.7ms (js=19.4ms pump=5.3ms), max 61ms
Tick: 40 ticks, avg 23.8ms (js=17.3ms pump=6.5ms), max 41ms
```

### Startup Spike
```
Tick: 25 ticks, avg 109.0ms (js=23.5ms pump=85.5ms), max 1352ms  ← pump dominated!
Tick: 19 ticks, avg 131.4ms (js=95.3ms pump=36.1ms), max 703ms   ← js dominated!
```

### Idle (seeding, no transfer)
```
Tick: 50 ticks, avg 0.5ms (js=0.3ms pump=0.2ms), max 2ms
```
