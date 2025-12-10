/**
 * Daemon Bridge
 *
 * Simplified connection management for both desktop and ChromeOS.
 * Replaces the complex IOBridge state machine with 3 simple states.
 */

import type { Platform } from './platform'
import { detectPlatform } from './platform'
import type { DaemonInfo, DownloadRoot } from './native-connection'
import { getOrCreateInstallId } from './install-id'

// Re-export types for convenience
export type { DaemonInfo, DownloadRoot } from './native-connection'

// ============================================================================
// Types
// ============================================================================

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface DaemonBridgeState {
  status: ConnectionStatus
  platform: Platform
  daemonInfo: DaemonInfo | null
  roots: DownloadRoot[]
  lastError: string | null
}

export interface NativeEvent {
  event: string
  payload: unknown
}

export type StateListener = (state: DaemonBridgeState) => void
export type EventListener = (event: NativeEvent) => void

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEY_TOKEN = 'android:authToken'
const STORAGE_KEY_PORT = 'android:daemonPort'
const STORAGE_KEY_HAS_CONNECTED = 'daemon:hasConnectedSuccessfully'

// ============================================================================
// DaemonBridge Class
// ============================================================================

export class DaemonBridge {
  private state: DaemonBridgeState
  private stateListeners = new Set<StateListener>()
  private eventListeners = new Set<EventListener>()

