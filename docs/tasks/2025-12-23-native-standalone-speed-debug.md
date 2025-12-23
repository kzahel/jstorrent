# Native Standalone Download Speed Debug

## Problem

Native standalone mode (QuickJS) downloads are slow - ~1.5 MB/s observed.
Companion mode achieves ~20 MB/s on same hardware.

## Goal

Identify the bottleneck and improve throughput to match companion mode performance.

## Context

The native standalone architecture:
```
Internet Peers
     │
     ▼
TcpSocketService (Kotlin, io-core)
  - 128KB read buffer
  - Coroutine per socket
     │
     ▼
TcpBindings.onTcpData callback
  - Posts to JsThread handler
     │
     ▼
QuickJS engine (single-threaded)
  - Processes piece data
  - Writes to disk (SYNCHRONOUS - blocks JS thread)
     │
     ▼
FileBindings.write
  - Blocks until disk write complete
```

**Key difference from companion mode:** Companion mode uses WebSocket binary frames with async I/O. Native mode has per-callback JNI overhead and synchronous file writes.

## Likely Bottlenecks (in order)

1. **Network/peers** - If downloading from internet (not local seeder), 1.5 MB/s may be normal
2. **Synchronous file writes** - FileBindings blocks JS thread during disk I/O; no TCP callbacks processed during writes
3. **JNI callback overhead** - Each chunk: Kotlin → Handler.post → JS → executeAllPendingJobs
4. **JS processing time** - Piece verification, buffer management

## Phase 1: Add Throughput Instrumentation

First, measure where data is flowing to identify the bottleneck.

### 1.1 Add TCP throughput logging

**File:** `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/TcpBindings.kt`

Find:
```kotlin
    private fun setupNativeCallbacks(ctx: QuickJsContext) {
        tcpManager.setCallback(object : TcpSocketCallback {
            override fun onTcpConnected(socketId: Int, success: Boolean, errorCode: Int) {
```

Replace with:
```kotlin
    private fun setupNativeCallbacks(ctx: QuickJsContext) {
        // Throughput tracking
        var bytesReceived = 0L
        var lastLogTime = System.currentTimeMillis()
        
        tcpManager.setCallback(object : TcpSocketCallback {
            override fun onTcpConnected(socketId: Int, success: Boolean, errorCode: Int) {
```

Find:
```kotlin
            override fun onTcpData(socketId: Int, data: ByteArray) {
                if (!hasDataCallback) return

                jsThread.post {
```

Replace with:
```kotlin
            override fun onTcpData(socketId: Int, data: ByteArray) {
                if (!hasDataCallback) return
                
                // Track throughput before posting to JS
                bytesReceived += data.size
                val now = System.currentTimeMillis()
                if (now - lastLogTime >= 5000) {
                    val elapsed = (now - lastLogTime) / 1000.0
                    val mbps = (bytesReceived / elapsed) / (1024 * 1024)
                    android.util.Log.i("TcpBindings", "TCP recv throughput: %.2f MB/s (raw from network)".format(mbps))
                    bytesReceived = 0
                    lastLogTime = now
                }

                jsThread.post {
```

### 1.2 Add file write timing

**File:** `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/FileBindings.kt`

Add a companion object at the top of the class:

```kotlin
class FileBindings(
    private val fileManager: FileHandleManager
) {
    companion object {
        private var totalWriteTime = 0L
        private var totalBytesWritten = 0L
        private var lastLogTime = System.currentTimeMillis()
    }
```

Find the write function registration:
```kotlin
        // __jstorrent_file_write(handleId: number, data: ArrayBuffer, position: number): number
        ctx.setGlobalFunctionWithBinary("__jstorrent_file_write", 1) { args, binary ->
            val handleId = args.getOrNull(0)?.toIntOrNull()
            val position = args.getOrNull(2)?.toLongOrNull() ?: 0L

            if (handleId == null || binary == null) {
                "-1"
            } else {
                fileManager.write(handleId, binary, position).toString()
            }
        }
```

Replace with:
```kotlin
        // __jstorrent_file_write(handleId: number, data: ArrayBuffer, position: number): number
        ctx.setGlobalFunctionWithBinary("__jstorrent_file_write", 1) { args, binary ->
            val handleId = args.getOrNull(0)?.toIntOrNull()
            val position = args.getOrNull(2)?.toLongOrNull() ?: 0L

            if (handleId == null || binary == null) {
                "-1"
            } else {
                val startTime = System.nanoTime()
                val result = fileManager.write(handleId, binary, position)
                val elapsed = System.nanoTime() - startTime
                
                totalWriteTime += elapsed
                totalBytesWritten += binary.size
                
                val now = System.currentTimeMillis()
                if (now - lastLogTime >= 5000) {
                    val writeTimeMs = totalWriteTime / 1_000_000.0
                    val writeMbps = if (writeTimeMs > 0) (totalBytesWritten / writeTimeMs) / 1024.0 else 0.0
                    android.util.Log.i("FileBindings", "Disk write: %.0f ms for %.1f MB = %.1f MB/s".format(
                        writeTimeMs, totalBytesWritten / (1024.0 * 1024.0), writeMbps))
                    totalWriteTime = 0
                    totalBytesWritten = 0
                    lastLogTime = now
                }
                
                result.toString()
            }
        }
```

