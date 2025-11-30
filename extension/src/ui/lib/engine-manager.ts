import {
  BtEngine,
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  StorageRootManager,
  ChromeStorageSessionStore,
  RingBufferLogger,
  LogEntry,
} from '@jstorrent/engine'
import { getBridge } from './extension-bridge'

export interface DaemonInfo {
  port: number
  token: string
  version?: number
  roots: Array<{
    token: string
    path: string
    display_name: string
    removable: boolean
    last_stat_ok: boolean
    last_checked: number
  }>
}

export interface DownloadRoot {
  token: string
  path: string
  display_name: string
  removable: boolean
  last_stat_ok: boolean
  last_checked: number
}

/**
 * Manages the BtEngine lifecycle in the UI thread.
 * Singleton - one engine per tab.
 */
class EngineManager {
  engine: BtEngine | null = null
  daemonConnection: DaemonConnection | null = null
  logBuffer: RingBufferLogger = new RingBufferLogger(500)
  private initPromise: Promise<BtEngine> | null = null

  /**
   * Initialize the engine. Safe to call multiple times - returns cached engine.
   */
  async init(): Promise<BtEngine> {
    if (this.engine) {
      return this.engine
    }

    // Prevent concurrent initialization
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<BtEngine> {
    console.log('[EngineManager] Initializing...')

    // 1. Get daemon info from service worker
    const bridge = getBridge()
    const response = await bridge.sendMessage<{ ok: boolean; daemonInfo?: DaemonInfo; error?: string }>(
      { type: 'GET_DAEMON_INFO' },
    )
    if (!response.ok) {
      throw new Error(`Failed to get daemon info: ${response.error}`)
    }
    const daemonInfo: DaemonInfo = response.daemonInfo!
    console.log('[EngineManager] Got daemon info:', daemonInfo)

    // 2. Create direct WebSocket connection to daemon
    this.daemonConnection = new DaemonConnection(daemonInfo.port, daemonInfo.token)
    await this.daemonConnection.connectWebSocket()
    console.log('[EngineManager] WebSocket connected')

    // 3. Set up storage root manager
    const srm = new StorageRootManager(
      (root) => new DaemonFileSystem(this.daemonConnection!, root.token),
    )

    // Register download roots from daemon
    if (daemonInfo.roots && daemonInfo.roots.length > 0) {
      for (const root of daemonInfo.roots) {
        srm.addRoot({
          token: root.token,
          label: root.display_name,
          path: root.path,
        })
      }

      // Load saved default root
      const savedDefault = await chrome.storage.local.get('defaultRootToken')
      const defaultToken = savedDefault.defaultRootToken
      const validDefault = daemonInfo.roots.some((r) => r.token === defaultToken)

      if (validDefault && typeof defaultToken === 'string') {
        srm.setDefaultRoot(defaultToken)
      } else if (daemonInfo.roots.length > 0) {
        srm.setDefaultRoot(daemonInfo.roots[0].token)
      }
      console.log('[EngineManager] Registered', daemonInfo.roots.length, 'download roots')
    } else {
      console.warn('[EngineManager] No download roots configured!')
    }

    // 4. Create session store
    const sessionStore = new ChromeStorageSessionStore(chrome.storage.local, 'session:')

    // 5. Create engine (suspended)
    this.engine = new BtEngine({
      socketFactory: new DaemonSocketFactory(this.daemonConnection),
      storageRootManager: srm,
      sessionStore,
      startSuspended: true,
      onLog: (entry: LogEntry) => {
        this.logBuffer.add(entry)
      },
    })
    console.log('[EngineManager] Engine created (suspended)')

    // 6. Restore session
    const restored = await this.engine.restoreSession()
    console.log(`[EngineManager] Restored ${restored} torrents`)

    // 7. Resume engine
    this.engine.resume()
    console.log('[EngineManager] Engine resumed')

    // 8. Set up beforeunload handler
    window.addEventListener('beforeunload', () => {
      this.shutdown()
    })

    return this.engine
  }

  /**
   * Clean shutdown - notify SW that this UI is closing.
   */
  shutdown(): void {
    console.log('[EngineManager] Shutting down...')

    // Notify service worker
    getBridge().postMessage({ type: 'UI_CLOSING' })

    // Clean up engine
    if (this.engine) {
      this.engine.destroy()
      this.engine = null
    }

    // Clean up connection
    if (this.daemonConnection) {
      this.daemonConnection.close()
      this.daemonConnection = null
    }

    this.initPromise = null
  }

  /**
   * Pick a download folder via native host.
   * Returns the new root, or null if cancelled.
   */
  async pickDownloadFolder(): Promise<DownloadRoot | null> {
    const response = await getBridge().sendMessage<{ ok: boolean; root?: DownloadRoot; error?: string }>(
      { type: 'PICK_DOWNLOAD_FOLDER' },
    )
    if (!response.ok || !response.root) {
      return null
    }

    // Register with StorageRootManager
    if (this.engine) {
      const root = response.root
      this.engine.storageRootManager.addRoot({
        token: root.token,
        label: root.display_name,
        path: root.path,
      })
    }

    return response.root
  }

  /**
   * Set the default download root.
   */
  async setDefaultRoot(token: string): Promise<void> {
    if (!this.engine) {
      throw new Error('Engine not initialized')
    }
    this.engine.storageRootManager.setDefaultRoot(token)
    await chrome.storage.local.set({ defaultRootToken: token })
  }

  /**
   * Get current download roots.
   */
  getRoots(): Array<{ token: string; label: string; path: string }> {
    if (!this.engine) return []
    return this.engine.storageRootManager.getRoots()
  }

  /**
   * Get current default root token.
   */
  async getDefaultRootToken(): Promise<string | null> {
    const result = await chrome.storage.local.get('defaultRootToken')
    return (result.defaultRootToken as string) || null
  }
}

// Singleton export
export const engineManager = new EngineManager()

// Expose for debugging in console
// @ts-expect-error -- exposing engineManager for debugging
window.engineManager = engineManager
