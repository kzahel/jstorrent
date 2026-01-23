package com.jstorrent.companion.server

import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.server.testing.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Tests for the /stats endpoint.
 */
class StatsEndpointTest {

    @Before
    fun setup() {
        // Reset stats before each test
        DaemonStats.reset()
    }

    @Test
    fun `DaemonStats reset initializes all counters to zero`() {
        // Increment some counters
        DaemonStats.tcpSockets.incrementAndGet()
        DaemonStats.bytesSent.addAndGet(1000)

        // Reset
        DaemonStats.reset()

        // Verify all counters are zero
        assertEquals(0, DaemonStats.tcpSockets.get())
        assertEquals(0, DaemonStats.pendingConnects.get())
        assertEquals(0, DaemonStats.pendingTcp.get())
        assertEquals(0, DaemonStats.udpSockets.get())
        assertEquals(0, DaemonStats.tcpServers.get())
        assertEquals(0, DaemonStats.wsConnections.get())
        assertEquals(0L, DaemonStats.bytesSent.get())
        assertEquals(0L, DaemonStats.bytesReceived.get())
    }

    @Test
    fun `DaemonStats uptimeSecs returns elapsed time`() {
        DaemonStats.reset()

        // Wait a bit
        Thread.sleep(100)

        // Uptime should be at least 0 (could be 0 if < 1 second)
        val uptime = DaemonStats.uptimeSecs()
        assertTrue(uptime >= 0, "Uptime should be non-negative")
    }

    @Test
    fun `DaemonStats counters can be incremented and decremented`() {
        DaemonStats.reset()

        // Test increment
        DaemonStats.tcpSockets.incrementAndGet()
        DaemonStats.tcpSockets.incrementAndGet()
        assertEquals(2, DaemonStats.tcpSockets.get())

        // Test decrement
        DaemonStats.tcpSockets.decrementAndGet()
        assertEquals(1, DaemonStats.tcpSockets.get())

        // Test addAndGet for bytes
        DaemonStats.bytesSent.addAndGet(1000)
        DaemonStats.bytesSent.addAndGet(500)
        assertEquals(1500L, DaemonStats.bytesSent.get())
    }

    @Test
    fun `stats endpoint returns valid JSON`() = testApplication {
        // Set up some test data
        DaemonStats.reset()
        DaemonStats.tcpSockets.set(5)
        DaemonStats.pendingConnects.set(2)
        DaemonStats.pendingTcp.set(1)
        DaemonStats.udpSockets.set(3)
        DaemonStats.tcpServers.set(1)
        DaemonStats.wsConnections.set(2)
        DaemonStats.bytesSent.set(12345L)
        DaemonStats.bytesReceived.set(67890L)

        application {
            routing {
                get("/stats") {
                    val response = TestStatsResponse(
                        tcp_sockets = DaemonStats.tcpSockets.get(),
                        pending_connects = DaemonStats.pendingConnects.get(),
                        pending_tcp = DaemonStats.pendingTcp.get(),
                        udp_sockets = DaemonStats.udpSockets.get(),
                        tcp_servers = DaemonStats.tcpServers.get(),
                        ws_connections = DaemonStats.wsConnections.get(),
                        bytes_sent = DaemonStats.bytesSent.get(),
                        bytes_received = DaemonStats.bytesReceived.get(),
                        uptime_secs = DaemonStats.uptimeSecs()
                    )
                    call.respondText(
                        Json.encodeToString(TestStatsResponse.serializer(), response),
                        ContentType.Application.Json
                    )
                }
            }
        }

        val response = client.get("/stats")
        assertEquals(HttpStatusCode.OK, response.status)

        val body = response.bodyAsText()
        val stats = Json.decodeFromString<TestStatsResponse>(body)

        assertEquals(5, stats.tcp_sockets)
        assertEquals(2, stats.pending_connects)
        assertEquals(1, stats.pending_tcp)
        assertEquals(3, stats.udp_sockets)
        assertEquals(1, stats.tcp_servers)
        assertEquals(2, stats.ws_connections)
        assertEquals(12345L, stats.bytes_sent)
        assertEquals(67890L, stats.bytes_received)
        assertTrue(stats.uptime_secs >= 0)
    }
}

/**
 * Test version of StatsResponse (avoids Android dependencies)
 */
@Serializable
private data class TestStatsResponse(
    val tcp_sockets: Int,
    val pending_connects: Int,
    val pending_tcp: Int,
    val udp_sockets: Int,
    val tcp_servers: Int,
    val ws_connections: Int,
    val bytes_sent: Long,
    val bytes_received: Long,
    val uptime_secs: Long
)
