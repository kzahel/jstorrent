/**
 * ChromeOS Bootstrap
 *
 * Simple polling loop to get from "nothing" to "connected WebSocket".
 * Replaces the complex recursive timeout logic in daemon-bridge.ts.
 */

// ============================================================================
// Types
// ============================================================================

export type BootstrapPhase =
  | 'idle' // Not started
  | 'probing' // Looking for daemon (/health)
  | 'pairing' // Daemon found, need pairing approval
  | 'connecting' // Paired, establishing WebSocket
  | 'connected' // Done - WebSocket authenticated

export type BootstrapProblem =
  | null // No problem
  | 'not_reachable' // Can't reach /health
  | 'not_paired' // /status says not paired
  | 'token_invalid' // /status says token doesn't match
  | 'pair_rejected' // User rejected pairing dialog
  | 'pair_conflict' // Another dialog showing
  | 'auth_failed' // WebSocket AUTH failed
  | 'connection_lost' // Was connected, lost connection

export interface BootstrapState {
  phase: BootstrapPhase
  port: number | null
  problem: BootstrapProblem
  /** User-friendly message for current state */
  message: string
}

export interface BootstrapResult {
  port: number
  token: string
  ws: WebSocket
}

type StateListener = (state: BootstrapState) => void

// ============================================================================
// Constants
// ============================================================================

const CHROMEOS_HOST = '100.115.92.2'
const PROBE_PORTS = [7800, 7805, 7814, 7827, 7844]
const POLL_INTERVAL_MS = 2000
const PROBE_TIMEOUT_MS = 2000
const WS_TIMEOUT_MS = 10000

const STORAGE_KEY_TOKEN = 'android:authToken'
const STORAGE_KEY_PORT = 'android:daemonPort'

// ============================================================================
// ChromeOSBootstrap Class
// ============================================================================

export class ChromeOSBootstrap {
  private state: BootstrapState = {
    phase: 'idle',
    port: null,
    problem: null,
    message: 'Not started',
  }

