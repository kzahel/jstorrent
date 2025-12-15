import {
  BtEngine,
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  DaemonHasher,
  StorageRootManager,
  ChromeStorageSessionStore,
  ExternalChromeStorageSessionStore,
  globalLogStore,
  LogStore,
  ISessionStore,
  Torrent,
  toHex,
  type CredentialsGetter,
} from '@jstorrent/engine'
import { getSettingsStore } from '../settings'
import { getBridge } from './extension-bridge'
import { notificationBridge, ProgressStats } from './notification-bridge'

// Session store key for default root key
const DEFAULT_ROOT_KEY_KEY = 'settings:defaultRootKey'

/**
 * Create credentials getter for DaemonConnection.
 * Reads fresh values from chrome.storage.local at connection time.
 */
function createCredentialsGetter(): CredentialsGetter {
  return async () => {
    const stored = await chrome.storage.local.get(['android:authToken', 'installId'])
    const token = stored['android:authToken'] as string | undefined
    const installId = stored['installId'] as string | undefined

    if (!token) {
      throw new Error('No auth token in storage')
    }

    return {
      token,
      extensionId: chrome.runtime.id,
      installId: installId || '',
    }
  }
}

/**
 * Create the appropriate session store based on context.
 */
function createSessionStore(): ISessionStore {
  const bridge = getBridge()

  if (!bridge.isDevMode) {
    // Inside extension - use direct chrome.storage.local
    return new ChromeStorageSessionStore(chrome.storage.local, 'session:')
  }

  // External (jstorrent.com or localhost) - relay through extension
  if (!bridge.extensionId) {
    throw new Error('Extension ID required for external session store')
  }
  return new ExternalChromeStorageSessionStore(bridge.extensionId)
}

export interface DaemonInfo {
  port: number
  token: string
  version?: number
  roots: Array<{
    key: string
    path: string
    display_name: string
    removable: boolean
    last_stat_ok: boolean
    last_checked: number
  }>
  /** Host address for daemon connection. Defaults to 127.0.0.1 on desktop, but differs on ChromeOS. */
  host?: string
}

export interface DownloadRoot {
  key: string
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
  logStore: LogStore = globalLogStore
  private sessionStore: ISessionStore | null = null
  private initPromise: Promise<BtEngine> | null = null
  private swPort: chrome.runtime.Port | null = null
  private notificationProgressInterval: ReturnType<typeof setInterval> | null = null
  private previousActiveCount: number = 0
  private previousCompletedCount: number = 0

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
    const response = await bridge.sendMessage<{
      ok: boolean
      daemonInfo?: DaemonInfo
      roots?: DownloadRoot[]
      error?: string
      status?: string
    }>({ type: 'GET_DAEMON_INFO' })
    if (!response.ok) {
      throw new Error(`Failed to get daemon info: ${response.error || response.status}`)
    }
    const daemonInfo: DaemonInfo = response.daemonInfo!
    // Roots may come separately or in daemonInfo (for backwards compatibility)
    const roots: DownloadRoot[] = response.roots ?? daemonInfo.roots ?? []
    console.log('[EngineManager] Got daemon info:', daemonInfo, 'roots:', roots.length)

    // 2. Create direct WebSocket connection to daemon
    // On ChromeOS, use credentials getter for fresh token
    // On desktop, use token directly from daemon info
    const isChromeos = daemonInfo.host === '100.115.92.2'

    if (isChromeos) {
      this.daemonConnection = new DaemonConnection(
        daemonInfo.port,
        daemonInfo.host,
        createCredentialsGetter(),
      )
    } else {
      // Desktop - use legacy token directly
      this.daemonConnection = new DaemonConnection(
        daemonInfo.port,
        daemonInfo.host,
        undefined,
        daemonInfo.token,
      )
    }
    try {
      await this.daemonConnection.connectWebSocket()
    } catch (error) {
      // If auth failed, signal IOBridge to clear token and trigger re-pairing
      if (error instanceof Error && error.message.includes('auth failed')) {
        console.log('[EngineManager] Auth failed, signaling IOBridge')
        bridge.postMessage({ type: 'IOBRIDGE_AUTH_FAILED' })
      }
      throw error
    }
    console.log('[EngineManager] WebSocket connected')

