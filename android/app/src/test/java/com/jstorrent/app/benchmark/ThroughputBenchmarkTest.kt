package com.jstorrent.app.benchmark

import org.junit.Ignore
import org.junit.Test

/**
 * TCP receive throughput benchmark for android-io-daemon.
 *
 * Measures download path throughput:
 * Mock Seeder (TCP) → Daemon (TCP read) → WebSocket TCP_RECV frames → Test Client
 *
 * This simulates a real BitTorrent download where a remote peer seeds data
 * and the daemon bridges it to the browser.
 *
 * ## Standalone Tests (no external daemon needed)
 *
 * These tests use an embedded JVM WebSocket server to measure baseline throughput:
 * - `standalone_100MB` - 100 MB with 16 KB chunks
 * - `standalone_10MB` - Quick 10 MB test
 * - `standalone_LargeChunks` - 100 MB with 64 KB chunks
 * - `standalone_VaryBufferSizes` - Compare different TCP buffer sizes
 *
 * ## External Daemon Tests
 *
 * These require the Android daemon running:
 *   1. Start the daemon (Android app or standalone)
 *   2. Note the auth token from the app
 *   3. Run: ./gradlew test --tests "*.ThroughputBenchmarkTest.benchmarkTcpRecvThroughput"
 */
class ThroughputBenchmarkTest {

    companion object {
        // Daemon connection settings (for external daemon tests)
        const val DAEMON_HOST = "localhost"
        const val DAEMON_PORT = 7800
        const val DAEMON_PATH = "/io"

        // Test parameters
        const val TOTAL_BYTES = 100L * 1024 * 1024 // 100 MB
        const val CHUNK_SIZE = 16 * 1024 // 16 KB chunks from mock seeder

        // Auth token
        const val AUTH_TOKEN = "test-token"

        // Timeouts
        const val CONNECT_TIMEOUT_MS = 5000L
        const val FRAME_TIMEOUT_MS = 2000L
    }

    // ==================== STANDALONE TESTS (Embedded Server) ====================

    /**
     * Standalone benchmark: 100 MB with 16 KB chunks.
     * Uses embedded JVM server - no external daemon needed.
     */
    @Test
    fun standalone_100MB() {
        runStandaloneBenchmark(
            totalBytes = 100L * 1024 * 1024,
            chunkSize = 16 * 1024,
            tcpReadBufferSize = 64 * 1024
        )
    }

    /**
     * Standalone benchmark: Quick 10 MB test.
     */
    @Test
    fun standalone_10MB() {
        runStandaloneBenchmark(
            totalBytes = 10L * 1024 * 1024,
            chunkSize = 16 * 1024,
            tcpReadBufferSize = 64 * 1024
        )
    }

    /**
     * Standalone benchmark: 100 MB with larger 64 KB chunks.
     */
    @Test
    fun standalone_LargeChunks() {
        runStandaloneBenchmark(
            totalBytes = 100L * 1024 * 1024,
            chunkSize = 64 * 1024,
            tcpReadBufferSize = 64 * 1024
        )
    }

    /**
     * Compare different TCP read buffer sizes to find optimal.
     */
    @Test
    fun standalone_VaryBufferSizes() {
        val totalBytes = 50L * 1024 * 1024 // 50 MB for faster iteration
        val chunkSize = 16 * 1024
        val bufferSizes = listOf(16 * 1024, 32 * 1024, 64 * 1024, 128 * 1024, 256 * 1024)

        println("=== Buffer Size Comparison ===")
        println("Transfer: ${totalBytes / 1024 / 1024} MB, Chunk: ${chunkSize / 1024} KB")
        println()

        val results = mutableListOf<Pair<Int, Double>>()

        for (bufSize in bufferSizes) {
            print("Buffer ${bufSize / 1024} KB: ")
            val result = runStandaloneBenchmarkQuiet(totalBytes, chunkSize, bufSize)
            val mbps = (result.totalBytes / 1024.0 / 1024.0) / (result.elapsedNanos / 1_000_000_000.0)
            results.add(bufSize to mbps)
            println("${String.format("%.2f", mbps)} MB/s (${result.frameCount} frames)")
        }

        println()
        println("=== Summary ===")
        val best = results.maxByOrNull { it.second }!!
        println("Best: ${best.first / 1024} KB buffer → ${String.format("%.2f", best.second)} MB/s")
    }

