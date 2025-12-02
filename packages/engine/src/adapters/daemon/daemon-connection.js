export class DaemonConnection {
  constructor(port, authToken) {
    this.port = port
    this.authToken = authToken
    this.ws = null
    this.frameHandlers = []
    this.ready = false
    this.baseUrl = `http://127.0.0.1:${port}`
  }
  static async connect(port, authToken) {
    const connection = new DaemonConnection(port, authToken)
    return connection
  }
  async connectWebSocket() {
    if (this.ready) return
    const url = `ws://127.0.0.1:${this.port}/io`
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'
    await new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve()
      this.ws.onerror = (_err) => reject(new Error('WebSocket connection failed'))
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
    this.ws.onmessage = (ev) => {
      const frame = ev.data
      for (const h of this.frameHandlers) h(frame)
    }
  }
  sendFrame(frame) {
    if (!this.ready) throw new Error('Daemon not ready')
    this.ws?.send(frame)
  }
  sendFrameInternal(frame) {
    this.ws?.send(frame)
  }
  onFrame(cb) {
    this.frameHandlers.push(cb)
  }
  close() {
    this.ws?.close()
    this.ready = false
  }
  waitForOpcode(expectedOp) {
    return new Promise((resolve, reject) => {
      const handler = (ev) => {
        const frame = ev.data
        const env = this.unpackEnvelope(frame)
        if (env.msgType === expectedOp) {
          this.ws.removeEventListener('message', handler)
          resolve(frame)
        } else if (env.msgType === DaemonConnection.OP_ERROR) {
          this.ws.removeEventListener('message', handler)
          reject(new Error(`Received ERROR frame: ${new TextDecoder().decode(env.payload)}`))
        }
      }
      this.ws.addEventListener('message', handler)
    })
  }
  packEnvelope(msgType, reqId, payload) {
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
  unpackEnvelope(buffer) {
    const view = new DataView(buffer)
    return {
      version: view.getUint8(0),
      msgType: view.getUint8(1),
      flags: view.getUint16(2, true),
      reqId: view.getUint32(4, true),
      payload: new Uint8Array(buffer, 8),
    }
  }
  async request(method, path, params, body) {
    const url = new URL(path, this.baseUrl)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.append(key, String(value))
        }
      }
    }
    const headers = {
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
    if (!text) return {}
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  async requestBinary(method, path, params, body) {
    const url = new URL(path, this.baseUrl)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.append(key, String(value))
        }
      }
    }
    const headers = {
      'X-JST-Auth': this.authToken,
    }
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body,
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
  async requestWithHeaders(method, path, headers, body) {
    const url = new URL(path, this.baseUrl)
    return fetch(url.toString(), {
      method,
      headers: {
        'X-JST-Auth': this.authToken,
        ...headers,
      },
      body: body,
    })
  }
  /**
   * Make an HTTP request with custom headers and return binary data.
   */
  async requestBinaryWithHeaders(method, path, headers) {
    const response = await this.requestWithHeaders(method, path, headers)
    if (!response.ok) {
      throw new Error(`Daemon request failed: ${response.status} ${response.statusText}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }
}
// Opcodes
DaemonConnection.OP_CLIENT_HELLO = 0x01
DaemonConnection.OP_SERVER_HELLO = 0x02
DaemonConnection.OP_AUTH = 0x03
DaemonConnection.OP_AUTH_RESULT = 0x04
DaemonConnection.OP_ERROR = 0x7f
DaemonConnection.PROTOCOL_VERSION = 1
