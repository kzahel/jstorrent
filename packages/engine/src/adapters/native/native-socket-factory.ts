/**
 * Native Socket Factory
 *
 * Implements ISocketFactory using native bindings.
 */

import type { ISocketFactory, ITcpSocket, IUdpSocket, ITcpServer } from '../../interfaces/socket'
import { callbackManager } from './callback-manager'
import { NativeTcpSocket } from './native-tcp-socket'
import { NativeUdpSocket } from './native-udp-socket'
import { NativeTcpServer } from './native-tcp-server'
import './bindings.d.ts'

export class NativeSocketFactory implements ISocketFactory {
  private nextId = 1

  constructor() {
    // Initialize the callback manager on first factory creation
    callbackManager.initialize()
  }

  /**
   * Get the next unique ID for sockets/servers.
   */
  private getNextId(): number {
    return this.nextId++
  }

  /**
   * Create a new TCP socket.
   * If host and port are provided, connects immediately.
   */
  async createTcpSocket(host?: string, port?: number): Promise<ITcpSocket> {
    const socket = new NativeTcpSocket(this.getNextId())

    if (host && port) {
      await socket.connect(port, host)
    }

    return socket
  }

  /**
   * Create a new UDP socket bound to the specified address and port.
   */
  async createUdpSocket(bindAddr: string = '', bindPort: number = 0): Promise<IUdpSocket> {
    const socketId = this.getNextId()
    const socket = new NativeUdpSocket(socketId)

    return new Promise((resolve, reject) => {
      callbackManager.updateUdpHandler(socketId, 'onBound', (success, _port) => {
        if (success) {
          resolve(socket)
        } else {
          reject(new Error('Failed to bind UDP socket'))
        }
      })
      __jstorrent_udp_bind(socketId, bindAddr, bindPort)
    })
  }

  /**
   * Create a TCP server.
   */
  createTcpServer(): ITcpServer {
    const serverId = this.getNextId()
    return new NativeTcpServer(serverId, () => this.getNextId())
  }

  /**
   * Wrap a native socket into ITcpSocket.
   * Only supports wrapping NativeTcpSocket instances.
   */
  wrapTcpSocket(socket: unknown): ITcpSocket {
    if (socket instanceof NativeTcpSocket) {
      return socket
    }
    throw new Error('wrapTcpSocket only supports NativeTcpSocket instances')
  }

  /**
   * Batch send data to multiple sockets in a single FFI call.
   * Reduces FFI overhead when flushing many peer connections at end of tick.
   */
  batchSend(sends: Array<{ socketId: number; data: Uint8Array }>): void {
    if (sends.length === 0) return

    // Pack into single buffer
    // Format: [count: u32 LE] then for each: [socketId: u32 LE] [len: u32 LE] [data: len bytes]
    let totalSize = 4 // count
    for (const { data } of sends) {
      totalSize += 8 + data.length // socketId + len + data
    }

    const packed = new ArrayBuffer(totalSize)
    const view = new DataView(packed)
    const bytes = new Uint8Array(packed)

    let offset = 0
    view.setUint32(offset, sends.length, true)
    offset += 4

    for (const { socketId, data } of sends) {
      view.setUint32(offset, socketId, true)
      offset += 4
      view.setUint32(offset, data.length, true)
      offset += 4
      bytes.set(data, offset)
      offset += data.length
    }

    __jstorrent_tcp_send_batch(packed)
  }

  /**
   * Signal backpressure to pause/resume TCP reads on the native side.
   * When active=true, Kotlin pauses reads on all TCP connections to prevent
   * unbounded buffer growth when JS processing can't keep up.
   */
  setBackpressure(active: boolean): void {
    __jstorrent_tcp_set_backpressure(active)
  }

  /**
   * Flush accumulated native callbacks at start of engine tick.
   * Drains all pending I/O callbacks (TCP, UDP, disk, hash) that have been
   * queued by native I/O threads, delivering them in batched FFI calls.
   * This reduces FFI crossings from 60+ per tick to just 4.
   */
  flushCallbacks(): void {
    const g = globalThis as Record<string, unknown>

    // Phase 3: TCP data
    if (typeof g.__jstorrent_tcp_flush === 'function') {
      ;(g.__jstorrent_tcp_flush as () => void)()
    }

    // Phase 4: UDP messages
    if (typeof g.__jstorrent_udp_flush === 'function') {
      ;(g.__jstorrent_udp_flush as () => void)()
    }

    // Phase 4: Disk write results
    if (typeof g.__jstorrent_file_flush === 'function') {
      ;(g.__jstorrent_file_flush as () => void)()
    }

    // Phase 4: Hash results
    if (typeof g.__jstorrent_hash_flush === 'function') {
      ;(g.__jstorrent_hash_flush as () => void)()
    }
  }
}