    private fun runStandaloneBenchmark(totalBytes: Long, chunkSize: Int, tcpReadBufferSize: Int) {
        println("=== Standalone TCP Recv Throughput Benchmark ===")
        println("Transfer size: ${totalBytes / 1024 / 1024} MB")
        println("Seeder chunk size: ${chunkSize / 1024} KB")
        println("TCP read buffer: ${tcpReadBufferSize / 1024} KB")
        println()

        // Start embedded daemon server
        TestDaemonServer(port = 0, authToken = AUTH_TOKEN, tcpReadBufferSize = tcpReadBufferSize).use { daemon ->
            daemon.start()
            println("Embedded daemon started on port ${daemon.port}")

            // Start mock seeder
            MockSeeder(totalBytes, chunkSize).use { seeder ->
                seeder.startAsync()
                println("Mock seeder started on port ${seeder.port}")

                // Connect WebSocket client
                TestWsClient(daemon.uri).use { ws ->
                    ws.connect(CONNECT_TIMEOUT_MS)
                    println("WebSocket connected")

                    performHandshake(ws)
                    println("Handshake complete, authenticated")

                    val socketId = 1
                    connectToSeeder(ws, socketId, seeder.port)
                    println("TCP connected to mock seeder")
                    println()

                    val result = receiveAllData(ws, socketId)
                    printResults(result, seeder)

                    println()
                    println("Server stats: ${daemon.totalBytesRelayed.get() / 1024 / 1024} MB relayed, " +
                        "${daemon.totalFramesSent.get()} frames sent")
                }
            }
        }
    }

    private fun runStandaloneBenchmarkQuiet(totalBytes: Long, chunkSize: Int, tcpReadBufferSize: Int): BenchmarkResult {
        TestDaemonServer(port = 0, authToken = AUTH_TOKEN, tcpReadBufferSize = tcpReadBufferSize).use { daemon ->
            daemon.start()

            MockSeeder(totalBytes, chunkSize).use { seeder ->
                seeder.startAsync()

                TestWsClient(daemon.uri).use { ws ->
                    ws.connect(CONNECT_TIMEOUT_MS)
                    performHandshake(ws)
                    val socketId = 1
                    connectToSeeder(ws, socketId, seeder.port)
                    return receiveAllDataQuiet(ws, socketId)
                }
            }
        }
    }

    // ==================== EXTERNAL DAEMON TESTS ====================

    /**
     * Main throughput benchmark test.
     *
     * Ignored by default because it requires an external daemon.
     * Remove @Ignore to run the benchmark.
     */
    @Test
    @Ignore("Requires external daemon running - remove to run benchmark")
    fun benchmarkTcpRecvThroughput() {
        val wsUri = "ws://$DAEMON_HOST:$DAEMON_PORT$DAEMON_PATH"

        println("=== TCP Recv Throughput Benchmark ===")
        println("Daemon: $wsUri")
        println("Transfer size: ${TOTAL_BYTES / 1024 / 1024} MB")
        println()

        // 1. Start mock seeder
        MockSeeder(TOTAL_BYTES, CHUNK_SIZE).use { seeder ->
            seeder.startAsync()
            println("Mock seeder started on port ${seeder.port}")

            // 2. Connect WebSocket to daemon
            TestWsClient(wsUri).use { ws ->
                ws.connect(CONNECT_TIMEOUT_MS)
                println("WebSocket connected")

                // 3. Handshake
                performHandshake(ws)
                println("Handshake complete, authenticated")

                // 4. TCP_CONNECT to mock seeder
                val socketId = 1
                connectToSeeder(ws, socketId, seeder.port)
                println("TCP connected to mock seeder")

                // 5. Receive all data and measure
                val result = receiveAllData(ws, socketId)

                // 6. Report results
                printResults(result, seeder)
            }
        }
    }

    /**
     * Smaller benchmark for quick testing (10 MB).
     */
    @Test
    @Ignore("Requires external daemon running - remove to run benchmark")
    fun benchmarkTcpRecvThroughput_10MB() {
        runBenchmark(
            totalBytes = 10L * 1024 * 1024,
            chunkSize = 16 * 1024
        )
    }

    /**
     * Benchmark with larger chunk sizes (64 KB).
     */
    @Test
    @Ignore("Requires external daemon running - remove to run benchmark")
    fun benchmarkTcpRecvThroughput_LargeChunks() {
        runBenchmark(
            totalBytes = 100L * 1024 * 1024,
            chunkSize = 64 * 1024
        )
    }

