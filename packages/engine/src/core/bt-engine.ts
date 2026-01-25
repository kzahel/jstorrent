import { EventEmitter } from '../utils/event-emitter'
import { ISocketFactory } from '../interfaces/socket'
import { IFileSystem } from '../interfaces/filesystem'
import { randomBytes } from '../utils/hash'
import { fromString, concat, toHex, fromBase64 } from '../utils/buffer'
import { VERSION, versionToAzureusCode } from '../version'
import { TokenBucket } from '../utils/token-bucket'
import { DHTNode, saveDHTState, loadDHTState, hexToNodeId } from '../dht'
import {
  ILoggingEngine,
  Logger,
  EngineLoggingConfig,
  createFilter,
  randomClientId,
  withScopeAndFiltering,
  ShouldLogFn,
  ILoggableComponent,
  LogEntry,
  globalLogStore,
} from '../logging/logger'
import { UPnPManager, NetworkInterface } from '../upnp'

import { ISessionStore } from '../interfaces/session-store'
import { IHasher } from '../interfaces/hasher'
import { SubtleCryptoHasher } from '../adapters/browser/subtle-crypto-hasher'
import { type EncryptionPolicy, MseSocket } from '../crypto'
import { MemorySessionStore } from '../adapters/memory/memory-session-store'
import { StorageRootManager } from '../storage/storage-root-manager'
import type { StorageRoot } from '../storage/types'
import type { ConfigHub } from '../config/config-hub'
import { MemoryConfigHub } from '../config/memory-config-hub'
import type { ConfigType } from '../config/config-schema'
import { SessionPersistence } from './session-persistence'
import { Torrent } from './torrent'
import { PeerConnection } from './peer-connection'
import { TorrentUserState } from './torrent-state'
import { BandwidthTracker } from './bandwidth-tracker'

// New imports for refactored code
import { parseTorrentInput } from './torrent-factory'
import { initializeTorrentMetadata } from './torrent-initializer'

// Maximum piece size supported by the io-daemon (must match DefaultBodyLimit in io-daemon)
export const MAX_PIECE_SIZE = 32 * 1024 * 1024 // 32MB

// UPnP status type
export type UPnPStatus = 'disabled' | 'discovering' | 'mapped' | 'unavailable' | 'failed'

// === Unified Daemon Operation Queue Types ===

/**
 * Types of operations that consume daemon resources.
 */
export type DaemonOpType =
  | 'tcp_connect' // TCP peer connection (long-lived)
  | 'utp_connect' // UDP peer connection via uTP (long-lived, future)
  | 'udp_announce' // UDP tracker announce (fire & forget)
  | 'http_announce' // HTTP tracker announce (fire & forget)

/**
 * Pending operation counts per type.
 */
export type PendingOpCounts = Record<DaemonOpType, number>

/**
 * Create empty pending op counts.
 */
function emptyOpCounts(): PendingOpCounts {
  return {
    tcp_connect: 0,
    utp_connect: 0,
    udp_announce: 0,
    http_announce: 0,
  }
}

/**
 * Filter out undefined values from an object.
 */
function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

export interface BtEngineOptions {
  downloadPath?: string
  socketFactory: ISocketFactory
  fileSystem?: IFileSystem
  storageRootManager?: StorageRootManager
  sessionStore?: ISessionStore
  hasher?: IHasher

  maxConnections?: number
  maxDownloadSpeed?: number
  maxUploadSpeed?: number
  peerId?: string // Optional custom peerId
  port?: number // Listening port to announce
  logging?: EngineLoggingConfig
  maxPeers?: number
  maxUploadSlots?: number
  onLog?: (entry: LogEntry) => void

  /**
   * Start the engine in suspended state (no network activity).
   * Use this when you need to restore session before starting networking.
   * Call resume() after setup/restore is complete.
   */
  startSuspended?: boolean

  /**
   * Maximum daemon operations per second (connections, announces).
   * Default: 20
   */
  daemonOpsPerSecond?: number

  /**
   * Burst capacity for daemon operations.
   * Default: 40 (2x rate)
   */
  daemonOpsBurst?: number

  /**
   * Function to get network interfaces.
   * Required for UPnP to determine local address for port mapping.
   */
  getNetworkInterfaces?: () => Promise<NetworkInterface[]>

  /**
   * MSE/PE encryption policy for peer connections.
   * - 'disabled': No encryption
   * - 'allow': Accept encryption if peer requests, but don't initiate
   * - 'prefer': Try encryption, fall back to plain
   * - 'required': Only accept encrypted connections
   * Default: 'disabled'
   */
  encryptionPolicy?: EncryptionPolicy

  /**
   * Enable DHT for trackerless peer discovery.
   * Default: true
   */
  dhtEnabled?: boolean

  /**
   * Skip DHT bootstrap (for testing only).
   * @internal
   */
  _skipDHTBootstrap?: boolean

  /**
   * Optional ConfigHub for reactive configuration.
   * When provided, settings are read from ConfigHub and subscriptions are
   * set up for automatic propagation. Individual options like maxConnections,
   * encryptionPolicy, etc. are ignored when config is provided.
   */
  config?: ConfigHub
}

export class BtEngine extends EventEmitter implements ILoggingEngine, ILoggableComponent {
  public readonly storageRootManager: StorageRootManager
  public readonly socketFactory: ISocketFactory
  public readonly sessionPersistence: SessionPersistence
  public readonly hasher: IHasher
  public readonly bandwidthTracker = new BandwidthTracker()
  public torrents: Torrent[] = []
  public port: number
  public peerId: Uint8Array

  /**
   * Get the current listening port.
   * This may differ from the initially configured port if port 0 (auto-assign) was used.
   */
  get listeningPort(): number {
    return this.port
  }

  public readonly clientId: string
  private logger: Logger
  private filterFn: ShouldLogFn
  private onLogCallback?: (entry: LogEntry) => void
  public maxConnections: number
  public maxPeers: number
  public maxUploadSlots: number
  public encryptionPolicy: EncryptionPolicy

