# Task: TCP Receive Throughput Benchmark for android-io-daemon

## Goal

Create a benchmark test that measures the **download path throughput** of the android-io-daemon:

```
Mock Seeder (TCP) → Daemon (TCP read) → WebSocket TCP_RECV frames → Test Client
```

This simulates a real BitTorrent download where a remote peer seeds data and the daemon bridges it to the browser. Current throughput is poor; this test will help identify bottlenecks.

## Context

### Architecture

The android-io-daemon is a Kotlin app that:
1. Accepts WebSocket connections on port 7800 at `/io`
2. Multiplexes TCP/UDP sockets over the WebSocket using a binary protocol
3. When the client requests TCP_CONNECT, the daemon connects to the remote peer
4. Data received from the peer is wrapped in TCP_RECV frames and sent over WebSocket

### Protocol Reference

See `design_docs/io-daemon-websocket-detail.md` for full spec. Key points:

**Frame envelope (8 bytes):**
```
byte 0   : version (u8)     = 1
byte 1   : msg_type (u8)    = opcode
byte 2-3 : flags (u16)      = 0
byte 4-7 : request_id (u32) = correlation ID
byte 8.. : payload
```

**Opcodes:**
```
CLIENT_HELLO  = 0x01
SERVER_HELLO  = 0x02
AUTH          = 0x03
AUTH_RESULT   = 0x04
TCP_CONNECT   = 0x10
TCP_CONNECTED = 0x11
TCP_SEND      = 0x12
TCP_RECV      = 0x13
TCP_CLOSE     = 0x14
```

**Payload formats:**

TCP_CONNECT: `[socketId:4][port:2][hostname...]`
TCP_CONNECTED: `[socketId:4][status:1]` (status 0 = success)
TCP_RECV: `[socketId:4][data...]`
TCP_CLOSE: `[socketId:4]`
AUTH: `[authType:1][token...]` (authType 1 = token)
AUTH_RESULT: `[status:1]` (status 0 = success)

All multi-byte integers are **little-endian**.

## Implementation

### Phase 1: Create Test Infrastructure

Create a new Kotlin test file at `app/src/test/java/com/jstorrent/ThroughputBenchmarkTest.kt`.

This is a **JVM unit test** (not Android instrumentation test) so it can run fast without a device.

#### 1.1 Mock Seeder Server

A simple TCP server that blasts data as fast as possible:

```kotlin
class MockSeeder(private val totalBytes: Long, private val chunkSize: Int = 16 * 1024) : Closeable {
    private val server = ServerSocket(0) // random port
    val port: Int get() = server.localPort
    
    private var clientThread: Thread? = null
    var bytesSent: Long = 0
        private set
    
    fun startAsync() {
        clientThread = thread(name = "MockSeeder") {
            try {
                val client = server.accept()
                val out = BufferedOutputStream(client.getOutputStream(), 64 * 1024)
                val chunk = ByteArray(chunkSize) { 0x42.toByte() }
                
                while (bytesSent < totalBytes) {
                    val toSend = minOf(chunkSize.toLong(), totalBytes - bytesSent).toInt()
                    out.write(chunk, 0, toSend)
                    bytesSent += toSend
                }
                out.flush()
                client.close()
            } catch (e: Exception) {
                // Connection closed
            }
        }
    }
    
    override fun close() {
        server.close()
        clientThread?.interrupt()
    }
}
```

#### 1.2 WebSocket Test Client

A minimal WebSocket client for the binary protocol:

```kotlin
class TestWsClient(uri: String) : Closeable {
    private val client: WebSocketClient // Use okhttp or java-websocket library
    private val receiveQueue = LinkedBlockingQueue<ByteArray>()
    
    fun connect() { /* connect and set up binary message handler */ }
    
    fun sendFrame(opcode: Int, requestId: Int, payload: ByteArray) {
        val frame = ByteBuffer.allocate(8 + payload.size).order(ByteOrder.LITTLE_ENDIAN)
        frame.put(1) // version
        frame.put(opcode.toByte())
        frame.putShort(0) // flags
        frame.putInt(requestId)
        frame.put(payload)
        client.send(frame.array())
    }
    
    fun receiveFrame(timeoutMs: Long = 5000): ReceivedFrame? {
        val data = receiveQueue.poll(timeoutMs, TimeUnit.MILLISECONDS) ?: return null
        val buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        return ReceivedFrame(
            version = buf.get().toInt(),
            opcode = buf.get().toInt() and 0xFF,
            flags = buf.short.toInt(),
            requestId = buf.int,
            payload = data.copyOfRange(8, data.size)
        )
    }
    
    override fun close() { client.close() }
}

data class ReceivedFrame(
    val version: Int,
    val opcode: Int,
    val flags: Int,
    val requestId: Int,
    val payload: ByteArray
)
```

