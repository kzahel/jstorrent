package com.jstorrent.companion.server

import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Global statistics for the companion server daemon.
 * Tracks socket counts, bytes transferred, and uptime.
 *
 * Thread-safe using atomic primitives.
 */
object DaemonStats {
    /** Number of active TCP sockets */
    val tcpSockets = AtomicInteger(0)

    /** Number of pending TCP connections (connecting, not yet established) */
    val pendingConnects = AtomicInteger(0)

    /** Number of pending TCP streams (connected but not yet activated) */
    val pendingTcp = AtomicInteger(0)

    /** Number of active UDP sockets */
    val udpSockets = AtomicInteger(0)

    /** Number of active TCP server listeners */
    val tcpServers = AtomicInteger(0)

    /** Number of active WebSocket connections (IO sessions) */
    val wsConnections = AtomicInteger(0)

    /** Total bytes sent across all sessions */
    val bytesSent = AtomicLong(0)

    /** Total bytes received across all sessions */
    val bytesReceived = AtomicLong(0)

    /** Start time in epoch milliseconds */
    val startTime = AtomicLong(System.currentTimeMillis())

    /**
     * Reset all counters. Called when server starts.
     */
    fun reset() {
        tcpSockets.set(0)
        pendingConnects.set(0)
        pendingTcp.set(0)
        udpSockets.set(0)
        tcpServers.set(0)
        wsConnections.set(0)
        bytesSent.set(0)
        bytesReceived.set(0)
        startTime.set(System.currentTimeMillis())
    }

    /**
     * Get uptime in seconds.
     */
    fun uptimeSecs(): Long {
        return (System.currentTimeMillis() - startTime.get()) / 1000
    }
}
