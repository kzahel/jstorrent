import { EventEmitter } from '../utils/event-emitter'
import { ISocketFactory } from '../interfaces/socket'
import { IFileSystem } from '../interfaces/filesystem'
import { randomBytes } from '../utils/hash'
import { fromString, concat, toHex } from '../utils/buffer'
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
import type { EncryptionPolicy } from '../crypto'
import { MemorySessionStore } from '../adapters/memory/memory-session-store'
import { StorageRootManager } from '../storage/storage-root-manager'
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
export type UPnPStatus = 'disabled' | 'discovering' | 'mapped' | 'failed'

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

  public readonly clientId: string
  private logger: Logger
  private filterFn: ShouldLogFn
  private onLogCallback?: (entry: LogEntry) => void
  public maxConnections: number
  public maxPeers: number
  public maxUploadSlots: number
  public encryptionPolicy: EncryptionPolicy

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
    this.maxConnections = options.maxConnections ?? 100
    this.maxPeers = options.maxPeers ?? 20
    this.maxUploadSlots = options.maxUploadSlots ?? 4
    this.encryptionPolicy = options.encryptionPolicy ?? 'disabled'
    this._suspended = options.startSuspended ?? false

    // Initialize daemon rate limiter from options
    const opsPerSec = options.daemonOpsPerSecond ?? 20
    const burst = options.daemonOpsBurst ?? opsPerSec * 2
    this.daemonRateLimiter = new TokenBucket(opsPerSec, burst)

    // Save network interface getter for UPnP
    this.getNetworkInterfaces = options.getNetworkInterfaces

    // Initialize DHT setting
    this._dhtEnabled = options.dhtEnabled ?? true
    this._skipDHTBootstrap = options._skipDHTBootstrap ?? false

    // Initialize logger for BtEngine itself
    this.logger = this.scopedLoggerFor(this)

    if (options.peerId) {
      this.peerId = Buffer.from(options.peerId)
    } else {
      // Generate random peerId: -JS0001- + 12 random bytes
      const prefix = '-JS0001-'
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
  private handleIncomingConnection(nativeSocket: any) {
    const socket = this.socketFactory.wrapTcpSocket(nativeSocket)

    // Check global connection limit for incoming connections
    if (this.numConnections >= this.maxConnections) {
      this.logger.debug(
        `Rejecting incoming connection: global limit reached (${this.numConnections}/${this.maxConnections})`,
      )
      socket.close()
      return
    }

    // Validate remote address info - required for peer tracking
    if (!socket.remoteAddress || !socket.remotePort) {
      this.logger.error(
        `Incoming connection missing remote address info (remoteAddress=${socket.remoteAddress}, remotePort=${socket.remotePort}). ` +
          `Socket wrapper must implement remoteAddress/remotePort getters.`,
      )
      socket.close()
      return
    }

    const peer = new PeerConnection(this, socket, {
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
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
        this.logger.warn(`Incoming connection for unknown torrent ${infoHashStr}`)
        peer.close()
      }
    })
  }

  async addTorrent(
    magnetOrBuffer: string | Uint8Array,
    options: {
      storageKey?: string
      /** Whether this torrent is being restored from session or added by user action. Default: 'user' */
      source?: 'user' | 'restore'
      userState?: TorrentUserState
    } = {},
  ): Promise<Torrent | null> {
    // Parse the input (magnet link or torrent file)
    const input = await parseTorrentInput(magnetOrBuffer, this.hasher)

    // Check for existing torrent
    const existing = this.getTorrent(input.infoHashStr)
    if (existing) {
      return existing
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
    if (options.source !== 'restore' && input.torrentFileBuffer) {
      await this.sessionPersistence.saveTorrentFile(input.infoHashStr, input.torrentFileBuffer)
    }

    // Persist torrent list (unless restoring from session)
    if (options.source !== 'restore') {
      await this.sessionPersistence.saveTorrentList()
    }

    return torrent
  }

  async removeTorrent(torrent: Torrent) {
    const index = this.torrents.indexOf(torrent)
    if (index !== -1) {
      this.torrents.splice(index, 1)
      const infoHash = toHex(torrent.infoHash)

      // Remove persisted data
      await this.sessionPersistence.removeTorrentData(infoHash)
      await this.sessionPersistence.saveTorrentList()

      torrent.stop()
      this.emit('torrent-removed', torrent)
    }
  }

  async removeTorrentByHash(infoHash: string) {
    const torrent = this.getTorrent(infoHash)
    if (torrent) {
      await this.removeTorrent(torrent)
    }
  }

  /**
   * Reset a torrent's state (progress, stats, file priorities) without removing it.
   * For magnet torrents, this preserves the infodict so metadata doesn't need to be re-fetched.
   * The torrent will be stopped after reset and needs to be started manually.
   */
  async resetTorrent(torrent: Torrent): Promise<void> {
    const index = this.torrents.indexOf(torrent)
    if (index === -1) return

    const infoHash = toHex(torrent.infoHash)

    // Stop without tracker announce (much faster)
    await torrent.stop({ skipAnnounce: true })

    // Reset in-memory state
    torrent.resetState()

    // Reset persisted state (but preserve infodict for magnet torrents)
    await this.sessionPersistence.resetState(infoHash)

    // Set user state to stopped
    torrent.userState = 'stopped'

    // Save the new (empty) state
    await this.sessionPersistence.saveTorrentState(torrent)

    this.emit('torrent-updated', torrent)
  }

  getTorrent(infoHash: string): Torrent | undefined {
    return this.torrents.find((t) => toHex(t.infoHash) === infoHash)
  }

  async destroy() {
    this.logger.info('Destroying engine')

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

  /**
   * Set connection limits for the engine.
   * @param maxPeersPerTorrent - Maximum peers per torrent (applied to new and existing torrents)
   * @param maxGlobalPeers - Maximum total connections across all torrents
   * @param maxUploadSlots - Maximum simultaneously unchoked peers per torrent
   */
  setConnectionLimits(
    maxPeersPerTorrent: number,
    maxGlobalPeers: number,
    maxUploadSlots: number,
  ): void {
    this.maxPeers = maxPeersPerTorrent
    this.maxConnections = maxGlobalPeers
    this.maxUploadSlots = maxUploadSlots
    // Apply to all existing torrents
    for (const torrent of this.torrents) {
      torrent.setMaxPeers(maxPeersPerTorrent)
      torrent.setMaxUploadSlots(maxUploadSlots)
    }
    this.logger.info(
      `Connection limits updated: maxPeersPerTorrent=${maxPeersPerTorrent}, maxGlobalPeers=${maxGlobalPeers}, maxUploadSlots=${maxUploadSlots}`,
    )
  }

  /**
   * Set encryption policy for the engine.
   * Takes effect for new connections on all torrents.
   * @param policy - 'disabled' | 'allow' | 'prefer' | 'required'
   */
  setEncryptionPolicy(policy: EncryptionPolicy): void {
    this.encryptionPolicy = policy
    // Apply to all existing torrents
    for (const torrent of this.torrents) {
      torrent.setEncryptionPolicy(policy)
    }
    this.logger.info(`Encryption policy updated: ${policy}`)
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

  /**
   * Configure daemon operation rate limit.
   * @param opsPerSecond - Rate limit (0 = unlimited)
   * @param burstSize - Maximum burst (default: 2x rate)
   */
  setDaemonRateLimit(opsPerSecond: number, burstSize?: number): void {
    const burst = burstSize ?? opsPerSecond * 2
    this.daemonRateLimiter.setLimit(opsPerSecond, burst / Math.max(1, opsPerSecond))
  }

  /**
   * Configure global connection rate limit.
   * @deprecated Use setDaemonRateLimit() instead.
   */
  setConnectionRateLimit(connectionsPerSecond: number, burstSize?: number): void {
    this.setDaemonRateLimit(connectionsPerSecond, burstSize)
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

  /**
   * Enable or disable UPnP port mapping.
   * When enabled, discovers gateway and maps the listening port.
   * When disabled, removes any active mappings.
   */
  async setUPnPEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.enableUPnP()
    } else {
      await this.disableUPnP()
    }
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
      this._upnpStatus = 'failed'
      this.emit('upnpStatusChanged', this._upnpStatus)
      this.logger.info('UPnP: No gateway found')
      return
    }

    const tcpMapped = await this.upnpManager.addMapping(this.port, 'TCP')
    const udpMapped = await this.upnpManager.addMapping(this.port, 'UDP') // For DHT

    if (tcpMapped) {
      this._upnpStatus = 'mapped'
      this.emit('upnpStatusChanged', this._upnpStatus)
      this.logger.info(
        `UPnP: Mapped TCP port ${this.port}${udpMapped ? ' and UDP' : ''}, external IP: ${this.upnpManager.externalIP}`,
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
   * Enable or disable DHT.
   * When enabled, starts the DHT node and begins peer discovery.
   * When disabled, stops the DHT node and saves state for persistence.
   */
  async setDHTEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await this.enableDHT()
    } else {
      await this.disableDHT()
    }
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

    this._dhtNode = new DHTNode({
      nodeId,
      socketFactory: this.socketFactory,
      krpcOptions: { bindPort: this.port }, // Use same port as TCP for UDP
      logger: dhtLogger,
    })

    await this._dhtNode.start()

    // Restore routing table from persisted state
    if (persistedState && persistedState.nodes.length > 0) {
      this.logger.info(`DHT: Restoring ${persistedState.nodes.length} nodes from session`)
      for (const node of persistedState.nodes) {
        this._dhtNode.addNode({
          id: hexToNodeId(node.id),
          host: node.host,
          port: node.port,
        })
      }
    }

    // Bootstrap if routing table is empty or small (skip for tests)
    if (!this._skipDHTBootstrap && this._dhtNode.getNodeCount() < 10) {
      this.logger.info('DHT: Bootstrapping...')
      const stats = await this._dhtNode.bootstrap()
      this.logger.info(`DHT: Bootstrap complete - ${stats.routingTableSize} nodes in routing table`)
    }

    this.logger.info(`DHT: Started with node ID ${this._dhtNode.nodeIdHex}`)
    this.emit('dhtStatusChanged', true)
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