### 1.3 Add JS callback queue depth logging

**File:** `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/TcpBindings.kt`

Add queue depth tracking. Find the class declaration and add:

```kotlin
class TcpBindings(
    private val tcpManager: TcpSocketManager,
    private val jsThread: JsThread
) {
    companion object {
        private var pendingCallbacks = java.util.concurrent.atomic.AtomicInteger(0)
    }
```

Then wrap the jsThread.post in onTcpData:

Find:
```kotlin
                jsThread.post {
                    // Call the JS dispatcher with binary data
                    ctx.callGlobalFunctionWithBinary(
                        "__jstorrent_tcp_dispatch_data",
                        data,
                        1,
                        socketId.toString()
                    )
                    ctx.executeAllPendingJobs()
                }
```

Replace with:
```kotlin
                val queueDepth = pendingCallbacks.incrementAndGet()
                if (queueDepth > 10) {
                    android.util.Log.w("TcpBindings", "JS callback queue depth: $queueDepth (backpressure)")
                }
                
                jsThread.post {
                    pendingCallbacks.decrementAndGet()
                    // Call the JS dispatcher with binary data
                    ctx.callGlobalFunctionWithBinary(
                        "__jstorrent_tcp_dispatch_data",
                        data,
                        1,
                        socketId.toString()
                    )
                    ctx.executeAllPendingJobs()
                }
```

## Phase 2: Analyze Results

After rebuilding and running a download, check logcat:

```bash
adb logcat | grep -E "(TcpBindings|FileBindings)"
```

**Interpreting results:**

| TCP recv | Disk write | Queue depth | Diagnosis |
|----------|------------|-------------|-----------|
| ~1.5 MB/s | any | low | Network-limited (peers are slow) |
| >5 MB/s | <2 MB/s | high | Disk is bottleneck |
| >5 MB/s | >5 MB/s | high | JS processing is bottleneck |
| >5 MB/s | >5 MB/s | low | Something else - check JS side |

## Phase 3: Potential Fixes

Based on diagnosis, implement the appropriate fix:

### 3a: If disk is bottleneck → Async file writes

This is the most likely issue. Currently file writes block the JS thread.

**Strategy:** Queue writes to a dedicated I/O thread, notify JS on completion.

This requires significant refactoring:
1. FileBindings.write returns immediately with a "pending" status
2. Actual write happens on IO thread
3. Completion callback posts to JS thread
4. JS file handle tracks pending writes

### 3b: If JS processing is bottleneck → Batch callbacks

Coalesce multiple TCP receives before posting to JS.

**File:** `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/TcpBindings.kt`

Add batching logic in onTcpData - accumulate data in a buffer, post to JS only when buffer reaches threshold or after timeout.

### 3c: If JNI overhead is bottleneck → Reduce callback frequency

Increase read buffer size and only callback on larger chunks.

**File:** `android/io-core/src/main/java/com/jstorrent/io/socket/TcpConnection.kt`

Change `READ_BUFFER_SIZE` from 128KB to 256KB or 512KB.

### 3d: If network-limited → Nothing to do

1.5 MB/s from internet peers is normal. Test with local seeder to verify native path is fast.

## Verification

After any fix, verify:

1. **Throughput improved:** Check logcat for higher MB/s
2. **No data corruption:** Downloaded files verify correctly
3. **Session persistence still works:** Kill app, reopen, torrents resume
4. **UI remains responsive:** Progress updates, can add/remove torrents

## Files Reference

- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/TcpBindings.kt` - TCP callbacks
- `android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/bindings/FileBindings.kt` - File I/O
- `android/io-core/src/main/java/com/jstorrent/io/socket/TcpConnection.kt` - Low-level socket handling
- `android/io-core/src/main/java/com/jstorrent/io/socket/TcpSocketService.kt` - Socket lifecycle
- `packages/engine/src/adapters/native/native-tcp-socket.ts` - JS-side TCP wrapper
- `packages/engine/src/adapters/native/native-filesystem.ts` - JS-side file wrapper
