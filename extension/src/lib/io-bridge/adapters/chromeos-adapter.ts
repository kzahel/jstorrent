/**
 * ChromeOS IO Bridge Adapter
 *
 * Uses HTTP to connect to the Android daemon running in the ARC container.
 * On ChromeOS, the daemon runs as an Android app that must be manually launched.
 */

import type {
  IIOBridgeAdapter,
  ProbeResult,
  OnDaemonConnected,
  OnDaemonDisconnected,
} from '../io-bridge-adapter'
import type { DaemonInfo, ConnectionId, DownloadRoot } from '../types'

/**
 * Error thrown when auth tokens don't match between extension and Android app.
 * This triggers re-pairing flow.
 */
export class TokenMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenMismatchError'
  }
}

const ANDROID_HOST = '100.115.92.2'
const ANDROID_PORTS = [7800, 7805, 7814, 7827, 7844]
const STORAGE_KEY_TOKEN = 'android:authToken'
const STORAGE_KEY_PORT = 'android:daemonPort'
const STORAGE_KEY_HAS_CONNECTED = 'iobridge:hasConnectedSuccessfully'
const PROBE_TIMEOUT_MS = 2000
const POLL_INTERVAL_MS = 1000
const HEALTH_CHECK_INTERVAL_MS = 5000

/**
 * Configuration for the ChromeOS adapter.
 */
export interface ChromeOSAdapterConfig {
  /** Android container host address */
  host?: string
  /** Ports to try for daemon */
  ports?: number[]
  /** Probe timeout in ms */
  probeTimeoutMs?: number
  /** Polling interval in ms */
  pollIntervalMs?: number
  /** Health check interval in ms */
  healthCheckIntervalMs?: number
}

/**
 * ChromeOS adapter using HTTP to Android container.
 *
 * On ChromeOS, the daemon runs as an Android app. The user must manually
 * launch it, and we communicate via HTTP to the ARC container.
 */
export class ChromeOSAdapter implements IIOBridgeAdapter {
  readonly platform = 'chromeos' as const

  private config: Required<ChromeOSAdapterConfig>
  private currentPort: number | null = null
  private currentConnectionId: ConnectionId | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private token: string | null = null

  constructor(config: ChromeOSAdapterConfig = {}) {
    this.config = {
      host: config.host ?? ANDROID_HOST,
      ports: config.ports ?? ANDROID_PORTS,
      probeTimeoutMs: config.probeTimeoutMs ?? PROBE_TIMEOUT_MS,
      pollIntervalMs: config.pollIntervalMs ?? POLL_INTERVAL_MS,
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? HEALTH_CHECK_INTERVAL_MS,
    }
  }

  async probe(): Promise<ProbeResult> {
    try {
      // Try to find the daemon on known ports
      const port = await this.findDaemonPort()

      if (!port) {
        return {
          success: false,
          error: 'Android daemon not reachable',
        }
      }

      this.currentPort = port

      // Load or create auth token
      const token = await this.getOrCreateToken()
      this.token = token

      // Check if daemon is paired
      const paired = await this.isPaired(port)
      if (!paired) {
        return {
          success: false,
          error: 'Daemon not paired',
        }
      }

      // Generate connection ID
      const connectionId = `chromeos-${Date.now()}-${Math.random().toString(36).slice(2)}`
      this.currentConnectionId = connectionId

      // Build daemon info
      const daemonInfo = await this.buildDaemonInfo(port, token)

      // Persist successful connection for first-time detection
      await chrome.storage.local.set({ [STORAGE_KEY_HAS_CONNECTED]: true })

      return {
        success: true,
        connectionId,
        daemonInfo,
      }
    } catch (error) {
      console.error('[ChromeOSAdapter] Probe failed:', error)

      // On token mismatch, also clear saved port to force fresh discovery on retry
      if (error instanceof TokenMismatchError) {
        await chrome.storage.local.remove([STORAGE_KEY_PORT])
        this.currentPort = null
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async triggerLaunch(): Promise<boolean> {
    try {
      // Generate a new token for this launch attempt
      const token = await this.getOrCreateToken()

      // Create intent URL to pair with Android app (sends token)
      // Note: Using 'pair' instead of 'launch' because 'pair' sets the token
      // TODO: Track pairing state to use 'launch' for subsequent connections
      const intentUrl = `intent://pair?token=${encodeURIComponent(token)}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`

      // Try to open in current tab for better UX
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: intentUrl })
      } else {
        await chrome.tabs.create({ url: intentUrl })
      }

      console.log('[ChromeOSAdapter] Triggered launch intent')
      return true
    } catch (error) {
      console.error('[ChromeOSAdapter] Failed to trigger launch:', error)
      return false
    }
  }

  startPolling(onConnected: OnDaemonConnected): () => void {
    let stopped = false

    const poll = async () => {
      if (stopped) return

      try {
        const port = await this.findDaemonPort()
        if (port) {
          this.currentPort = port
          const paired = await this.isPaired(port)

          if (paired) {
            const connectionId = `chromeos-${Date.now()}-${Math.random().toString(36).slice(2)}`
            this.currentConnectionId = connectionId

            const token = this.token ?? (await this.getOrCreateToken())
            const daemonInfo = await this.buildDaemonInfo(port, token)

            onConnected(connectionId, daemonInfo)
            return // Stop polling on success
          }
        }
      } catch (error) {
        console.log('[ChromeOSAdapter] Poll check failed:', error)
      }

      // Schedule next poll
      if (!stopped) {
        setTimeout(poll, this.config.pollIntervalMs)
      }
    }

    // Start polling
    poll()

    return () => {
      stopped = true
    }
  }