    private fun runBenchmark(totalBytes: Long, chunkSize: Int) {
        val wsUri = "ws://$DAEMON_HOST:$DAEMON_PORT$DAEMON_PATH"

        println("=== TCP Recv Throughput Benchmark ===")
        println("Daemon: $wsUri")
        println("Transfer size: ${totalBytes / 1024 / 1024} MB")
        println("Chunk size: ${chunkSize / 1024} KB")
        println()

        MockSeeder(totalBytes, chunkSize).use { seeder ->
            seeder.startAsync()
            println("Mock seeder started on port ${seeder.port}")

            TestWsClient(wsUri).use { ws ->
                ws.connect(CONNECT_TIMEOUT_MS)
                println("WebSocket connected")

                performHandshake(ws)
                println("Handshake complete, authenticated")

                val socketId = 1
                connectToSeeder(ws, socketId, seeder.port)
                println("TCP connected to mock seeder")

                val result = receiveAllData(ws, socketId)
                printResults(result, seeder)
            }
        }
    }

    private fun performHandshake(ws: TestWsClient) {
        // CLIENT_HELLO
        ws.sendFrame(Protocol.CLIENT_HELLO, 1)
        val hello = ws.receiveFrame(CONNECT_TIMEOUT_MS)
            ?: throw AssertionError("No SERVER_HELLO received")
        check(hello.opcode == Protocol.SERVER_HELLO) {
            "Expected SERVER_HELLO (0x02), got 0x${hello.opcode.toString(16)}"
        }

        // AUTH
        ws.sendFrame(Protocol.AUTH, 2, Protocol.authPayload(AUTH_TOKEN))
        val authResult = ws.receiveFrame(CONNECT_TIMEOUT_MS)
            ?: throw AssertionError("No AUTH_RESULT received")
        check(authResult.opcode == Protocol.AUTH_RESULT) {
            "Expected AUTH_RESULT (0x04), got 0x${authResult.opcode.toString(16)}"
        }
        check(authResult.payload.isNotEmpty() && authResult.payload[0] == 0.toByte()) {
            "Auth failed: status=${authResult.payload.getOrNull(0)}"
        }
    }

    private fun connectToSeeder(ws: TestWsClient, socketId: Int, port: Int) {
        ws.sendFrame(
            Protocol.TCP_CONNECT,
            3,
            Protocol.tcpConnectPayload(socketId, "127.0.0.1", port)
        )

        val connected = ws.receiveFrame(CONNECT_TIMEOUT_MS)
            ?: throw AssertionError("No TCP_CONNECTED received")
        check(connected.opcode == Protocol.TCP_CONNECTED) {
            "Expected TCP_CONNECTED (0x11), got 0x${connected.opcode.toString(16)}"
        }
        // Payload: [socketId:4][status:1][errno:4]
        check(connected.payload.size >= 5 && connected.payload[4] == 0.toByte()) {
            "TCP connect failed: status=${connected.payload.getOrNull(4)}"
        }
    }

    private fun receiveAllData(ws: TestWsClient, expectedSocketId: Int): BenchmarkResult {
        var totalReceived = 0L
        var frameCount = 0
        val frameSizes = mutableListOf<Int>()
        var minFrameSize = Int.MAX_VALUE
        var maxFrameSize = 0

        val startTime = System.nanoTime()
        var lastProgressTime = startTime

        while (true) {
            val frame = ws.receiveFrame(FRAME_TIMEOUT_MS) ?: break

            when (frame.opcode) {
                Protocol.TCP_RECV -> {
                    // Payload: [socketId:4][data...]
                    val dataSize = frame.payload.size - 4
                    if (dataSize > 0) {
                        totalReceived += dataSize
                        frameCount++
                        frameSizes.add(dataSize)
                        if (dataSize < minFrameSize) minFrameSize = dataSize
                        if (dataSize > maxFrameSize) maxFrameSize = dataSize
                    }

                    // Progress reporting every 10MB
                    val now = System.nanoTime()
                    if (totalReceived > 0 && (now - lastProgressTime) > 1_000_000_000L) {
                        val elapsed = (now - startTime) / 1_000_000_000.0
                        val mbps = (totalReceived / 1024.0 / 1024.0) / elapsed
                        println("  Progress: ${totalReceived / 1024 / 1024} MB, ${String.format("%.2f", mbps)} MB/s")
                        lastProgressTime = now
                    }
                }
                Protocol.TCP_CLOSE -> {
                    println("  TCP connection closed by daemon")
                    break
                }
                Protocol.ERROR -> {
                    val errorMsg = if (frame.payload.isNotEmpty()) {
                        String(frame.payload, Charsets.UTF_8)
                    } else "unknown"
                    println("  ERROR received: $errorMsg")
                    break
                }
                else -> {
                    println("  Unexpected opcode: 0x${frame.opcode.toString(16)}")
                }
            }
        }

        val elapsedNanos = System.nanoTime() - startTime

        return BenchmarkResult(
            totalBytes = totalReceived,
            elapsedNanos = elapsedNanos,
            frameCount = frameCount,
            minFrameSize = if (minFrameSize == Int.MAX_VALUE) 0 else minFrameSize,
            maxFrameSize = maxFrameSize,
            frameSizes = frameSizes
        )
    }

