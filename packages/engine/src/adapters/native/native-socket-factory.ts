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
}
