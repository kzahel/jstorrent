/**
 * Callback Manager
 *
 * Central registry for routing async native callbacks to specific socket/server instances.
 * The native layer fires global callbacks with socket/server IDs, and this manager
 * routes them to the appropriate handler.
 */

import './bindings.d.ts'

type TcpDataHandler = (data: Uint8Array) => void
type TcpCloseHandler = (hadError: boolean) => void
type TcpErrorHandler = (err: Error) => void
type TcpConnectHandler = (success: boolean, errorMessage?: string) => void
type TcpSecuredHandler = (success: boolean) => void

type UdpMessageHandler = (src: { addr: string; port: number }, data: Uint8Array) => void
type UdpBoundHandler = (success: boolean, port: number) => void

type TcpServerListeningHandler = (success: boolean, port: number) => void
type TcpServerAcceptHandler = (socketId: number, remoteAddr: string, remotePort: number) => void

interface TcpSocketHandlers {
  onData?: TcpDataHandler
  onClose?: TcpCloseHandler
  onError?: TcpErrorHandler
  onConnect?: TcpConnectHandler
  onSecured?: TcpSecuredHandler
}

interface UdpSocketHandlers {
  onMessage?: UdpMessageHandler
  onBound?: UdpBoundHandler
}

interface TcpServerHandlers {
  onListening?: TcpServerListeningHandler
  onAccept?: TcpServerAcceptHandler
}

class CallbackManager {
  private tcpHandlers = new Map<number, TcpSocketHandlers>()
  private udpHandlers = new Map<number, UdpSocketHandlers>()
  private tcpServerHandlers = new Map<number, TcpServerHandlers>()
  private initialized = false

  /**
   * Initialize global callbacks with native layer.
   * Must be called once before creating any sockets.
   */
  initialize(): void {
    if (this.initialized) return
    this.initialized = true

    // TCP data callback
    __jstorrent_tcp_on_data((socketId, data) => {
      const handlers = this.tcpHandlers.get(socketId)
      handlers?.onData?.(new Uint8Array(data))
    })

    // TCP close callback
    __jstorrent_tcp_on_close((socketId, hadError) => {
      const handlers = this.tcpHandlers.get(socketId)
      handlers?.onClose?.(hadError)
      // Don't delete handlers here - let the socket do cleanup
    })

    // TCP error callback
    __jstorrent_tcp_on_error((socketId, message) => {
      const handlers = this.tcpHandlers.get(socketId)
      handlers?.onError?.(new Error(message))
    })

    // TCP connect callback
    __jstorrent_tcp_on_connected((socketId, success, errorMessage) => {
      const handlers = this.tcpHandlers.get(socketId)
      handlers?.onConnect?.(success, errorMessage)
    })

    // TCP secured callback (TLS upgrade result)
    __jstorrent_tcp_on_secured((socketId, success) => {
      const handlers = this.tcpHandlers.get(socketId)
      handlers?.onSecured?.(success)
    })

    // TCP Server listening callback
    __jstorrent_tcp_on_listening((serverId, success, port) => {
      const handlers = this.tcpServerHandlers.get(serverId)
      handlers?.onListening?.(success, port)
    })

    // TCP Server accept callback
    __jstorrent_tcp_on_accept((serverId, socketId, remoteAddr, remotePort) => {
      const handlers = this.tcpServerHandlers.get(serverId)
      handlers?.onAccept?.(socketId, remoteAddr, remotePort)
    })

    // UDP bound callback
    __jstorrent_udp_on_bound((socketId, success, port) => {
      const handlers = this.udpHandlers.get(socketId)
      handlers?.onBound?.(success, port)
    })

    // UDP message callback
    __jstorrent_udp_on_message((socketId, addr, port, data) => {
      const handlers = this.udpHandlers.get(socketId)
      handlers?.onMessage?.({ addr, port }, new Uint8Array(data))
    })
  }

  // ============================================================
  // TCP Socket Methods
  // ============================================================

  registerTcp(socketId: number, handlers: TcpSocketHandlers): void {
    this.tcpHandlers.set(socketId, handlers)
  }

  updateTcpHandler<K extends keyof TcpSocketHandlers>(
    socketId: number,
    key: K,
    handler: TcpSocketHandlers[K],
  ): void {
    const existing = this.tcpHandlers.get(socketId) || {}
    existing[key] = handler
    this.tcpHandlers.set(socketId, existing)
  }

  unregisterTcp(socketId: number): void {
    this.tcpHandlers.delete(socketId)
  }

  // ============================================================
  // UDP Socket Methods
  // ============================================================

  registerUdp(socketId: number, handlers: UdpSocketHandlers): void {
    this.udpHandlers.set(socketId, handlers)
  }

  updateUdpHandler<K extends keyof UdpSocketHandlers>(
    socketId: number,
    key: K,
    handler: UdpSocketHandlers[K],
  ): void {
    const existing = this.udpHandlers.get(socketId) || {}
    existing[key] = handler
    this.udpHandlers.set(socketId, existing)
  }

  unregisterUdp(socketId: number): void {
    this.udpHandlers.delete(socketId)
  }

  // ============================================================
  // TCP Server Methods
  // ============================================================

  registerTcpServer(serverId: number, handlers: TcpServerHandlers): void {
    this.tcpServerHandlers.set(serverId, handlers)
  }

  updateTcpServerHandler<K extends keyof TcpServerHandlers>(
    serverId: number,
    key: K,
    handler: TcpServerHandlers[K],
  ): void {
    const existing = this.tcpServerHandlers.get(serverId) || {}
    existing[key] = handler
    this.tcpServerHandlers.set(serverId, existing)
  }

  unregisterTcpServer(serverId: number): void {
    this.tcpServerHandlers.delete(serverId)
  }
}

/** Singleton callback manager instance */
export const callbackManager = new CallbackManager()
