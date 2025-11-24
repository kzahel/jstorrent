import * as net from 'net'
import { ITcpSocket, ISocketFactory, IUdpSocket } from '../../interfaces/socket'

export class NodeTcpSocket implements ITcpSocket {
  private socket: net.Socket

  constructor(socket?: net.Socket) {
    this.socket = socket || new net.Socket()
  }

  connect(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.error(`NodeTcpSocket: Connecting to ${host}:${port}`)
      const socket = new net.Socket()
      this.socket = socket

      socket.connect(port, host, () => {
        console.error(`NodeTcpSocket: Connected to ${host}:${port}`)
        resolve()
      })

      socket.on('error', (err) => {
        console.error(`NodeTcpSocket: Error connecting: ${err.message}`)
        reject(err)
      })

      // We must attach a data listener or pause/resume to ensure we don't lose data?
      // Node sockets start in paused mode if no data listener?
      // Actually, if we don't attach 'data', it might flow if we don't pause?
      // "The socket is created in 'paused' mode."
    })
  }

  send(data: Uint8Array): void {
    // console.error(`NodeTcpSocket: Sending ${data.length} bytes`)
    if (this.socket.destroyed || !this.socket.writable) {
      console.error('NodeTcpSocket: Socket not writable, skipping send')
      return
    }
    try {
      this.socket.write(data, (err) => {
        if (err) {
          console.error(`NodeTcpSocket: Error sending data: ${err.message}`)
        }
      })
    } catch (err) {
      console.error(
        `NodeTcpSocket: Exception sending data: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  onData(cb: (data: Uint8Array) => void): void {
    console.error('NodeTcpSocket: Registering onData listener')
    this.socket.on('data', (data) => {
      console.error(`NodeTcpSocket: Received ${data.length} bytes from net.Socket`)
      cb(new Uint8Array(data))
    })
  }

  onClose(cb: (hadError: boolean) => void): void {
    this.socket.on('close', cb)
  }

  onError(cb: (err: Error) => void): void {
    this.socket.on('error', cb)
  }

  close(): void {
    console.error('NodeTcpSocket: Closing socket')
    this.socket.destroy()
  }
}

export class NodeSocketFactory implements ISocketFactory {
  async createTcpSocket(host?: string, port?: number): Promise<ITcpSocket> {
    const socket = new NodeTcpSocket()
    if (host && port) {
      await socket.connect(port, host)
    }
    return socket
  }

  async createUdpSocket(_bindAddr?: string, _bindPort?: number): Promise<IUdpSocket> {
    throw new Error('UDP not implemented for Node adapter yet')
  }

  createTcpServer(): net.Server {
    return net.createServer()
  }
}
