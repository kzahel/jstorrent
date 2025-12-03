# Android IO-Daemon Performance

This document covers performance tuning and benchmarking for the android-io-daemon.

## Benchmark Results (JVM Baseline)

These results establish the **theoretical maximum throughput** using a standalone JVM
server that implements the same protocol. The Android daemon should aim for 50-70%
of these numbers due to additional overhead (Android framework, Ktor, coroutines).

### Summary

| Test | Throughput | Frames | Avg Frame Size |
|------|------------|--------|----------------|
| 10 MB, 16KB chunks | 382 MB/s | 161 | 65 KB |
| 100 MB, 16KB chunks | 1110 MB/s | 1606 | 65 KB |
| 100 MB, 64KB chunks | 1082 MB/s | 1605 | 65 KB |

### Buffer Size Impact

Testing 50 MB transfers with different TCP read buffer sizes:

| Buffer Size | Throughput | Frames | Notes |
|-------------|------------|--------|-------|
| 16 KB | 702 MB/s | 3201 | Baseline (current Android default) |
| 32 KB | 1212 MB/s | 1601 | +73% improvement |
| 64 KB | 1455 MB/s | 801 | +107% improvement |
| **128 KB** | **1684 MB/s** | **411** | **Best: +140% improvement** |
| 256 KB | 1530 MB/s | 412 | Diminishing returns |

**Recommendation**: Increase Android daemon's TCP read buffer from 64 KB to 128 KB.

### Key Findings

1. **Larger buffers = fewer frames = better throughput**
   - Each frame has overhead (8-byte header + WebSocket framing)
   - Reducing frame count from 3201 to 411 more than doubles throughput

2. **Frame size distribution is excellent**
   - 99%+ of frames are 64KB+ (maximum efficient size)
   - Very few small frames (good TCP read coalescing)

3. **Seeder chunk size doesn't matter much**
   - 16 KB vs 64 KB seeder chunks: similar throughput
   - TCP/OS buffers coalesce small writes into larger reads

4. **128 KB is the sweet spot**
   - Beyond 128 KB, cache effects may cause slight regression
   - 128 KB fits well in L2 cache on most CPUs

## Throughput Benchmark

The `ThroughputBenchmarkTest` measures download path throughput:

```
Mock Seeder (TCP) → Daemon (TCP read) → WebSocket TCP_RECV frames → Test Client
```

### Running Standalone Benchmarks (Recommended)

These tests run entirely in JVM with no external dependencies:

```bash
cd android-io-daemon

# Quick 10 MB test
./gradlew :app:testDebugUnitTest --tests "*.ThroughputBenchmarkTest.standalone_10MB"

# Full 100 MB benchmark
./gradlew :app:testDebugUnitTest --tests "*.ThroughputBenchmarkTest.standalone_100MB"

# Compare buffer sizes
./gradlew :app:testDebugUnitTest --tests "*.ThroughputBenchmarkTest.standalone_VaryBufferSizes"
```

Results are written to `app/build/test-results/testDebugUnitTest/*.xml`

### Running Against Android Daemon

Tests prefixed with `benchmark` (not `standalone`) require the Android daemon running:

1. Start the Android app on a device/emulator
2. Note the auth token from the app UI
3. Update `AUTH_TOKEN` in `ThroughputBenchmarkTest.kt`
4. Remove the `@Ignore` annotation from the test
5. Run:
   ```bash
   ./gradlew :app:testDebugUnitTest --tests "*.ThroughputBenchmarkTest.benchmarkTcpRecvThroughput"
   ```

## Performance Instrumentation

The daemon includes built-in timing instrumentation in `TcpSocketHandler`.

### Enabling Detailed Logging

Edit `SocketHandler.kt`:
```kotlin
companion object {
    private const val ENABLE_PERF_LOGGING = true  // Enable detailed timing
    private const val LOG_INTERVAL = 100          // Log every N reads
}
```

### Viewing Logs

```bash
adb logcat -s JSTorrent.Perf:V SocketHandler:V
```

Sample output:
```
JSTorrent.Perf: socket=1 read=45µs pack=12µs send=890µs bytes=16384 total=1024KB
JSTorrent.Perf: socket=1 read=38µs pack=11µs send=1203µs bytes=16384 total=2048KB
```

This shows:
- `read` - Time spent in `InputStream.read()`
- `pack` - Time to build the TCP_RECV frame
- `send` - Time to enqueue to WebSocket

### Summary Stats

At socket close, the daemon logs aggregate stats:
```
SocketHandler: TCP socket 1 finished: 100MB in 2340ms (42.74 MB/s, 6400 reads)
```

## Current Android Daemon Configuration

| Component | Current | Recommended | Location |
|-----------|---------|-------------|----------|
| TCP Read Buffer | 64 KB | **128 KB** | `TcpSocketHandler.startReading()` |
| Outgoing Channel | 1000 frames | 1000 frames | `SocketSession.outgoing` |
| Socket Receive Buffer | OS default | 256 KB | `socket.receiveBufferSize` |

## Optimization Roadmap

### High Impact (Implement First)

1. **Increase TCP Read Buffer to 128 KB**
   ```kotlin
   val buffer = ByteArray(128 * 1024)
   ```
   Expected improvement: 40-100% based on JVM benchmarks.

2. **Set Socket Receive Buffer**
   ```kotlin
   socket.receiveBufferSize = 256 * 1024
   ```

### Medium Impact

3. **Buffer Pool (Avoid Allocation)**
   ```kotlin
   object BufferPool {
       private val pool = ConcurrentLinkedQueue<ByteArray>()
       private const val BUFFER_SIZE = 128 * 1024
       private const val MAX_POOLED = 16

       fun acquire(): ByteArray = pool.poll() ?: ByteArray(BUFFER_SIZE)

       fun release(buf: ByteArray) {
           if (pool.size < MAX_POOLED && buf.size == BUFFER_SIZE) {
               pool.offer(buf)
           }
       }
   }
   ```

4. **Pre-allocate Frame Headers**
   - Reuse ByteBuffer for envelope creation
   - Avoid `+` operator for byte array concatenation

### Lower Impact (Investigate Later)

5. **Direct ByteBuffer with NIO**
   ```kotlin
   val directBuffer = ByteBuffer.allocateDirect(128 * 1024)
   // Use SocketChannel instead of InputStream
   ```

6. **Batch Small Reads**
   - Coalesce multiple small TCP reads before sending
   - May add latency; only useful if seeing many small frames

## Performance Targets

| Metric | JVM Baseline | Android Target | Notes |
|--------|--------------|----------------|-------|
| Throughput (loopback) | 1100+ MB/s | 100-200 MB/s | Android overhead expected |
| Throughput (WiFi) | N/A | 20-50 MB/s | Network-limited |
| Latency per frame | <1ms | <5ms | Includes coroutine scheduling |
| Frame size | 65 KB avg | 65 KB avg | Match JVM behavior |

## Architecture Notes

The JVM baseline server (`TestDaemonServer.kt`) uses:
- Java-WebSocket library (same as test client)
- Plain Java sockets + threads
- No coroutines, no Ktor

The Android daemon uses:
- Ktor + Netty for WebSocket
- Kotlin coroutines for concurrency
- Channel for outgoing message queue

The difference in throughput between JVM baseline and Android daemon represents
the overhead of the Android stack. Optimizations should focus on reducing
allocations and frame count rather than changing the architecture.
