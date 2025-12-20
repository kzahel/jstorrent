import { ITcpSocket } from '../../interfaces/socket'
import { DaemonConnection } from './daemon-connection'
import { IDaemonSocketManager } from './internal-types'

// Opcodes
const OP_TCP_CONNECT = 0x10
const OP_TCP_SEND = 0x12
const OP_TCP_RECV = 0x13
const OP_TCP_CLOSE = 0x14
const OP_TCP_SECURE = 0x19
const PROTOCOL_VERSION = 1

export class DaemonTcpSocket implements ITcpSocket {
  private onDataCb: ((data: Uint8Array) => void) | null = null
  private onCloseCb: ((hadError: boolean) => void) | null = null
  private onErrorCb: ((err: Error) => void) | null = null
  private closed = false
  private _isSecure = false

  // Remote address info (available for accepted connections)
  public remoteAddress?: string
  public remotePort?: number

  get isSecure(): boolean {
    return this._isSecure
  }

  constructor(
    private id: number,
    private daemon: DaemonConnection,
    private manager: IDaemonSocketManager,
    options?: { remoteAddress?: string; remotePort?: number },
  ) {
    if (options) {
      this.remoteAddress = options.remoteAddress
      this.remotePort = options.remotePort
    }
    this.manager.registerHandler(
      id,
      (payload, msgType) => {
        if (msgType === OP_TCP_RECV) {
          // Payload: socketId(4) + data
          if (this.onDataCb) {
            this.onDataCb(payload.slice(4))
          }
        } else if (msgType === OP_TCP_CLOSE) {
          // Payload: socketId(4), reason(1), errno(4)
          // reason != 0 indicates error (including IO connection lost)
          if (this.closed) return
          this.closed = true
          const hadError = payload.length >= 5 && payload[4] !== 0
          if (this.onCloseCb) {
            this.onCloseCb(hadError)
          }
          this.manager.unregisterHandler(this.id)
        }
      },
      'tcp',
    )
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

  async secure(hostname: string, options?: { skipValidation?: boolean }): Promise<void> {
    if (this._isSecure) {
      throw new Error('Socket is already secure')
    }
    if (this.closed) {
      throw new Error('Socket is closed')
    }

    const reqId = this.manager.nextRequestId()
    const flags = options?.skipValidation ? 1 : 0

    // Payload: socketId(4) + flags(1) + hostname(utf8)
    const hostBytes = new TextEncoder().encode(hostname)
    const buffer = new ArrayBuffer(4 + 1 + hostBytes.length)
    const view = new DataView(buffer)
    view.setUint32(0, this.id, true)
    view.setUint8(4, flags)
    new Uint8Array(buffer, 5).set(hostBytes)

    this.daemon.sendFrame(this.manager.packEnvelope(OP_TCP_SECURE, reqId, new Uint8Array(buffer)))

    // 30s timeout for TLS handshake
    await this.manager.waitForResponse(reqId, 30000)
    this._isSecure = true
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
    if (this.closed) return
    this.closed = true

    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, this.id, true)

    const env = new ArrayBuffer(8 + 4)
    const envView = new DataView(env)
    envView.setUint8(0, PROTOCOL_VERSION)
    envView.setUint8(1, OP_TCP_CLOSE)
    envView.setUint16(2, 0, true)
    envView.setUint32(4, 0, true)
    new Uint8Array(env, 8).set(new Uint8Array(buffer))

    try {
      this.daemon.sendFrame(env)
    } catch {
      // Ignore send errors during close (connection may already be dead)
    }
    this.manager.unregisterHandler(this.id)
    if (this.onCloseCb) this.onCloseCb(false)
  }
}
