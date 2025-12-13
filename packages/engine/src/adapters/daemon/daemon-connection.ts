export interface IDaemonConnection {
  connect(info: { port: number; token: string }): Promise<void>
  sendFrame(frame: ArrayBuffer): void
  onFrame(cb: (frame: ArrayBuffer) => void): void
  close(): void
  readonly ready: boolean
}

export interface DaemonCredentials {
  token: string
  extensionId: string
  installId: string
}

export type CredentialsGetter = () => Promise<DaemonCredentials>

export class DaemonConnection {
  private baseUrl: string
  private ws: WebSocket | null = null
  private frameHandlers: Array<(f: ArrayBuffer) => void> = []
  private disconnectHandlers: Array<(reason: string) => void> = []
  public ready = false

  // Cached credentials for HTTP requests
  private cachedCredentials: DaemonCredentials | null = null

  // Opcodes
  private static readonly OP_CLIENT_HELLO = 0x01
  private static readonly OP_SERVER_HELLO = 0x02
  private static readonly OP_AUTH = 0x03
  private static readonly OP_AUTH_RESULT = 0x04
  private static readonly OP_ERROR = 0x7f
  private static readonly PROTOCOL_VERSION = 1

  constructor(
    private port: number,
    private host: string = '127.0.0.1',
    private getCredentials?: CredentialsGetter,
    // Direct token for desktop (extensionId/installId will be empty strings)
    private legacyToken?: string,
  ) {
    this.baseUrl = `http://${host}:${port}`
  }

  // Legacy static factory for backwards compatibility
  static async connect(
    port: number,
    authToken: string,
    host: string = '127.0.0.1',
  ): Promise<DaemonConnection> {
    const connection = new DaemonConnection(port, host, undefined, authToken)
    return connection
  }

  async connectWebSocket(): Promise<void> {
    if (this.ready) return

    // Get fresh credentials
    let token: string
    let extensionId: string
    let installId: string

    if (this.getCredentials) {
      const creds = await this.getCredentials()
      this.cachedCredentials = creds
      token = creds.token
      extensionId = creds.extensionId
      installId = creds.installId
    } else if (this.legacyToken) {
      // Desktop mode - token only
      token = this.legacyToken
      extensionId = ''
      installId = ''
    } else {
      throw new Error('No credentials available')
    }

    const url = `ws://${this.host}:${this.port}/io`
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

    // 3. Send AUTH - unified format for all platforms
    // Format: authType(1) + token + '\0' + extensionId + '\0' + installId
    const encoder = new TextEncoder()
    const tokenBytes = encoder.encode(token)
    const extIdBytes = encoder.encode(extensionId)
    const installIdBytes = encoder.encode(installId)

    const authPayload = new Uint8Array(
      1 + tokenBytes.length + 1 + extIdBytes.length + 1 + installIdBytes.length,
    )
    let offset = 0
    authPayload[offset++] = 0 // authType 0
    authPayload.set(tokenBytes, offset)
    offset += tokenBytes.length
    authPayload[offset++] = 0 // null separator
    authPayload.set(extIdBytes, offset)
    offset += extIdBytes.length
    authPayload[offset++] = 0 // null separator
    authPayload.set(installIdBytes, offset)

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

    // TODO: Add auto-reconnect with exponential backoff
    this.ws!.onclose = (ev) => {
      this.notifyDisconnect(`WebSocket closed: code=${ev.code} reason=${ev.reason}`)
    }
    this.ws!.onerror = () => {
      this.notifyDisconnect('WebSocket error')
    }
  }

  sendFrame(frame: ArrayBuffer) {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Daemon connection not ready')
    }
    this.ws.send(frame)
  }

  private sendFrameInternal(frame: ArrayBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Daemon connection not ready')
    }
    this.ws.send(frame)
  }

  onFrame(cb: (f: ArrayBuffer) => void) {
    this.frameHandlers.push(cb)
  }

  onDisconnect(cb: (reason: string) => void) {
    this.disconnectHandlers.push(cb)
  }

  private notifyDisconnect(reason: string) {
    this.ready = false
    for (const h of this.disconnectHandlers) h(reason)
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null // prevent notification on intentional close
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
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

  private getAuthToken(): string {
    if (this.cachedCredentials) {
      return this.cachedCredentials.token
    }
    if (this.legacyToken) {
      return this.legacyToken
    }
    throw new Error('No auth token available')
  }

  private getHttpHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-JST-Auth': this.getAuthToken(),
    }
    if (this.cachedCredentials) {
      headers['X-JST-ExtensionId'] = this.cachedCredentials.extensionId
      headers['X-JST-InstallId'] = this.cachedCredentials.installId
    }
    return headers
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
      ...this.getHttpHeaders(),
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
      ...this.getHttpHeaders(),
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

  /**
   * Make an HTTP request with custom headers.
   * Returns the raw Response object for status code inspection.
   */
  async requestWithHeaders(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: Uint8Array,
  ): Promise<Response> {
    const url = new URL(path, this.baseUrl)

    return fetch(url.toString(), {
      method,
      headers: {
        ...this.getHttpHeaders(),
        ...headers,
      },
      body: body as unknown as BodyInit,
    })
  }

  /**
   * Make an HTTP request with custom headers and return binary data.
   */
  async requestBinaryWithHeaders(
    method: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<Uint8Array> {
    const response = await this.requestWithHeaders(method, path, headers)

    if (!response.ok) {
      throw new Error(`Daemon request failed: ${response.status} ${response.statusText}`)
    }

    return new Uint8Array(await response.arrayBuffer())
  }
}
