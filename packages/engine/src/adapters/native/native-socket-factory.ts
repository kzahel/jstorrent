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
}
