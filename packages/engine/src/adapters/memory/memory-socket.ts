import { ISocketFactory, ITcpSocket, IUdpSocket } from '../../interfaces/socket'

export class MemorySocket implements ITcpSocket {
  public connected = false
  public peer: MemorySocket | null = null
  private onDataCb: ((data: Uint8Array) => void) | null = null
  private onCloseCb: ((hadError: boolean) => void) | null = null
  private onErrorCb: ((err: Error) => void) | null = null
  private onConnectCb: (() => void) | null = null

  constructor(peer?: MemorySocket) {
    if (peer) {
      this.peer = peer
      peer.peer = this
      this.connected = true
      peer.connected = true
    }
  }

  connect(_port: number, _host: string): Promise<void> {
    // In a real scenario, we might look up a peer by address.
    // For this simple implementation, we assume the socket is already paired or will be paired manually.
    // If we want to simulate connection delay:
    return new Promise((resolve) => {
      setTimeout(() => {
        this.connected = true
        if (this.onConnectCb) this.onConnectCb()
        resolve()
      }, 10)
    })
  }

  send(data: Uint8Array): void {
    if (!this.connected || !this.peer) {
      console.warn('MemorySocket: Attempting to send data on disconnected socket')
      return
    }
    // Simulate network delay?
    setTimeout(() => {
      if (this.peer && this.peer.onDataCb) {
        // Copy buffer to avoid shared memory issues if the sender modifies it later
        const copy = new Uint8Array(data)
        // console.error(`MemorySocket: Sending ${data.length} bytes to peer`)
        this.peer.onDataCb(copy)
      } else {
        console.error('MemorySocket: Peer has no onDataCb')
      }
    }, 1)
  }

  onData(cb: (data: Uint8Array) => void): void {
    this.onDataCb = cb
  }

  onClose(cb: (hadError: boolean) => void): void {
    this.onCloseCb = cb
  }

  onError(cb: (err: Error) => void): void {
    this.onErrorCb = cb
  }

  onConnect(cb: () => void): void {
    this.onConnectCb = cb
  }

  close(): void {
    if (this.connected) {
      this.connected = false
      if (this.onCloseCb) this.onCloseCb(false)
      if (this.peer && this.peer.connected) {
        this.peer.close()
      }
    }
  }

  // Helper to manually trigger error
  emitError(err: Error) {
    if (this.onErrorCb) this.onErrorCb(err)
  }
}

export class MemorySocketFactory implements ISocketFactory {
  static createPair(): [MemorySocket, MemorySocket] {
    const a = new MemorySocket()
    const b = new MemorySocket(a)
    return [a, b]
  }

  async createTcpSocket(_host?: string, _port?: number): Promise<ITcpSocket> {
    // Return a disconnected socket? Or simulate connection?
    // For now, return a disconnected socket.
    return new MemorySocket()
  }

  async createUdpSocket(_bindAddr?: string, _bindPort?: number): Promise<IUdpSocket> {
    throw new Error('UDP not supported in MemorySocketFactory yet')
  }

  createTcpServer() {
    return {
      on: () => {},
      listen: () => {},
      address: () => ({ port: 0 }),
      close: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapTcpSocket(socket: any): ITcpSocket {
    return socket as ITcpSocket
  }
}
