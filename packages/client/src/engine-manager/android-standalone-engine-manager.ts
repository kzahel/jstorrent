import {
  BtEngine,
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  StorageRootManager,
  globalLogStore,
  LogStore,
  type EngineLoggingConfig,
} from '@jstorrent/engine'
import { JsBridgeSessionStore, JsBridgeSettingsStore } from '@jstorrent/engine/adapters/android'
import type { IEngineManager, StorageRoot } from './types'

// Session store key for default root key
const DEFAULT_ROOT_KEY_KEY = 'settings:defaultRootKey'

/**
 * Window interfaces for Android bridges.
 */
declare global {
  interface Window {
    JSTORRENT_CONFIG?: {
      daemonUrl: string
      platform: string
    }
    RootsBridge?: {
      hasDownloadRoot(): boolean
      getDownloadRoots(): string // JSON array of roots
      getDefaultRootKey(): string | null
    }
    // Debug exports
    engine?: unknown
  }
}

/**
 * Android Standalone engine manager.
 * Manages the BtEngine lifecycle for Android WebView context.
 * Uses JS bridges instead of Chrome extension APIs.
 */
export class AndroidStandaloneEngineManager implements IEngineManager {
  engine: BtEngine | null = null
  logStore: LogStore = globalLogStore
  readonly supportsFileOperations = false

  private daemonConnection: DaemonConnection | null = null
  private sessionStore: JsBridgeSessionStore | null = null
  private settingsStore: JsBridgeSettingsStore | null = null
  private initPromise: Promise<BtEngine> | null = null
  private config: { daemonUrl: string; platform: string } | null = null
  private pendingNativeEvents: Array<{ event: string; payload: unknown }> = []

  constructor(config?: { daemonUrl: string; platform: string }) {
    this.config = config ?? window.JSTORRENT_CONFIG ?? null
  }

  /**
   * Set configuration. Can be called after construction if config wasn't available.
   */
  setConfig(config: { daemonUrl: string; platform: string }): void {
    this.config = config
  }

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
    console.log('[AndroidStandaloneEngineManager] Initializing...')

    if (!this.config) {
      throw new Error('Config not set - call setConfig() or provide config in constructor')
    }

    // 1. Parse daemon URL
    const url = new URL(this.config.daemonUrl)
    const port = parseInt(url.port) || 7800
    const host = url.hostname
    const authToken = url.searchParams.get('token') || ''

    console.log(`[AndroidStandaloneEngineManager] Connecting to daemon at ${host}:${port}`)

    // 2. Create daemon connection
    this.daemonConnection = new DaemonConnection(port, host, undefined, authToken)
    await this.daemonConnection.connectWebSocket()
    console.log('[AndroidStandaloneEngineManager] WebSocket connected')

    // Register disconnect/reconnect handlers
    this.daemonConnection.onDisconnect((reason) => {
      console.error('[AndroidStandaloneEngineManager] IO WebSocket disconnected:', reason)
      this.handleIoDisconnect(reason)
    })
    this.daemonConnection.onReconnect(() => {
      console.log('[AndroidStandaloneEngineManager] IO WebSocket reconnected')
      this.handleIoReconnect()
    })

    // 3. Set up storage root manager
    const srm = new StorageRootManager(
      (root) => new DaemonFileSystem(this.daemonConnection!, root.key),
    )

    // 4. Create session store and settings store
    this.sessionStore = new JsBridgeSessionStore()
    this.settingsStore = new JsBridgeSettingsStore()
    await this.settingsStore.init()

    // 5. Load roots from RootsBridge
    const rootsJson = window.RootsBridge?.getDownloadRoots()
    if (rootsJson) {
      const roots = JSON.parse(rootsJson) as Array<{
        key: string
        displayName: string
        available?: boolean
      }>
      for (const root of roots) {
        srm.addRoot({
          key: root.key,
          label: root.displayName,
          path: root.key, // Android SAF URIs - key is the path
        })
      }
      console.log('[AndroidStandaloneEngineManager] Registered', roots.length, 'download roots')

      // Set default root
      const savedDefaultBytes = await this.sessionStore.get(DEFAULT_ROOT_KEY_KEY)
      const savedDefaultKey = savedDefaultBytes ? new TextDecoder().decode(savedDefaultBytes) : null
      const validDefault = savedDefaultKey && roots.some((r) => r.key === savedDefaultKey)

      if (validDefault) {
        srm.setDefaultRoot(savedDefaultKey)
      } else {
        const defaultKey = window.RootsBridge?.getDefaultRootKey()
        if (defaultKey) {
          srm.setDefaultRoot(defaultKey)
        } else if (roots.length > 0) {
          srm.setDefaultRoot(roots[0].key)
        }
      }
    } else {
      console.warn('[AndroidStandaloneEngineManager] No download roots configured!')
    }