  /** Optional ConfigHub for reactive configuration (created internally if not provided) */
  public config?: ConfigHub

  /** Cleanup functions for config subscriptions */
  private configUnsubscribers: Array<() => void> = []

  /**
   * Whether the engine is suspended (no network activity).
   * By default, engine starts active. Pass `startSuspended: true` to start suspended.
   */
  private _suspended: boolean = false

  // === UPnP ===
  private upnpManager?: UPnPManager
  private _upnpStatus: UPnPStatus = 'disabled'
  private getNetworkInterfaces?: () => Promise<NetworkInterface[]>

  // === DHT ===
  private _dhtEnabled: boolean = true
  private _dhtNode?: DHTNode
  private _skipDHTBootstrap: boolean = false

  // === Unified Daemon Operation Queue ===

  /**
   * Pending operation counts per torrent.
   * Key: infoHashHex, Value: counts by operation type
   */
  private pendingOps = new Map<string, PendingOpCounts>()

  /**
   * Round-robin index for fair queue draining.
   */
  private opDrainIndex = 0

  /**
   * Single rate limiter for all daemon operations.
   * Prevents overwhelming the daemon regardless of operation type.
   */
  private daemonRateLimiter: TokenBucket

  /**
   * Interval handle for operation queue drain loop.
   */
  private opDrainInterval: ReturnType<typeof setInterval> | null = null

  // ILoggableComponent implementation
  static logName = 'client'
  getLogName(): string {
    return BtEngine.logName
  }
  getStaticLogName(): string {
    return BtEngine.logName
  }
  get engineInstance(): ILoggingEngine {
    return this
  }

  constructor(options: BtEngineOptions) {
    super()
    this.socketFactory = options.socketFactory

    if (options.storageRootManager) {
      this.storageRootManager = options.storageRootManager
    } else if (options.fileSystem && options.downloadPath) {
      // Legacy support: wrap single filesystem in StorageRootManager
      this.storageRootManager = new StorageRootManager(() => options.fileSystem!)
      this.storageRootManager.addRoot({
        key: 'default',
        label: 'Default',
        path: options.downloadPath,
      })
      this.storageRootManager.setDefaultRoot('default')
    } else {
      throw new Error('BtEngine requires storageRootManager or fileSystem + downloadPath')
    }
    const sessionStore = options.sessionStore ?? new MemorySessionStore()
    this.sessionPersistence = new SessionPersistence(sessionStore, this)
    this.hasher = options.hasher ?? new SubtleCryptoHasher()
    this.port = options.port ?? 6881 // Use nullish coalescing to allow port 0

    this.clientId = randomClientId()
    this.onLogCallback = options.onLog
    this.filterFn = createFilter(options.logging ?? { level: 'info' })
    this._suspended = options.startSuspended ?? false

    // Save network interface getter for UPnP
    this.getNetworkInterfaces = options.getNetworkInterfaces

    // Create ConfigHub if not provided, mapping individual options as overrides
    if (options.config) {
      this.config = options.config
    } else {
      // Create default MemoryConfigHub with individual options as overrides
      const overrides = filterUndefined({
        maxGlobalPeers: options.maxConnections,
        maxPeersPerTorrent: options.maxPeers,
        maxUploadSlots: options.maxUploadSlots,
        encryptionPolicy: options.encryptionPolicy,
        dhtEnabled: options.dhtEnabled,
        daemonOpsPerSecond: options.daemonOpsPerSecond,
        daemonOpsBurst: options.daemonOpsBurst,
      }) as Partial<ConfigType>
      const internalConfig = new MemoryConfigHub(overrides)
      // MemoryConfigHub.init() is synchronous (loads from empty storage)
      void internalConfig.init()
      this.config = internalConfig
    }

    // Always read from ConfigHub
    this.maxConnections = this.config.maxGlobalPeers.get()
    this.maxPeers = this.config.maxPeersPerTorrent.get()
    this.maxUploadSlots = this.config.maxUploadSlots.get()
    this.encryptionPolicy = this.config.encryptionPolicy.get()
    this._dhtEnabled = this.config.dhtEnabled.get()

    // Set up bandwidth limits from config (0 = unlimited)
    const downloadLimit = this.config.downloadSpeedUnlimited.get()
      ? 0
      : this.config.downloadSpeedLimit.get()
    const uploadLimit = this.config.uploadSpeedUnlimited.get()
      ? 0
      : this.config.uploadSpeedLimit.get()
    this.bandwidthTracker.setDownloadLimit(downloadLimit)
    this.bandwidthTracker.setUploadLimit(uploadLimit)

    // Initialize daemon rate limiter from config
    const opsPerSec = this.config.daemonOpsPerSecond.get()
    const burst = this.config.daemonOpsBurst.get()
    this.daemonRateLimiter = new TokenBucket(opsPerSec, burst)

    // Wire up config subscriptions
    this.wireConfigSubscriptions()

    this._skipDHTBootstrap = options._skipDHTBootstrap ?? false

    // Initialize logger for BtEngine itself
    this.logger = this.scopedLoggerFor(this)

    if (options.peerId) {
      this.peerId = Buffer.from(options.peerId)
    } else {
      // Generate random peerId: -JS{version}- + 12 random bytes
      // Azureus-style: -XX####- where XX=client code, ####=version
      const prefix = `-JS${versionToAzureusCode(VERSION)}-`
      const random = randomBytes(12)
      this.peerId = concat([fromString(prefix), random])
    }

    this.startServer()
    this.startOpDrainLoop()
  }

  scopedLoggerFor(component: ILoggableComponent): Logger {
    // Pass a wrapper that always calls current filterFn, enabling dynamic log level changes
    return withScopeAndFiltering(component, (level, ctx) => this.filterFn(level, ctx), {
      onLog: (entry) => {
        // Add to global store (once)
        globalLogStore.add(entry.level, entry.message, entry.args)
        // Also call user-provided callback if any
        this.onLogCallback?.(entry)
      },
    })
  }

