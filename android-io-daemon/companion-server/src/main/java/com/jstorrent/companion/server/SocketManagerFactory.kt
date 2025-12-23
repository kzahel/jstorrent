package com.jstorrent.companion.server

import com.jstorrent.io.socket.TcpSocketService
import com.jstorrent.io.socket.UdpSocketManagerImpl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.sync.Semaphore

/**
 * Factory for creating per-session socket managers.
 *
 * The connection semaphore is shared globally across all sessions to limit
 * total concurrent TCP connection attempts. This prevents resource exhaustion
 * when connecting to many unreachable peers on internet torrents.
 *
 * Each WebSocket session gets its own TcpSocketService and UdpSocketManagerImpl
 * instances, which share the global semaphore.
 */
object SocketManagerFactory {
    // Global semaphore shared across all sessions
    // Limit to 30 concurrent pending connections
    private val connectSemaphore = Semaphore(30)

    // Maximum pending connections before fast-fail
    private const val MAX_PENDING_CONNECTS = 60

    /**
     * Create a new TCP socket service for a session.
     *
     * @param scope CoroutineScope for socket operations (tied to session lifecycle)
     * @return TcpSocketService for managing TCP connections
     */
    fun createTcpService(scope: CoroutineScope): TcpSocketService {
        return TcpSocketService(scope, connectSemaphore, MAX_PENDING_CONNECTS)
    }

    /**
     * Create a new UDP socket manager for a session.
     *
     * @param scope CoroutineScope for socket operations (tied to session lifecycle)
     * @return UdpSocketManagerImpl for managing UDP sockets
     */
    fun createUdpManager(scope: CoroutineScope): UdpSocketManagerImpl {
        return UdpSocketManagerImpl(scope)
    }
}
