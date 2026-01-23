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

/**
 * Stats from the daemon about socket and connection state
 */
export interface DaemonStats {
  tcp_sockets: number
  pending_connects: number
  pending_tcp: number
  udp_sockets: number
  tcp_servers: number
  ws_connections: number
  bytes_sent: number
  bytes_received: number
  uptime_secs: number
}

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
const STORAGE_KEY_LAST_CONNECTED = 'daemon:lastConnectedTime'

// ============================================================================
// Host Constants
// ============================================================================

/** Host for desktop (macOS/Windows/Linux) native messaging daemon */
const DESKTOP_HOST = '127.0.0.1'

/** Host for ChromeOS Android app daemon (Crostini container IP) */
const CHROMEOS_HOST = '100.115.92.2'

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

      await chrome.storage.local.set({
        [STORAGE_KEY_HAS_CONNECTED]: true,
        [STORAGE_KEY_LAST_CONNECTED]: Date.now(),
      })
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
   * Get the timestamp of the last successful connection (epoch ms).
   */
  async getLastConnectedTime(): Promise<number | null> {
    const result = await chrome.storage.local.get(STORAGE_KEY_LAST_CONNECTED)
    const value = result[STORAGE_KEY_LAST_CONNECTED]
    return typeof value === 'number' ? value : null
  }

  /**
   * Trigger Android app launch (ChromeOS only).
   * Opens launch intent then polls for daemon and initiates pairing.
   */
  async triggerLaunch(): Promise<boolean> {
    if (this.state.platform !== 'chromeos') return false

    try {
      // Launch intent - just starts the app, no token
      const intentUrl = 'intent://launch#Intent;scheme=jstorrent;package=com.jstorrent.app;end'

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: intentUrl })
      } else {
        await chrome.tabs.create({ url: intentUrl })
      }

      this.updateState({ status: 'connecting', lastError: null })
      this.waitForDaemonAndPair()

      return true
    } catch (e) {
      console.error('[DaemonBridge] Failed to trigger launch:', e)
      return false
    }
  }

  /**
   * Wait for daemon to become reachable after launch, then pair if needed.
   */
  private async waitForDaemonAndPair(): Promise<void> {
    const maxWaitAttempts = 30 // 30s to wait for daemon to start
    const pollInterval = 1000

    // Phase 1: Wait for daemon to become reachable
    let port: number | null = null
    for (let i = 0; i < maxWaitAttempts; i++) {
      port = await this.findDaemonPort()
      if (port) break
      await new Promise((r) => setTimeout(r, pollInterval))
    }

    if (!port) {
      this.updateState({
        status: 'disconnected',
        lastError: 'Android app did not start',
      })
      return
    }

    // Phase 2: Check status and pair if needed
    await this.checkStatusAndPair(port)
  }

  /**
   * Check pairing status and initiate pairing flow if needed.
   */
  private async checkStatusAndPair(port: number): Promise<void> {
    const installId = await getOrCreateInstallId()
    const extensionId = chrome.runtime.id

    const status = await this.fetchStatus(port)

    // Already paired with us?
    if (status.paired && status.extensionId === extensionId && status.installId === installId) {
      console.log('[DaemonBridge] Already paired, connecting...')
      await this.completeConnection(port, status.version)
      return
    }

    // Need to pair - POST /pair
    const pairResult = await this.requestPairing(port)

    if (pairResult === 'approved') {
      await this.completeConnection(port, status.version)
      return
    }

    if (pairResult === 'conflict') {
      // Dialog already showing, wait and retry
      await new Promise((r) => setTimeout(r, 2000))
      await this.checkStatusAndPair(port)
      return
    }

    // pairResult === 'pending' - poll until paired
    await this.pollForPairing(port)
  }

  /**
   * Poll /status until pairing completes or times out.
   */
  private async pollForPairing(port: number): Promise<void> {
    const maxPollAttempts = 60 // 60s for user to approve
    const pollInterval = 1000
    const installId = await getOrCreateInstallId()
    const extensionId = chrome.runtime.id

    for (let i = 0; i < maxPollAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollInterval))

      try {
        const status = await this.fetchStatus(port)
        if (status.paired && status.extensionId === extensionId && status.installId === installId) {
          console.log('[DaemonBridge] Pairing approved')
          await this.completeConnection(port, status.version)
          return
        }
      } catch {
        // Keep polling
      }
    }

    this.updateState({
      status: 'disconnected',
      lastError: 'Pairing timed out',
    })
  }

  /**
   * Build standard headers for all HTTP requests.
   */
  private async buildHeaders(includeAuth: boolean = false): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'X-JST-ExtensionId': chrome.runtime.id,
      'X-JST-InstallId': await getOrCreateInstallId(),
    }
    if (includeAuth) {
      const token = await this.getOrCreateToken()
      headers['X-JST-Auth'] = token
    }
    return headers
  }

  /**
   * Fetch status from daemon (POST for Origin header).
   */
  private async fetchStatus(port: number): Promise<{
    port: number
    paired: boolean
    extensionId: string | null
    installId: string | null
    version: string | null
  }> {
    const headers = await this.buildHeaders()
    const response = await fetch(`http://${CHROMEOS_HOST}:${port}/status`, {
      method: 'POST',
      headers,
    })
    if (!response.ok) throw new Error(`Status failed: ${response.status}`)
    return response.json()
  }

  /**
   * Request pairing via POST /pair.
   * Returns 'approved', 'pending', or 'conflict'.
   */
  private async requestPairing(port: number): Promise<'approved' | 'pending' | 'conflict'> {
    const token = await this.getOrCreateToken()
    const headers = await this.buildHeaders()
    headers['Content-Type'] = 'application/json'

    try {
      const response = await fetch(`http://${CHROMEOS_HOST}:${port}/pair`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token }),
      })

      if (response.ok) {
        const data = (await response.json()) as { status: string }
        return data.status as 'approved' | 'pending'
      } else if (response.status === 409) {
        return 'conflict'
      }
      return 'pending'
    } catch {
      return 'pending'
    }
  }

  /**
   * Complete connection after pairing confirmed.
   */
  private async completeConnection(port: number, version?: string | null): Promise<void> {
    const token = await this.getOrCreateToken()
    const headers = await this.buildHeaders(true)

    // Fetch roots with auth
    const rootsResponse = await fetch(`http://${CHROMEOS_HOST}:${port}/roots`, { headers })
    const rootsData = (await rootsResponse.json()) as {
      roots: Array<{
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
    }
    // Map Android format (uri, displayName) to extension format (path, display_name)
    const roots: DownloadRoot[] = (rootsData.roots || []).map((r) => ({
      key: r.key,
      path: r.uri || r.path || '',
      display_name: r.displayName || r.display_name || '',
      removable: r.removable,
      last_stat_ok: r.lastStatOk ?? r.last_stat_ok ?? true,
      last_checked: r.lastChecked ?? r.last_checked ?? Date.now(),
    }))

    // Connect WebSocket
    await this.connectWebSocket(port, token)

    this.updateState({
      status: 'connected',
      daemonInfo: { port, token, version: version ?? 'unknown', roots, host: CHROMEOS_HOST },
      roots,
      lastError: null,
    })

    await chrome.storage.local.set({ [STORAGE_KEY_HAS_CONNECTED]: true })
    this.startHealthCheck(CHROMEOS_HOST, port)
    console.log('[DaemonBridge] Connected successfully')
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

  /**
   * Remove a download root.
   * Desktop: via native messaging
   * ChromeOS: via HTTP DELETE to Android daemon
   */
  async removeDownloadRoot(key: string): Promise<boolean> {
    if (this.state.platform === 'desktop') {
      return this.removeRootDesktop(key)
    } else {
      return this.removeRootChromeos(key)
    }
  }

  /**
   * Open a file with the system's default application.
   * Desktop only for now.
   */
  async openFile(rootKey: string, path: string): Promise<{ ok: boolean; error?: string }> {
    if (this.state.platform !== 'desktop') {
      return { ok: false, error: 'Not supported on this platform' }
    }
    return this.sendNativeRequest('openFile', { rootKey, path })
  }

  /**
   * Reveal a file in the system file manager.
   * Desktop only for now.
   */
  async revealInFolder(rootKey: string, path: string): Promise<{ ok: boolean; error?: string }> {
    if (this.state.platform !== 'desktop') {
      return { ok: false, error: 'Not supported on this platform' }
    }
    return this.sendNativeRequest('revealInFolder', { rootKey, path })
  }

  /**
   * Get stats from the daemon about socket and connection state.
   * Useful for debugging.
   */
  async getStats(): Promise<DaemonStats | null> {
    if (this.state.status !== 'connected' || !this.state.daemonInfo) {
      return null
    }

    const { port, token, host } = this.state.daemonInfo
    const baseHost = host ?? '127.0.0.1'

    try {
      const response = await fetch(`http://${baseHost}:${port}/stats`, {
        headers: {
          'X-JST-Auth': token,
        },
      })
      if (!response.ok) {
        console.error('[DaemonBridge] getStats failed:', response.status)
        return null
      }
      return (await response.json()) as DaemonStats
    } catch (e) {
      console.error('[DaemonBridge] getStats error:', e)
      return null
    }
  }

  /**
   * Helper to send a request to the native host and wait for response.
   */
  private async sendNativeRequest(
    op: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.nativePort) {
      return { ok: false, error: 'Not connected' }
    }

    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()
      let resolved = false

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve({ ok: false, error: 'Request timed out' })
        }
      }, 10000)

      const handler = (msg: unknown) => {
        if (resolved) return
        if (typeof msg !== 'object' || msg === null) return
        const response = msg as { id?: string; ok?: boolean; error?: string }

        if (response.id !== requestId) return

        resolved = true
        clearTimeout(timeout)
        resolve({ ok: response.ok ?? false, error: response.error })
      }

      this.nativePort!.onMessage.addListener(handler)
      this.nativePort!.postMessage({ op, ...params, id: requestId })
    })
  }

  // ==========================================================================
  // Desktop Implementation
  // ==========================================================================

  private async connectDesktop(): Promise<void> {
    const installId = await getOrCreateInstallId()
    console.log('[DaemonBridge] connectDesktop() called, installId:', installId)

    return new Promise((resolve, reject) => {
      console.log('[DaemonBridge] Calling chrome.runtime.connectNative("com.jstorrent.native")')
      const port = chrome.runtime.connectNative('com.jstorrent.native')
      console.log('[DaemonBridge] connectNative returned port:', !!port)

      let resolved = false
      const timeout = setTimeout(() => {
        if (!resolved) {
          console.log('[DaemonBridge] Handshake timeout after 10s')
          resolved = true
          port.disconnect()
          reject(new Error('Handshake timeout'))
        }
      }, 10000)

      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message || 'Disconnected'
        console.log('[DaemonBridge] onDisconnect fired, resolved:', resolved, 'error:', error)
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error(error))
        } else {
          // Disconnected after successful connection
          this.handleDisconnect()
        }
      })

      port.onMessage.addListener((msg: unknown) => {
        console.log('[DaemonBridge] Received message from native host:', msg)
        if (!resolved && this.isDaemonInfoMessage(msg)) {
          resolved = true
          clearTimeout(timeout)

          const payload = (msg as { payload: DaemonInfo }).payload
          console.log(
            '[DaemonBridge] Got DaemonInfo, version:',
            payload.version,
            'roots:',
            payload.roots?.length,
          )
          this.nativePort = port
          this.updateState({
            status: 'connected',
            daemonInfo: {
              port: payload.port,
              token: payload.token,
              version: payload.version ?? 'unknown',
              roots: payload.roots || [],
              host: DESKTOP_HOST,
            },
            roots: payload.roots || [],
          })
          this.startHealthCheck(DESKTOP_HOST, payload.port)

          resolve()
        } else if (resolved) {
          // Post-connection messages
          this.handleDesktopMessage(msg)
        }
      })

      // Send handshake
      const handshakeMsg = {
        op: 'handshake',
        extensionId: chrome.runtime.id,
        installId,
        id: crypto.randomUUID(),
      }
      console.log('[DaemonBridge] Sending handshake:', handshakeMsg)
      port.postMessage(handshakeMsg)
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
          this.addRoot(response.payload.root)
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

  private async removeRootDesktop(key: string): Promise<boolean> {
    if (!this.nativePort) return false

    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()
      let resolved = false

      // Timeout after 10 seconds to prevent hanging
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true
          console.error('[DaemonBridge] removeRootDesktop timed out')
          resolve(false)
        }
      }, 10000)

      const handler = (msg: unknown) => {
        if (resolved) return
        if (typeof msg !== 'object' || msg === null) return
        const response = msg as {
          id?: string
          ok?: boolean
          type?: string
          payload?: { key?: string }
        }

        if (response.id !== requestId) return

        resolved = true
        clearTimeout(timeout)

        if (response.ok && response.type === 'RootRemoved') {
          // Remove from local state
          this.updateState({
            roots: this.state.roots.filter((r) => r.key !== key),
          })
          resolve(true)
        } else {
          console.error('[DaemonBridge] removeRootDesktop failed:', response)
          resolve(false)
        }
      }

      this.nativePort!.onMessage.addListener(handler)
      this.nativePort!.postMessage({ op: 'deleteDownloadRoot', key, id: requestId })
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

    const installId = await getOrCreateInstallId()
    const extensionId = chrome.runtime.id
    const status = await this.fetchStatus(port)

    // Already paired with us? Try connecting
    if (status.paired && status.extensionId === extensionId && status.installId === installId) {
      await this.completeConnection(port, status.version)
      return
    }

    // Need to pair
    throw new Error('Not paired - use triggerLaunch()')
  }

  private async connectWebSocket(port: number, token: string): Promise<void> {
    const installId = await getOrCreateInstallId()

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${CHROMEOS_HOST}:${port}/control`)
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
          // SERVER_HELLO - send AUTH with token + extensionId + installId
          const encoder = new TextEncoder()
          const tokenBytes = encoder.encode(token)
          const extensionIdBytes = encoder.encode(chrome.runtime.id)
          const installIdBytes = encoder.encode(installId)

          // Format: authType(1) + token + \0 + extensionId + \0 + installId
          const authPayload = new Uint8Array(
            1 + tokenBytes.length + 1 + extensionIdBytes.length + 1 + installIdBytes.length,
          )
          authPayload[0] = 0 // authType
          authPayload.set(tokenBytes, 1)
          authPayload[1 + tokenBytes.length] = 0 // null separator
          authPayload.set(extensionIdBytes, 1 + tokenBytes.length + 1)
          authPayload[1 + tokenBytes.length + 1 + extensionIdBytes.length] = 0 // null separator
          authPayload.set(installIdBytes, 1 + tokenBytes.length + 1 + extensionIdBytes.length + 1)

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

    // Send command to open folder picker via WebSocket
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[DaemonBridge] WebSocket not connected')
      return null
    }

    const requestId = Math.floor(Math.random() * 0xffffffff)
    this.ws.send(this.buildFrame(0xe2, requestId, new Uint8Array(0))) // OP_CTRL_OPEN_FOLDER_PICKER

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

  private async removeRootChromeos(key: string): Promise<boolean> {
    const port = this.state.daemonInfo?.port
    if (!port) return false

    try {
      const headers = await this.buildHeaders(true)
      const response = await fetch(
        `http://${CHROMEOS_HOST}:${port}/roots/${encodeURIComponent(key)}`,
        {
          method: 'DELETE',
          headers,
        },
      )

      if (response.ok) {
        // Root will be updated via ROOTS_CHANGED WebSocket message
        // but we can optimistically update local state
        this.updateState({
          roots: this.state.roots.filter((r) => r.key !== key),
        })
        return true
      }
      return false
    } catch (e) {
      console.error('[DaemonBridge] Failed to remove root:', e)
      return false
    }
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

        // Use /health endpoint which doesn't require headers
        const response = await fetch(`http://${CHROMEOS_HOST}:${port}/health`, {
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

  private async getOrCreateToken(): Promise<string> {
    const stored = await chrome.storage.local.get([STORAGE_KEY_TOKEN])
    if (stored[STORAGE_KEY_TOKEN]) {
      return stored[STORAGE_KEY_TOKEN] as string
    }
    const token = crypto.randomUUID()
    await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: token })
    return token
  }

  private startHealthCheck(host: string, port: number): void {
    // Clear any existing interval to prevent stacking
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }
    this.healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch(`http://${host}:${port}/health`)
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
    console.log('[DaemonBridge] cleanup() called')
    if (this.healthCheckInterval) {
      console.log('[DaemonBridge] Clearing health check interval')
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    if (this.ws) {
      console.log('[DaemonBridge] Closing WebSocket')
      this.ws.close()
      this.ws = null
    }
    if (this.nativePort) {
      console.log('[DaemonBridge] Disconnecting native port')
      this.nativePort.disconnect()
      this.nativePort = null
      console.log('[DaemonBridge] Native port disconnected and nulled')
    } else {
      console.log('[DaemonBridge] No native port to disconnect')
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
