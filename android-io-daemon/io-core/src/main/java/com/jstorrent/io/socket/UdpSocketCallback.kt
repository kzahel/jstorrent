package com.jstorrent.io.socket

/**
 * Callback interface for UDP socket events.
 *
 * Implementations receive notifications about socket lifecycle events
 * and incoming datagrams. The companion-server module implements this
 * to translate events into WebSocket protocol messages.
 */
interface UdpSocketCallback {
    /**
     * Called when a UDP bind operation completes.
     *
     * @param socketId The socket identifier
     * @param success True if bind succeeded
     * @param boundPort The port actually bound to (may differ if 0 was requested)
     * @param errorCode Error code if failed (0 on success)
     */
    fun onUdpBound(socketId: Int, success: Boolean, boundPort: Int, errorCode: Int)

    /**
     * Called when a UDP datagram is received.
     *
     * @param socketId The socket identifier
     * @param srcAddr Source IP address of the datagram
     * @param srcPort Source port of the datagram
     * @param data The received bytes
     */
    fun onUdpMessage(socketId: Int, srcAddr: String, srcPort: Int, data: ByteArray)

    /**
     * Called when a UDP socket is closed.
     *
     * @param socketId The socket identifier
     * @param hadError True if closed due to an error
     * @param errorCode Error code if applicable (0 otherwise)
     */
    fun onUdpClose(socketId: Int, hadError: Boolean, errorCode: Int)
}
