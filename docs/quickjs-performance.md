# QuickJS Native Standalone Performance Investigation

## Problem Statement

On Android native standalone mode (QuickJS), peer connections churn excessively during downloads. Peers that are actively sending data at good speeds (2+ MB/s) are being dropped as "too_slow" or "below_average", then reconnected, then dropped again. This creates a thrashing pattern that degrades download performance.

**Observed behavior:**
- Desktop extension achieves 30+ MB/s with stable peer connections
- Android native drops the same peers repeatedly within minutes
- Logcat shows mass "Dropping slow peer" events every 20-30 seconds
- GC logs show 10-33MB of Large Object Space being freed every 5 seconds

## Hypothesis

QuickJS cannot process incoming TCP data fast enough. Data arrives from I/O threads faster than the JS event loop can process it, causing:

1. Handler queue fills with unprocessed ByteArrays
2. Speed calculator only measures *processed* data (after JS handles it)
3. Peers appear "slow" even though they're sending fast
4. Download optimizer drops them as "too_slow"
5. Memory pressure triggers frequent GC (the 10-33MB LOS churn)

## Architecture Analysis

```
Internet Peers (fast)
     │
     ▼
TcpConnection.kt (I/O coroutine)
  - Reads up to 128KB per chunk
  - Creates new ByteArray: buffer.copyOf(bytesRead)
  - Calls onData(data) immediately
  - NO BACKPRESSURE - keeps reading as fast as data arrives
     │
     ▼
TcpBindings.kt (callback from I/O thread)
  - Posts to JsThread Handler queue
  - Queue is UNBOUNDED
     │
     ▼
JsThread Handler (single thread)
  - Processes callbacks FIFO
  - If backed up, data sits in queue
     │
     ▼
QuickJS Engine (single-threaded JS)
  - Processes piece data
  - Updates speed calculator (only NOW is data "received")
  - Disk writes block JS thread
```

**Key insight:** The speed calculator in `peer-connection.ts` only counts data that has been processed by JS. Data sitting in the Handler queue hasn't been "received" from the JS perspective, so the peer's download rate appears to be 0.

## Relevant Code Locations

- `android/io-core/src/main/java/com/jstorrent/io/socket/TcpConnection.kt:103-138` - Read loop with no backpressure
- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/TcpBindings.kt` - Posts to JS thread
- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/JsThread.kt` - Handler-based event loop
- `packages/engine/src/core/peer-coordinator/download-optimizer.ts` - Drops peers below thresholds
- `packages/engine/src/utils/speed-calculator.ts` - 5-second rolling window speed measurement

## Drop Thresholds (download-optimizer.ts)

```typescript
export const DEFAULT_DOWNLOAD_CONFIG = {
  chokedTimeoutMs: 60_000,      // Drop if choked for 1 minute
  minSpeedBytes: 1_000,         // Drop if < 1 KB/s (absolute)
  minConnectionAgeMs: 15_000,   // Grace period before speed checks
  dropBelowAverageRatio: 0.1,   // Drop if < 10% of average speed
  minPeersBeforeDropping: 4,    // Don't drop if fewer peers
}
```

## Reference Documents

- `docs/tasks/2025-12-23-native-standalone-speed-debug.md` - Original task doc with instrumentation plan
- `docs/tasks/2025-12-03-throughput-benchmark-task.md` - WebSocket throughput benchmark (different architecture)

## Instrumentation Added

### 1. TCP Queue Depth (`TcpBindings.kt`)

```kotlin
companion object {
    private val pendingCallbacks = AtomicInteger(0)
    @Volatile private var bytesReceived = 0L
    @Volatile private var lastLogTime = System.currentTimeMillis()
    @Volatile private var maxQueueDepth = 0
}
```

Logs every 5 seconds:
- `TCP recv: X.XX MB/s (raw), queue depth: N (max: M)` - network speed vs JS queue depth
- `JS callback queue depth: N (BACKPRESSURE)` - warning when queue > 50

### 2. Disk Write Latency (`FileBindings.kt`)

```kotlin
companion object {
    @Volatile private var bytesWritten = 0L
    @Volatile private var writeCount = 0
    @Volatile private var totalWriteTimeMs = 0L
    @Volatile private var maxWriteLatencyMs = 0L
    @Volatile private var lastLogTime = System.currentTimeMillis()
}
```

