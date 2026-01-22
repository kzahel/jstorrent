/**
 * Native TCP Server
 *
 * Implements ITcpServer using native bindings.
 */

import type { ITcpServer, ITcpSocket } from '../../interfaces/socket'
import { callbackManager } from './callback-manager'
import { NativeTcpSocket } from './native-tcp-socket'
import './bindings.d.ts'

export class NativeTcpServer implements ITcpServer {
  private boundPort: number | null = null
  private connectionCallback: ((socket: ITcpSocket) => void) | null = null
  private closed = false

  constructor(
    private readonly serverId: number,

    _getNextSocketId: () => number,
  ) {
    callbackManager.registerTcpServer(serverId, {
      onAccept: (socketId, remoteAddr, remotePort) => {
        if (this.closed) return
        // Create a new NativeTcpSocket for the accepted connection
        const socket = new NativeTcpSocket(socketId, {
          remoteAddress: remoteAddr,
          remotePort: remotePort,
        })
        this.connectionCallback?.(socket)
      },
    })
  }

  /**
   * Start listening on the specified port.
   * Port 0 means any available port.
   */
  listen(port: number, callback?: () => void): void {
    if (this.closed) {
      throw new Error('Server is closed')
    }

    callbackManager.updateTcpServerHandler(this.serverId, 'onListening', (success, boundPort) => {
      if (success) {
        this.boundPort = boundPort
        callback?.()
      } else {
        // Listening failed - could emit an error event if we had one
        console.error('Failed to start TCP server on port', port)
      }
    })

    __jstorrent_tcp_listen(this.serverId, port)
  }

  /**
   * Get the address the server is listening on.
   */
  address(): { port: number } | null {
    return this.boundPort !== null ? { port: this.boundPort } : null
  }

  /**
   * Register a callback for incoming connections.
   */
  on(event: 'connection', cb: (socket: ITcpSocket) => void): void {
    if (event === 'connection') {
      this.connectionCallback = cb
    }
  }

  /**
   * Close the server.
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    __jstorrent_tcp_server_close(this.serverId)
    callbackManager.unregisterTcpServer(this.serverId)
  }
}