#### 1.3 Protocol Helpers

```kotlin
object Protocol {
    const val CLIENT_HELLO = 0x01
    const val SERVER_HELLO = 0x02
    const val AUTH = 0x03
    const val AUTH_RESULT = 0x04
    const val TCP_CONNECT = 0x10
    const val TCP_CONNECTED = 0x11
    const val TCP_RECV = 0x13
    const val TCP_CLOSE = 0x14
    
    fun authPayload(token: String): ByteArray {
        val tokenBytes = token.toByteArray(Charsets.UTF_8)
        return ByteArray(1 + tokenBytes.size).also {
            it[0] = 1 // auth type = token
            tokenBytes.copyInto(it, 1)
        }
    }
    
    fun tcpConnectPayload(socketId: Int, host: String, port: Int): ByteArray {
        val hostBytes = host.toByteArray(Charsets.UTF_8)
        val buf = ByteBuffer.allocate(4 + 2 + hostBytes.size).order(ByteOrder.LITTLE_ENDIAN)
        buf.putInt(socketId)
        buf.putShort(port.toShort())
        buf.put(hostBytes)
        return buf.array()
    }
    
    fun extractSocketId(payload: ByteArray): Int {
        return ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN).int
    }
}
```

### Phase 2: The Benchmark Test

```kotlin
class ThroughputBenchmarkTest {
    
    @Test
    fun benchmarkTcpRecvThroughput() {
        val totalBytes = 100L * 1024 * 1024 // 100 MB
        val token = "test-token"
        val daemonPort = 7800
        
        // 1. Start mock seeder
        MockSeeder(totalBytes).use { seeder ->
            seeder.startAsync()
            
            // 2. Start daemon (you'll need to extract the server portion to be testable)
            // For now, assume daemon is running externally or started here
            
            // 3. Connect WebSocket
            TestWsClient("ws://localhost:$daemonPort/io").use { ws ->
                ws.connect()
                
                // 4. Handshake
                ws.sendFrame(Protocol.CLIENT_HELLO, 1, ByteArray(0))
                val hello = ws.receiveFrame()!!
                check(hello.opcode == Protocol.SERVER_HELLO) { "Expected SERVER_HELLO" }
                
                ws.sendFrame(Protocol.AUTH, 2, Protocol.authPayload(token))
                val authResult = ws.receiveFrame()!!
                check(authResult.opcode == Protocol.AUTH_RESULT) { "Expected AUTH_RESULT" }
                check(authResult.payload[0] == 0.toByte()) { "Auth failed" }
                
                // 5. TCP_CONNECT to mock seeder
                val socketId = 1
                ws.sendFrame(Protocol.TCP_CONNECT, 3, 
                    Protocol.tcpConnectPayload(socketId, "127.0.0.1", seeder.port))
                
                val connected = ws.receiveFrame()!!
                check(connected.opcode == Protocol.TCP_CONNECTED) { "Expected TCP_CONNECTED" }
                check(connected.payload[4] == 0.toByte()) { "Connect failed" }
                
                // 6. Receive all data and measure
                var totalReceived = 0L
                var frameCount = 0
                val frameSizes = mutableListOf<Int>()
                
                val startTime = System.nanoTime()
                
                while (true) {
                    val frame = ws.receiveFrame(timeoutMs = 2000) ?: break
                    
                    when (frame.opcode) {
                        Protocol.TCP_RECV -> {
                            val dataSize = frame.payload.size - 4 // minus socketId
                            totalReceived += dataSize
                            frameCount++
                            frameSizes.add(dataSize)
                        }
                        Protocol.TCP_CLOSE -> break
                        else -> println("Unexpected opcode: ${frame.opcode}")
                    }
                }
                
                val elapsedSec = (System.nanoTime() - startTime) / 1_000_000_000.0
                
                // 7. Report results
                val mbps = (totalReceived / 1024.0 / 1024.0) / elapsedSec
                val avgFrameSize = if (frameCount > 0) totalReceived / frameCount else 0
                
                println("=== TCP Recv Throughput Benchmark ===")
                println("Total received: ${totalReceived / 1024 / 1024} MB")
                println("Time: %.2f sec".format(elapsedSec))
                println("Throughput: %.2f MB/s".format(mbps))
                println("Frame count: $frameCount")
                println("Avg frame size: $avgFrameSize bytes")
                println("Min frame size: ${frameSizes.minOrNull()} bytes")
                println("Max frame size: ${frameSizes.maxOrNull()} bytes")
            }
        }
    }
}
```

### Phase 3: Add Instrumentation to Daemon

Add timing logs inside the daemon's TCP read loop to identify where time is spent.

In `SocketManager.kt` (or wherever TCP read happens):

