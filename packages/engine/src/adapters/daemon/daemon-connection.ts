export class DaemonConnection {
  private baseUrl: string
  private ws: WebSocket | null = null
  private frameHandlers: Array<(f: ArrayBuffer) => void> = []
  public ready = false

  // Opcodes
  private static readonly OP_CLIENT_HELLO = 0x01
  private static readonly OP_SERVER_HELLO = 0x02
  private static readonly OP_AUTH = 0x03
  private static readonly OP_AUTH_RESULT = 0x04
  private static readonly OP_ERROR = 0x7f
  private static readonly PROTOCOL_VERSION = 1

  constructor(
    private port: number,
    private authToken: string,
  ) {
    this.baseUrl = `http://127.0.0.1:${port}`
  }

  static async connect(port: number, authToken: string): Promise<DaemonConnection> {
    const connection = new DaemonConnection(port, authToken)
    return connection
  }

  async connectWebSocket(): Promise<void> {
    if (this.ready) return

    const url = `ws://127.0.0.1:${this.port}/io`
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'

    await new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => resolve()
      this.ws!.onerror = (_err) => reject(new Error('WebSocket connection failed'))
    })

    // 1. Send CLIENT_HELLO
    this.sendFrameInternal(this.packEnvelope(DaemonConnection.OP_CLIENT_HELLO, 1))

    // 2. Wait for SERVER_HELLO
    await this.waitForOpcode(DaemonConnection.OP_SERVER_HELLO)

    // 3. Send AUTH
    const tokenBytes = new TextEncoder().encode(this.authToken)
    const authPayload = new Uint8Array(1 + tokenBytes.length)
    authPayload[0] = 1 // Token auth
    authPayload.set(tokenBytes, 1)
    this.sendFrameInternal(this.packEnvelope(DaemonConnection.OP_AUTH, 2, authPayload))

    // 4. Wait for AUTH_RESULT
    const authResultFrame = await this.waitForOpcode(DaemonConnection.OP_AUTH_RESULT)
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
        } else if (env.msgType === DaemonConnection.OP_ERROR) {
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

    view.setUint8(0, DaemonConnection.PROTOCOL_VERSION)
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

  async request<T>(
    method: string,
    path: string,
    params?: Record<string, string | number | boolean>,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.append(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      'X-JST-Auth': this.authToken,
    }

    if (body) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      throw new Error(`Daemon request failed: ${response.status} ${response.statusText}`)
    }

    // Handle empty response
    const text = await response.text()
    if (!text) return {} as T

    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
  }

  async requestBinary(
    method: string,
    path: string,
    params?: Record<string, string | number | boolean>,
    body?: Uint8Array,
  ): Promise<Uint8Array> {
    const url = new URL(path, this.baseUrl)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.append(key, String(value))
        }
      }
    }

    const headers: Record<string, string> = {
      'X-JST-Auth': this.authToken,
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body as unknown as BodyInit,
    })

    if (!response.ok) {
      throw new Error(`Daemon request failed: ${response.status} ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  }
}
