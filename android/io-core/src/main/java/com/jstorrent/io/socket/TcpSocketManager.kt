package com.jstorrent.io.socket

/**
 * Manager interface for TCP client socket operations.
 *
 * Provides methods to connect, send data, upgrade to TLS, and close
 * TCP sockets. Events are delivered via [TcpSocketCallback].
 *
 * Socket lifecycle:
 * 1. [connect] initiates connection → [TcpSocketCallback.onTcpConnected]
 * 2. Optionally [secure] for TLS → [TcpSocketCallback.onTcpSecured]
 * 3. [activate] starts I/O loops (read/write)
 * 4. [send] queues data for transmission
 * 5. [close] terminates the socket → [TcpSocketCallback.onTcpClose]
 */
interface TcpSocketManager {
    /**
     * Initiate a TCP connection to the specified host and port.
     *
     * The socket remains in a "pending" state after connection succeeds,
     * allowing for TLS upgrade before activating I/O loops.
     *
     * @param socketId Unique identifier for this socket
     * @param host Hostname or IP address to connect to
     * @param port TCP port number
     */
    fun connect(socketId: Int, host: String, port: Int)

    /**
     * Send data on an active TCP socket.
     *
     * Data is queued for transmission. The socket must be activated
     * before sending.
     *
     * @param socketId The socket identifier
     * @param data Bytes to send
     */
    fun send(socketId: Int, data: ByteArray)

    /**
     * Close a TCP socket.
     *
     * Can be called on pending, active, or already-closed sockets.
     * Also cancels any pending connect operation for this socketId.
     *
     * @param socketId The socket identifier
     */
    fun close(socketId: Int)

    /**
     * Upgrade a pending TCP socket to TLS.
     *
     * Must be called after [connect] succeeds but before [activate].
     * The socket transitions from pending → secured upon success.
     *
     * @param socketId The socket identifier
     * @param hostname SNI hostname for TLS handshake
     * @param skipValidation If true, skip certificate validation (for self-signed certs)
     */
    fun secure(socketId: Int, hostname: String, skipValidation: Boolean)

    /**
     * Activate a pending socket to start I/O loops.
     *
     * After activation, the socket begins reading data (triggering
     * [TcpSocketCallback.onTcpData]) and can send data via [send].
     *
     * @param socketId The socket identifier
     */
    fun activate(socketId: Int)

    /**
     * Set the callback to receive socket events.
     *
     * @param callback The callback implementation
     */
    fun setCallback(callback: TcpSocketCallback)

    /**
     * Pause reads on all active TCP connections.
     * Called when backpressure is detected (JS buffer full).
     * New data arriving on sockets will be buffered in the OS kernel
     * until reads are resumed.
     */
    fun pauseAllReads()

    /**
     * Resume reads on all active TCP connections.
     * Called when backpressure is released (JS buffer has drained).
     */
    fun resumeAllReads()
}
