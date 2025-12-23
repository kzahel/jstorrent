package com.jstorrent.io.socket

/**
 * Manager interface for UDP socket operations.
 *
 * Provides methods to bind, send datagrams, manage multicast groups,
 * and close UDP sockets. Events are delivered via [UdpSocketCallback].
 *
 * Socket lifecycle:
 * 1. [bind] creates and binds socket → [UdpSocketCallback.onUdpBound]
 * 2. [send] sends datagrams to any destination
 * 3. Optionally [joinMulticast]/[leaveMulticast] for multicast groups
 * 4. [close] terminates the socket → [UdpSocketCallback.onUdpClose]
 */
interface UdpSocketManager {
    /**
     * Bind a UDP socket to the specified port.
     *
     * @param socketId Unique identifier for this socket
     * @param port UDP port to bind to (0 for system-assigned)
     */
    fun bind(socketId: Int, port: Int)

    /**
     * Send a UDP datagram.
     *
     * @param socketId The socket identifier
     * @param destAddr Destination hostname or IP address
     * @param destPort Destination port
     * @param data Bytes to send
     */
    fun send(socketId: Int, destAddr: String, destPort: Int, data: ByteArray)

    /**
     * Close a UDP socket.
     *
     * Automatically leaves all joined multicast groups.
     *
     * @param socketId The socket identifier
     */
    fun close(socketId: Int)

    /**
     * Join a multicast group.
     *
     * After joining, datagrams sent to the group address will be
     * received and delivered via [UdpSocketCallback.onUdpMessage].
     *
     * @param socketId The socket identifier
     * @param groupAddr Multicast group address (e.g., "239.192.152.143")
     */
    fun joinMulticast(socketId: Int, groupAddr: String)

    /**
     * Leave a multicast group.
     *
     * @param socketId The socket identifier
     * @param groupAddr Multicast group address
     */
    fun leaveMulticast(socketId: Int, groupAddr: String)

    /**
     * Set the callback to receive socket events.
     *
     * @param callback The callback implementation
     */
    fun setCallback(callback: UdpSocketCallback)
}
