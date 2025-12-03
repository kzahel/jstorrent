import { DaemonInfo } from './native-connection'

export interface IDaemonConnection {
  connect(info: DaemonInfo): Promise<void>
  sendFrame(frame: ArrayBuffer): void
  onFrame(cb: (frame: ArrayBuffer) => void): void
  close(): void
  readonly ready: boolean
}

// Opcodes
const OP_CLIENT_HELLO = 0x01
const OP_SERVER_HELLO = 0x02
const OP_AUTH = 0x03
const OP_AUTH_RESULT = 0x04
const OP_ERROR = 0x7f

const PROTOCOL_VERSION = 1

export class DaemonConnection implements IDaemonConnection {
  private ws: WebSocket | null = null
  private frameHandlers: Array<(f: ArrayBuffer) => void> = []
  ready = false

  async connect(info: DaemonInfo): Promise<void> {
    // const url = `ws://127.0.0.1:${info.port}/io`
    debugger
    const url = 'ws://127.0.0.1:7800/io'

    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'

    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve()
      this.ws!.onerror = () => reject(new Error('WebSocket connection failed'))
    })

    // 1. Send CLIENT_HELLO
    this.sendFrameInternal(this.packEnvelope(OP_CLIENT_HELLO, 1))

    // 2. Wait for SERVER_HELLO
    await this.waitForOpcode(OP_SERVER_HELLO)

    // 3. Send AUTH
    // Payload: auth_type(1 byte) + token(utf8)
    const tokenBytes = new TextEncoder().encode(info.token)
    const authPayload = new Uint8Array(1 + tokenBytes.length)
    authPayload[0] = 1 // Token auth
    authPayload.set(tokenBytes, 1)
    this.sendFrameInternal(this.packEnvelope(OP_AUTH, 2, authPayload))

    // 4. Wait for AUTH_RESULT
    const authResultFrame = await this.waitForOpcode(OP_AUTH_RESULT)
    const authResultPayload = this.unpackEnvelope(authResultFrame).payload

    if (authResultPayload.byteLength > 0 && authResultPayload[0] === 0) {
      this.ready = true
    } else {
      throw new Error('Daemon auth failed')
    }

    // Switch to normal message handling
    this.ws!.onmessage = (ev) => {
      const frame = ev.data as ArrayBuffer
      for (const h of this.frameHandlers) h(frame)
    }
  }

  sendFrame(frame: ArrayBuffer) {
    if (!this.ready) throw new Error('Daemon not ready')
    this.ws?.send(frame)
  }

  private sendFrameInternal(frame: ArrayBuffer) {
    this.ws?.send(frame)
  }

  onFrame(cb: (f: ArrayBuffer) => void) {
    this.frameHandlers.push(cb)
  }

  close() {
    this.ws?.close()
    this.ready = false
  }

  private waitForOpcode(expectedOp: number): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const handler = (ev: MessageEvent) => {
        const frame = ev.data as ArrayBuffer
        const env = this.unpackEnvelope(frame)
        if (env.msgType === expectedOp) {
          this.ws!.removeEventListener('message', handler)
          resolve(frame)
        } else if (env.msgType === OP_ERROR) {
          this.ws!.removeEventListener('message', handler)
          reject(new Error(`Received ERROR frame: ${new TextDecoder().decode(env.payload)}`))
        }
      }
      this.ws!.addEventListener('message', handler)
    })
  }

  private packEnvelope(msgType: number, reqId: number, payload?: Uint8Array): ArrayBuffer {
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

  private unpackEnvelope(buffer: ArrayBuffer) {
    const view = new DataView(buffer)
    return {
      version: view.getUint8(0),
      msgType: view.getUint8(1),
      flags: view.getUint16(2, true),
      reqId: view.getUint32(4, true),
      payload: new Uint8Array(buffer, 8),
    }
  }
}