Logs every 5 seconds:
- `Disk write: X.XX MB/s, N writes, avg Xms, max Xms`

### 3. Piece Buffer Stats (`torrent.ts`)

Logs from `runMaintenance()` every 5 seconds:
- `Backpressure: N active pieces, X.XXMB buffered, N outstanding requests`

**To observe:** `adb logcat | grep -iE "(TcpBindings|FileBindings|Backpressure:)"`

## Expected Diagnosis

| TCP recv | Queue depth | Peer drops | Diagnosis |
|----------|-------------|------------|-----------|
| High (>5 MB/s) | High (>20) | Many "too_slow" | **Backpressure confirmed** - JS can't keep up |
| Low (<2 MB/s) | Low (<5) | Few | Network-limited, not a JS issue |
| High | Low | Many | Something else - check JS processing time |

## Potential Fixes

### If backpressure confirmed:

1. **Implement backpressure in TcpConnection** - Use bounded Channel, suspend reader when JS is behind
2. **Increase speed calculator window** - From 5s to 10-15s to smooth out processing delays
3. **Relax drop thresholds** - Increase `minConnectionAgeMs`, decrease `dropBelowAverageRatio`
4. **Async file writes** - Currently disk writes block JS thread (see original task doc)

### Quick mitigation (treats symptom):

- Disable slow-peer dropping when backpressure detected
- Skip speed checks when queue depth > threshold

## Testing Requirements

Before implementing fixes, need instrumented tests that verify:

1. **Throughput test** - Measure actual MB/s through QuickJS path with local seeder
2. **Peer stability test** - Multi-peer download without excessive churn
3. **Backpressure test** - Verify fix prevents queue buildup under load

### Quick Manual Testing

```bash
# Start 1GB seeder (in packages/engine/integration/python/)
pnpm seed-for-test --size 1gb

# Deploy and run instrumented app
source android/scripts/android-env.sh
emu test-native --size 1gb

# Watch instrumentation logs
adb logcat | grep -iE "(TcpBindings|FileBindings|Backpressure:)"
```

Existing tests:
- `android/app/src/androidTest/java/com/jstorrent/app/e2e/DownloadE2ETest.kt` - Full engine E2E, but doesn't measure throughput or track churn
- `android/app/src/test/java/com/jstorrent/app/benchmark/ThroughputBenchmarkTest.kt` - WebSocket daemon only, not QuickJS path

## Next Steps

1. Run instrumented build on device with real multi-peer torrent
2. Observe logs to confirm backpressure hypothesis
3. If confirmed, create throughput instrumented test for QuickJS path
4. Implement backpressure fix with test coverage
5. Verify peer stability improves

## Test Results (2025-01-25)

### Single-Peer 1GB Download (Emulator)

| Metric | Typical | Max | Notes |
|--------|---------|-----|-------|
| TCP raw recv | 14.5-15.5 MB/s | - | Consistent throughput |
| TCP queue depth | 0-33 | 105 | Spikes during bursts |
| Disk write speed | 14.5-15.5 MB/s | - | Matches network |
| Disk avg latency | 10-13ms | - | Acceptable |
| Disk max latency | 21-36ms | 186ms | Occasional spike |
| Active pieces | 2-5 | - | Low |
| Buffered bytes | 0.5-0.9 MB | - | Well under 128MB limit |
| Outstanding requests | 65-210 | - | Request pipeline depth |

**Key findings:**

1. **TCP ↔ Disk balanced**: Both ~15 MB/s - disk writes keep pace with network
2. **Queue depth spikes to 100+** but recovers quickly (oscillates 0→105→0)
3. **Piece buffer well managed**: <1MB buffered vs 128MB limit
4. **No peer drops observed**: Single-peer test doesn't trigger speed comparison logic

**Limitation:** This test used a single local peer. The multi-peer scenario where all peers appear "slow" due to queue backup hasn't been tested yet.

## Session Context (2025-01-25)

- Investigated peer churn reported on Pixel 9 downloading Ubuntu ISO
- Desktop showed 30 MB/s with 16 stable peers
- Android showed repeated mass drops of same peers
- GC logs showed heavy LOS churn (10-33MB every 5s)
- Added comprehensive instrumentation (TCP queue, disk latency, piece buffer)
- Deployed to emulator for testing with deterministic seeder
- Single-peer 1GB download showed balanced TCP/disk throughput
- Queue depth confirmed to spike during data bursts (max 105)
