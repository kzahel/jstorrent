import * as net from 'net'
import { ITcpSocket, ISocketFactory, IUdpSocket } from '../../interfaces/socket'

export class NodeTcpSocket implements ITcpSocket {
  private socket: net.Socket

  constructor(socket?: net.Socket) {
    this.socket = socket || new net.Socket()
  }

  connect(port: number, host: string): Promise<void> {
    return new Promise((resolve, _reject) => {
      const socket = new net.Socket()
      this.socket = socket

      socket.connect(port, host, () => {
        resolve()
      })

      socket.on('error', (_err) => {
        // Handle error
      })
    })
  }

  send(data: Uint8Array): void {
    this.socket.write(data)
  }

  onData(cb: (data: Uint8Array) => void): void {
    this.socket.on('data', (data) => {
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
}