    // Register disconnect/reconnect handlers
    this.daemonConnection.onDisconnect((reason) => {
      console.error('[EngineManager] IO WebSocket disconnected:', reason)
      this.handleIoDisconnect(reason)
    })
    this.daemonConnection.onReconnect(() => {
      console.log('[EngineManager] IO WebSocket reconnected')
      this.handleIoReconnect()
    })

    // 3. Set up storage root manager
    const srm = new StorageRootManager(
      (root) => new DaemonFileSystem(this.daemonConnection!, root.key),
    )

    // 4. Create session store (before registering roots so we can load default)
    this.sessionStore = createSessionStore()

    // Register download roots from daemon
    if (roots.length > 0) {
      for (const root of roots) {
        srm.addRoot({
          key: root.key,
          label: root.display_name,
          path: root.path,
        })
      }

      // Load saved default root from session store
      const savedDefaultBytes = await this.sessionStore.get(DEFAULT_ROOT_KEY_KEY)
      const defaultKey = savedDefaultBytes ? new TextDecoder().decode(savedDefaultBytes) : null
      const validDefault = defaultKey && roots.some((r) => r.key === defaultKey)

      if (validDefault) {
        srm.setDefaultRoot(defaultKey)
      } else if (roots.length > 0) {
        srm.setDefaultRoot(roots[0].key)
      }
      console.log('[EngineManager] Registered', roots.length, 'download roots')
    } else {
      console.warn('[EngineManager] No download roots configured!')
    }

    // 5. Create engine (suspended)
    const hasher = new DaemonHasher(this.daemonConnection)
    const settingsStore = getSettingsStore()
    this.engine = new BtEngine({
      socketFactory: new DaemonSocketFactory(this.daemonConnection),
      storageRootManager: srm,
      sessionStore: this.sessionStore,
      hasher,
      port: settingsStore.get('listeningPort'),
      startSuspended: true,
      getNetworkInterfaces: () => this.daemonConnection!.getNetworkInterfaces(),
    })
    // @ts-expect-error -- expose engine for debugging
    window.engine = this.engine // expose for debugging
    console.log('[EngineManager] Engine created (suspended)')

    // 6. Restore session
    const restored = await this.engine.restoreSession()
    console.log(`[EngineManager] Restored ${restored} torrents`)

    // 7. Resume engine
    this.engine.resume()
    console.log('[EngineManager] Engine resumed')

    // 8. Apply rate limits and connection limits from settings
    this.setRateLimits(
      settingsStore.get('downloadSpeedLimit'),
      settingsStore.get('uploadSpeedLimit'),
    )
    this.setConnectionLimits(
      settingsStore.get('maxPeersPerTorrent'),
      settingsStore.get('maxGlobalPeers'),
      settingsStore.get('maxUploadSlots'),
    )
    this.setDaemonRateLimit(
      settingsStore.get('daemonOpsPerSecond'),
      settingsStore.get('daemonOpsBurst'),
    )

    // 9. Set up beforeunload handler
    window.addEventListener('beforeunload', () => {
      this.shutdown()
    })

    // 10. Set up notification handling
    // Note: Port connection for native events is now handled by useIOBridgeState in App.tsx
    this.setupNotifications()

