package com.jstorrent.io.socket

/**
 * Manager interface for TCP server socket operations.
 *
 * Provides methods to listen for incoming connections and stop listening.
 * Events are delivered via [TcpServerCallback].
 *
 * Accepted connections are automatically registered with [TcpSocketManager]
 * and can be managed using the socketId from [TcpServerCallback.onTcpAccepted].
 */
interface TcpServerManager {
    /**
     * Start listening for incoming TCP connections.
     *
     * @param serverId Unique identifier for this server
     * @param port TCP port to listen on (0 for system-assigned)
     */
    fun listen(serverId: Int, port: Int)

    /**
     * Stop listening and close the server socket.
     *
     * Does not close already-accepted connections.
     *
     * @param serverId The server identifier
     */
    fun stopListen(serverId: Int)

    /**
     * Set the callback to receive server events.
     *
     * @param callback The callback implementation
     */
    fun setCallback(callback: TcpServerCallback)
}
