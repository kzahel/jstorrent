import { INativeHostConnection, DaemonInfo, DownloadRoot } from './native-connection'

const ANDROID_HOST = '100.115.92.2'
const ANDROID_BASE_PORT = 7800
const STORAGE_KEY_TOKEN = 'android:authToken'
const STORAGE_KEY_PORT = 'android:daemonPort'

/**
 * Connection to Android io-daemon.
 * Implements same interface as NativeHostConnection for compatibility.
 */
export class AndroidDaemonConnection implements INativeHostConnection {
  private host = ANDROID_HOST
  private port = ANDROID_BASE_PORT
  private token: string | null = null
  private messageCallbacks: Array<(msg: unknown) => void> = []
  private disconnectCallbacks: Array<() => void> = []

  async connect(): Promise<void> {
    // Try to find the daemon
    const port = await this.findDaemonPort()
    if (!port) {
      throw new Error('Android daemon not reachable. Is the JSTorrent app running?')
    }
    this.port = port

    // Load saved token
    const stored = await chrome.storage.local.get([STORAGE_KEY_TOKEN])
    this.token = (stored[STORAGE_KEY_TOKEN] as string) || null

    console.log(`[AndroidDaemonConnection] Connected to ${this.host}:${this.port}`)
  }

  send(msg: unknown): void {
    // The Android daemon doesn't use the same message protocol as native host.
    // This is mainly used for handshake which we handle differently.
    // For now, we handle specific ops inline.
    const message = msg as { op?: string; id?: string }

    if (message.op === 'handshake') {
      // Respond with DaemonInfo
      this.handleHandshake()
    } else if (message.op === 'pickDownloadDirectory') {
      // Not supported on Android yet - would need SAF integration
      this.notifyMessage({
        id: message.id,
        ok: false,
        error: 'Folder picker not yet supported on ChromeOS',
      })
    }
  }

  onMessage(cb: (msg: unknown) => void): void {
    this.messageCallbacks.push(cb)
  }

  onDisconnect(cb: () => void): void {
    this.disconnectCallbacks.push(cb)
  }

  /**
   * Get the auth token, prompting for pairing if needed.
   */
  async getOrCreateToken(): Promise<string> {
    // If we have a token, verify it's still valid
    if (this.token) {
      const paired = await this.isPaired()
      if (paired) {
        return this.token
      }
      // Token is invalid, clear it
      console.log('[AndroidDaemonConnection] Stored token is invalid, clearing')
      await this.unpair()
    }

    // Generate new token and initiate pairing
    this.token = crypto.randomUUID()
    await chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: this.token })

    // Open Android app with pairing intent
    await this.openPairingIntent(this.token)

    return this.token
  }

  /**
   * Retry pairing with a new token.
   * Call this if pairing failed or the user wants to re-pair.
   */
  async retryPairing(): Promise<void> {
    await this.unpair()
    await this.getOrCreateToken()
    console.log('[AndroidDaemonConnection] Initiated re-pairing with new token')
  }

  /**
   * Check if we're paired (have a token and daemon accepts it).
   */
  async isPaired(): Promise<boolean> {
    if (!this.token) {
      return false
    }

    // Check daemon's pairing status via /status endpoint
    try {
      const response = await fetch(`http://${this.host}:${this.port}/status`)
      if (!response.ok) {
        return false
      }
      const data = (await response.json()) as { port: number; paired: boolean }
      return data.paired
    } catch {
      return false
    }
  }

  /**
   * Clear pairing and token.
   */
  async unpair(): Promise<void> {
    this.token = null
    await chrome.storage.local.remove([STORAGE_KEY_TOKEN])
  }

  // ============================================================================
  // Private methods
  // ============================================================================

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
    const ports = [7800, 7805, 7814, 7827, 7844]
    for (const port of ports) {
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
      const timeoutId = setTimeout(() => controller.abort(), 2000)

      const response = await fetch(`http://${this.host}:${port}/status`, {
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      return response.ok
    } catch {
      return false
    }
  }

  private async openPairingIntent(token: string): Promise<void> {
    // Create intent URL - must match package in AndroidManifest
    const intentUrl = `intent://pair?token=${encodeURIComponent(token)}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`

    // Open in new tab - Chrome on Android/ChromeOS will handle the intent
    await chrome.tabs.create({ url: intentUrl })

    console.log('[AndroidDaemonConnection] Opened pairing intent')
  }

  private async handleHandshake(): Promise<void> {
    // Ensure we have a token
    const token = await this.getOrCreateToken()

    // Build DaemonInfo response
    const daemonInfo: DaemonInfo = {
      port: this.port,
      token: token,
      version: 1,
      roots: await this.fetchRoots(),
      host: this.host,
    }

    // Notify listeners with DaemonInfo message (same format as native host)
    this.notifyMessage({
      type: 'DaemonInfo',
      payload: daemonInfo,
    })
  }

  private async fetchRoots(): Promise<DownloadRoot[]> {
    // For now, return a single default root
    // The Android app uses its own download directory
    return [
      {
        key: 'default',
        path: '/storage/emulated/0/Download/JSTorrent',
        display_name: 'Downloads',
        removable: false,
        last_stat_ok: true,
        last_checked: Date.now(),
      },
    ]
  }

  private notifyMessage(msg: unknown): void {
    for (const cb of this.messageCallbacks) {
      try {
        cb(msg)
      } catch (e) {
        console.error('[AndroidDaemonConnection] Message callback error:', e)
      }
    }
  }
}
