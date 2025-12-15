import { IUdpSocket } from '../../interfaces/socket'
import { DaemonConnection } from './daemon-connection'
import { IDaemonSocketManager } from './internal-types'

// Opcodes
const OP_UDP_SEND = 0x22
const OP_UDP_RECV = 0x23
const OP_UDP_CLOSE = 0x24
const OP_UDP_JOIN_MULTICAST = 0x25
const OP_UDP_LEAVE_MULTICAST = 0x26
const PROTOCOL_VERSION = 1

export class DaemonUdpSocket implements IUdpSocket {
  private onMessageCb: ((src: { addr: string; port: number }, data: Uint8Array) => void) | null =
    null
  private closed = false

  constructor(
    private id: number,
    private daemon: DaemonConnection,
    private manager: IDaemonSocketManager,
  ) {
    this.manager.registerHandler(
      id,
      (payload, msgType) => {
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
        } else if (msgType === OP_UDP_CLOSE) {
          // Socket was closed (either by daemon or synthetic from IO disconnect)
          this.closed = true
          this.manager.unregisterHandler(this.id)
        }
      },
      'udp',
    )
  }

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
    if (this.closed) return
    this.closed = true

    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, this.id, true)

    const env = new ArrayBuffer(8 + 4)
    const envView = new DataView(env)
    envView.setUint8(0, PROTOCOL_VERSION)
    envView.setUint8(1, OP_UDP_CLOSE)
    envView.setUint16(2, 0, true)
    envView.setUint32(4, 0, true)
    new Uint8Array(env, 8).set(new Uint8Array(buffer))

    try {
      this.daemon.sendFrame(env)
    } catch {
      // Ignore send errors during close (connection may already be dead)
    }
    this.manager.unregisterHandler(this.id)
  }

  async joinMulticast(group: string): Promise<void> {
    // Payload: socketId(4) + groupAddr(string)
    const groupBytes = new TextEncoder().encode(group)
    const buffer = new ArrayBuffer(4 + groupBytes.length)
    const view = new DataView(buffer)

    view.setUint32(0, this.id, true)
    new Uint8Array(buffer, 4).set(groupBytes)

    const env = new ArrayBuffer(8 + buffer.byteLength)
    const envView = new DataView(env)
    envView.setUint8(0, PROTOCOL_VERSION)
    envView.setUint8(1, OP_UDP_JOIN_MULTICAST)
    envView.setUint16(2, 0, true)
    envView.setUint32(4, 0, true)
    new Uint8Array(env, 8).set(new Uint8Array(buffer))

    this.daemon.sendFrame(env)
  }

  async leaveMulticast(group: string): Promise<void> {
    // Payload: socketId(4) + groupAddr(string)
    const groupBytes = new TextEncoder().encode(group)
    const buffer = new ArrayBuffer(4 + groupBytes.length)
    const view = new DataView(buffer)

    view.setUint32(0, this.id, true)
    new Uint8Array(buffer, 4).set(groupBytes)

    const env = new ArrayBuffer(8 + buffer.byteLength)
    const envView = new DataView(env)
    envView.setUint8(0, PROTOCOL_VERSION)
    envView.setUint8(1, OP_UDP_LEAVE_MULTICAST)
    envView.setUint16(2, 0, true)
    envView.setUint32(4, 0, true)
    new Uint8Array(env, 8).set(new Uint8Array(buffer))

    this.daemon.sendFrame(env)
  }
}
