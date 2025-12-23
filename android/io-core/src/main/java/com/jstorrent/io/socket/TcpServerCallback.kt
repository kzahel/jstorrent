package com.jstorrent.io.socket

/**
 * Callback interface for TCP server socket events.
 *
 * Implementations receive notifications about server lifecycle
 * and incoming connections. Accepted connections are managed
 * via [TcpSocketManager].
 */
interface TcpServerCallback {
    /**
     * Called when a TCP listen operation completes.
     *
     * @param serverId The server identifier
     * @param success True if listening succeeded
     * @param boundPort The port actually bound to (may differ if 0 was requested)
     * @param errorCode Error code if failed (0 on success)
     */
    fun onTcpListenResult(serverId: Int, success: Boolean, boundPort: Int, errorCode: Int)

    /**
     * Called when a client connection is accepted.
     *
     * A new socket is created for the accepted connection and
     * automatically activated (I/O loops started). The socketId
     * can be used with [TcpSocketManager] for send/close operations.
     *
     * @param serverId The server that accepted the connection
     * @param socketId The new socket identifier for the accepted connection
     * @param peerAddr Remote peer's IP address
     * @param peerPort Remote peer's port
     */
    fun onTcpAccepted(serverId: Int, socketId: Int, peerAddr: String, peerPort: Int)
}