  private listeners = new Set<StateListener>()
  private running = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private ws: WebSocket | null = null

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  getState(): BootstrapState {
    return this.state
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Start the bootstrap loop. Polls continuously until connected.
   * Returns a promise that resolves when connected (or rejects on stop).
   */
  start(): Promise<BootstrapResult> {
    if (this.running) {
      return Promise.reject(new Error('Already running'))
    }

    this.running = true
    this.updateState({ phase: 'probing', problem: null, message: 'Looking for Android app...' })

    return new Promise((resolve, reject) => {
      this.runLoop(resolve, reject)
    })
  }

  /**
   * Stop the bootstrap loop.
   */
  stop(): void {
    this.running = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.updateState({ phase: 'idle', problem: null, message: 'Stopped' })
  }

  /**
   * Open the Android app via intent. Can be called anytime.
   * If we're waiting for pairing approval, this resets the pairing state
   * so the next poll will call /pair again (in case user denied previously).
   */
  async openIntent(): Promise<void> {
    // If we're stuck waiting for pairing, reset to allow retry
    if (this.state.phase === 'pairing' && this.state.problem === 'not_paired') {
      this.updateState({
        phase: 'probing',
        problem: null,
        message: 'Retrying...',
      })
    }

    const intentUrl =
      'intent://launch#Intent;scheme=jstorrent;package=com.jstorrent.app;' +
      'S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.jstorrent.app;end'

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: intentUrl })
      } else {
        await chrome.tabs.create({ url: intentUrl })
      }
    } catch (e) {
      console.error('[ChromeOSBootstrap] Failed to open intent:', e)
    }
  }

  /**
   * Clear stored token and restart pairing flow.
   */
  async resetPairing(): Promise<void> {
    await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
    console.log('[ChromeOSBootstrap] Pairing reset')

    // If running, the next poll iteration will detect we need to pair
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main Loop
  // ─────────────────────────────────────────────────────────────────────────

  private async runLoop(
    resolve: (result: BootstrapResult) => void,
    reject: (error: Error) => void,
  ): Promise<void> {
    while (this.running) {
      try {
        const result = await this.tryConnect()
        if (result) {
          this.updateState({
            phase: 'connected',
            port: result.port,
            problem: null,
            message: 'Connected',
          })

          // Set up disconnect handler BEFORE resolving
          this.setupDisconnectHandler(result.ws)

          resolve(result)
          return
        }
      } catch (e) {
        console.error('[ChromeOSBootstrap] Loop error:', e)
      }

      // Wait before next attempt
      await this.sleep(POLL_INTERVAL_MS)
    }

    reject(new Error('Stopped'))
  }

  /**
   * Set up handler to detect WebSocket disconnection and restart bootstrap.
   */
  private setupDisconnectHandler(ws: WebSocket): void {
    ws.onclose = () => {
      console.log('[ChromeOSBootstrap] WebSocket closed, restarting bootstrap')
      this.ws = null

      // Update state to show disconnection
      this.updateState({
        phase: 'probing',
        port: null,
        problem: 'connection_lost',
        message: 'Connection lost, reconnecting...',
      })

      // Restart the loop if we're still supposed to be running
      if (this.running) {
        // Create new promise and restart
        const newPromise = new Promise<BootstrapResult>((resolve, reject) => {
          this.runLoop(resolve, reject)
        })
        // Log but don't block - the new loop runs in background
        newPromise
          .then((result) => {
            console.log('[ChromeOSBootstrap] Reconnected after disconnect, port:', result.port)
          })
          .catch((e) => {
            console.log('[ChromeOSBootstrap] Reconnect failed:', e)
          })
      }
    }

    ws.onerror = (e) => {
      console.error('[ChromeOSBootstrap] WebSocket error:', e)
      // The onclose handler will be called after onerror
    }
  }

  /**
   * Single attempt to connect. Returns result if successful, null to retry.
   */
  private async tryConnect(): Promise<BootstrapResult | null> {
    // Step 1: Find daemon
    const port = await this.findDaemonPort()
    if (!port) {
      this.updateState({
        phase: 'probing',
        port: null,
        problem: 'not_reachable',
        message: 'Android app not running',
      })
      return null
    }

    // Step 2: Check pairing status
    const token = await this.getOrCreateToken()
    const status = await this.fetchStatus(port, token)

    if (!status.paired) {
      // Need to initiate pairing - but only if we haven't already
      // Check if we're already waiting for pairing approval
      if (this.state.phase !== 'pairing' || this.state.problem !== 'not_paired') {
        // First time seeing not paired, initiate pairing request
        this.updateState({
          phase: 'pairing',
          port,
          problem: 'not_paired',
          message: 'Approve pairing in Android app',
        })

        const pairResult = await this.requestPairing(port, token)
        if (pairResult === 'conflict') {
          this.updateState({
            phase: 'pairing',
            port,
            problem: 'pair_conflict',
            message: 'Dismiss existing pairing dialog',
          })
        }
        // 'pending' or 'approved' - wait for status to show paired
      }
      // Already waiting for pairing, just poll status (don't call /pair again)
      return null
    }

    // Paired, but is our token valid?
    if (status.tokenValid === false) {
      this.updateState({
        phase: 'pairing',
        port,
        problem: 'token_invalid',
        message: 'Token expired, re-pairing...',
      })
      // Clear token and re-pair
      await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
      return null
    }

    // Step 3: Connect WebSocket
    this.updateState({
      phase: 'connecting',
      port,
      problem: null,
      message: 'Connecting...',
    })

    try {
      const ws = await this.connectWebSocket(port, token)
      return { port, token, ws }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'WebSocket failed'

      if (msg.includes('Auth failed')) {
        // Token mismatch - clear and re-pair
        await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
        this.updateState({
          phase: 'pairing',
          port,
          problem: 'auth_failed',
          message: 'Authentication failed, re-pairing...',
        })
      } else {
        this.updateState({
          phase: 'probing',
          port,
          problem: 'not_reachable',
          message: 'Connection failed',
        })
      }
      return null
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Network Operations
  // ─────────────────────────────────────────────────────────────────────────

  private async findDaemonPort(): Promise<number | null> {
    // Check cached port first
    const stored = await chrome.storage.local.get([STORAGE_KEY_PORT])
    const ports = [stored[STORAGE_KEY_PORT], ...PROBE_PORTS].filter(Boolean) as number[]
    const seen = new Set<number>()

    for (const port of ports) {
      if (seen.has(port)) continue
      seen.add(port)

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

        const response = await fetch(`http://${CHROMEOS_HOST}:${port}/health`, {
          signal: controller.signal,
        })
        clearTimeout(timeout)

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

  private async fetchStatus(
    port: number,
    token: string,
  ): Promise<{
    paired: boolean
    extensionId: string | null
    installId: string | null
    tokenValid: boolean | null
  }> {
    const installId = await this.getInstallId()

    const response = await fetch(`http://${CHROMEOS_HOST}:${port}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-JST-ExtensionId': chrome.runtime.id,
        'X-JST-InstallId': installId,
      },
      body: JSON.stringify({ token }),
    })

    if (!response.ok) {
      throw new Error(`Status failed: ${response.status}`)
    }

    return response.json()
  }

  private async requestPairing(
    port: number,
    token: string,
  ): Promise<'approved' | 'pending' | 'conflict'> {
    const installId = await this.getInstallId()

    try {
      const response = await fetch(`http://${CHROMEOS_HOST}:${port}/pair`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-JST-ExtensionId': chrome.runtime.id,
          'X-JST-InstallId': installId,
        },
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

  private async connectWebSocket(port: number, token: string): Promise<WebSocket> {
    const installId = await this.getInstallId()

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${CHROMEOS_HOST}:${port}/control`)
      ws.binaryType = 'arraybuffer'

      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('WebSocket timeout'))
      }, WS_TIMEOUT_MS)

      ws.onopen = () => {
        // Send CLIENT_HELLO
        ws.send(this.buildFrame(0x01, 0, new Uint8Array(0)))
      }

      ws.onmessage = (event) => {
        const data = new Uint8Array(event.data as ArrayBuffer)
        const opcode = data[1]

        if (opcode === 0x02) {
          // SERVER_HELLO - send AUTH
          const encoder = new TextEncoder()
          const tokenBytes = encoder.encode(token)
          const extIdBytes = encoder.encode(chrome.runtime.id)
          const installIdBytes = encoder.encode(installId)

          const payload = new Uint8Array(
            1 + tokenBytes.length + 1 + extIdBytes.length + 1 + installIdBytes.length,
          )
          payload[0] = 0 // authType
          let offset = 1
          payload.set(tokenBytes, offset)
          offset += tokenBytes.length
          payload[offset++] = 0
          payload.set(extIdBytes, offset)
          offset += extIdBytes.length
          payload[offset++] = 0
          payload.set(installIdBytes, offset)

          ws.send(this.buildFrame(0x03, 0, payload))
        } else if (opcode === 0x04) {
          // AUTH_RESULT
          clearTimeout(timeout)
          const status = data[8]
          if (status === 0) {
            this.ws = ws
            resolve(ws)
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
        // Only reject if we haven't resolved yet
      }
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async getOrCreateToken(): Promise<string> {
    const stored = await chrome.storage.local.get([STORAGE_KEY_TOKEN])
    if (stored[STORAGE_KEY_TOKEN]) {
      return stored[STORAGE_KEY_TOKEN] as string
    }
    const token = crypto.randomUUID()
    await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: token })
    return token
  }

  private async getInstallId(): Promise<string> {
    const stored = await chrome.storage.local.get(['installId'])
    if (stored.installId) {
      return stored.installId as string
    }
    const id = crypto.randomUUID()
    await chrome.storage.local.set({ installId: id })
    return id
  }

  private buildFrame(opcode: number, requestId: number, payload: Uint8Array): ArrayBuffer {
    const frame = new Uint8Array(8 + payload.length)
    frame[0] = 1 // version
    frame[1] = opcode
    const view = new DataView(frame.buffer)
    view.setUint32(4, requestId, true)
    frame.set(payload, 8)
    return frame.buffer
  }

  private updateState(partial: Partial<BootstrapState>): void {
    const oldPhase = this.state.phase
    this.state = { ...this.state, ...partial }
    console.log(
      `[ChromeOSBootstrap] State: ${oldPhase} -> ${this.state.phase}, problem: ${this.state.problem}, listeners: ${this.listeners.size}`,
    )
    for (const listener of this.listeners) {
      try {
        listener(this.state)
      } catch (e) {
        console.error('[ChromeOSBootstrap] Listener error:', e)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.pollTimer = setTimeout(resolve, ms)
    })
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ChromeOSBootstrap | null = null

export function getChromeOSBootstrap(): ChromeOSBootstrap {
  if (!instance) {
    instance = new ChromeOSBootstrap()
  }
  return instance
}
