import type { IDaemonConnection } from '@jstorrent/engine'

export interface ITcpSocket {
  send(data: Uint8Array): void
  onData(cb: (data: Uint8Array) => void): void
  close(): void
}

export interface IUdpSocket {
  send(addr: string, port: number, data: Uint8Array): void
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void
  close(): void
}

export interface ISockets {
  createTcpSocket(host: string, port: number): Promise<ITcpSocket>
  createUdpSocket(bindAddr?: string, bindPort?: number): Promise<IUdpSocket>
}

// Opcodes
const OP_TCP_CONNECT = 0x10
// const OP_TCP_CONNECTED = 0x11
const OP_TCP_SEND = 0x12
const OP_TCP_RECV = 0x13
const OP_TCP_CLOSE = 0x14

const OP_UDP_BIND = 0x20
// const OP_UDP_BOUND = 0x21
const OP_UDP_SEND = 0x22
const OP_UDP_RECV = 0x23
const OP_UDP_CLOSE = 0x24

const PROTOCOL_VERSION = 1

export class Sockets implements ISockets {
  private nextSocketId = 1
  private pendingRequests = new Map<
    number,
    { resolve: (v: Uint8Array) => void; reject: (e: Error) => void }
  >()
  private socketHandlers = new Map<number, (payload: Uint8Array, msgType: number) => void>()

  constructor(private daemon: IDaemonConnection) {
    this.daemon.onFrame((frame) => this.handleFrame(frame))
  }

  async createTcpSocket(host: string, port: number): Promise<ITcpSocket> {
    const socketId = this.nextSocketId++
    const reqId = this.nextRequestId()

    // Payload: socketId(4), port(2), hostname(utf8)
    // Note: My previous implementation in ws.rs expected: socketId(4), port(2), hostname
    // Let's match that.
    const hostBytes = new TextEncoder().encode(host)
    const buffer = new ArrayBuffer(4 + 2 + hostBytes.length)
    const view = new DataView(buffer)
    view.setUint32(0, socketId, true)
    view.setUint16(4, port, true)
    new Uint8Array(buffer, 6).set(hostBytes)

    this.daemon.sendFrame(this.packEnvelope(OP_TCP_CONNECT, reqId, new Uint8Array(buffer)))

    await this.waitForResponse(reqId)

    return new TcpSocket(socketId, this.daemon, this)
  }

  async createUdpSocket(bindAddr: string = '', bindPort: number = 0): Promise<IUdpSocket> {
    const socketId = this.nextSocketId++
    const reqId = this.nextRequestId()

    // Payload: socketId(4), port(2), bind_addr(string)
    const addrBytes = new TextEncoder().encode(bindAddr)
    const buffer = new ArrayBuffer(4 + 2 + addrBytes.length)
    const view = new DataView(buffer)
    view.setUint32(0, socketId, true)
    view.setUint16(4, bindPort, true)
    new Uint8Array(buffer, 6).set(addrBytes)

    this.daemon.sendFrame(this.packEnvelope(OP_UDP_BIND, reqId, new Uint8Array(buffer)))

    await this.waitForResponse(reqId)

    return new UdpSocket(socketId, this.daemon, this)
  }

  registerHandler(socketId: number, handler: (payload: Uint8Array, msgType: number) => void) {
    this.socketHandlers.set(socketId, handler)
  }

  unregisterHandler(socketId: number) {
    this.socketHandlers.delete(socketId)
  }

  private handleFrame(frame: ArrayBuffer) {
    const view = new DataView(frame)
    const msgType = view.getUint8(1)
    const reqId = view.getUint32(4, true)
    const payload = new Uint8Array(frame, 8)

    if (this.pendingRequests.has(reqId)) {
      const { resolve, reject } = this.pendingRequests.get(reqId)!
      this.pendingRequests.delete(reqId)

      // Check status in payload for CONNECTED/BOUND
      // Both have status at offset 4 (after socketId)
      if (payload.byteLength >= 5) {
        const status = payload[4]
        if (status === 0) {
          resolve(payload)
        } else {
          reject(new Error(`Operation failed with status ${status}`))
        }
      } else {
        resolve(payload)
      }
      return
    }

    // Socket events
    if (payload.byteLength >= 4) {
      const socketId = new DataView(
        payload.buffer,
        payload.byteOffset,
        payload.byteLength,
      ).getUint32(0, true)
      const handler = this.socketHandlers.get(socketId)
      if (handler) {
        handler(payload, msgType)
      }
    }
  }

