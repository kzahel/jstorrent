import * as net from 'net'
import * as dgram from 'dgram'
import { ITcpServer, ITcpSocket, ISocketFactory, IUdpSocket } from '../../interfaces/socket'

export class NodeTcpSocket implements ITcpSocket {
  private socket: net.Socket

  constructor(socket?: net.Socket) {
    this.socket = socket || new net.Socket()
  }

  get remoteAddress(): string | undefined {
    return this.socket.remoteAddress
  }

  get remotePort(): number | undefined {
    return this.socket.remotePort
  }

  connect(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // console.error(`NodeTcpSocket: Connecting to ${host}:${port}`)
      const socket = new net.Socket()
      this.socket = socket

      socket.connect(port, host, () => {
        // console.error(`NodeTcpSocket: Connected to ${host}:${port}`)
        resolve()
      })

      socket.on('error', (err) => {
        console.error(`NodeTcpSocket: Error connecting: ${err.message}`)
        reject(err)
      })
    })
  }

  send(data: Uint8Array): void {
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
    // console.error('NodeTcpSocket: Registering onData listener')
    this.socket.on('data', (data) => {
      // console.error(`NodeTcpSocket: Received ${data.length} bytes from net.Socket`)
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
    // console.error('NodeTcpSocket: Closing socket')
    this.socket.destroy()
  }
}

export class NodeUdpSocket implements IUdpSocket {
  private socket: dgram.Socket

  constructor(socket?: dgram.Socket) {
    this.socket = socket || dgram.createSocket('udp4')
  }

  send(addr: string, port: number, data: Uint8Array): void {
    this.socket.send(data, port, addr, (err) => {
      if (err) {
        console.error(`NodeUdpSocket: Error sending data: ${err.message}`)
      }
    })
  }

  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.socket.on('message', (msg, rinfo) => {
      cb({ addr: rinfo.address, port: rinfo.port }, new Uint8Array(msg))
    })
  }

  close(): void {
    this.socket.close()
  }

  async joinMulticast(group: string): Promise<void> {
    this.socket.addMembership(group)
  }

  async leaveMulticast(group: string): Promise<void> {
    this.socket.dropMembership(group)
  }
}

export class NodeTcpServer implements ITcpServer {
  private server: net.Server

  constructor() {
    this.server = net.createServer()
  }

  listen(port: number, callback?: () => void): void {
    this.server.listen(port, callback)
  }

  address(): { port: number } | null {
    const addr = this.server.address()
    if (addr && typeof addr === 'object' && 'port' in addr) {
      return { port: addr.port }
    }
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: 'connection', cb: (socket: any) => void): void {
    this.server.on(event, cb)
  }

  close(): void {
    this.server.close()
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
    return new NodeUdpSocket()
  }

  createTcpServer(): ITcpServer {
    return new NodeTcpServer()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapTcpSocket(socket: any): ITcpSocket {
    return new NodeTcpSocket(socket)
  }
}