```kotlin
// Inside the coroutine that reads from TCP socket
val buffer = ByteArray(64 * 1024) // Try different sizes: 16KB, 64KB, 256KB

while (isActive) {
    val t0 = System.nanoTime()
    
    val bytesRead = socket.getInputStream().read(buffer)
    if (bytesRead == -1) break
    
    val tRead = System.nanoTime()
    
    // Build TCP_RECV frame
    val frame = buildTcpRecvFrame(socketId, buffer, bytesRead)
    
    val tPack = System.nanoTime()
    
    // Send to WebSocket
    wsSendChannel.send(frame)
    
    val tSend = System.nanoTime()
    
    Log.d("JSTorrent.Perf", 
        "read=${(tRead-t0)/1000}µs " +
        "pack=${(tPack-tRead)/1000}µs " +
        "send=${(tSend-tPack)/1000}µs " +
        "bytes=$bytesRead")
}
```

Run with: `adb logcat -s JSTorrent.Perf:V`

### Phase 4: Optimization Experiments

Once you have baseline measurements, try these optimizations:

#### 4.1 Increase TCP Read Buffer

```kotlin
// Try different sizes and measure impact
val BUFFER_SIZES = listOf(16 * 1024, 64 * 1024, 256 * 1024, 1024 * 1024)
```

#### 4.2 Buffer Pool (Avoid Allocation)

```kotlin
object BufferPool {
    private val pool = ConcurrentLinkedQueue<ByteArray>()
    private const val BUFFER_SIZE = 64 * 1024
    private const val MAX_POOLED = 16
    
    fun acquire(): ByteArray = pool.poll() ?: ByteArray(BUFFER_SIZE)
    
    fun release(buf: ByteArray) {
        if (pool.size < MAX_POOLED && buf.size == BUFFER_SIZE) {
            pool.offer(buf)
        }
    }
}
```

#### 4.3 Direct ByteBuffer (Avoid JVM Heap Copy)

```kotlin
val directBuffer = ByteBuffer.allocateDirect(64 * 1024)
// Use with NIO channels instead of InputStream
```

#### 4.4 Increase WebSocket Send Channel Capacity

```kotlin
// If using Kotlin Channel for WS send queue
val wsSendChannel = Channel<ByteArray>(capacity = 64) // instead of default
```

#### 4.5 Batch Multiple Reads

```kotlin
// Instead of sending immediately, batch small reads
val batchBuffer = ByteArrayOutputStream(64 * 1024)
var lastSendTime = System.currentTimeMillis()

while (isActive) {
    val bytesRead = socket.read(buffer)
    batchBuffer.write(buffer, 0, bytesRead)
    
    val now = System.currentTimeMillis()
    if (batchBuffer.size() >= 32 * 1024 || now - lastSendTime > 10) {
        sendTcpRecvFrame(socketId, batchBuffer.toByteArray())
        batchBuffer.reset()
        lastSendTime = now
    }
}
```

## Expected Output

After running the benchmark, you should see output like:

```
=== TCP Recv Throughput Benchmark ===
Total received: 100 MB
Time: 2.34 sec
Throughput: 42.74 MB/s
Frame count: 6400
Avg frame size: 16384 bytes
Min frame size: 1234 bytes
Max frame size: 16384 bytes
```

And from daemon logs:

```
JSTorrent.Perf: read=45µs pack=12µs send=890µs bytes=16384
JSTorrent.Perf: read=38µs pack=11µs send=1203µs bytes=16384
```

This tells you `send` is the bottleneck (WebSocket backpressure).

## Success Criteria

1. Benchmark runs and produces consistent throughput numbers
2. Timing logs in daemon show where time is spent
3. At least one optimization improves throughput measurably
4. Document findings in `android-io-daemon/PERFORMANCE.md`

## Files to Create

1. `app/src/test/java/com/jstorrent/ThroughputBenchmarkTest.kt` - Main benchmark
2. `app/src/test/java/com/jstorrent/MockSeeder.kt` - TCP server helper
3. `app/src/test/java/com/jstorrent/TestWsClient.kt` - WebSocket client helper
4. `app/src/test/java/com/jstorrent/Protocol.kt` - Protocol constants and helpers
5. `android-io-daemon/PERFORMANCE.md` - Document findings

## Dependencies to Add

In `app/build.gradle.kts`:

```kotlin
testImplementation("org.java-websocket:Java-WebSocket:1.5.4")
// or
testImplementation("com.squareup.okhttp3:okhttp:4.12.0")
testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
```

## Notes

- The daemon must be extractable to run in a JVM test, OR start it externally before running tests
- If daemon can't run in JVM (Android dependencies), use `./gradlew connectedAndroidTest` instead
- Compare results with the Rust io-daemon to establish a baseline target
- Real-world will be slower due to actual network latency; this tests max theoretical throughput
