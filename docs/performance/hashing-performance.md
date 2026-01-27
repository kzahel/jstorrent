# Hashing Performance Analysis

This document analyzes SHA1 hashing performance across the JS-to-Kotlin FFI boundary on Android.

## Background

Every downloaded piece must be SHA1 verified before being marked complete. On the native Android runtime (QuickJS), this requires crossing the FFI boundary to Kotlin where `java.security.MessageDigest` performs the actual hash computation.

## Current Data Flow

When `NativeHasher.sha1(data)` is called, the data takes this path:

```
JS Side (native-hasher.ts):
1. piece.assemble() → Uint8Array from blocks
2. data.buffer.slice() → COPY #1 (new ArrayBuffer to handle byteOffset)

JNI Side (quickjs-jni.c):
3. JS_GetArrayBuffer() → pointer to JS buffer
4. NewByteArray() + SetByteArrayRegion() → COPY #2 (JS heap → JNI heap)

Kotlin Side (PolyfillBindings.kt):
5. Hasher.sha1(data) → MessageDigest.digest() → hash computed

JNI Return:
6. GetByteArrayElements() → pointer to result
7. JS_NewArrayBufferCopy() → COPY #3 (Java heap → JS heap)

JS Side:
8. new Uint8Array(result) → wrap ArrayBuffer
```

Total: **3 memory copies** for each piece hashed.

## Measurement Methodology

### Instrumentation Added

**JS side** (`native-hasher.ts`):
- Tracks wall-clock time from before `slice()` to after receiving result
- Logs every 5 seconds: call count, total bytes, avg/max time, throughput

**Kotlin side** (`PolyfillBindings.kt`):
- Tracks time spent only in `MessageDigest.digest()`
- Uses `System.nanoTime()` for microsecond precision
- Logs every 5 seconds with same metrics

### Test Configuration

- Device: Pixel 7a
- Test: 1GB download with null storage (no disk writes)
- Piece size: 1MB (1,012 pieces total)
- Seeder: 10-peer LAN swarm at ~35 MB/s

## Results

### Steady-State Performance (from logs)

| Layer | Avg Time/Hash | Max Time | Throughput |
|-------|---------------|----------|------------|
| **Kotlin** (MessageDigest only) | 1.5-1.9ms | 3-5ms | 600-670 MB/s |
| **JS** (end-to-end) | 2.6-3.3ms | 6-10ms | 350-380 MB/s |

### Sample Log Output

```
JSTorrent-Hash: Kotlin: 175 hashes, 175.0MB, avg 1575µs, max 4901µs, throughput 635MB/s
JSTorrent-JS: [NativeHasher] 175 hashes, 175.0MB, avg 2.82ms, max 7ms, throughput 355.0MB/s
```

### Analysis

**FFI overhead per hash: ~1.1ms (40% of total time)**

Breakdown estimate:
- `data.buffer.slice()`: ~0.2ms (1MB memcpy in JS)
- JNI `SetByteArrayRegion()`: ~0.3ms (1MB copy JS→Java)
- JNI `JS_NewArrayBufferCopy()`: ~0.3ms (20 bytes, but allocation overhead)
- Function call overhead: ~0.3ms

**Key insight**: The raw hash throughput (600+ MB/s) is not the bottleneck. The FFI overhead reduces effective throughput to 350 MB/s, which is still 10× higher than our current download speed (~35 MB/s).

## Potential Optimizations

### 1. Remove Unnecessary `slice()` Copy (Easy Win)

**Current code:**
```typescript
const buffer = data.buffer.slice(
  data.byteOffset,
  data.byteOffset + data.byteLength,
) as ArrayBuffer
```

**Optimized:**
```typescript
// Only slice if the Uint8Array is a view into a larger buffer
const buffer = (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
  ? data.buffer
  : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
```

**Expected gain**: ~0.2ms per hash, ~10% improvement

### 2. Batch Multiple Hashes Per FFI Call (Medium Effort)

Instead of one FFI call per piece, batch N pieces:

```typescript
// New binding
__jstorrent_sha1_batch(buffers: ArrayBuffer[]): ArrayBuffer[]
```

**Expected gain**: Amortize FFI overhead across N pieces. With N=8, could reduce overhead from 1.1ms to ~0.15ms per hash.

### 3. Async Hashing with Callback (Higher Effort)

Make hashing non-blocking:

```typescript
// Current (blocking)
const hash = __jstorrent_sha1(buffer)

// Async version
__jstorrent_sha1_async(buffer, callbackId)
// Later: callback fires with result
```

**Benefits**:
- JS thread isn't blocked during hash computation
- Could hash multiple pieces in parallel on background threads
- Better utilization of multi-core CPUs

**Complexity**: Requires callback infrastructure similar to TCP/UDP bindings.

### 4. Direct ByteBuffer (JNI Optimization)

Use `NewDirectByteBuffer` to share memory without copying:

```c
// Instead of copying to jbyteArray
jobject directBuffer = (*env)->NewDirectByteBuffer(env, buf, len);
```

**Caveat**: QuickJS ArrayBuffer lifetime management makes this tricky.

### 5. Skip Verification for Trusted Sources

For null storage mode or trusted LAN peers, optionally skip verification:

```typescript
if (this.skipVerification) {
  this.markPieceVerified(index)
  return
}
```

**Use case**: Benchmarking only. Not recommended for production.

## Current Impact Assessment

With current download speeds of ~35 MB/s:
- Pieces/second: ~35 (at 1MB each)
- Hash time/second: 35 × 2.8ms = **98ms** (9.8% of JS thread time)

This is acceptable but becomes a concern as download speeds increase.

## Recommendations

1. **Short term**: Implement optimization #1 (remove unnecessary slice) - easy win
2. **Medium term**: If download speeds exceed 100 MB/s, implement batch hashing (#2)
3. **Long term**: For maximum throughput, implement async hashing (#3)

## Appendix: Instrumentation Code

### JS Side (native-hasher.ts)

```typescript
let _hashCallCount = 0
let _hashTotalBytes = 0
let _hashTotalTimeMs = 0
let _hashMaxTimeMs = 0
let _hashLastLogTime = 0

// In sha1():
const startTime = Date.now()
// ... do hash ...
const elapsed = Date.now() - startTime
_hashCallCount++
_hashTotalBytes += data.byteLength
_hashTotalTimeMs += elapsed
if (elapsed > _hashMaxTimeMs) _hashMaxTimeMs = elapsed

// Log every 5 seconds
if (now - _hashLastLogTime >= 5000 && _hashCallCount > 0) {
  console.log(`[NativeHasher] ${_hashCallCount} hashes, ...`)
  // reset counters
}
```

### Kotlin Side (PolyfillBindings.kt)

```kotlin
private var hashCallCount = 0L
private var hashTotalBytes = 0L
private var hashTotalTimeNs = 0L
private var hashMaxTimeNs = 0L
private var hashLastLogTime = 0L

// In __jstorrent_sha1:
val startNs = System.nanoTime()
val result = Hasher.sha1(data)
val elapsedNs = System.nanoTime() - startNs
// track and log similar to JS side
```

## Related Documents

- [piece-picker-overhaul.md](./piece-picker-overhaul.md) - Piece selection performance