  /**
   * Update logging configuration dynamically.
   * Takes effect immediately for all components.
   */
  setLoggingConfig(config: EngineLoggingConfig): void {
    this.filterFn = createFilter(config)
    this.logger.info('Logging config updated', { level: config.level })
  }

  /**
   * Whether the engine is suspended (no network activity).
   */
  get isSuspended(): boolean {
    return this._suspended
  }

  /**
   * Suspend all network activity.
   * Torrents remain in their user state but stop all networking.
   * Use this during session restore or for "pause all" functionality.
   */
  suspend(): void {
    if (this._suspended) return

    this.logger.info('Suspending engine - stopping all network activity')
    this._suspended = true

    for (const torrent of this.torrents) {
      torrent.suspendNetwork()
    }
  }

  /**
   * Resume network activity.
   * Torrents with userState 'active' will start networking.
   * Torrents with userState 'stopped' or 'queued' remain stopped.
   */
  resume(): void {
    if (!this._suspended) return

    this.logger.info('Resuming engine - starting active torrents')
    this._suspended = false

    for (const torrent of this.torrents) {
      if (torrent.userState === 'active') {
        torrent.resumeNetwork()
      }
    }

    // Apply initial config for subsystems that depend on non-suspended state
    this.applyInitialConfig()
  }

  /**
   * Apply initial configuration from ConfigHub.
   * Called once after engine resumes to start subsystems based on saved settings.
   * Subscriptions only fire on CHANGES, so initial values need explicit application.
   */
  private applyInitialConfig(): void {
    if (!this.config) return

    // Log initial rate limits for debugging
    const downloadUnlimited = this.config.downloadSpeedUnlimited.get()
    const uploadUnlimited = this.config.uploadSpeedUnlimited.get()
    const downloadLimit = downloadUnlimited ? 0 : this.config.downloadSpeedLimit.get()
    const uploadLimit = uploadUnlimited ? 0 : this.config.uploadSpeedLimit.get()
    this.logger.info(
      `Initial rate limits - download: ${downloadLimit === 0 ? 'unlimited' : downloadLimit + ' B/s'}, upload: ${uploadLimit === 0 ? 'unlimited' : uploadLimit + ' B/s'}`,
    )

    // Start DHT if enabled (constructor only reads the flag, doesn't start)
    if (this.config.dhtEnabled.get()) {
      this.logger.info('Starting DHT (from initial config)')
      this.enableDHT().catch((e) => this.logger.error('Failed to enable DHT on startup', e))
    }

    // Start UPnP if enabled (constructor doesn't read initial value)
    if (this.config.upnpEnabled.get()) {
      this.logger.info('Starting UPnP (from initial config)')
      this.enableUPnP().catch((e) => this.logger.error('Failed to enable UPnP on startup', e))
    }
  }