  private waitForResponse(reqId: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(reqId, { resolve: resolve as (v: Uint8Array) => void, reject })
    })
  }

  private nextRequestId() {
    return Math.floor(Math.random() * 0xffffffff)
  }

  packEnvelope(msgType: number, reqId: number, payload?: Uint8Array): ArrayBuffer {
    const payloadLen = payload ? payload.byteLength : 0
    const buffer = new ArrayBuffer(8 + payloadLen)
    const view = new DataView(buffer)

    view.setUint8(0, PROTOCOL_VERSION)
    view.setUint8(1, msgType)
    view.setUint16(2, 0, true) // flags
    view.setUint32(4, reqId, true) // request_id

    if (payload) {
      new Uint8Array(buffer, 8).set(payload)
    }

    return buffer
  }
}

class TcpSocket implements ITcpSocket {
  constructor(
    private id: number,
    private daemon: IDaemonConnection,
    private factory: Sockets,
  ) {
    this.factory.registerHandler(id, (payload, msgType) => {
      if (msgType === OP_TCP_RECV) {
        // Payload: socketId(4) + data
        if (this.onDataCb) {
          this.onDataCb(payload.subarray(4))
        }
      }
    })
  }

  private onDataCb: ((data: Uint8Array) => void) | null = null

  send(data: Uint8Array) {
    // Payload: socketId(4) + data
    const buffer = new ArrayBuffer(4 + data.byteLength)
    const view = new DataView(buffer)
    view.setUint32(0, this.id, true)
    new Uint8Array(buffer, 4).set(data)

    // We need access to packEnvelope, but it's private in Sockets.
    // Let's just duplicate it or make it public. I'll duplicate for now to keep Sockets clean-ish.
    // Or better, expose a helper on factory.
    // Actually, I'll just manually pack it here since I know the format.
    const env = new ArrayBuffer(8 + buffer.byteLength)
    const envView = new DataView(env)
    envView.setUint8(0, PROTOCOL_VERSION)
    envView.setUint8(1, OP_TCP_SEND)
    envView.setUint16(2, 0, true)
    envView.setUint32(4, 0, true) // reqId=0 for async send
    new Uint8Array(env, 8).set(new Uint8Array(buffer))

    this.daemon.sendFrame(env)
  }

  onData(cb: (data: Uint8Array) => void) {
    this.onDataCb = cb
  }

  close() {
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, this.id, true)

    const env = new ArrayBuffer(8 + 4)
    const envView = new DataView(env)
    envView.setUint8(0, PROTOCOL_VERSION)
    envView.setUint8(1, OP_TCP_CLOSE)
    envView.setUint16(2, 0, true)
    envView.setUint32(4, 0, true)
    new Uint8Array(env, 8).set(new Uint8Array(buffer))

    this.daemon.sendFrame(env)
    this.factory.unregisterHandler(this.id)
  }
}

class UdpSocket implements IUdpSocket {
  constructor(
    private id: number,
    private daemon: IDaemonConnection,
    private factory: Sockets,
  ) {
    this.factory.registerHandler(id, (payload, msgType) => {
      if (msgType === OP_UDP_RECV) {
        // Payload: socketId(4) + port(2) + addr_len(2) + addr + data
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
        const port = view.getUint16(4, true)
        const addrLen = view.getUint16(6, true)
        const addr = new TextDecoder().decode(payload.slice(8, 8 + addrLen))
        const data = payload.slice(8 + addrLen)

        if (this.onMessageCb) {
          this.onMessageCb({ addr, port }, data)
        }
      }
    })
  }

  private onMessageCb: ((src: { addr: string; port: number }, data: Uint8Array) => void) | null =
    null

  send(addr: string, port: number, data: Uint8Array) {
    // Payload: socketId(4), dest_port(2), dest_addr_len(2), dest_addr, data
    const addrBytes = new TextEncoder().encode(addr)
    const buffer = new ArrayBuffer(4 + 2 + 2 + addrBytes.length + data.byteLength)
    const view = new DataView(buffer)

    view.setUint32(0, this.id, true)
    view.setUint16(4, port, true)
    view.setUint16(6, addrBytes.length, true)
    new Uint8Array(buffer, 8).set(addrBytes)
    new Uint8Array(buffer, 8 + addrBytes.length).set(data)

    const env = new ArrayBuffer(8 + buffer.byteLength)
    const envView = new DataView(env)
    envView.setUint8(0, PROTOCOL_VERSION)
    envView.setUint8(1, OP_UDP_SEND)
    envView.setUint16(2, 0, true)
    envView.setUint32(4, 0, true)
    new Uint8Array(env, 8).set(new Uint8Array(buffer))

    this.daemon.sendFrame(env)
  }

  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void) {
    this.onMessageCb = cb
  }

  close() {
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, this.id, true)

    const env = new ArrayBuffer(8 + 4)
    const envView = new DataView(env)
    envView.setUint8(0, PROTOCOL_VERSION)
    envView.setUint8(1, OP_UDP_CLOSE)
    envView.setUint16(2, 0, true)
    envView.setUint32(4, 0, true)
    new Uint8Array(env, 8).set(new Uint8Array(buffer))

    this.daemon.sendFrame(env)
    this.factory.unregisterHandler(this.id)
  }
}