  // Platform-specific
  private nativePort: chrome.runtime.Port | null = null
  private ws: WebSocket | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    const platform = detectPlatform()
    this.state = {
      status: 'disconnected',
      platform,
      daemonInfo: null,
      roots: [],
      lastError: null,
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  getState(): DaemonBridgeState {
    return this.state
  }

  getPlatform(): Platform {
    return this.state.platform
  }

  subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /**
   * Attempt to connect to the daemon.
   * Returns true if connection succeeded.
   */
  async connect(): Promise<boolean> {
    this.updateState({ status: 'connecting', lastError: null })

    try {
      if (this.state.platform === 'desktop') {
        await this.connectDesktop()
      } else {
        await this.connectChromeos()
      }

      await chrome.storage.local.set({ [STORAGE_KEY_HAS_CONNECTED]: true })
      return true
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error'
      this.updateState({ status: 'disconnected', lastError: error })
      return false
    }
  }

  /**
   * Disconnect from the daemon.
   */
  disconnect(): void {
    this.cleanup()
    this.updateState({
      status: 'disconnected',
      daemonInfo: null,
      roots: [],
    })
  }

  /**
   * Check if we've ever successfully connected (for install prompt logic).
   */
  async hasEverConnected(): Promise<boolean> {
    const result = await chrome.storage.local.get(STORAGE_KEY_HAS_CONNECTED)
    return result[STORAGE_KEY_HAS_CONNECTED] === true
  }

  /**
   * Trigger Android app launch (ChromeOS only).
   * Opens the pairing intent and then retries connection.
   */
  async triggerLaunch(): Promise<boolean> {
    if (this.state.platform !== 'chromeos') return false

    try {
      const token = await this.getOrCreateToken()
      const intentUrl = `intent://pair?token=${encodeURIComponent(token)}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: intentUrl })
      } else {
        await chrome.tabs.create({ url: intentUrl })
      }

      // After launching, poll for connection (daemon may take a moment to start)
      this.updateState({ status: 'connecting', lastError: null })
      this.pollForConnection()

      return true
    } catch (e) {
      console.error('[DaemonBridge] Failed to trigger launch:', e)
      return false
    }
  }

  /**
   * Poll for daemon connection after launch.
   */
  private async pollForConnection(): Promise<void> {
    const maxAttempts = 30 // 30 seconds max
    const pollInterval = 1000 // 1 second

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const port = await this.findDaemonPort()
        if (port) {
          const paired = await this.checkPaired(port)
          if (paired) {
            // Found paired daemon, complete connection
            const token = await this.getOrCreateToken()
            const roots = await this.fetchRoots(port, token)
            await this.connectWebSocket(port, token)

            this.updateState({
              status: 'connected',
              daemonInfo: { port, token, version: 1, roots, host: '100.115.92.2' },
              roots,
              lastError: null,
            })

            await chrome.storage.local.set({ [STORAGE_KEY_HAS_CONNECTED]: true })
            this.startHealthCheck(port)
            console.log('[DaemonBridge] Connected after launch')
            return
          }
        }
      } catch (e) {
        // Keep polling
      }

      await new Promise((r) => setTimeout(r, pollInterval))
    }

    // Timed out
    this.updateState({
      status: 'disconnected',
      lastError: 'Launch timed out - daemon did not respond',
    })
  }

  /**
   * Trigger folder picker.
   * Desktop: via native messaging
   * ChromeOS: via Android intent, returns when ROOTS_CHANGED received
   */
  async pickDownloadFolder(): Promise<DownloadRoot | null> {
    if (this.state.platform === 'desktop') {
      return this.pickFolderDesktop()
    } else {
      return this.pickFolderChromeos()
    }
  }

  // ==========================================================================
  // Desktop Implementation
  // ==========================================================================

  private async connectDesktop(): Promise<void> {
    const installId = await getOrCreateInstallId()

    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connectNative('com.jstorrent.native')

      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          port.disconnect()
          reject(new Error('Handshake timeout'))
        }
      }, 10000)

      port.onDisconnect.addListener(() => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          const error = chrome.runtime.lastError?.message || 'Disconnected'
          reject(new Error(error))
        } else {
          // Disconnected after successful connection
          this.handleDisconnect()
        }
      })

      port.onMessage.addListener((msg: unknown) => {
        if (!resolved && this.isDaemonInfoMessage(msg)) {
          resolved = true
          clearTimeout(timeout)

          const payload = (msg as { payload: DaemonInfo }).payload
          this.nativePort = port
          this.updateState({
            status: 'connected',
            daemonInfo: {
              port: payload.port,
              token: payload.token,
              version: payload.version ?? 1,
              roots: payload.roots || [],
            },
            roots: payload.roots || [],
          })

          resolve()
        } else if (resolved) {
          // Post-connection messages
          this.handleDesktopMessage(msg)
        }
      })

      // Send handshake
      port.postMessage({
        op: 'handshake',
        extensionId: chrome.runtime.id,
        installId,
        id: crypto.randomUUID(),
      })
    })
  }

  private handleDesktopMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return

    // Handle native events (TorrentAdded, MagnetAdded, etc.)
    if ('event' in msg) {
      this.emitEvent(msg as NativeEvent)
    }

    // Handle RootAdded response
    if ('type' in msg && (msg as { type: string }).type === 'RootAdded') {
      const payload = (msg as { payload?: { root?: DownloadRoot } }).payload
      if (payload?.root) {
        this.addRoot(payload.root)
      }
    }
  }

  private async pickFolderDesktop(): Promise<DownloadRoot | null> {
    if (!this.nativePort) return null

    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()

      const handler = (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null) return
        const response = msg as {
          id?: string
          ok?: boolean
          type?: string
          payload?: { root?: DownloadRoot }
        }

        if (response.id !== requestId) return

        if (response.ok && response.type === 'RootAdded' && response.payload?.root) {
          resolve(response.payload.root)
        } else {
          resolve(null)
        }
      }

      // Note: Native messaging doesn't support removing listeners easily,
      // but responses are keyed by requestId so this is safe
      this.nativePort!.onMessage.addListener(handler)
      this.nativePort!.postMessage({ op: 'pickDownloadDirectory', id: requestId })
    })
  }

  // ==========================================================================
  // ChromeOS Implementation
  // ==========================================================================

  private async connectChromeos(): Promise<void> {
    const port = await this.findDaemonPort()
    if (!port) {
      throw new Error('Android daemon not reachable')
    }

    const token = await this.getOrCreateToken()
    const paired = await this.checkPaired(port)
    if (!paired) {
      throw new Error('Daemon not paired')
    }

    // Fetch initial roots
    const roots = await this.fetchRoots(port, token)

    // Connect WebSocket for control plane
    await this.connectWebSocket(port, token)

    this.updateState({
      status: 'connected',
      daemonInfo: { port, token, version: 1, roots, host: '100.115.92.2' },
      roots,
    })

    // Start health check
    this.startHealthCheck(port)
  }

  private async connectWebSocket(port: number, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://100.115.92.2:${port}/io`)
      ws.binaryType = 'arraybuffer'

      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('WebSocket timeout'))
      }, 10000)

      ws.onopen = () => {
        // Send CLIENT_HELLO
        ws.send(this.buildFrame(0x01, 0, new Uint8Array(0)))
      }

      ws.onmessage = (event) => {
        const data = new Uint8Array(event.data as ArrayBuffer)
        const opcode = data[1]

        if (opcode === 0x02) {
          // SERVER_HELLO - send AUTH
          const authPayload = new Uint8Array([0, ...new TextEncoder().encode(token)])
          ws.send(this.buildFrame(0x03, 0, authPayload))
        } else if (opcode === 0x04) {
          // AUTH_RESULT
          const status = data[8]
          if (status === 0) {
            clearTimeout(timeout)
            this.ws = ws
            resolve()
          } else {
            clearTimeout(timeout)
            ws.close()
            reject(new Error('Auth failed'))
          }
        } else if (opcode === 0xe0) {
          // ROOTS_CHANGED
          this.handleRootsChanged(data)
        } else if (opcode === 0xe1) {
          // EVENT
          this.handleControlEvent(data)
        }
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('WebSocket error'))
      }

      ws.onclose = () => {
        if (this.ws === ws) {
          this.handleDisconnect()
        }
      }
    })
  }

  private handleRootsChanged(frame: Uint8Array): void {
    try {
      const payload = frame.slice(8)
      const json = new TextDecoder().decode(payload)
      const roots = JSON.parse(json) as Array<{
        key: string
        uri?: string
        path?: string
        displayName?: string
        display_name?: string
        removable: boolean
        lastStatOk?: boolean
        last_stat_ok?: boolean
        lastChecked?: number
        last_checked?: number
      }>

      // Map Android format to extension format
      const mapped: DownloadRoot[] = roots.map((r) => ({
        key: r.key,
        path: r.uri || r.path || '',
        display_name: r.displayName || r.display_name || '',
        removable: r.removable,
        last_stat_ok: r.lastStatOk ?? r.last_stat_ok ?? true,
        last_checked: r.lastChecked ?? r.last_checked ?? Date.now(),
      }))

      this.updateState({ roots: mapped })
      console.log('[DaemonBridge] Roots updated:', mapped.length)
    } catch (e) {
      console.error('[DaemonBridge] Failed to parse ROOTS_CHANGED:', e)
    }
  }

  private handleControlEvent(frame: Uint8Array): void {
    try {
      const payload = frame.slice(8)
      const json = new TextDecoder().decode(payload)
      const event = JSON.parse(json) as NativeEvent
      this.emitEvent(event)
    } catch (e) {
      console.error('[DaemonBridge] Failed to parse EVENT:', e)
    }
  }

  private async pickFolderChromeos(): Promise<DownloadRoot | null> {
    const existingKeys = new Set(this.state.roots.map((r) => r.key))

    // Open intent
    const intentUrl = 'intent://add-root#Intent;scheme=jstorrent;package=com.jstorrent.app;end'
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { url: intentUrl })
    } else {
      await chrome.tabs.create({ url: intentUrl })
    }

    // Wait for ROOTS_CHANGED with new root (via WebSocket)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe()
        resolve(null)
      }, 60000) // 60s timeout for user to pick folder

      const unsubscribe = this.subscribe((state) => {
        const newRoot = state.roots.find((r) => !existingKeys.has(r.key))
        if (newRoot) {
          clearTimeout(timeout)
          unsubscribe()
          resolve(newRoot)
        }
      })
    })
  }

  private buildFrame(opcode: number, requestId: number, payload: Uint8Array): ArrayBuffer {
    const frame = new Uint8Array(8 + payload.length)
    frame[0] = 1 // version
    frame[1] = opcode
    // flags at 2-3 (0)
    // requestId at 4-7 (little endian)
    const view = new DataView(frame.buffer)
    view.setUint32(4, requestId, true)
    frame.set(payload, 8)
    return frame.buffer
  }

  private async findDaemonPort(): Promise<number | null> {
    const stored = await chrome.storage.local.get([STORAGE_KEY_PORT])
    const ports = [stored[STORAGE_KEY_PORT], 7800, 7805, 7814, 7827, 7844].filter(
      Boolean,
    ) as number[]

    for (const port of ports) {
      try {
        const controller = new AbortController()
        setTimeout(() => controller.abort(), 2000)

        const response = await fetch(`http://100.115.92.2:${port}/status`, {
          signal: controller.signal,
        })

        if (response.ok) {
          await chrome.storage.local.set({ [STORAGE_KEY_PORT]: port })
          return port
        }
      } catch {
        // Try next port
      }
    }
    return null
  }

  private async checkPaired(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://100.115.92.2:${port}/status`)
      const data = (await response.json()) as { paired: boolean }
      return data.paired
    } catch {
      return false
    }
  }

  private async fetchRoots(port: number, token: string): Promise<DownloadRoot[]> {
    try {
      const response = await fetch(`http://100.115.92.2:${port}/roots`, {
        headers: { 'X-JST-Auth': token },
      })

      if (!response.ok) return []

      const data = (await response.json()) as {
        roots: Array<{
          key: string
          uri: string
          display_name?: string
          displayName?: string
          removable: boolean
          last_stat_ok?: boolean
          lastStatOk?: boolean
          last_checked?: number
          lastChecked?: number
        }>
      }

      return data.roots.map((r) => ({
        key: r.key,
        path: r.uri,
        display_name: r.display_name || r.displayName || '',
        removable: r.removable,
        last_stat_ok: r.last_stat_ok ?? r.lastStatOk ?? true,
        last_checked: r.last_checked ?? r.lastChecked ?? Date.now(),
      }))
    } catch {
      return []
    }
  }

  private async getOrCreateToken(): Promise<string> {
    const stored = await chrome.storage.local.get([STORAGE_KEY_TOKEN])
    if (stored[STORAGE_KEY_TOKEN]) {
      return stored[STORAGE_KEY_TOKEN] as string
    }
    const token = crypto.randomUUID()
    await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: token })
    return token
  }

  private startHealthCheck(port: number): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch(`http://100.115.92.2:${port}/health`)
        if (!response.ok) throw new Error('Health check failed')
      } catch {
        this.handleDisconnect()
      }
    }, 5000)
  }

  // ==========================================================================
  // Shared Helpers
  // ==========================================================================

  private isDaemonInfoMessage(msg: unknown): boolean {
    return (
      typeof msg === 'object' &&
      msg !== null &&
      'type' in msg &&
      (msg as { type: string }).type === 'DaemonInfo' &&
      'payload' in msg
    )
  }

  private handleDisconnect(): void {
    this.cleanup()
    this.updateState({
      status: 'disconnected',
      lastError: 'Connection lost',
    })
  }

  private cleanup(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    if (this.nativePort) {
      this.nativePort.disconnect()
      this.nativePort = null
    }
  }

  private updateState(partial: Partial<DaemonBridgeState>): void {
    this.state = { ...this.state, ...partial }
    this.notifyStateListeners()
  }

  private addRoot(root: DownloadRoot): void {
    const exists = this.state.roots.some((r) => r.key === root.key)
    if (!exists) {
      this.updateState({ roots: [...this.state.roots, root] })
    }
  }

  private notifyStateListeners(): void {
    for (const listener of this.stateListeners) {
      try {
        listener(this.state)
      } catch (e) {
        console.error('[DaemonBridge] Listener error:', e)
      }
    }
  }

  private emitEvent(event: NativeEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (e) {
        console.error('[DaemonBridge] Event listener error:', e)
      }
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let bridge: DaemonBridge | null = null

export function getDaemonBridge(): DaemonBridge {
  if (!bridge) {
    bridge = new DaemonBridge()
  }
  return bridge
}
