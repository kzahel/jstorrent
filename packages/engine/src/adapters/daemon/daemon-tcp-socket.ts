import { ITcpSocket } from '../../interfaces/socket'
import { DaemonConnection } from './daemon-connection'
import { IDaemonSocketManager } from './internal-types'

// Opcodes
const OP_TCP_CONNECT = 0x10
const OP_TCP_SEND = 0x12
const OP_TCP_RECV = 0x13
const OP_TCP_CLOSE = 0x14
const PROTOCOL_VERSION = 1

export class DaemonTcpSocket implements ITcpSocket {
  private onDataCb: ((data: Uint8Array) => void) | null = null
  private onCloseCb: ((hadError: boolean) => void) | null = null
  // @ts-expect-error - unused
  private onErrorCb: ((err: Error) => void) | null = null

  constructor(
    private id: number,
    private daemon: DaemonConnection,
    private manager: IDaemonSocketManager,
  ) {
    this.manager.registerHandler(id, (payload, msgType) => {
      if (msgType === OP_TCP_RECV) {
        // Payload: socketId(4) + data
        if (this.onDataCb) {
          this.onDataCb(payload.slice(4))
        }
      }
    })
  }

  async connect(port: number, host: string): Promise<void> {
    const reqId = this.manager.nextRequestId()

    // Payload: socketId(4), port(2), hostname(utf8)
    const hostBytes = new TextEncoder().encode(host)
    const buffer = new ArrayBuffer(4 + 2 + hostBytes.length)
    const view = new DataView(buffer)
    view.setUint32(0, this.id, true)
    view.setUint16(4, port, true)
    new Uint8Array(buffer, 6).set(hostBytes)

    this.daemon.sendFrame(this.manager.packEnvelope(OP_TCP_CONNECT, reqId, new Uint8Array(buffer)))

    await this.manager.waitForResponse(reqId)
  }

  send(data: Uint8Array) {
    // Payload: socketId(4) + data
    const buffer = new ArrayBuffer(4 + data.byteLength)
    const view = new DataView(buffer)
    view.setUint32(0, this.id, true)
    new Uint8Array(buffer, 4).set(data)

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

  onClose(cb: (hadError: boolean) => void) {
    this.onCloseCb = cb
  }

  onError(cb: (err: Error) => void) {
    this.onErrorCb = cb
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
    this.manager.unregisterHandler(this.id)
    if (this.onCloseCb) this.onCloseCb(false)
  }
}
