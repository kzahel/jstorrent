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

    // Phase 3: Batch TCP data receiver
    // Called by Kotlin when __jstorrent_tcp_flush() drains the pending queue.
    // Format: [count: u32 LE] then for each: [socketId: u32 LE] [len: u32 LE] [data: len bytes]
    ;(globalThis as Record<string, unknown>).__jstorrent_tcp_dispatch_batch = (
      packed: ArrayBuffer,
    ) => {
      const view = new DataView(packed)
      let offset = 0
      const count = view.getUint32(offset, true)
      offset += 4

      for (let i = 0; i < count; i++) {
        const socketId = view.getUint32(offset, true)
        offset += 4
        const len = view.getUint32(offset, true)
        offset += 4
        const data = new Uint8Array(packed, offset, len)
        offset += len

        // Dispatch to socket handler (just buffers, no processing per Phase 1)
        const handlers = this.tcpHandlers.get(socketId)
        handlers?.onData?.(data)
      }
    }

    // Phase 4: Batch UDP message receiver
    // Called by Kotlin when __jstorrent_udp_flush() drains the pending queue.
    // Format: [count: u32 LE] then for each:
    //   [socketId: u32 LE] [srcPort: u16 LE] [addrLen: u8] [addr: bytes] [dataLen: u32 LE] [data: bytes]
    ;(globalThis as Record<string, unknown>).__jstorrent_udp_dispatch_batch = (
      packed: ArrayBuffer,
    ) => {
      const view = new DataView(packed)
      const bytes = new Uint8Array(packed)
      let offset = 0
      const count = view.getUint32(offset, true)
      offset += 4

      const textDecoder = new TextDecoder()

      for (let i = 0; i < count; i++) {
        const socketId = view.getUint32(offset, true)
        offset += 4
        const srcPort = view.getUint16(offset, true)
        offset += 2
        const addrLen = bytes[offset]
        offset += 1
        const addr = textDecoder.decode(bytes.subarray(offset, offset + addrLen))
        offset += addrLen
        const dataLen = view.getUint32(offset, true)
        offset += 4
        const data = new Uint8Array(packed, offset, dataLen)
        offset += dataLen

        // Dispatch to socket handler
        const handlers = this.udpHandlers.get(socketId)
        handlers?.onMessage?.({ addr, port: srcPort }, data)
      }
    }

    // Phase 4: Batch disk write result receiver
    // Called by Kotlin when __jstorrent_file_flush() drains the pending queue.
    // Format: [count: u32 LE] then for each:
    //   [callbackIdLen: u8] [callbackId: bytes] [bytesWritten: i32 LE] [resultCode: u8]
    ;(globalThis as Record<string, unknown>).__jstorrent_file_dispatch_batch = (
      packed: ArrayBuffer,
    ) => {
      const view = new DataView(packed)
      const bytes = new Uint8Array(packed)
      let offset = 0
      const count = view.getUint32(offset, true)
      offset += 4

      const textDecoder = new TextDecoder()
      const callbacks = (
        globalThis as unknown as {
          __jstorrent_file_write_callbacks?: Record<string, (bw: number, rc: number) => void>
        }
      ).__jstorrent_file_write_callbacks

      for (let i = 0; i < count; i++) {
        const callbackIdLen = bytes[offset]
        offset += 1
        const callbackId = textDecoder.decode(bytes.subarray(offset, offset + callbackIdLen))
        offset += callbackIdLen
        const bytesWritten = view.getInt32(offset, true)
        offset += 4
        const resultCode = bytes[offset]
        offset += 1

        // Dispatch to registered callback (same as __jstorrent_file_dispatch_write_result)
        const callback = callbacks?.[callbackId]
        if (callback) {
          delete callbacks[callbackId]
          callback(bytesWritten, resultCode)
        }
      }
    }

    // Phase 4: Batch hash result receiver
    // Called by Kotlin when __jstorrent_hash_flush() drains the pending queue.
    // Format: [count: u32 LE] then for each:
    //   [callbackIdLen: u8] [callbackId: bytes] [hashLen: u8] [hash: bytes]
    ;(globalThis as Record<string, unknown>).__jstorrent_hash_dispatch_batch = (
      packed: ArrayBuffer,
    ) => {
      const bytes = new Uint8Array(packed)
      const view = new DataView(packed)
      let offset = 0
      const count = view.getUint32(offset, true)
      offset += 4

      const textDecoder = new TextDecoder()
      const callbacks = (
        globalThis as unknown as {
          __jstorrent_hash_callbacks?: Record<string, (hash: ArrayBuffer) => void>
        }
      ).__jstorrent_hash_callbacks

      for (let i = 0; i < count; i++) {
        const callbackIdLen = bytes[offset]
        offset += 1
        const callbackId = textDecoder.decode(bytes.subarray(offset, offset + callbackIdLen))
        offset += callbackIdLen
        const hashLen = bytes[offset]
        offset += 1
        // Create a copy of the hash data to avoid issues with the packed buffer
        const hash = packed.slice(offset, offset + hashLen)
        offset += hashLen

        // Dispatch to registered callback (same as __jstorrent_hash_dispatch_result)
        const callback = callbacks?.[callbackId]
        if (callback) {
          delete callbacks[callbackId]
          callback(hash)
        }
      }
    }

    // TCP data callback (legacy per-event dispatch, still used when not batching)
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