  watchConnection(connectionId: ConnectionId, onDisconnected: OnDaemonDisconnected): () => void {
    if (connectionId !== this.currentConnectionId) {
      console.warn('[ChromeOSAdapter] watchConnection called with unknown connectionId')
      return () => {}
    }

    // Start periodic health checks
    this.healthCheckInterval = setInterval(async () => {
      const reachable = await this.isDaemonReachable(this.currentPort!)
      if (!reachable) {
        console.log('[ChromeOSAdapter] Health check failed - daemon unreachable')
        this.stopHealthCheck()
        onDisconnected(true)
      }
    }, this.config.healthCheckIntervalMs)

    return () => {
      this.stopHealthCheck()
    }
  }

  dispose(): void {
    this.stopHealthCheck()
    this.currentPort = null
    this.currentConnectionId = null
    this.token = null
  }

  // ===========================================================================
  // Private methods
  // ===========================================================================

  private async findDaemonPort(): Promise<number | null> {
    // Check saved port first
    const stored = await chrome.storage.local.get([STORAGE_KEY_PORT])
    if (stored[STORAGE_KEY_PORT]) {
      const savedPort = stored[STORAGE_KEY_PORT] as number
      if (await this.isDaemonReachable(savedPort)) {
        return savedPort
      }
    }

    // Try known ports
    for (const port of this.config.ports) {
      if (await this.isDaemonReachable(port)) {
        await chrome.storage.local.set({ [STORAGE_KEY_PORT]: port })
        return port
      }
    }

    return null
  }

  private async isDaemonReachable(port: number): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.probeTimeoutMs)

      const response = await fetch(`http://${this.config.host}:${port}/status`, {
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      return response.ok
    } catch {
      return false
    }
  }

  private async isPaired(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://${this.config.host}:${port}/status`)
      if (!response.ok) {
        return false
      }
      const data = (await response.json()) as { port: number; paired: boolean }
      return data.paired
    } catch {
      return false
    }
  }

  private async getOrCreateToken(): Promise<string> {
    const stored = await chrome.storage.local.get([STORAGE_KEY_TOKEN])
    if (stored[STORAGE_KEY_TOKEN]) {
      return stored[STORAGE_KEY_TOKEN] as string
    }

    const newToken = crypto.randomUUID()
    await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: newToken })
    return newToken
  }

  /**
   * Clear the stored auth token. Called when token mismatch is detected.
   */
  async clearToken(): Promise<void> {
    await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
    this.token = null
  }

  private async buildDaemonInfo(port: number, token: string): Promise<DaemonInfo> {
    return {
      port,
      token,
      version: 1,
      roots: await this.fetchRoots(),
      host: this.config.host,
    }
  }

  private async fetchRoots(): Promise<DownloadRoot[]> {
    if (!this.currentPort || !this.token) {
      return []
    }

    try {
      const response = await fetch(`http://${this.config.host}:${this.currentPort}/roots`, {
        headers: {
          'X-JST-Auth': this.token,
        },
      })

      if (response.status === 401) {
        console.warn('[ChromeOSAdapter] 401 Unauthorized - token mismatch, clearing token')
        await this.clearToken()
        throw new TokenMismatchError('Token mismatch - re-pair needed')
      }

      if (!response.ok) {
        console.warn('[ChromeOSAdapter] Failed to fetch roots:', response.status)
        return []
      }

      const data = (await response.json()) as { roots: RootsApiResponse[] }

      // Map API response to DownloadRoot format
      // The API returns 'uri' but extension expects 'path'
      return data.roots.map((root) => ({
        key: root.key,
        path: root.uri, // Use URI as the path identifier
        display_name: root.display_name,
        removable: root.removable,
        last_stat_ok: root.last_stat_ok,
        last_checked: root.last_checked,
      }))
    } catch (error) {
      console.error('[ChromeOSAdapter] Error fetching roots:', error)
      return []
    }
  }

  /**
   * Trigger the Android SAF folder picker.
   * Returns true if intent was opened successfully.
   */
  async triggerAddRoot(): Promise<boolean> {
    try {
      const intentUrl = 'intent://add-root#Intent;scheme=jstorrent;package=com.jstorrent.app;end'

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { url: intentUrl })
      } else {
        await chrome.tabs.create({ url: intentUrl })
      }

      console.log('[ChromeOSAdapter] Triggered add-root intent')
      return true
    } catch (error) {
      console.error('[ChromeOSAdapter] Failed to trigger add-root:', error)
      return false
    }
  }

  /**
   * Poll for roots until a new one appears or timeout.
   * Used after triggerAddRoot() to detect when user completes picker.
   */
  async waitForNewRoot(
    existingKeys: Set<string>,
    timeoutMs: number = 30000,
  ): Promise<DownloadRoot | null> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const roots = await this.fetchRoots()
      const newRoot = roots.find((r) => !existingKeys.has(r.key))

      if (newRoot) {
        return newRoot
      }
    }

    return null
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }
}

/**
 * API response format from Android daemon /roots endpoint.
 * Note: Uses 'uri' instead of 'path' since it's a SAF content URI.
 */
interface RootsApiResponse {
  key: string
  uri: string
  display_name: string
  removable: boolean
  last_stat_ok: boolean
  last_checked: number
}