    private fun receiveAllDataQuiet(ws: TestWsClient, expectedSocketId: Int): BenchmarkResult {
        var totalReceived = 0L
        var frameCount = 0
        var minFrameSize = Int.MAX_VALUE
        var maxFrameSize = 0

        val startTime = System.nanoTime()

        while (true) {
            val frame = ws.receiveFrame(FRAME_TIMEOUT_MS) ?: break

            when (frame.opcode) {
                Protocol.TCP_RECV -> {
                    val dataSize = frame.payload.size - 4
                    if (dataSize > 0) {
                        totalReceived += dataSize
                        frameCount++
                        if (dataSize < minFrameSize) minFrameSize = dataSize
                        if (dataSize > maxFrameSize) maxFrameSize = dataSize
                    }
                }
                Protocol.TCP_CLOSE -> break
                Protocol.ERROR -> break
            }
        }

        return BenchmarkResult(
            totalBytes = totalReceived,
            elapsedNanos = System.nanoTime() - startTime,
            frameCount = frameCount,
            minFrameSize = if (minFrameSize == Int.MAX_VALUE) 0 else minFrameSize,
            maxFrameSize = maxFrameSize,
            frameSizes = emptyList()
        )
    }

    private fun printResults(result: BenchmarkResult, seeder: MockSeeder) {
        val elapsedSec = result.elapsedNanos / 1_000_000_000.0
        val mbps = (result.totalBytes / 1024.0 / 1024.0) / elapsedSec
        val avgFrameSize = if (result.frameCount > 0) result.totalBytes / result.frameCount else 0

        println()
        println("=== Results ===")
        println("Seeder sent:      ${seeder.bytesSent / 1024 / 1024} MB")
        println("Client received:  ${result.totalBytes / 1024 / 1024} MB")
        println("Time:             ${String.format("%.2f", elapsedSec)} sec")
        println("Throughput:       ${String.format("%.2f", mbps)} MB/s")
        println("Frame count:      ${result.frameCount}")
        println("Avg frame size:   $avgFrameSize bytes")
        println("Min frame size:   ${result.minFrameSize} bytes")
        println("Max frame size:   ${result.maxFrameSize} bytes")

        // Histogram of frame sizes
        if (result.frameSizes.isNotEmpty()) {
            println()
            println("Frame size distribution:")
            val buckets = mapOf(
                "0-1KB" to result.frameSizes.count { it < 1024 },
                "1-4KB" to result.frameSizes.count { it in 1024 until 4096 },
                "4-16KB" to result.frameSizes.count { it in 4096 until 16384 },
                "16-32KB" to result.frameSizes.count { it in 16384 until 32768 },
                "32-64KB" to result.frameSizes.count { it in 32768 until 65536 },
                "64KB+" to result.frameSizes.count { it >= 65536 }
            )
            for ((range, count) in buckets) {
                if (count > 0) {
                    val pct = count * 100.0 / result.frameSizes.size
                    println("  $range: $count (${String.format("%.1f", pct)}%)")
                }
            }
        }

        // Verify data integrity
        if (result.totalBytes < seeder.bytesSent) {
            val lostPct = (seeder.bytesSent - result.totalBytes) * 100.0 / seeder.bytesSent
            println()
            println("WARNING: Data loss detected!")
            println("  Lost: ${(seeder.bytesSent - result.totalBytes) / 1024} KB (${String.format("%.2f", lostPct)}%)")
        }
    }

    data class BenchmarkResult(
        val totalBytes: Long,
        val elapsedNanos: Long,
        val frameCount: Int,
        val minFrameSize: Int,
        val maxFrameSize: Int,
        val frameSizes: List<Int>
    )
}
