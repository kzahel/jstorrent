/**
 * Control Connection
 *
 * Lightweight WebSocket connection to /control endpoint.
 * Receives ROOTS_CHANGED and EVENT broadcasts from the daemon.
 *
 * Unlike the extension's DaemonBridge, this assumes:
 * - Port is already known (injected via config)
 * - Token is pre-shared (no pairing dance)
 * - Host is localhost (127.0.0.1 for standalone)
 */

// Protocol opcodes (same as Protocol.kt)
const OP_CLIENT_HELLO = 0x01
const OP_SERVER_HELLO = 0x02
const OP_AUTH = 0x03
const OP_AUTH_RESULT = 0x04
const OP_CTRL_ROOTS_CHANGED = 0xe0
const OP_CTRL_EVENT = 0xe1
const OP_CTRL_OPEN_FOLDER_PICKER = 0xe2

export interface ControlRoot {
  key: string
  uri?: string
  displayName?: string
  available?: boolean
}

export interface ControlEvent {
  event: string
  payload: unknown
}

export type RootsChangedCallback = (roots: ControlRoot[]) => void
export type EventCallback = (event: ControlEvent) => void

export class ControlConnection {
  private ws: WebSocket | null = null
  private rootsChangedCallbacks = new Set<RootsChangedCallback>()
  private eventCallbacks = new Set<EventCallback>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true

  constructor(
    private host: string,
    private port: number,
    private token: string,
  ) {}

  /**
   * Connect to /control WebSocket and authenticate.
   */
  async connect(): Promise<void> {
    this.shouldReconnect = true

    return new Promise((resolve, reject) => {
      const url = `ws://${this.host}:${this.port}/control`
      console.log(`[ControlConnection] Connecting to ${url}`)

      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'

      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Connection timeout'))
      }, 10000)

      ws.onopen = () => {
        // Send CLIENT_HELLO
        ws.send(this.buildFrame(OP_CLIENT_HELLO, 0, new Uint8Array(0)))
      }

      ws.onmessage = (event) => {
        const data = new Uint8Array(event.data as ArrayBuffer)
        const opcode = data[1]

        if (opcode === OP_SERVER_HELLO) {
          // SERVER_HELLO - send AUTH
          // Format: authType(1) + token + \0 + extensionId + \0 + installId
          // For standalone, extensionId and installId are placeholder values
          const encoder = new TextEncoder()
          const tokenBytes = encoder.encode(this.token)
          const extIdBytes = encoder.encode('standalone')
          const installIdBytes = encoder.encode('standalone')

          const payload = new Uint8Array(
            1 + tokenBytes.length + 1 + extIdBytes.length + 1 + installIdBytes.length,
          )
          payload[0] = 0 // authType
          let offset = 1
          payload.set(tokenBytes, offset)
          offset += tokenBytes.length
          payload[offset++] = 0 // null separator
          payload.set(extIdBytes, offset)
          offset += extIdBytes.length
          payload[offset++] = 0 // null separator
          payload.set(installIdBytes, offset)

          ws.send(this.buildFrame(OP_AUTH, 0, payload))
        } else if (opcode === OP_AUTH_RESULT) {
          // AUTH_RESULT
          clearTimeout(timeout)
          const status = data[8]
          if (status === 0) {
            console.log('[ControlConnection] Authenticated')
            this.ws = ws
            this.setupMessageHandler(ws)
            resolve()
          } else {
            ws.close()
            reject(new Error('Auth failed'))
          }
        }
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('WebSocket error'))
      }

      ws.onclose = () => {
        clearTimeout(timeout)
        if (this.ws === ws) {
          this.ws = null
          this.scheduleReconnect()
        }
      }
    })
  }

  /**
   * Close the connection and stop reconnecting.
   */
  close(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * Send request to open folder picker.
   * The daemon will trigger SAF picker and broadcast ROOTS_CHANGED when done.
   */
  requestFolderPicker(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[ControlConnection] Cannot request folder picker: not connected')
      return
    }
    console.log('[ControlConnection] Requesting folder picker')
    this.ws.send(this.buildFrame(OP_CTRL_OPEN_FOLDER_PICKER, 0, new Uint8Array(0)))
  }

  /**
   * Subscribe to ROOTS_CHANGED events.
   */
  onRootsChanged(callback: RootsChangedCallback): () => void {
    this.rootsChangedCallbacks.add(callback)
    return () => this.rootsChangedCallbacks.delete(callback)
  }

  /**
   * Subscribe to native events (TorrentAdded, MagnetAdded, etc).
   */
  onEvent(callback: EventCallback): () => void {
    this.eventCallbacks.add(callback)
    return () => this.eventCallbacks.delete(callback)
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────────────────────────────────

  private setupMessageHandler(ws: WebSocket): void {
    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer)
      const opcode = data[1]

      if (opcode === OP_CTRL_ROOTS_CHANGED) {
        this.handleRootsChanged(data)
      } else if (opcode === OP_CTRL_EVENT) {
        this.handleEvent(data)
      }
    }

    ws.onclose = () => {
      console.log('[ControlConnection] Disconnected')
      if (this.ws === ws) {
        this.ws = null
        this.scheduleReconnect()
      }
    }

    ws.onerror = () => {
      console.error('[ControlConnection] WebSocket error')
    }
  }

  private handleRootsChanged(frame: Uint8Array): void {
    try {
      const payload = frame.slice(8)
      const json = new TextDecoder().decode(payload)
      const roots = JSON.parse(json) as ControlRoot[]
      console.log('[ControlConnection] Roots changed:', roots.length)

      for (const callback of this.rootsChangedCallbacks) {
        try {
          callback(roots)
        } catch (e) {
          console.error('[ControlConnection] Callback error:', e)
        }
      }
    } catch (e) {
      console.error('[ControlConnection] Failed to parse ROOTS_CHANGED:', e)
    }
  }

  private handleEvent(frame: Uint8Array): void {
    try {
      const payload = frame.slice(8)
      const json = new TextDecoder().decode(payload)
      const event = JSON.parse(json) as ControlEvent
      console.log('[ControlConnection] Event:', event.event)

      for (const callback of this.eventCallbacks) {
        try {
          callback(event)
        } catch (e) {
          console.error('[ControlConnection] Callback error:', e)
        }
      }
    } catch (e) {
      console.error('[ControlConnection] Failed to parse EVENT:', e)
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return
    if (this.reconnectTimer) return

    console.log('[ControlConnection] Scheduling reconnect in 2s')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldReconnect) {
        this.connect().catch((e) => {
          console.error('[ControlConnection] Reconnect failed:', e)
        })
      }
    }, 2000)
  }

  private buildFrame(opcode: number, requestId: number, payload: Uint8Array): ArrayBuffer {
    const frame = new Uint8Array(8 + payload.length)
    frame[0] = 1 // version
    frame[1] = opcode
    // bytes 2-3: flags (0)
    const view = new DataView(frame.buffer)
    view.setUint32(4, requestId, true) // little-endian
    frame.set(payload, 8)
    return frame.buffer
  }
}
