import { ISocketFactory, ITcpServer, ITcpSocket, IUdpSocket } from '../../interfaces/socket'
import { DaemonConnection } from './daemon-connection'
import { DaemonTcpServer } from './daemon-tcp-server'
import { DaemonTcpSocket } from './daemon-tcp-socket'
import { DaemonUdpSocket } from './daemon-udp-socket'
import { IDaemonSocketManager } from './internal-types'

const PROTOCOL_VERSION = 1

export class DaemonSocketFactory implements ISocketFactory, IDaemonSocketManager {
  private nextSocketIdVal = 1
  private pendingRequests = new Map<
    number,
    { resolve: (v: Uint8Array) => void; reject: (e: Error) => void }
  >()
  private socketHandlers = new Map<number, (payload: Uint8Array, msgType: number) => void>()

  constructor(private daemon: DaemonConnection) {
    this.daemon.onFrame((frame) => this.handleFrame(frame))
  }

  async createTcpSocket(host?: string, port?: number): Promise<ITcpSocket> {
    const socket = new DaemonTcpSocket(this.nextSocketIdVal++, this.daemon, this)
    if (host && port) {
      await socket.connect(port, host)
    }
    return socket
  }

  async createUdpSocket(bindAddr: string = '', bindPort: number = 0): Promise<IUdpSocket> {
    const socketId = this.nextSocketIdVal++
    const reqId = this.nextRequestId()

    // Payload: socketId(4), port(2), bind_addr(string)
    const addrBytes = new TextEncoder().encode(bindAddr)
    const buffer = new ArrayBuffer(4 + 2 + addrBytes.length)
    const view = new DataView(buffer)
    view.setUint32(0, socketId, true)
    view.setUint16(4, bindPort, true)
    new Uint8Array(buffer, 6).set(addrBytes)

    // OP_UDP_BIND = 0x20
    this.daemon.sendFrame(this.packEnvelope(0x20, reqId, new Uint8Array(buffer)))

    await this.waitForResponse(reqId)

    return new DaemonUdpSocket(socketId, this.daemon, this)
  }

  createTcpServer(): ITcpServer {
    const serverId = this.nextSocketIdVal++
    return new DaemonTcpServer(serverId, this.daemon, this)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapTcpSocket(socket: any): ITcpSocket {
    // If the socket is already a DaemonTcpSocket (from DaemonTcpServer), return it as-is
    if (socket instanceof DaemonTcpSocket) {
      return socket
    }
    // For other socket types, this would need to be implemented
    throw new Error('wrapTcpSocket only supports DaemonTcpSocket')
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
          reject(new Error(`Operation failed with status ${status} `))
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

  waitForResponse(reqId: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(reqId, { resolve: resolve as (v: Uint8Array) => void, reject })
    })
  }

  nextRequestId() {
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