    return this.engine
  }

  /**
   * Clean shutdown - notify SW that this UI is closing.
   */
  shutdown(): void {
    console.log('[EngineManager] Shutting down...')

    // Clean up notification interval
    if (this.notificationProgressInterval) {
      clearInterval(this.notificationProgressInterval)
      this.notificationProgressInterval = null
    }

    // Notify service worker
    getBridge().postMessage({ type: 'UI_CLOSING' })

    // Clean up engine
    if (this.engine) {
      this.engine.destroy()
      this.engine = null
    }

    // Note: Don't close daemonConnection here. The engine.destroy() is async but
    // beforeunload can't wait for it, so closing the connection immediately would
    // cause tracker announce('stopped') to fail. The WebSocket will close
    // automatically when the page unloads.
    this.daemonConnection = null

    this.initPromise = null
  }

  /**
   * Handle IO websocket disconnect.
   * Marks active torrents with error and shows notification.
   */
  private handleIoDisconnect(_reason: string): void {
    if (!this.engine) return

    // Mark all active torrents with IO error
    for (const torrent of this.engine.torrents) {
      if (torrent.userState === 'active' && !torrent.errorMessage) {
        torrent.errorMessage = 'IO connection lost'
      }
    }
  }

  /**
   * Handle IO websocket reconnect.
   * Clears IO errors and resumes torrents.
   */
  private handleIoReconnect(): void {
    if (!this.engine) return

    // Clear IO-related errors and let torrents resume naturally
    for (const torrent of this.engine.torrents) {
      if (torrent.errorMessage === 'IO connection lost') {
        torrent.errorMessage = undefined
        // Torrents will automatically re-establish peers on next tick
      }
    }
  }

  /**
   * Pick a download folder via native host.
   * Returns the new root, or null if cancelled.
   */
  async pickDownloadFolder(): Promise<DownloadRoot | null> {
    const response = await getBridge().sendMessage<{
      ok: boolean
      root?: DownloadRoot
      error?: string
    }>({ type: 'PICK_DOWNLOAD_FOLDER' })
    if (!response.ok || !response.root) {
      return null
    }

    // Register with StorageRootManager
    if (this.engine) {
      const root = response.root
      this.engine.storageRootManager.addRoot({
        key: root.key,
        label: root.display_name,
        path: root.path,
      })
    }

    return response.root
  }

  /**
   * Remove a download root.
   * Does not block removal if torrents are using it - they will error.
   * Returns true if removed successfully.
   */
  async removeDownloadRoot(key: string): Promise<boolean> {
    const response = await getBridge().sendMessage<{
      ok: boolean
      error?: string
    }>({ type: 'REMOVE_DOWNLOAD_ROOT', key })

    if (!response.ok) {
      console.error('[EngineManager] Failed to remove root:', response.error)
      return false
    }

    // Remove from StorageRootManager
    if (this.engine) {
      this.engine.storageRootManager.removeRoot(key)

      // If this was the default root, select a new default
      const currentDefault = this.engine.storageRootManager.getDefaultRoot()
      if (!currentDefault) {
        // Default was cleared - set new default if any roots remain
        const remaining = this.engine.storageRootManager.getRoots()
        if (remaining.length > 0) {
          this.engine.storageRootManager.setDefaultRoot(remaining[0].key)
          if (this.sessionStore) {
            await this.sessionStore.set(
              DEFAULT_ROOT_KEY_KEY,
              new TextEncoder().encode(remaining[0].key),
            )
          }
        } else if (this.sessionStore) {
          // No roots left - clear the persisted default
          await this.sessionStore.delete(DEFAULT_ROOT_KEY_KEY)
        }
      }
    }

    return true
  }

  /**
   * Open a file with the system's default application.
   * @param torrentHash The torrent's info hash (hex)
   * @param filePath The file's path (already includes torrent name as root dir per BT spec)
   */
  async openFile(torrentHash: string, filePath: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.engine) {
      return { ok: false, error: 'Engine not initialized' }
    }

    // Get the root key for this torrent
    const root = this.engine.storageRootManager.getRootForTorrent(torrentHash)
    if (!root) {
      return { ok: false, error: 'No storage root for torrent' }
    }

    // filePath already includes torrent name as root directory (per BT spec for multi-file torrents)
    return getBridge().sendMessage<{ ok: boolean; error?: string }>({
      type: 'OPEN_FILE',
      rootKey: root.key,
      path: filePath,
    })
  }

  /**
   * Reveal a file in the system file manager.
   * @param torrentHash The torrent's info hash (hex)
   * @param filePath The file's path (already includes torrent name as root dir per BT spec)
   */
  async revealInFolder(
    torrentHash: string,
    filePath: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.engine) {
      return { ok: false, error: 'Engine not initialized' }
    }

    // Get the root key for this torrent
    const root = this.engine.storageRootManager.getRootForTorrent(torrentHash)
    if (!root) {
      return { ok: false, error: 'No storage root for torrent' }
    }

    // filePath already includes torrent name as root directory (per BT spec for multi-file torrents)
    return getBridge().sendMessage<{ ok: boolean; error?: string }>({
      type: 'REVEAL_IN_FOLDER',
      rootKey: root.key,
      path: filePath,
    })
  }

  /**
   * Open the torrent's storage folder in the system file manager.
   * @param torrentHash The torrent's info hash (hex)
   */
  async openTorrentFolder(torrentHash: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.engine) {
      return { ok: false, error: 'Engine not initialized' }
    }

    const torrent = this.engine.torrents.find((t) => toHex(t.infoHash) === torrentHash)
    if (!torrent) {
      return { ok: false, error: 'Torrent not found' }
    }

    // Get the root key for this torrent
    const root = this.engine.storageRootManager.getRootForTorrent(torrentHash)
    if (!root) {
      return { ok: false, error: 'No storage root for torrent' }
    }

    // Use torrent name as path (folder for multi-file, file for single-file)
    const path = torrent.name || torrentHash
    return getBridge().sendMessage<{ ok: boolean; error?: string }>({
      type: 'REVEAL_IN_FOLDER',
      rootKey: root.key,
      path,
    })
  }

  /**
   * Get the full filesystem path for a torrent file.
   * @param torrentHash The torrent's info hash (hex)
   * @param filePath The file's path (already includes torrent name as root dir per BT spec)
   * @returns The full path, or null if the root is not found
   */
  getFilePath(torrentHash: string, filePath: string): string | null {
    if (!this.engine) {
      return null
    }

    // Get the root for this torrent (contains both key and path)
    const root = this.engine.storageRootManager.getRootForTorrent(torrentHash)
    if (!root) {
      return null
    }

    // Combine root path with file path
    // filePath already includes torrent name as root directory (per BT spec for multi-file torrents)
    return `${root.path}/${filePath}`
  }

  /**
   * Set the default download root.
   */
  async setDefaultRoot(key: string): Promise<void> {
    if (!this.engine) {
      throw new Error('Engine not initialized')
    }
    this.engine.storageRootManager.setDefaultRoot(key)
    if (this.sessionStore) {
      await this.sessionStore.set(DEFAULT_ROOT_KEY_KEY, new TextEncoder().encode(key))
    }
  }

  /**
   * Get current download roots.
   */
  getRoots(): Array<{ key: string; label: string; path: string }> {
    if (!this.engine) return []
    return this.engine.storageRootManager.getRoots()
  }

  /**
   * Get current default root key.
   */
  async getDefaultRootKey(): Promise<string | null> {
    if (!this.sessionStore) {
      return null
    }
    const bytes = await this.sessionStore.get(DEFAULT_ROOT_KEY_KEY)
    return bytes ? new TextDecoder().decode(bytes) : null
  }

  /**
   * Set download and upload rate limits.
   * @param downloadLimit - bytes per second (0 = unlimited)
   * @param uploadLimit - bytes per second (0 = unlimited)
   */
  setRateLimits(downloadLimit: number, uploadLimit: number): void {
    if (!this.engine) {
      console.warn('[EngineManager] Cannot set rate limits: engine not initialized')
      return
    }
    this.engine.bandwidthTracker.setDownloadLimit(downloadLimit)
    this.engine.bandwidthTracker.setUploadLimit(uploadLimit)
    console.log(
      `[EngineManager] Rate limits set: download=${downloadLimit === 0 ? 'unlimited' : downloadLimit + ' B/s'}, upload=${uploadLimit === 0 ? 'unlimited' : uploadLimit + ' B/s'}`,
    )
  }

  /**
   * Set connection limits.
   * @param maxPeersPerTorrent - Maximum peers per torrent
   * @param maxGlobalPeers - Maximum total connections across all torrents
   * @param maxUploadSlots - Maximum simultaneously unchoked peers per torrent
   */
  setConnectionLimits(
    maxPeersPerTorrent: number,
    maxGlobalPeers: number,
    maxUploadSlots: number,
  ): void {
    if (!this.engine) {
      console.warn('[EngineManager] Cannot set connection limits: engine not initialized')
      return
    }
    this.engine.setConnectionLimits(maxPeersPerTorrent, maxGlobalPeers, maxUploadSlots)
    console.log(
      `[EngineManager] Connection limits set: maxPeersPerTorrent=${maxPeersPerTorrent}, maxGlobalPeers=${maxGlobalPeers}, maxUploadSlots=${maxUploadSlots}`,
    )
  }

  /**
   * Set daemon operation rate limit (connections, announces).
   * @param opsPerSecond - operations per second
   * @param burstSize - burst capacity
   */
  setDaemonRateLimit(opsPerSecond: number, burstSize: number): void {
    if (!this.engine) {
      console.warn('[EngineManager] Cannot set daemon rate limit: engine not initialized')
      return
    }
    this.engine.setDaemonRateLimit(opsPerSecond, burstSize)
    console.log(
      `[EngineManager] Daemon rate limit set: ${opsPerSecond} ops/sec, burst=${burstSize}`,
    )
  }

  /**
   * Enable or disable UPnP port mapping.
   * @param enabled - Whether UPnP should be enabled
   */
  async setUPnPEnabled(enabled: boolean): Promise<void> {
    if (!this.engine) {
      console.warn('[EngineManager] Cannot set UPnP: engine not initialized')
      return
    }
    await this.engine.setUPnPEnabled(enabled)
  }

  /**
   * Set up notification handling for download events.
   */
  private setupNotifications(): void {
    if (!this.engine) return

    // Subscribe to torrent complete events
    this.engine.on('torrent-complete', (torrent: Torrent) => {
      notificationBridge.onTorrentComplete(toHex(torrent.infoHash), torrent.name || 'Unknown')
    })

    // Subscribe to error events
    // Note: Engine errors may not always have a torrent context
    // We handle this gracefully by checking if torrent info is available

    // Set up progress polling interval
    this.notificationProgressInterval = setInterval(() => {
      this.sendProgressUpdate()
    }, 1000)

    // Send initial progress update
    this.sendProgressUpdate()
  }

  /**
   * Calculate and send progress stats to the notification bridge.
   */
  private sendProgressUpdate(): void {
    if (!this.engine) return

    const torrents = this.engine.torrents

    // Active torrents: user wants them running and not complete
    const activeTorrents = torrents.filter(
      (t) => t.userState === 'active' && !t.isComplete && t.hasMetadata,
    )

    // Error torrents: have an error message
    const errorTorrents = torrents.filter((t) => t.errorMessage)

    // Calculate combined download speed
    const downloadSpeed = torrents.reduce((sum, t) => sum + (t.downloadSpeed || 0), 0)

    // Calculate combined ETA (max of all active torrent ETAs)
    const eta = this.calculateCombinedEta(activeTorrents)

    // Completed torrents: finished downloading
    const completedCount = torrents.filter((t) => t.isComplete).length

    const stats: ProgressStats = {
      activeCount: activeTorrents.length,
      errorCount: errorTorrents.length,
      downloadSpeed,
      eta,
      singleTorrentName: activeTorrents.length === 1 ? activeTorrents[0].name : undefined,
    }

    // Detect transition to all complete
    // Only fire if: active count dropped to 0 AND completed count increased
    // This ensures we only notify when downloads actually finished, not when stopped
    const justCompleted = completedCount > this.previousCompletedCount
    if (this.previousActiveCount > 0 && stats.activeCount === 0 && justCompleted) {
      notificationBridge.onAllComplete()
    }
    this.previousActiveCount = stats.activeCount
    this.previousCompletedCount = completedCount

    notificationBridge.updateProgress(stats)
  }

  /**
   * Calculate the combined ETA for all active torrents.
   * Returns the maximum ETA (i.e., when will all torrents be done).
   */
  private calculateCombinedEta(activeTorrents: Torrent[]): number | null {
    let maxEta: number | null = null

    for (const torrent of activeTorrents) {
      // Calculate ETA from progress and download speed
      if (torrent.downloadSpeed > 0 && torrent.progress < 1) {
        const remainingBytes = this.calculateRemainingBytes(torrent)
        if (remainingBytes > 0) {
          const eta = remainingBytes / torrent.downloadSpeed
          if (maxEta === null || eta > maxEta) {
            maxEta = eta
          }
        }
      }
    }

    return maxEta
  }

  /**
   * Calculate remaining bytes for a torrent.
   */
  private calculateRemainingBytes(torrent: Torrent): number {
    // If we have content storage, use actual file sizes
    if (torrent.contentStorage) {
      const files = torrent.files
      const totalSize = files.reduce((sum, f) => sum + f.length, 0)
      return totalSize * (1 - torrent.progress)
    }

    // Fallback: estimate from piece info
    if (torrent.piecesCount > 0) {
      const remainingPieces = torrent.piecesCount - torrent.completedPiecesCount
      return remainingPieces * torrent.pieceLength
    }

    return 0
  }

  private swReconnectAttempts = 0
  private readonly SW_MAX_RECONNECTS = 3
  private readonly SW_RECONNECT_DELAY = 1000

  /**
   * Connect to service worker via persistent port for real-time events.
   */
  private connectToServiceWorker(): void {
    const bridge = getBridge()

    // Check reconnect limit
    if (this.swReconnectAttempts >= this.SW_MAX_RECONNECTS) {
      console.error(
        `[EngineManager] SW reconnect limit (${this.SW_MAX_RECONNECTS}) reached, giving up`,
      )
      return
    }

    try {
      // In dev mode, connect with extension ID; in extension context, connect directly
      if (bridge.isDevMode && bridge.extensionId) {
        this.swPort = chrome.runtime.connect(bridge.extensionId, { name: 'ui' })
      } else {
        this.swPort = chrome.runtime.connect({ name: 'ui' })
      }

      // Check for connection error
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message)
      }

      this.swPort.onMessage.addListener(
        (msg: { type?: string; event?: string; payload?: unknown }) => {
          console.log('[EngineManager] Received from SW:', msg)

          // Reset reconnect counter on first message (proves connection is stable)
          this.swReconnectAttempts = 0

          // Handle CLOSE message (single UI enforcement)
          if (msg.type === 'CLOSE') {
            console.log('[EngineManager] Received CLOSE, closing window')
            window.close()
            return
          }

          // Handle native events
          if (msg.event) {
            this.handleNativeEvent(msg.event, msg.payload)
          }
        },
      )

      this.swPort.onDisconnect.addListener(() => {
        console.log('[EngineManager] SW port disconnected')
        this.swPort = null

        // Only attempt reconnect if engine is still running
        if (this.engine) {
          this.swReconnectAttempts++
          console.log(
            `[EngineManager] Will retry SW connection (${this.swReconnectAttempts}/${this.SW_MAX_RECONNECTS})...`,
          )
          setTimeout(() => this.connectToServiceWorker(), this.SW_RECONNECT_DELAY)
        }
      })

      console.log('[EngineManager] Connected to SW via port')
    } catch (e) {
      console.error('[EngineManager] Failed to connect to SW:', e)
      this.swPort = null

      // Retry connection
      if (this.engine) {
        this.swReconnectAttempts++
        if (this.swReconnectAttempts < this.SW_MAX_RECONNECTS) {
          console.log(
            `[EngineManager] Retrying SW connection (${this.swReconnectAttempts}/${this.SW_MAX_RECONNECTS})...`,
          )
          setTimeout(() => this.connectToServiceWorker(), this.SW_RECONNECT_DELAY)
        } else {
          console.error('[EngineManager] Max retries reached, SW port not connected')
        }
      }
    }
  }

  /**
   * Handle native events forwarded from service worker.
   * Public so App can forward events from useIOBridgeState.
   */
  async handleNativeEvent(event: string, payload: unknown): Promise<void> {
    if (!this.engine) {
      console.warn('[EngineManager] Received event but engine not ready:', event)
      return
    }

    if (event === 'TorrentAdded') {
      const p = payload as { name: string; infohash: string; contentsBase64: string }
      console.log('[EngineManager] Adding torrent:', p.name)
      try {
        const bytes = Uint8Array.from(atob(p.contentsBase64), (c) => c.charCodeAt(0))
        await this.engine.addTorrent(bytes)
      } catch (e) {
        console.error('[EngineManager] Failed to add torrent:', e)
      }
    } else if (event === 'MagnetAdded') {
      const p = payload as { link: string }
      console.log('[EngineManager] Adding magnet:', p.link)
      try {
        // addTorrent accepts both magnet links and torrent buffers
        await this.engine.addTorrent(p.link)
      } catch (e) {
        console.error('[EngineManager] Failed to add magnet:', e)
      }
    }
  }
}

