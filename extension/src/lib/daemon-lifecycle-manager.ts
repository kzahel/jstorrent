import { INativeHostConnection, DaemonInfo, DownloadRoot } from './native-connection'

/** Push event from native host (TorrentAdded, MagnetAdded, etc.) */
export interface NativeEvent {
  event: string
  payload: unknown
}

/**
 * Manages daemon lifecycle in the service worker.
 * Keeps connectNative alive while UI tabs exist, closes it after grace period.
 */
export class DaemonLifecycleManager {
  private nativeConn: INativeHostConnection | null = null
  private daemonInfo: DaemonInfo | null = null
  private activeUICount = 0
  private gracePeriodTimer: ReturnType<typeof setTimeout> | null = null
  private readonly GRACE_PERIOD_MS = 5000
  private nativeFactory: () => INativeHostConnection
  private onEvent?: (event: NativeEvent) => void

  constructor(nativeFactory: () => INativeHostConnection, onEvent?: (event: NativeEvent) => void) {
    this.nativeFactory = nativeFactory
    this.onEvent = onEvent
  }

  /**
   * Get daemon info, opening native connection if needed.
   * Called when UI requests GET_DAEMON_INFO.
   */
  async getDaemonInfo(): Promise<DaemonInfo> {
    // Clear any pending grace period shutdown
    if (this.gracePeriodTimer) {
      clearTimeout(this.gracePeriodTimer)
      this.gracePeriodTimer = null
    }

    this.activeUICount++
    console.log(`[DaemonLifecycleManager] UI connected, count: ${this.activeUICount}`)

    if (this.daemonInfo) {
      return this.daemonInfo
    }

    // Open native connection and perform handshake
    this.nativeConn = this.nativeFactory()
    await this.nativeConn.connect()

    const installId = await this.getInstallId()

    this.nativeConn.send({
      op: 'handshake',
      extensionId: chrome.runtime.id,
      installId,
      id: crypto.randomUUID(),
    })

    this.daemonInfo = await this.waitForDaemonInfo()
    console.log('[DaemonLifecycleManager] Daemon ready:', this.daemonInfo)

    // Set up event listener for push events (TorrentAdded, MagnetAdded, etc.)
    if (this.onEvent) {
      this.nativeConn.onMessage((msg) => {
        if (typeof msg === 'object' && msg !== null && 'event' in msg) {
          console.log('[DaemonLifecycleManager] Received push event:', (msg as NativeEvent).event)
          this.onEvent!(msg as NativeEvent)
        }
      })
    }

    // Set up disconnect handler
    this.nativeConn.onDisconnect(() => {
      console.log('[DaemonLifecycleManager] Native connection disconnected')
      this.daemonInfo = null
      this.nativeConn = null
    })

    return this.daemonInfo
  }

  /**
   * Called when a UI tab closes.
   */
  onUIClosing(): void {
    this.activeUICount = Math.max(0, this.activeUICount - 1)
    console.log(`[DaemonLifecycleManager] UI disconnected, count: ${this.activeUICount}`)

    if (this.activeUICount === 0) {
      this.startGracePeriod()
    }
  }

  /**
   * Pick a download folder via native host dialog.
   * Must be called while native connection is active.
   */
  async pickDownloadFolder(): Promise<DownloadRoot | null> {
    if (!this.nativeConn) {
      throw new Error('Native connection not active')
    }

    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()

      const handler = (msg: unknown) => {
        if (typeof msg !== 'object' || msg === null) return
        const response = msg as {
          id?: string
          ok?: boolean
          type?: string
          payload?: { root?: DownloadRoot }
          error?: string
        }

        if (response.id !== requestId) return

        if (response.ok && response.type === 'RootAdded' && response.payload?.root) {
          resolve(response.payload.root)
        } else {
          console.log('Folder picker cancelled or failed:', response.error)
          resolve(null)
        }
      }

      this.nativeConn!.onMessage(handler)
      this.nativeConn!.send({
        op: 'pickDownloadDirectory',
        id: requestId,
      })
    })
  }

  private startGracePeriod(): void {
    console.log(`[DaemonLifecycleManager] Starting ${this.GRACE_PERIOD_MS}ms grace period`)

    this.gracePeriodTimer = setTimeout(() => {
      if (this.activeUICount === 0) {
        console.log('[DaemonLifecycleManager] Grace period expired, closing native connection')
        this.shutdown()
      }
    }, this.GRACE_PERIOD_MS)
  }

  private shutdown(): void {
    // Note: We don't explicitly disconnect - just let the reference go
    // The native host will detect disconnect and terminate daemon
    this.nativeConn = null
    this.daemonInfo = null
    this.gracePeriodTimer = null
  }

  private async getInstallId(): Promise<string> {
    const result = await chrome.storage.local.get('installId')
    if (result.installId) {
      return result.installId as string
    }
    const newId = crypto.randomUUID()
    await chrome.storage.local.set({ installId: newId })
    return newId
  }

  private waitForDaemonInfo(): Promise<DaemonInfo> {
    return new Promise((resolve) => {
      const handler = (msg: unknown) => {
        console.log('[DaemonLifecycleManager] Raw message from native host:', JSON.stringify(msg))
        if (
          typeof msg === 'object' &&
          msg !== null &&
          'type' in msg &&
          (msg as { type: string }).type === 'DaemonInfo'
        ) {
          const payload = (msg as unknown as { payload: DaemonInfo }).payload
          console.log(
            '[DaemonLifecycleManager] Parsed DaemonInfo payload:',
            JSON.stringify(payload),
          )
          resolve(payload)
        }
      }
      this.nativeConn!.onMessage(handler)
    })
  }
}