    // 6. Create engine (suspended)
    this.engine = new BtEngine({
      socketFactory: new DaemonSocketFactory(this.daemonConnection),
      storageRootManager: srm,
      sessionStore: this.sessionStore,
      port: this.settingsStore.get('listeningPort'),
      startSuspended: true,
    })
    window.engine = this.engine // expose for debugging
    console.log('[AndroidStandaloneEngineManager] Engine created (suspended)')

    // 7. Restore session
    const restored = await this.engine.restoreSession()
    console.log(`[AndroidStandaloneEngineManager] Restored ${restored} torrents`)

    // 8. Resume engine
    this.engine.resume()
    console.log('[AndroidStandaloneEngineManager] Engine resumed')

    // 9. Apply initial settings
    this.applyInitialSettings()

    // 10. Process any native events that arrived during initialization
    if (this.pendingNativeEvents.length > 0) {
      console.log(
        '[AndroidStandaloneEngineManager] Processing',
        this.pendingNativeEvents.length,
        'queued events',
      )
      for (const { event, payload } of this.pendingNativeEvents) {
        await this.handleNativeEvent(event, payload)
      }
      this.pendingNativeEvents = []
    }

    return this.engine
  }

  private applyInitialSettings(): void {
    if (!this.engine || !this.settingsStore) return

    const s = this.settingsStore
    const downloadLimit = s.get('downloadSpeedLimitUnlimited') ? 0 : s.get('downloadSpeedLimit')
    const uploadLimit = s.get('uploadSpeedLimitUnlimited') ? 0 : s.get('uploadSpeedLimit')
    this.setRateLimits(downloadLimit, uploadLimit)
    this.setConnectionLimits(
      s.get('maxPeersPerTorrent'),
      s.get('maxGlobalPeers'),
      s.get('maxUploadSlots'),
    )
    this.setDaemonRateLimit(s.get('daemonOpsPerSecond'), s.get('daemonOpsBurst'))
    this.setEncryptionPolicy(s.get('encryptionPolicy'))
    // Don't await - DHT bootstrap runs in background
    this.setDHTEnabled(s.get('dht.enabled')).catch((err) => {
      console.error('[AndroidStandaloneEngineManager] DHT failed to start:', err)
    })
  }

  /**
   * Handle IO websocket disconnect.
   */
  private handleIoDisconnect(_reason: string): void {
    if (!this.engine) return

    for (const torrent of this.engine.torrents) {
      if (torrent.userState === 'active' && !torrent.errorMessage) {
        torrent.errorMessage = 'IO connection lost'
      }
    }
  }

  /**
   * Handle IO websocket reconnect.
   */
  private handleIoReconnect(): void {
    if (!this.engine) return

    for (const torrent of this.engine.torrents) {
      if (torrent.errorMessage === 'IO connection lost') {
        torrent.errorMessage = undefined
      }
    }
  }

  /**
   * Shutdown the engine.
   */
  shutdown(): void {
    console.log('[AndroidStandaloneEngineManager] Shutting down...')

    if (this.engine) {
      this.engine.destroy()
      this.engine = null
    }

    this.pendingNativeEvents = []
    this.daemonConnection = null
    this.initPromise = null
  }

  /**
   * Reset engine state for reconnection.
   */
  reset(): void {
    console.log('[AndroidStandaloneEngineManager] Resetting for reconnection...')

    if (this.daemonConnection) {
      this.daemonConnection.close()
      this.daemonConnection = null
    }

    if (this.engine) {
      this.engine.destroy()
      this.engine = null
    }

    this.pendingNativeEvents = []
    this.initPromise = null
  }

  // ============ Storage Roots ============

  getRoots(): StorageRoot[] {
    if (!this.engine) return []
    return this.engine.storageRootManager.getRoots()
  }

  async getDefaultRootKey(): Promise<string | null> {
    if (!this.sessionStore) {
      return window.RootsBridge?.getDefaultRootKey() ?? null
    }
    const bytes = await this.sessionStore.get(DEFAULT_ROOT_KEY_KEY)
    return bytes ? new TextDecoder().decode(bytes) : null
  }

  async setDefaultRoot(key: string): Promise<void> {
    if (!this.engine) {
      throw new Error('Engine not initialized')
    }
    this.engine.storageRootManager.setDefaultRoot(key)
    if (this.sessionStore) {
      await this.sessionStore.set(DEFAULT_ROOT_KEY_KEY, new TextEncoder().encode(key))
    }
  }

  // ============ Settings ============

  setRateLimits(downloadLimit: number, uploadLimit: number): void {
    if (!this.engine) {
      console.warn(
        '[AndroidStandaloneEngineManager] Cannot set rate limits: engine not initialized',
      )
      return
    }
    this.engine.bandwidthTracker.setDownloadLimit(downloadLimit)
    this.engine.bandwidthTracker.setUploadLimit(uploadLimit)
    console.log(
      `[AndroidStandaloneEngineManager] Rate limits set: download=${downloadLimit === 0 ? 'unlimited' : downloadLimit + ' B/s'}, upload=${uploadLimit === 0 ? 'unlimited' : uploadLimit + ' B/s'}`,
    )
  }

  setConnectionLimits(
    maxPeersPerTorrent: number,
    maxGlobalPeers: number,
    maxUploadSlots: number,
  ): void {
    if (!this.engine) {
      console.warn(
        '[AndroidStandaloneEngineManager] Cannot set connection limits: engine not initialized',
      )
      return
    }
    this.engine.setConnectionLimits(maxPeersPerTorrent, maxGlobalPeers, maxUploadSlots)
    console.log(
      `[AndroidStandaloneEngineManager] Connection limits set: maxPeersPerTorrent=${maxPeersPerTorrent}, maxGlobalPeers=${maxGlobalPeers}, maxUploadSlots=${maxUploadSlots}`,
    )
  }

  setDaemonRateLimit(opsPerSecond: number, burstSize: number): void {
    if (!this.engine) {
      console.warn(
        '[AndroidStandaloneEngineManager] Cannot set daemon rate limit: engine not initialized',
      )
      return
    }
    this.engine.setDaemonRateLimit(opsPerSecond, burstSize)
    console.log(
      `[AndroidStandaloneEngineManager] Daemon rate limit set: ${opsPerSecond} ops/sec, burst=${burstSize}`,
    )
  }

  setEncryptionPolicy(policy: 'disabled' | 'allow' | 'prefer' | 'required'): void {
    if (!this.engine) {
      console.warn(
        '[AndroidStandaloneEngineManager] Cannot set encryption policy: engine not initialized',
      )
      return
    }
    this.engine.setEncryptionPolicy(policy)
    console.log(`[AndroidStandaloneEngineManager] Encryption policy set: ${policy}`)
  }

  async setUPnPEnabled(enabled: boolean): Promise<void> {
    if (!this.engine) {
      console.warn('[AndroidStandaloneEngineManager] Cannot set UPnP: engine not initialized')
      return
    }
    await this.engine.setUPnPEnabled(enabled)
  }

  async setDHTEnabled(enabled: boolean): Promise<void> {
    if (!this.engine) {
      console.warn('[AndroidStandaloneEngineManager] Cannot set DHT: engine not initialized')
      return
    }
    await this.engine.setDHTEnabled(enabled)
    console.log(`[AndroidStandaloneEngineManager] DHT ${enabled ? 'enabled' : 'disabled'}`)
  }

  setLoggingConfig(config: EngineLoggingConfig): void {
    if (!this.engine) {
      console.warn(
        '[AndroidStandaloneEngineManager] Cannot set logging config: engine not initialized',
      )
      return
    }
    this.engine.setLoggingConfig(config)
    console.log(`[AndroidStandaloneEngineManager] Logging config updated: level=${config.level}`)
  }

  // ============ Native Events ============

  async handleNativeEvent(event: string, payload: unknown): Promise<void> {
    if (!this.engine) {
      console.log('[AndroidStandaloneEngineManager] Engine not ready, queueing event:', event)
      this.pendingNativeEvents.push({ event, payload })
      return
    }

    if (event === 'TorrentAdded') {
      const p = payload as { name: string; infohash: string; contentsBase64: string }
      console.log('[AndroidStandaloneEngineManager] Adding torrent:', p.name)
      try {
        const bytes = Uint8Array.from(atob(p.contentsBase64), (c) => c.charCodeAt(0))
        await this.engine.addTorrent(bytes)
      } catch (e) {
        console.error('[AndroidStandaloneEngineManager] Failed to add torrent:', e)
      }
    } else if (event === 'MagnetAdded') {
      const p = payload as { link: string }
      console.log('[AndroidStandaloneEngineManager] Adding magnet:', p.link)
      try {
        await this.engine.addTorrent(p.link)
      } catch (e) {
        console.error('[AndroidStandaloneEngineManager] Failed to add magnet:', e)
      }
    }
  }
}
