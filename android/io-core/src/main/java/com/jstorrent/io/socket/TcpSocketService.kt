@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.jstorrent.io.socket

import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Semaphore
import java.io.IOException
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/**
 * Unified TCP socket service implementing both client and server operations.
 *
 * This class implements [TcpSocketManager] for client connections and
 * [TcpServerManager] for server sockets. Accepted connections share
 * the same connection pool as outgoing connections.
 *
 * @param scope CoroutineScope for all socket operations
 * @param connectSemaphore Semaphore limiting concurrent connection attempts (default 30)
 * @param maxPendingConnects Maximum pending connections before fast-fail (default 60)
 * @param batchingConfig Configuration for read batching behavior (default STANDALONE)
 */
class TcpSocketService(
    private val scope: CoroutineScope,
    private val connectSemaphore: Semaphore = Semaphore(30),
    private val maxPendingConnects: Int = 60,
    private val batchingConfig: BatchingConfig = BatchingConfig.STANDALONE
) : TcpSocketManager, TcpServerManager {

    // Callbacks
    private var socketCallback: TcpSocketCallback? = null
    private var serverCallback: TcpServerCallback? = null

    // Socket state
    private val pendingConnects = ConcurrentHashMap<Int, Job>()
    private val pendingSockets = ConcurrentHashMap<Int, Socket>()
    private val activeConnections = ConcurrentHashMap<Int, TcpConnection>()

    // Server state
    private val servers = ConcurrentHashMap<Int, ServerHandler>()

    // Statistics
    private val pendingConnectCount = AtomicInteger(0)
    private val nextSocketId = AtomicInteger(0x10000) // For accepted sockets

    companion object {
        // Socket configuration
        private const val TCP_NO_DELAY = true
        private const val RECEIVE_BUFFER_SIZE = 256 * 1024 // 256KB
        private const val SO_TIMEOUT = 60_000 // 60 seconds
        private const val CONNECT_TIMEOUT = 5_000 // 5 seconds (allows trying multiple addresses within client timeout)
        private const val SEMAPHORE_TIMEOUT = 5000L // 5 seconds
    }

    // ============================================================
    // TcpSocketManager implementation
    // ============================================================

    override fun connect(socketId: Int, host: String, port: Int) {
        // Fast-fail if too many connects are already pending
        val currentPending = pendingConnectCount.get()
        if (currentPending >= maxPendingConnects) {
            socketCallback?.onTcpConnected(socketId, false, 1)
            return
        }

        pendingConnectCount.incrementAndGet()

        val job = scope.launch {
            var acquiredSemaphore = false
            try {
                // Limit concurrent pending connections to prevent resource exhaustion
                val acquired = withTimeoutOrNull(SEMAPHORE_TIMEOUT) {
                    connectSemaphore.acquire()
                    true
                }
                if (acquired != true) {
                    // Timeout waiting for semaphore
                    socketCallback?.onTcpConnected(socketId, false, 1)
                    return@launch
                }
                acquiredSemaphore = true

                // Check if we were cancelled while waiting for semaphore
                if (!isActive) return@launch

                // Resolve hostname to all addresses, prefer IPv6 for better peer discovery
                val addresses = InetAddress.getAllByName(host)
                    .sortedByDescending { it is Inet6Address }

                var socket: Socket? = null
                var lastException: Exception? = null

                for (addr in addresses) {
                    val s = Socket()
                    try {
                        configureSocket(s)
                        s.connect(InetSocketAddress(addr, port), CONNECT_TIMEOUT)
                        socket = s
                        break
                    } catch (e: Exception) {
                        lastException = e
                        s.close()
                    }
                }

                if (socket == null) {
                    throw lastException ?: Exception("No addresses found for $host")
                }

                // Check if we were cancelled during connect
                if (!isActive) {
                    socket.close()
                    return@launch
                }

                // Store in pending - don't start read/write tasks yet
                pendingSockets[socketId] = socket

                // Notify success
                socketCallback?.onTcpConnected(socketId, true, 0)

            } catch (_: CancellationException) {
                // Don't send failure - socket was intentionally closed
                throw CancellationException()
            } catch (_: Exception) {
                // Connection failed
                socketCallback?.onTcpConnected(socketId, false, 1)
            } finally {
                if (acquiredSemaphore) {
                    connectSemaphore.release()
                }
                pendingConnectCount.decrementAndGet()
                pendingConnects.remove(socketId)
            }
        }

        pendingConnects[socketId] = job
    }

    override fun send(socketId: Int, data: ByteArray) {
        // Check if socket is pending (not yet activated) - auto-activate
        val pendingSocket = pendingSockets.remove(socketId)
        if (pendingSocket != null) {
            val connection = createConnection(socketId, pendingSocket)
            activeConnections[socketId] = connection
            connection.activate()
            connection.send(data)
            return
        }

        // Send to active connection
        activeConnections[socketId]?.send(data)
    }

    override fun close(socketId: Int) {
        // Cancel any pending connect
        pendingConnects.remove(socketId)?.cancel()

        // Close pending socket (connected but not activated)
        pendingSockets.remove(socketId)?.let { socket ->
            closeSocketFast(socket)
        }

        // Close active connection
        activeConnections.remove(socketId)?.close()
    }

    /**
     * Close a raw socket quickly without blocking.
     * Calls shutdownInput/Output first to unblock any pending I/O.
     */
    private fun closeSocketFast(socket: java.net.Socket) {
        try {
            if (!socket.isInputShutdown) {
                socket.shutdownInput()
            }
            if (!socket.isOutputShutdown) {
                socket.shutdownOutput()
            }
            socket.close()
        } catch (_: Exception) {}
    }

    override fun secure(socketId: Int, hostname: String, skipValidation: Boolean) {
        // Must be a pending socket (not yet active)
        val socket = pendingSockets.remove(socketId)
        if (socket == null) {
            socketCallback?.onTcpSecured(socketId, false)
            return
        }

        scope.launch {
            try {
                // Create SSLSocketFactory
                val sslSocketFactory = if (skipValidation) {
                    InsecureTrustManager.createInsecureSocketFactory()
                } else {
                    SSLSocketFactory.getDefault() as SSLSocketFactory
                }

                // Create SSLSocket wrapping the existing socket
                val sslSocket = sslSocketFactory.createSocket(
                    socket,
                    hostname,
                    socket.port,
                    true // autoClose
                ) as SSLSocket

                // Configure and start handshake
                sslSocket.useClientMode = true
                sslSocket.startHandshake()

                // Create connection with TLS socket and activate
                val connection = createConnection(socketId, sslSocket)
                activeConnections[socketId] = connection
                connection.activate()

                socketCallback?.onTcpSecured(socketId, true)

            } catch (_: Exception) {
                try {
                    socket.close()
                } catch (_: Exception) {}
                socketCallback?.onTcpSecured(socketId, false)
            }
        }
    }

    override fun activate(socketId: Int) {
        val socket = pendingSockets.remove(socketId) ?: return

        val connection = createConnection(socketId, socket)
        activeConnections[socketId] = connection
        connection.activate()
    }

    override fun setCallback(callback: TcpSocketCallback) {
        socketCallback = callback
    }

    // ============================================================
    // TcpServerManager implementation
    // ============================================================

    override fun listen(serverId: Int, port: Int) {
        scope.launch {
            try {
                val serverSocket = ServerSocket(port)
                val boundPort = serverSocket.localPort

                val handler = ServerHandler(serverId, serverSocket)
                servers[serverId] = handler

                // Notify success
                serverCallback?.onTcpListenResult(serverId, true, boundPort, 0)

                // Start accepting connections
                handler.startAccepting()

            } catch (_: Exception) {
                serverCallback?.onTcpListenResult(serverId, false, 0, 1)
            }
        }
    }

    override fun stopListen(serverId: Int) {
        servers.remove(serverId)?.close()
    }

    override fun setCallback(callback: TcpServerCallback) {
        serverCallback = callback
    }

    // ============================================================
    // Lifecycle
    // ============================================================

    /**
     * Shutdown the service, closing all sockets and cancelling operations.
     */
    fun shutdown() {
        // Cancel all pending connects
        pendingConnects.values.forEach { it.cancel() }
        pendingConnects.clear()

        // Close pending sockets (use fast close to avoid blocking)
        pendingSockets.values.forEach { closeSocketFast(it) }
        pendingSockets.clear()

        // Close active connections
        activeConnections.values.forEach { it.close() }
        activeConnections.clear()

        // Close servers
        servers.values.forEach { it.close() }
        servers.clear()
    }

    // ============================================================
    // Internal helpers
    // ============================================================

    private fun configureSocket(socket: Socket) {
        socket.tcpNoDelay = TCP_NO_DELAY
        socket.receiveBufferSize = RECEIVE_BUFFER_SIZE
        socket.soTimeout = SO_TIMEOUT
        socket.setKeepAlive(true)
    }

    private fun createConnection(socketId: Int, socket: Socket): TcpConnection {
        return TcpConnection(
            socketId = socketId,
            socket = socket,
            scope = scope,
            batchingConfig = batchingConfig,
            onData = { data ->
                socketCallback?.onTcpData(socketId, data)
            },
            onClose = { hadError, errorCode ->
                activeConnections.remove(socketId)
                socketCallback?.onTcpClose(socketId, hadError, errorCode)
            }
        )
    }

    /**
     * Internal handler for TCP server socket.
     */
    private inner class ServerHandler(
        private val serverId: Int,
        private val serverSocket: ServerSocket
    ) {
        private var acceptJob: Job? = null

        fun startAccepting() {
            acceptJob = scope.launch {
                try {
                    while (true) {
                        val socket = serverSocket.accept()
                        configureSocket(socket)

                        val socketId = nextSocketId.getAndIncrement()
                        val peerAddr = socket.inetAddress.hostAddress ?: "unknown"
                        val peerPort = socket.port

                        // Create and activate connection
                        val connection = createConnection(socketId, socket)
                        activeConnections[socketId] = connection
                        connection.activate()

                        // Notify callback
                        serverCallback?.onTcpAccepted(serverId, socketId, peerAddr, peerPort)
                    }
                } catch (_: IOException) {
                    // Server socket closed
                }
            }
        }

        fun close() {
            acceptJob?.cancel()
            try {
                serverSocket.close()
            } catch (_: Exception) {}
            // Note: Don't close accepted connections - they're managed separately
        }
    }
}