// Singleton export
export const engineManager = new EngineManager()

// Expose for debugging in console
// @ts-expect-error -- exposing engineManager for debugging
window.engineManager = engineManager
/**
 * Debug helper: Add Big Buck Bunny test torrent and start immediately.
 * Call from console: addTestTorrent()
 */
async function addTestTorrent(url?: string): Promise<Torrent | null> {
  let magnet =
    url ??
    'magnet:?xt=urn:btih:a4e71df0553e6c565df4958a817b1f1a780503da&dn=big_buck_bunny_720p_surround.mp4'
  magnet += '&x.pe=127.0.0.1:8998&x.pe=127.0.0.1:6082'

  const engine = await engineManager.init()
  const torrent = await engine.addTorrent(magnet)
  if (torrent) {
    console.log('[addTestTorrent] Added:', torrent.name, toHex(torrent.infoHash))
  } else {
    console.log('[addTestTorrent] Torrent already exists or failed to add')
  }
  return torrent
}

async function addTestTorrent2(): Promise<Torrent | null> {
  const url =
    'magnet:?xt=urn:btih:68e52e19f423308ba4f330d5a9b7fb68cec36355&xt=urn:btmh:1220d501d9530fb0563cb8113adb85a69df2cf5997f59b1927d302fc807e407dc0ee&dn=remy%20reads%20a%20book.mp4'
  return addTestTorrent(url)
}

/**
 * Debug helper: Add n fake test torrents with sequential hashes.
 * Call from console: addTestTorrents(100)
 */
async function addTestTorrents(n: number): Promise<Torrent[]> {
  const engine = await engineManager.init()
  const added: Torrent[] = []

  for (let i = 1; i <= n; i++) {
    // Pad to 3 hex digits for display: 001, 002, ..., 00f, 010, ...
    const hexNum = i.toString(16).padStart(3, '0')
    // Full 40-char info hash (pad with leading zeros)
    const infoHash = i.toString(16).padStart(40, '0')
    const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=test%20torrent%20${hexNum}`

    const torrent = await engine.addTorrent(magnet, { userState: 'stopped' })
    if (torrent) {
      added.push(torrent)
    }
  }

  console.log(`[addTestTorrents] Added ${added.length}/${n} torrents`)
  return added
}

// @ts-expect-error -- exposing addTestTorrent for debugging
window.addTestTorrent = addTestTorrent
// @ts-expect-error -- exposing addTestTorrent2 for debugging
window.addTestTorrent2 = addTestTorrent2

// @ts-expect-error -- exposing addTestTorrents for debugging
window.addTestTorrents = addTestTorrents