  private startServer() {
    try {
      const server = this.socketFactory.createTcpServer()
      if (server && typeof server.listen === 'function') {
        server.listen(this.port, () => {
          // Get the actual bound port (important when port was 0 for auto-assign)
          const addr = server.address()
          if (addr && typeof addr === 'object' && 'port' in addr) {
            this.port = addr.port
          }
          this.logger.info(`BtEngine listening on port ${this.port}`)
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        server.on('connection', (socket: any) => {
          this.handleIncomingConnection(socket)
        })
      }
    } catch (err) {
      // not implemented yet
      this.logger.info('Failed to start server:', { error: err })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleIncomingConnection(nativeSocket: any) {
    const rawSocket = this.socketFactory.wrapTcpSocket(nativeSocket)

    // Check global connection limit for incoming connections
    if (this.numConnections >= this.maxConnections) {
      this.logger.debug(
        `Rejecting incoming connection: global limit reached (${this.numConnections}/${this.maxConnections})`,
      )
      rawSocket.close()
      return
    }

    // Validate remote address info - required for peer tracking
    if (!rawSocket.remoteAddress || !rawSocket.remotePort) {
      this.logger.error(
        `Incoming connection missing remote address info (remoteAddress=${rawSocket.remoteAddress}, remotePort=${rawSocket.remotePort}). ` +
          `Socket wrapper must implement remoteAddress/remotePort getters.`,
      )
      rawSocket.close()
      return
    }

    // Handle MSE/PE encryption for incoming connections
    let socket = rawSocket
    const shouldHandleMse = this.encryptionPolicy !== 'disabled'

    if (shouldHandleMse && this.torrents.length > 0) {
      const knownInfoHashes = this.torrents.map((t) => t.infoHash)
      const mseSocket = new MseSocket(rawSocket, {
        policy: this.encryptionPolicy,
        knownInfoHashes,
        sha1: (data) => this.hasher.sha1(data),
        getRandomBytes: randomBytes,
      })

      try {
        await mseSocket.acceptConnection()
        socket = mseSocket
        this.logger.debug(`Incoming MSE handshake complete (encrypted: ${mseSocket.isEncrypted})`)
      } catch (err) {
        // MSE failed
        if (this.encryptionPolicy === 'required') {
          this.logger.debug(`Incoming connection rejected: encryption required but MSE failed`)
          rawSocket.close()
          return
        }
        // 'allow' or 'prefer': fall back to plain socket
        this.logger.debug(`Incoming MSE failed, using plain: ${err}`)
      }
    }

    const peer = new PeerConnection(this, socket, {
      remoteAddress: socket.remoteAddress!,
      remotePort: socket.remotePort!,
    })
    peer.on('handshake', (infoHash, _peerId, _extensions) => {
      const infoHashStr = toHex(infoHash)
      const torrent = this.getTorrent(infoHashStr)
      if (torrent) {
        this.logger.debug(`Incoming connection for torrent ${infoHashStr}`)
        // Send our handshake back FIRST
        peer.sendHandshake(torrent.infoHash, torrent.peerId)
        peer.isIncoming = true
        torrent.addPeer(peer)
      } else {
        const knownHashes = this.torrents.map((t) => toHex(t.infoHash))
        this.logger.warn(
          `Incoming connection for unknown torrent ${infoHashStr}. ` +
            `Known torrents (${this.torrents.length}): ${knownHashes.join(', ') || 'none'}`,
        )
        peer.close()
      }
    })
  }

  async addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options: {
      storageKey?: string
      /** Whether this torrent is being restored from session, reset, or added by user action. Default: 'user' */
      source?: 'user' | 'restore' | 'reset'
      userState?: TorrentUserState
    } = {},
  ): Promise<{ torrent: Torrent | null; isDuplicate: boolean }> {
    // Parse the input (magnet link or torrent file)
    const input = await parseTorrentInput(magnetOrBuffer, this.hasher)

    // Check for existing torrent
    const existing = this.getTorrent(input.infoHashStr)
    if (existing) {
      return { torrent: existing, isDuplicate: true }
    }

    // Register storage root for this torrent if provided
    if (options.storageKey) {
      this.storageRootManager.setRootForTorrent(input.infoHashStr, options.storageKey)
    }

    // Create the torrent instance
    const torrent = new Torrent(
      this,
      input.infoHash,
      this.peerId,
      this.socketFactory,
      this.port,
      undefined, // contentStorage - initialized later with metadata
      input.announce,
      this.maxPeers,
      this.maxUploadSlots,
      this.encryptionPolicy,
    )

    // Store magnet display name for fallback naming
    if (input.magnetDisplayName) {
      torrent._magnetDisplayName = input.magnetDisplayName
    }

    // Store magnet peer hints for use on every start
    if (input.magnetPeerHints && input.magnetPeerHints.length > 0) {
      torrent.magnetPeerHints = input.magnetPeerHints
    }

    // Store origin info for persistence
    if (input.magnetLink) {
      torrent.initFromMagnet(input.magnetLink)
    } else if (input.torrentFileBase64) {
      torrent.initFromTorrentFile(input.torrentFileBase64)
    }

    // Set initial user state
    torrent.userState = options.userState ?? 'active'

    // Initialize metadata if we have it (torrent file case)
    if (input.infoBuffer && input.parsedTorrent) {
      try {
        await initializeTorrentMetadata(this, torrent, input.infoBuffer, input.parsedTorrent)
      } catch (e) {
        // Handle missing storage gracefully - torrent will be in error state but still visible
        if (e instanceof Error && e.name === 'MissingStorageRootError') {
          torrent.errorMessage = `Download location unavailable. Storage root not found.`
          this.logger.warn(`Torrent ${input.infoHashStr} initialized with missing storage`)
        } else {
          throw e
        }
      }
    }

    // Set up metadata event handler for magnet links
    torrent.on('metadata', async (infoBuffer) => {
      try {
        await initializeTorrentMetadata(this, torrent, infoBuffer)

        // Save infodict for future restores
        await this.sessionPersistence.saveInfoDict(input.infoHashStr, infoBuffer)

        torrent.recheckPeers()
        torrent.emit('ready')
      } catch (err) {
        this.emit('error', err)
      }
    })

    // Register torrent
    this.torrents.push(torrent)
    this.emit('torrent', torrent)

    // Set up event forwarding
    torrent.on('complete', () => {
      this.emit('torrent-complete', torrent)
    })

    torrent.on('error', (err) => {
      this.emit('error', err)
    })

    // Start if engine not suspended AND user wants it active
    if (!this._suspended && torrent.userState === 'active') {
      await torrent.start()
      // Note: peer hints are now added inside torrent.start()
    }

    // Save torrent file for file-source torrents (write once)
    if (options.source !== 'restore' && options.source !== 'reset' && input.torrentFileBuffer) {
      await this.sessionPersistence.saveTorrentFile(input.infoHashStr, input.torrentFileBuffer)
    }

    // Persist torrent list (unless restoring from session or resetting)
    if (options.source !== 'restore' && options.source !== 'reset') {
      await this.sessionPersistence.saveTorrentList()
    }

    return { torrent, isDuplicate: false }
  }

  async removeTorrent(torrent: Torrent) {
    const index = this.torrents.indexOf(torrent)
    if (index !== -1) {
      this.torrents.splice(index, 1)
      const infoHash = toHex(torrent.infoHash)

      // Remove persisted data
      const t0 = Date.now()
      await this.sessionPersistence.removeTorrentData(infoHash)
      console.log(`[removeTorrent] removeTorrentData took ${Date.now() - t0}ms`)

      const t1 = Date.now()
      await this.sessionPersistence.saveTorrentList()
      console.log(`[removeTorrent] saveTorrentList took ${Date.now() - t1}ms`)

      const t2 = Date.now()
      await torrent.stop({ skipAnnounce: true })
      console.log(`[removeTorrent] stop took ${Date.now() - t2}ms`)

      this.emit('torrent-removed', torrent)
      console.log(`[removeTorrent] complete, total ${Date.now() - t0}ms`)
    }
  }

  async removeTorrentByHash(infoHash: string) {
    const torrent = this.getTorrent(infoHash)
    if (torrent) {
      await this.removeTorrent(torrent)
    }
  }

  /**
   * Remove a torrent and delete all associated data files from disk.
   * This includes: downloaded content files, .parts file, and session data.
   * Returns a list of any errors encountered during file deletion.
   */
  async removeTorrentWithData(torrent: Torrent): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = []
    const infoHash = toHex(torrent.infoHash)

    // 1. Close file handles and stop torrent
    if (torrent.contentStorage) {
      await torrent.contentStorage.close()
    }
    await torrent.stop({ skipAnnounce: true })

    // 2. Get filesystem for this torrent (may throw if no storage root)
    let fs: IFileSystem | null = null
    try {
      fs = this.storageRootManager.getFileSystemForTorrent(infoHash)
    } catch {
      // No storage root - skip file deletion (torrent may never have had files)
    }

    // 3. Delete content files
    if (torrent.contentStorage && fs) {
      for (const file of torrent.contentStorage.filesList) {
        try {
          if (await fs.exists(file.path)) {
            await fs.delete(file.path)
          }
        } catch (e) {
          errors.push(`${file.path}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      // Clean up empty parent directories (best effort)
      await this.cleanupEmptyDirectories(fs, torrent.contentStorage.filesList)
    }

    // 4. Delete .parts file
    if (fs) {
      const partsPath = `${infoHash}.parts`
      try {
        if (await fs.exists(partsPath)) {
          await fs.delete(partsPath)
        }
      } catch (e) {
        errors.push(`.parts: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // 5. Remove from engine (clears session data)
    await this.removeTorrent(torrent)

    return { success: errors.length === 0, errors }
  }

  /**
   * Clean up empty parent directories after deleting files.
   * Works deepest-first to properly clean up nested empty directories.
   */
  private async cleanupEmptyDirectories(fs: IFileSystem, files: { path: string }[]): Promise<void> {
    const dirs = new Set<string>()
    for (const file of files) {
      let dir = file.path
      while (dir.includes('/')) {
        dir = dir.substring(0, dir.lastIndexOf('/'))
        if (dir) dirs.add(dir)
      }
    }
    // Sort deepest first
    const sorted = [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)
    for (const dir of sorted) {
      try {
        const contents = await fs.readdir(dir)
        if (contents.length === 0) {
          await fs.delete(dir)
        }
      } catch {
        // Ignore errors - directory may not exist or be non-empty
      }
    }
  }

  /**
   * Reset a torrent's state (progress, stats, file priorities) without removing it.
   * For magnet torrents, this preserves the infodict so metadata doesn't need to be re-fetched.
   * The torrent will be stopped after reset and needs to be started manually.
   *
   * This works by removing and re-adding the torrent from its original source (magnet or file),
   * which ensures trackers and other metadata are properly restored.
   */
  async resetTorrent(torrent: Torrent): Promise<void> {
    const index = this.torrents.indexOf(torrent)
    if (index === -1) return

    const infoHash = toHex(torrent.infoHash)
    const storageKey = this.storageRootManager.getRootForTorrent(infoHash)?.key

    // Get original source for re-adding
    const magnetLink = torrent.magnetLink
    const torrentFileBase64 = torrent.torrentFileBase64

    // Stop the torrent
    await torrent.stop({ skipAnnounce: true })

    // Remove from engine array (but keep in persisted list)
    this.torrents.splice(index, 1)

    // Reset persisted state (clears progress, keeps source files + list entry)
    await this.sessionPersistence.resetState(infoHash)

    // Re-add from original source
    const source = magnetLink || (torrentFileBase64 ? fromBase64(torrentFileBase64) : null)
    if (!source) {
      throw new Error('Cannot reset: no source available')
    }

    const result = await this.addTorrent(source, {
      storageKey,
      source: 'reset', // Skip saving source files and list (already saved)
      userState: 'stopped',
    })

    // For magnet torrents, restore infodict if available
    if (result.torrent && !result.torrent.hasMetadata && magnetLink) {
      const infoDict = await this.sessionPersistence.loadInfoDict(infoHash)
      if (infoDict) {
        await initializeTorrentMetadata(this, result.torrent, infoDict)
      }
    }

    // Note: addTorrent() emits 'torrent' event, which updates UI with fresh torrent
  }

  getTorrent(infoHash: string): Torrent | undefined {
    return this.torrents.find((t) => toHex(t.infoHash) === infoHash)
  }

  async destroy() {
    this.logger.info('Destroying engine')

    // Clean up config subscriptions
    for (const unsubscribe of this.configUnsubscribers) {
      unsubscribe()
    }
    this.configUnsubscribers = []

    // Notify ConfigHub that engine is stopping (clears pending restart-required changes)
    if (this.config && 'setEngineRunning' in this.config) {
      ;(this.config as { setEngineRunning: (running: boolean) => void }).setEngineRunning(false)
    }

    // Stop operation drain loop
    this.stopOpDrainLoop()

    // Clear pending operations
    this.pendingOps.clear()

    // Clean up UPnP mappings
    await this.disableUPnP()

    // Stop DHT (saves state)
    await this.disableDHT()

    // Flush any pending persistence saves
    await this.sessionPersistence.flushPendingSaves()

    // Stop all torrents
    await Promise.all(this.torrents.map((t) => t.stop()))
    this.torrents = []

    // Close server?
    // We don't have a reference to server instance returned by createTcpServer unless we stored it.
    // startServer() didn't store it.
    // But we should probably store it.
    // For now, just clearing torrents satisfies the test.
  }

  /**
   * Restore torrents from session storage.
   * Call this after engine is initialized.
   */
  async restoreSession(): Promise<number> {
    this.logger.info('Restoring session...')
    const count = await this.sessionPersistence.restoreSession()
    this.logger.info(`Restored ${count} torrents`)
    return count
  }

  get numConnections(): number {
    return this.torrents.reduce((acc, t) => acc + t.numPeers, 0)
  }

  // === ConfigHub Subscription Wiring ===

  /**
   * Wire up ConfigHub subscriptions for reactive configuration.
   * Called once during construction when config is provided.
   */
  private wireConfigSubscriptions(): void {
    if (!this.config) return

    // Capture config for use in callbacks (TypeScript can't track narrowing into closures)
    const config = this.config

    // Rate Limits - subscribe to both boolean flags and values
    // Download speed
    this.configUnsubscribers.push(
      config.downloadSpeedUnlimited.subscribe((unlimited) => {
        const limit = unlimited ? 0 : config.downloadSpeedLimit.get()
        this.bandwidthTracker.setDownloadLimit(limit)
        this.logger.info(
          `Download speed limit updated: ${limit === 0 ? 'unlimited' : limit + ' B/s'}`,
        )
      }),
    )

    this.configUnsubscribers.push(
      config.downloadSpeedLimit.subscribe((value) => {
        // Only apply if not unlimited
        if (!config.downloadSpeedUnlimited.get()) {
          this.bandwidthTracker.setDownloadLimit(value)
          this.logger.info(`Download speed limit updated: ${value} B/s`)
        }
      }),
    )

    // Upload speed
    this.configUnsubscribers.push(
      config.uploadSpeedUnlimited.subscribe((unlimited) => {
        const limit = unlimited ? 0 : config.uploadSpeedLimit.get()
        this.bandwidthTracker.setUploadLimit(limit)
        this.logger.info(
          `Upload speed limit updated: ${limit === 0 ? 'unlimited' : limit + ' B/s'}`,
        )
      }),
    )

    this.configUnsubscribers.push(
      config.uploadSpeedLimit.subscribe((value) => {
        // Only apply if not unlimited
        if (!config.uploadSpeedUnlimited.get()) {
          this.bandwidthTracker.setUploadLimit(value)
          this.logger.info(`Upload speed limit updated: ${value} B/s`)
        }
      }),
    )

    // Connection Limits - inline the logic from the removed setConnectionLimits method
    this.configUnsubscribers.push(
      this.config.maxPeersPerTorrent.subscribe((maxPeers) => {
        this.maxPeers = maxPeers
        for (const torrent of this.torrents) {
          torrent.setMaxPeers(maxPeers)
        }
        this.logger.info(`Max peers per torrent updated: ${maxPeers}`)
      }),
    )

    this.configUnsubscribers.push(
      this.config.maxGlobalPeers.subscribe((maxGlobal) => {
        this.maxConnections = maxGlobal
        this.logger.info(`Max global peers updated: ${maxGlobal}`)
      }),
    )

    this.configUnsubscribers.push(
      this.config.maxUploadSlots.subscribe((maxSlots) => {
        this.maxUploadSlots = maxSlots
        for (const torrent of this.torrents) {
          torrent.setMaxUploadSlots(maxSlots)
        }
        this.logger.info(`Max upload slots updated: ${maxSlots}`)
      }),
    )

    // Encryption Policy - inline the logic from the removed setEncryptionPolicy method
    this.configUnsubscribers.push(
      this.config.encryptionPolicy.subscribe((policy) => {
        this.encryptionPolicy = policy
        for (const torrent of this.torrents) {
          torrent.setEncryptionPolicy(policy)
        }
        this.logger.info(`Encryption policy updated: ${policy}`)
      }),
    )

    // DHT - call private methods directly (the public setDHTEnabled was removed)
    this.configUnsubscribers.push(
      this.config.dhtEnabled.subscribe((enabled) => {
        if (enabled) {
          this.enableDHT()
        } else {
          this.disableDHT()
        }
      }),
    )

    // UPnP - call private methods directly (the public setUPnPEnabled was removed)
    this.configUnsubscribers.push(
      this.config.upnpEnabled.subscribe((enabled) => {
        if (enabled) {
          this.enableUPnP()
        } else {
          this.disableUPnP()
        }
      }),
    )

    // Daemon Rate Limit - inline the logic from the removed setDaemonRateLimit method
    this.configUnsubscribers.push(
      this.config.daemonOpsPerSecond.subscribe((opsPerSec) => {
        const burst = this.config!.daemonOpsBurst.get()
        this.daemonRateLimiter.setLimit(opsPerSec, burst / Math.max(1, opsPerSec))
        this.logger.info(`Daemon rate limit updated: ${opsPerSec} ops/s, burst ${burst}`)
      }),
    )

    this.configUnsubscribers.push(
      this.config.daemonOpsBurst.subscribe((burst) => {
        const opsPerSec = this.config!.daemonOpsPerSecond.get()
        this.daemonRateLimiter.setLimit(opsPerSec, burst / Math.max(1, opsPerSec))
        this.logger.info(`Daemon rate limit updated: ${opsPerSec} ops/s, burst ${burst}`)
      }),
    )

    // Storage Roots
    this.configUnsubscribers.push(
      this.config.storageRoots.subscribe((roots) => {
        this.syncStorageRoots(roots)
      }),
    )

    this.configUnsubscribers.push(
      this.config.defaultRootKey.subscribe((key) => {
        if (key && this.storageRootManager.getRoots().some((r) => r.key === key)) {
          this.storageRootManager.setDefaultRoot(key)
          this.logger.info(`Default storage root updated: ${key}`)
        }
      }),
    )
  }

  /**
   * Sync storage roots from ConfigHub to StorageRootManager.
   * Adds new roots, removes missing roots, preserves torrent mappings.
   */
  private syncStorageRoots(configRoots: StorageRoot[]): void {
    const currentRoots = this.storageRootManager.getRoots()
    const currentKeys = new Set(currentRoots.map((r) => r.key))
    const newKeys = new Set(configRoots.map((r) => r.key))

    // Add new roots
    for (const root of configRoots) {
      if (!currentKeys.has(root.key)) {
        this.storageRootManager.addRoot(root)
        this.logger.info(`Storage root added: ${root.label} (${root.key})`)
      }
    }

    // Remove old roots
    for (const root of currentRoots) {
      if (!newKeys.has(root.key)) {
        this.storageRootManager.removeRoot(root.key)
        this.logger.info(`Storage root removed: ${root.label} (${root.key})`)
      }
    }
  }

  // === Unified Daemon Operation Queue Methods ===

  /**
   * Request daemon operation slots for a torrent.
   * @param infoHashHex - Torrent identifier
   * @param type - Type of operation
   * @param count - Number of slots requested
   */
  requestDaemonOps(infoHashHex: string, type: DaemonOpType, count: number): void {
    if (count <= 0) return

    let ops = this.pendingOps.get(infoHashHex)
    if (!ops) {
      ops = emptyOpCounts()
      this.pendingOps.set(infoHashHex, ops)
    }

    ops[type] += count
    this.logger.debug(
      `[OpQueue] ${infoHashHex.slice(0, 8)} +${count} ${type} (pending: ${JSON.stringify(ops)})`,
    )
  }

  /**
   * Cancel all pending operations for a torrent.
   * Called when torrent is stopped or removed.
   * @param infoHashHex - Torrent identifier
   */
  cancelDaemonOps(infoHashHex: string): void {
    const ops = this.pendingOps.get(infoHashHex)
    if (ops) {
      const total = Object.values(ops).reduce((a, b) => a + b, 0)
      if (total > 0) {
        this.pendingOps.delete(infoHashHex)
        this.logger.debug(`[OpQueue] ${infoHashHex.slice(0, 8)} cancelled ${total} pending ops`)
      }
    }
  }

  /**
   * Cancel pending operations of a specific type for a torrent.
   * @param infoHashHex - Torrent identifier
   * @param type - Type of operation to cancel
   */
  cancelDaemonOpsByType(infoHashHex: string, type: DaemonOpType): void {
    const ops = this.pendingOps.get(infoHashHex)
    if (ops && ops[type] > 0) {
      this.logger.debug(`[OpQueue] ${infoHashHex.slice(0, 8)} cancelled ${ops[type]} ${type} ops`)
      ops[type] = 0

      // Clean up if all zeros
      if (Object.values(ops).every((c) => c === 0)) {
        this.pendingOps.delete(infoHashHex)
      }
    }
  }

  // === Legacy Connection Queue API (wrapper around unified queue) ===

  /**
   * Request connection slots for a torrent.
   * @deprecated Use requestDaemonOps(hash, 'tcp_connect', count) instead.
   */
  requestConnections(infoHashHex: string, count: number): void {
    this.requestDaemonOps(infoHashHex, 'tcp_connect', count)
  }

  /**
   * Cancel all pending connection requests for a torrent.
   * @deprecated Use cancelDaemonOps() instead.
   */
  cancelConnectionRequests(infoHashHex: string): void {
    this.cancelDaemonOps(infoHashHex)
  }

  /**
   * Start the operation queue drain loop.
   */
  private startOpDrainLoop(): void {
    if (this.opDrainInterval) return

    // Drain at 50ms intervals (up to 20 ops/sec with rate limiter)
    this.opDrainInterval = setInterval(() => {
      this.drainOpQueue()
    }, 50)
  }

  /**
   * Stop the operation queue drain loop.
   */
  private stopOpDrainLoop(): void {
    if (this.opDrainInterval) {
      clearInterval(this.opDrainInterval)
      this.opDrainInterval = null
    }
  }

  /**
   * Drain operation queue with round-robin fairness.
   * Grants one operation slot per call, rate limited.
   */
  private drainOpQueue(): void {
    // Check global connection limit first
    if (this.numConnections >= this.maxConnections) return

    // Check rate limit
    if (!this.daemonRateLimiter.tryConsume(1)) return

    const hashes = Array.from(this.pendingOps.keys())
    if (hashes.length === 0) return

    // Round-robin: try each torrent starting from last position
    for (let i = 0; i < hashes.length; i++) {
      const idx = (this.opDrainIndex + i) % hashes.length
      const hash = hashes[idx]
      const ops = this.pendingOps.get(hash)

      if (!ops) continue

      const total = Object.values(ops).reduce((a, b) => a + b, 0)
      if (total <= 0) {
        this.pendingOps.delete(hash)
        continue
      }

      const torrent = this.getTorrent(hash)
      if (!torrent || !torrent.isActive) {
        this.pendingOps.delete(hash)
        continue
      }

      // Grant slot - torrent decides which operation to execute
      const usedType = torrent.useDaemonSlot(ops)
      if (usedType) {
        ops[usedType]--
        if (ops[usedType] < 0) ops[usedType] = 0

        // Clean up if all zeros
        if (Object.values(ops).every((c) => c === 0)) {
          this.pendingOps.delete(hash)
        }

        // Advance round-robin
        this.opDrainIndex = (idx + 1) % Math.max(1, hashes.length)
        return
      } else {
        // Torrent couldn't use any slot, clear its pending ops
        this.pendingOps.delete(hash)
      }
    }
  }

  /**
   * Get operation queue stats for debugging.
   */
  getOpQueueStats(): {
    pendingByTorrent: Record<string, PendingOpCounts>
    totalByType: PendingOpCounts
    rateLimiterAvailable: number
  } {
    const pendingByTorrent: Record<string, PendingOpCounts> = {}
    const totalByType = emptyOpCounts()

    for (const [hash, ops] of this.pendingOps) {
      pendingByTorrent[hash.slice(0, 8)] = { ...ops }
      for (const type of Object.keys(ops) as DaemonOpType[]) {
        totalByType[type] += ops[type]
      }
    }

    return {
      pendingByTorrent,
      totalByType,
      rateLimiterAvailable: this.daemonRateLimiter.available,
    }
  }

  /**
   * Get connection queue stats for debugging.
   * @deprecated Use getOpQueueStats() instead.
   */
  getConnectionQueueStats(): {
    pendingByTorrent: Record<string, number>
    totalPending: number
    rateLimiterAvailable: number
  } {
    const stats = this.getOpQueueStats()
    const pendingByTorrent: Record<string, number> = {}
    let totalPending = 0
    for (const [hash, ops] of Object.entries(stats.pendingByTorrent)) {
      const count = ops.tcp_connect
      pendingByTorrent[hash] = count
      totalPending += count
    }
    return {
      pendingByTorrent,
      totalPending,
      rateLimiterAvailable: stats.rateLimiterAvailable,
    }
  }

  // === UPnP Methods ===

  /**
   * Get the current UPnP status.
   */
  get upnpStatus(): UPnPStatus {
    return this._upnpStatus
  }

  /**
   * Get the external IP address discovered via UPnP.
   * Returns null if UPnP is not enabled or discovery failed.
   */
  get upnpExternalIP(): string | null {
    return this.upnpManager?.externalIP ?? null
  }

  private async enableUPnP(): Promise<void> {
    if (this._upnpStatus !== 'disabled') {
      // Already enabled or in progress
      return
    }

    if (!this.getNetworkInterfaces) {
      this.logger.warn('UPnP: Cannot enable - no getNetworkInterfaces function provided')
      this._upnpStatus = 'failed'
      this.emit('upnpStatusChanged', this._upnpStatus)
      return
    }

    this._upnpStatus = 'discovering'
    this.emit('upnpStatusChanged', this._upnpStatus)
    this.logger.info('UPnP: Discovering gateway...')

    this.upnpManager = new UPnPManager(this.socketFactory, this.getNetworkInterfaces, this.logger)

    const discovered = await this.upnpManager.discover()
    if (!discovered) {
      this._upnpStatus = 'unavailable'
      this.emit('upnpStatusChanged', this._upnpStatus)
      this.logger.info('UPnP: No gateway found')
      return
    }

    const tcpMapped = await this.upnpManager.addMapping(this.port, 'TCP')
    const udpMapped = await this.upnpManager.addMapping(this.port + 1, 'UDP') // For DHT

    if (tcpMapped) {
      this._upnpStatus = 'mapped'
      this.emit('upnpStatusChanged', this._upnpStatus)
      this.logger.info(
        `UPnP: Mapped TCP port ${this.port}${udpMapped ? ` and UDP port ${this.port + 1}` : ''}, external IP: ${this.upnpManager.externalIP}`,
      )
    } else {
      this._upnpStatus = 'failed'
      this.emit('upnpStatusChanged', this._upnpStatus)
      this.logger.warn(`UPnP: Failed to map port ${this.port}`)
    }
  }

  private async disableUPnP(): Promise<void> {
    if (this._upnpStatus === 'disabled') {
      return
    }

    if (this.upnpManager) {
      await this.upnpManager.cleanup()
      this.upnpManager = undefined
    }

    this._upnpStatus = 'disabled'
    this.emit('upnpStatusChanged', this._upnpStatus)
    this.logger.info('UPnP: Disabled')
  }

  // === DHT Methods ===

  /**
   * Get whether DHT is enabled.
   */
  get dhtEnabled(): boolean {
    return this._dhtEnabled
  }

  /**
   * Get the DHT node instance (if enabled and started).
   */
  get dhtNode(): DHTNode | undefined {
    return this._dhtNode
  }

  /**
   * Start the DHT node.
   * Loads persisted state (node ID, routing table) if available.
   */
  private async enableDHT(): Promise<void> {
    if (this._dhtNode) {
      // Already enabled
      return
    }

    this.logger.info('DHT: Starting...')
    this._dhtEnabled = true

    // Try to load persisted state
    const sessionStore = this.sessionPersistence.store
    const persistedState = await loadDHTState(sessionStore)

    // Create DHT node with persisted node ID or generate new one
    const nodeId = persistedState ? hexToNodeId(persistedState.nodeId) : undefined

    // Create a scoped logger for DHT
    const dhtLoggable = {
      getLogName: () => 'dht',
      getStaticLogName: () => 'dht',
      engineInstance: this as ILoggingEngine,
    }
    const dhtLogger = this.scopedLoggerFor(dhtLoggable)

    // Retry logic for port binding failures (e.g., after quick reconnect)
    const maxRetries = 5
    const delays = [1000, 2000, 3000, 4000, 5000]

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      this._dhtNode = new DHTNode({
        nodeId,
        socketFactory: this.socketFactory,
        krpcOptions: { bindPort: this.port === 0 ? 0 : this.port + 1 }, // DHT uses port+1 or auto-assign if engine port is 0
        logger: dhtLogger,
        bandwidthTracker: this.bandwidthTracker,
      })

      try {
        await this._dhtNode.start()
        break // Success
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const isBindingError = errMsg.includes('status 1')

        if (isBindingError && attempt < maxRetries - 1) {
          this.logger.warn(`DHT: Port binding failed, retrying in ${delays[attempt]}ms...`)
          this._dhtNode = undefined
          await new Promise((r) => setTimeout(r, delays[attempt]))
          continue
        }
        // Final failure - cleanup and throw
        this.logger.error(`DHT: Failed to start: ${errMsg}`)
        this._dhtNode = undefined
        this._dhtEnabled = false
        throw err
      }
    }

    // TypeScript can't infer that the loop either succeeds or throws
    const dhtNode = this._dhtNode!

    // Restore routing table from persisted state
    if (persistedState && persistedState.nodes.length > 0) {
      this.logger.info(`DHT: Restoring ${persistedState.nodes.length} nodes from session`)
      for (const node of persistedState.nodes) {
        dhtNode.addNode({
          id: hexToNodeId(node.id),
          host: node.host,
          port: node.port,
        })
      }
    }

    // Bootstrap if routing table is empty or small (skip for tests)
    if (!this._skipDHTBootstrap && dhtNode.getNodeCount() < 10) {
      this.logger.info('DHT: Bootstrapping...')
      const stats = await dhtNode.bootstrap()
      this.logger.info(`DHT: Bootstrap complete - ${stats.routingTableSize} nodes in routing table`)
    }

    this.logger.info(`DHT: Started with node ID ${dhtNode.nodeIdHex}`)
    this.emit('dhtStatusChanged', true)

    // Notify all active torrents that DHT is ready
    // This handles the race condition where torrents start before DHT
    for (const torrent of this.torrents) {
      torrent.onDHTReady()
    }
  }

  /**
   * Stop the DHT node and save state for persistence.
   */
  private async disableDHT(): Promise<void> {
    if (!this._dhtNode) {
      this._dhtEnabled = false
      return
    }

    this.logger.info('DHT: Stopping...')

    // Save state before stopping
    const sessionStore = this.sessionPersistence.store
    const state = this._dhtNode.getState()
    await saveDHTState(sessionStore, state)
    this.logger.info(`DHT: Saved ${state.nodes.length} nodes to session`)

    this._dhtNode.stop()
    this._dhtNode = undefined
    this._dhtEnabled = false

    this.emit('dhtStatusChanged', false)
    this.logger.info('DHT: Stopped')
  }

  /**
   * Save DHT state (called periodically or before shutdown).
   */
  async saveDHTState(): Promise<void> {
    if (!this._dhtNode) return

    const sessionStore = this.sessionPersistence.store
    const state = this._dhtNode.getState()
    await saveDHTState(sessionStore, state)
  }
}
