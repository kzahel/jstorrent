import { PeerConnection } from './peer-connection'
import { ActivePiece, BLOCK_SIZE } from './active-piece'
import { ActivePieceManager } from './active-piece-manager'
import { TorrentContentStorage } from './torrent-content-storage'
import { HashMismatchError } from '../adapters/daemon/daemon-file-handle'
import { BitField } from '../utils/bitfield'
import { MessageType, WireMessage } from '../protocol/wire-protocol'
import { toHex, toString, compare } from '../utils/buffer'
import { Bencode } from '../utils/bencode'
import { TrackerManager } from '../tracker/tracker-manager'
import { ISocketFactory } from '../interfaces/socket'
import { PeerInfo } from '../interfaces/tracker'
import { TorrentFileInfo } from './torrent-file-info'
import { EngineComponent } from '../logging/logger'
import type { BtEngine } from './bt-engine'
import { TorrentUserState, TorrentActivityState, computeActivityState } from './torrent-state'
import { Swarm, SwarmStats, detectAddressFamily, peerKey } from './swarm'
import { ConnectionManager } from './connection-manager'
import { ConnectionTimingTracker } from './connection-timing'

/**
 * All persisted fields for a torrent.
 * Adding a new persisted field = add to this interface + add getter/setter in Torrent.
 */
export interface TorrentPersistedState {
  // === Origin (at least one set) ===
  magnetLink?: string // Original magnet URI
  torrentFileBase64?: string // Base64-encoded .torrent file

  // Info dict - for magnet, fetched from peers
  // For .torrent, can extract from torrentFile but cache here
  infoBuffer?: Uint8Array

  // === Timestamps ===
  addedAt: number
  completedAt?: number

  // === User Intent ===
  userState: TorrentUserState
  queuePosition?: number

  // === Stats ===
  totalDownloaded: number
  totalUploaded: number

  // === Progress ===
  completedPieces: number[] // Indices of verified pieces
}

/**
 * Create default persisted state for new torrents.
 */
export function createDefaultPersistedState(): TorrentPersistedState {
  return {
    addedAt: Date.now(),
    userState: 'active',
    totalDownloaded: 0,
    totalUploaded: 0,
    completedPieces: [],
  }
}

export class Torrent extends EngineComponent {
  static logName = 'torrent'

  private btEngine: BtEngine
  private pendingConnections: Set<string> = new Set() // Track in-flight connection attempts (legacy, to be removed)
  private _swarm: Swarm // Single source of truth for peer state (Phase 3)
  private _connectionManager: ConnectionManager // Handles outgoing connection lifecycle
  private connectionTiming: ConnectionTimingTracker // Tracks connection timing for adaptive timeouts
  public infoHash: Uint8Array
  public peerId: Uint8Array
  public socketFactory: ISocketFactory
  public port: number
  private activePieces?: ActivePieceManager

  // Piece info (moved from PieceManager)
  public pieceHashes: Uint8Array[] = []
  public pieceLength: number = 0
  public lastPieceLength: number = 0
  public piecesCount: number = 0
  public contentStorage?: TorrentContentStorage
  private _bitfield?: BitField
  public announce: string[] = []
  public trackerManager?: TrackerManager
  private _files: TorrentFileInfo[] = []
  public maxPeers: number = 20
  public globalLimitCheck: () => boolean = () => true

  // Metadata Phase
  public metadataSize: number | null = null
  public metadataBuffer: Uint8Array | null = null
  public metadataComplete = false
  public metadataPiecesReceived = new Set<number>()
  private _metadataRaw: Uint8Array | null = null // The full info dictionary buffer

  /**
   * The raw info dictionary buffer (verified via SHA1 against infoHash).
   * This is the bencoded "info" dictionary from the .torrent file.
   * Available for session persistence.
   */
  get metadataRaw(): Uint8Array | null {
    return this._metadataRaw
  }

  // Cached parsed info dictionary (to avoid repeated bencode parsing)
  private _cachedInfoDict?: Record<string, unknown>

  /**
   * The parsed info dictionary (decoded from metadataRaw).
   * This is the official BitTorrent "info dict" containing name, piece hashes, files, etc.
   * Lazily parsed and cached to avoid repeated bencode decoding.
   */
  get infoDict(): Record<string, unknown> | undefined {
    if (this._cachedInfoDict) return this._cachedInfoDict

    if (this._metadataRaw) {
      try {
        this._cachedInfoDict = Bencode.decode(this._metadataRaw) as Record<string, unknown>
        return this._cachedInfoDict
      } catch {
        // Ignore decode errors
      }
    }
    return undefined
  }

  // Magnet display name (dn parameter) - fallback when info dict isn't available yet
  public _magnetDisplayName?: string

  // === Centralized persisted state ===
  private _persisted: TorrentPersistedState = createDefaultPersistedState()

  // === Persisted state getters ===
  get totalDownloaded(): number {
    return this._persisted.totalDownloaded
  }
  set totalDownloaded(value: number) {
    this._persisted.totalDownloaded = value
  }

  get totalUploaded(): number {
    return this._persisted.totalUploaded
  }
  set totalUploaded(value: number) {
    this._persisted.totalUploaded = value
  }

  get userState(): TorrentUserState {
    return this._persisted.userState
  }
  set userState(value: TorrentUserState) {
    this._persisted.userState = value
  }

  get queuePosition(): number | undefined {
    return this._persisted.queuePosition
  }
  set queuePosition(value: number | undefined) {
    this._persisted.queuePosition = value
  }

  get addedAt(): number {
    return this._persisted.addedAt
  }
  set addedAt(value: number) {
    this._persisted.addedAt = value
  }

  get completedAt(): number | undefined {
    return this._persisted.completedAt
  }
  set completedAt(value: number | undefined) {
    this._persisted.completedAt = value
  }

  get magnetLink(): string | undefined {
    return this._persisted.magnetLink
  }
  set magnetLink(value: string | undefined) {
    this._persisted.magnetLink = value
  }

  get torrentFileBase64(): string | undefined {
    return this._persisted.torrentFileBase64
  }
  set torrentFileBase64(value: string | undefined) {
    this._persisted.torrentFileBase64 = value
  }

  /**
   * Whether the torrent is currently checking data.
   */
  private _isChecking: boolean = false

  /**
   * Current error message if any.
   */
  public errorMessage?: string

  /**
   * Whether network is currently active for this torrent.
   */
  private _networkActive: boolean = false

  /**
   * Periodic maintenance interval for peer slot filling.
   */
  private _maintenanceInterval: ReturnType<typeof setInterval> | null = null

  public isPrivate: boolean = false
  public creationDate?: number

  // We need to re-implement EventEmitter methods if we don't extend it.
  // Or I can modify EngineComponent to extend EventEmitter.
  // Let's modify EngineComponent first.

  constructor(
    engine: BtEngine,
    infoHash: Uint8Array,
    peerId: Uint8Array,
    socketFactory: ISocketFactory,
    port: number,
    contentStorage?: TorrentContentStorage,
    announce: string[] = [],
    maxPeers: number = 20,
    globalLimitCheck: () => boolean = () => true,
  ) {
    super(engine)
    this.btEngine = engine
    this.infoHash = infoHash
    this.peerId = peerId
    this.socketFactory = socketFactory
    this.port = port
    this.contentStorage = contentStorage
    this.announce = announce
    this.maxPeers = maxPeers
    this.globalLimitCheck = globalLimitCheck

    this.instanceLogName = `t:${toHex(infoHash).slice(0, 6)}`

    // Initialize connection timing tracker for adaptive timeouts
    this.connectionTiming = new ConnectionTimingTracker()

    // Initialize swarm for unified peer tracking
    this._swarm = new Swarm(this.logger)

    // Initialize connection manager with config based on maxPeers
    this._connectionManager = new ConnectionManager(
      this._swarm,
      this.socketFactory,
      this.engineInstance,
      this.logger,
      {
        maxPeersPerTorrent: this.maxPeers,
        connectTimeout: 10000, // 10 second internal timeout
      },
    )

    if (this.announce.length > 0) {
      this.initTrackerManager()
    }
  }

  async start() {
    if ((this.engine as BtEngine).isSuspended) {
      this.logger.debug('Engine suspended, not starting')
      return
    }

    if (this.userState !== 'active') {
      this.logger.debug('User state is not active, not starting')
      return
    }

    this._networkActive = true

    // Start periodic maintenance (idempotent)
    this.startMaintenance()

    if (this.trackerManager) {
      this.logger.info('Starting tracker announce')
      await this.trackerManager.announce('started')
    }
  }

  async connectToPeer(peerInfo: PeerInfo) {
    const key = peerKey(peerInfo.ip, peerInfo.port)

    // Check if already connected (via swarm - single source of truth)
    const existingPeer = this._swarm.getPeerByKey(key)
    if (existingPeer?.state === 'connected') return

    // Check if connection already in progress
    if (this.pendingConnections.has(key)) return

    // Reserve slot FIRST (synchronous) - prevents race condition
    this.pendingConnections.add(key)
    this._swarm.markConnecting(key)

    // NOW check limits (after adding, so count is accurate)
    const totalConnections = this.numPeers + this.pendingConnections.size
    if (totalConnections > this.maxPeers) {
      this.logger.debug(
        `Skipping peer ${peerInfo.ip}, max peers reached (${totalConnections}/${this.maxPeers})`,
      )
      this.pendingConnections.delete(key)
      this._swarm.markConnectFailed(key, 'limit_exceeded')
      return
    }

    if (!this.globalLimitCheck()) {
      this.logger.debug(`Skipping peer ${peerInfo.ip}, global max connections reached`)
      this.pendingConnections.delete(key)
      this._swarm.markConnectFailed(key, 'limit_exceeded')
      return
    }

    const connectStartTime = Date.now()
    const timeout = this.connectionTiming.getTimeout()

    try {
      this.logger.info(`Connecting to ${peerInfo.ip}:${peerInfo.port} (timeout: ${timeout}ms)`)
      const socket = await this.createConnectionWithTimeout(peerInfo, timeout)

      // Record successful connection time
      const connectionTime = Date.now() - connectStartTime
      this.connectionTiming.recordSuccess(connectionTime)

      const peer = new PeerConnection(this.engineInstance, socket, {
        remoteAddress: peerInfo.ip,
        remotePort: peerInfo.port,
      })

      // Remove from pending BEFORE adding to peers (prevents double-counting)
      this.pendingConnections.delete(key)

      // We need to set up the peer
      this.addPeer(peer)

      // Initiate handshake
      peer.sendHandshake(this.infoHash, this.peerId)
    } catch (err) {
      const elapsed = Date.now() - connectStartTime

      // Check if this was a timeout
      if (err instanceof Error && err.message.includes('timeout')) {
        this.connectionTiming.recordTimeout()
        this.logger.debug(`Connection to ${key} timed out after ${elapsed}ms`)
      }

      // very common to happen, don't log details
      this._swarm.markConnectFailed(key, 'connection_error')
      this.pendingConnections.delete(key)
    }
  }

  /**
   * Create a TCP connection with an internal timeout.
   * This runs independently of the io-daemon's 30s backstop.
   */
  private async createConnectionWithTimeout(
    peerInfo: PeerInfo,
    timeoutMs: number,
  ): Promise<import('../interfaces/socket').ITcpSocket> {
    return new Promise((resolve, reject) => {
      let settled = false

      // Internal timeout
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error(`Connection timeout after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      // Attempt connection
      this.socketFactory
        .createTcpSocket(peerInfo.ip, peerInfo.port)
        .then((socket) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            resolve(socket)
          } else {
            // Timeout already fired, close the socket
            socket.close()
          }
        })
        .catch((error) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            reject(error)
          }
        })
    })
  }

  get infoHashStr(): string {
    return toHex(this.infoHash)
  }

  get bitfield(): BitField | undefined {
    return this._bitfield
  }

  /**
   * Initialize the bitfield with the given piece count.
   * Called when metadata is available and we know how many pieces there are.
   */
  initBitfield(pieceCount: number): void {
    this._bitfield = new BitField(pieceCount)
  }

  // --- Piece Info Initialization ---

  /**
   * Initialize piece info from parsed torrent metadata.
   * Called when metadata becomes available.
   */
  initPieceInfo(pieceHashes: Uint8Array[], pieceLength: number, lastPieceLength: number): void {
    this.pieceHashes = pieceHashes
    this.pieceLength = pieceLength
    this.lastPieceLength = lastPieceLength
    this.piecesCount = pieceHashes.length
  }

  // --- Piece Metadata ---

  getPieceHash(index: number): Uint8Array | undefined {
    return this.pieceHashes[index]
  }

  getPieceLength(index: number): number {
    if (index === this.piecesCount - 1) {
      return this.lastPieceLength
    }
    return this.pieceLength
  }

  // --- Bitfield Helpers ---

  hasPiece(index: number): boolean {
    return this._bitfield?.get(index) ?? false
  }

  markPieceVerified(index: number): void {
    this._bitfield?.set(index, true)
  }

  getMissingPieces(): number[] {
    if (!this._bitfield) return []
    const missing: number[] = []
    for (let i = 0; i < this.piecesCount; i++) {
      if (!this._bitfield.get(i)) {
        missing.push(i)
      }
    }
    return missing
  }

  // --- Progress ---

  get completedPiecesCount(): number {
    return this._bitfield?.count() ?? 0
  }

  get isDownloadComplete(): boolean {
    return this.piecesCount > 0 && this.completedPiecesCount === this.piecesCount
  }

  // --- Session Restore ---

  restoreBitfieldFromHex(hex: string): void {
    this._bitfield?.restoreFromHex(hex)
  }

  get numPeers(): number {
    // Use swarm as single source of truth (Phase 3)
    return this._swarm.connectedCount
  }

  /**
   * Get all connected peer connections.
   * With Phase 3, swarm is single source of truth.
   */
  get peers(): PeerConnection[] {
    return this._swarm.getConnectedPeers()
  }

  /**
   * Alias for peers - used internally.
   */
  private get connectedPeers(): PeerConnection[] {
    return this.peers
  }

  /**
   * Get swarm statistics for debugging/UI.
   * Shows all known peers from all discovery sources.
   */
  get swarm(): SwarmStats {
    return this._swarm.getStats()
  }

  /**
   * Get all swarm peers (for detailed debugging).
   */
  get swarmPeers(): IterableIterator<import('./swarm').SwarmPeer> {
    return this._swarm.allPeers()
  }

  /**
   * Get connection timing statistics for debugging/UI.
   */
  getConnectionTimingStats(): import('./connection-timing').ConnectionTimingStats {
    return this.connectionTiming.getStats()
  }

  get isComplete(): boolean {
    return this.isDownloadComplete
  }

  get files(): TorrentFileInfo[] {
    if (this._files.length > 0) return this._files

    if (this.contentStorage && this.hasMetadata) {
      const rawFiles = this.contentStorage.filesList
      this._files = rawFiles.map((f) => new TorrentFileInfo(f, this))
      return this._files
    }
    return []
  }

  get progress(): number {
    if (this.piecesCount === 0) return 0
    return this.completedPiecesCount / this.piecesCount
  }

  get name(): string {
    // Try to get from info dict (cached, avoids repeated parsing)
    const info = this.infoDict
    if (info?.name) {
      return toString(info.name as Uint8Array)
    }

    // Fallback to magnet display name
    if (this._magnetDisplayName) return this._magnetDisplayName

    // Final fallback to truncated infohash
    return `Torrent-${this.infoHashStr.substring(0, 8)}...`
  }

  get downloadSpeed(): number {
    return this.connectedPeers.reduce((acc, peer) => acc + peer.downloadSpeed, 0)
  }

  get uploadSpeed(): number {
    return this.connectedPeers.reduce((acc, peer) => acc + peer.uploadSpeed, 0)
  }

  /**
   * Get the current activity state (derived, not persisted).
   */
  get activityState(): TorrentActivityState {
    return computeActivityState(
      this.userState,
      (this.engine as BtEngine).isSuspended,
      this.hasMetadata,
      this._isChecking,
      this.progress,
      !!this.errorMessage,
    )
  }

  /**
   * Whether this torrent has metadata (piece info, files, etc).
   */
  get hasMetadata(): boolean {
    return this.piecesCount > 0
  }

  /**
   * User action: Start the torrent.
   * Changes userState to 'active' and starts networking if engine allows.
   */
  userStart(): void {
    this.logger.info('User starting torrent')
    this.userState = 'active'
    this.errorMessage = undefined

    if (!(this.engine as BtEngine).isSuspended) {
      this.resumeNetwork()
    }

    // Persist state change
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentList()
  }

  /**
   * User action: Stop the torrent.
   * Changes userState to 'stopped' and stops all networking.
   */
  userStop(): void {
    this.logger.info('User stopping torrent')
    this.userState = 'stopped'
    this.suspendNetwork()

    // Persist state change
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentList()
  }

  /**
   * Internal: Suspend network activity.
   * Called by engine.suspend() or userStop().
   */
  suspendNetwork(): void {
    if (!this._networkActive) return

    this.logger.debug('Suspending network')
    this._networkActive = false

    // Stop periodic maintenance
    this.stopMaintenance()

    // Send stopped announce to trackers
    if (this.trackerManager) {
      this.trackerManager.announce('stopped').catch((err) => {
        this.logger.warn(`Failed to send stopped announce: ${err}`)
      })
    }

    // Close all peer connections
    for (const peer of this.connectedPeers) {
      peer.close()
    }
    // Note: swarm state is updated via markDisconnected when peers close
    this.pendingConnections.clear()
  }

  /**
   * Internal: Resume network activity.
   * Called by engine.resume() (for active torrents) or userStart().
   */
  resumeNetwork(): void {
    if (this._networkActive) return
    if ((this.engine as BtEngine).isSuspended) return
    if (this.userState !== 'active') return

    this.logger.debug('Resuming network')
    this._networkActive = true

    // Start tracker announces
    if (this.trackerManager) {
      this.trackerManager.announce('started').catch((err) => {
        this.logger.warn(`Failed to send started announce: ${err}`)
      })
    } else if (this.announce.length > 0) {
      // Initialize tracker manager if we have announces but no manager yet
      this.initTrackerManager()
    }

    // Start periodic maintenance for peer slots
    this.startMaintenance()
  }

  /**
   * Start periodic maintenance to fill peer slots.
   * Runs every 5 seconds to check if we need more peers.
   */
  private startMaintenance(): void {
    if (this._maintenanceInterval) return

    this._maintenanceInterval = setInterval(() => {
      this.runMaintenance()
    }, 5000) // Run every 5 seconds
  }

  /**
   * Stop periodic maintenance.
   */
  private stopMaintenance(): void {
    if (this._maintenanceInterval) {
      clearInterval(this._maintenanceInterval)
      this._maintenanceInterval = null
    }
  }

  /**
   * Validate connection state invariants.
   * With Phase 3, swarm is single source of truth, so these checks are simpler.
   */
  private checkSwarmInvariants(): void {
    const swarmStats = this._swarm.getStats()

    // connectingKeys should match pendingConnections (until we remove pendingConnections)
    if (swarmStats.byState.connecting !== this.pendingConnections.size) {
      const msg = `swarm.connecting (${swarmStats.byState.connecting}) !== pendingConnections (${this.pendingConnections.size})`
      this.logger.error(`INVARIANT VIOLATION: ${msg}`)
      this.emit('invariant_violation', { type: 'connecting_mismatch', message: msg })
    }

    // Total active connections should not exceed maxPeers (with headroom for in-flight)
    const total = this.numPeers + swarmStats.byState.connecting
    const maxWithHeadroom = this.maxPeers + 10 // Allow headroom for in-flight connections
    if (total > maxWithHeadroom) {
      const msg = `total connections (${total}) > maxPeers+headroom (${maxWithHeadroom})`
      this.logger.error(`INVARIANT VIOLATION: ${msg}`)
      this.emit('invariant_violation', {
        type: 'limit_exceeded',
        total,
        max: maxWithHeadroom,
        peers: this.numPeers,
        connecting: swarmStats.byState.connecting,
        message: msg,
      })
    }
  }

  /**
   * Assert connection limit immediately after state changes.
   * Allows headroom for in-flight connections.
   */
  private assertConnectionLimit(context: string): void {
    const connecting = this._swarm.connectingCount
    const total = this.numPeers + connecting
    const maxWithHeadroom = this.maxPeers + 10
    if (total > maxWithHeadroom) {
      const msg = `${this.numPeers} peers + ${connecting} connecting = ${total} > ${maxWithHeadroom} max`
      this.logger.error(`LIMIT EXCEEDED [${context}]: ${msg}`)
      this.emit('invariant_violation', {
        type: 'limit_exceeded',
        context,
        total,
        max: maxWithHeadroom,
        peers: this.numPeers,
        connecting,
        message: msg,
      })
    }
  }

  /**
   * Run maintenance: try to fill peer slots from swarm.
   */
  private runMaintenance(): void {
    // Always check invariants regardless of state
    this.checkSwarmInvariants()

    if (!this._networkActive) return
    if (this.isComplete) return // Don't seek peers when complete (unless seeding, future feature)

    const connected = this.numPeers
    const connecting = this.pendingConnections.size
    const slotsAvailable = this.maxPeers - connected - connecting

    if (slotsAvailable <= 0) return
    if (this._swarm.size === 0) return

    // Get connectable peers from swarm (respects backoff, filters banned/connected)
    const candidates = this._swarm.getConnectablePeers(slotsAvailable)

    if (candidates.length > 0) {
      this.logger.debug(
        `Maintenance: ${connected} connected, ${connecting} connecting, ` +
          `${slotsAvailable} slots available, trying ${candidates.length} candidates`,
      )

      for (const swarmPeer of candidates) {
        if (!this.globalLimitCheck()) break
        if (this.numPeers + this.pendingConnections.size >= this.maxPeers) break

        // Connect using existing method
        this.connectToPeer({ ip: swarmPeer.ip, port: swarmPeer.port })
      }
    }
  }

  /**
   * Initialize the tracker manager.
   */
  private initTrackerManager(): void {
    if (this.trackerManager) return

    const tiers = [this.announce]
    this.trackerManager = new TrackerManager(
      this.engineInstance,
      tiers,
      this.infoHash,
      this.peerId,
      this.socketFactory,
      this.port,
    )

    this.trackerManager.on('peersDiscovered', (peers: PeerInfo[]) => {
      // Add peers to swarm for unified tracking
      const peerAddresses = peers.map((p) => ({
        ip: p.ip,
        port: p.port,
        family: detectAddressFamily(p.ip),
      }))
      const added = this._swarm.addPeers(peerAddresses, 'tracker')
      if (added > 0) {
        this.logger.debug(`Added ${added} tracker peers to swarm (total: ${this._swarm.size})`)
      }

      // Fill peer slots (existing behavior)
      this.fillPeerSlots()
    })

    this.trackerManager.on('warning', (msg) => {
      this.logger.warn(`Tracker warning: ${msg}`)
    })

    this.trackerManager.on('error', (err) => {
      this.logger.error(`Tracker error: ${err.message}`)
    })
  }

  /**
   * Get information about all connected peers.
   *
   * Choking/Interest fields follow BitTorrent wire protocol semantics:
   * - peerChoking: Peer is choking us (we cannot download from them)
   * - peerInterested: Peer wants to download from us
   * - amChoking: We are choking peer (blocking their downloads)
   * - amInterested: We want to download from peer
   */
  getPeerInfo() {
    return this.connectedPeers.map((peer) => ({
      ip: peer.remoteAddress,
      port: peer.remotePort,
      client: peer.peerId ? toString(peer.peerId) : 'unknown',
      peerId: peer.peerId ? toHex(peer.peerId) : null,
      downloaded: peer.downloaded,
      uploaded: peer.uploaded,
      downloadSpeed: peer.downloadSpeed,
      uploadSpeed: peer.uploadSpeed,
      percent: peer.bitfield ? peer.bitfield.count() / peer.bitfield.size : 0,
      peerChoking: peer.peerChoking,
      peerInterested: peer.peerInterested,
      amChoking: peer.amChoking,
      amInterested: peer.amInterested,
      piecesHave: peer.bitfield?.count() ?? 0,
      connectionType: peer.isIncoming ? ('incoming' as const) : ('outgoing' as const),
    }))
  }

  getPieceAvailability(): number[] {
    if (!this.hasMetadata) return []
    const counts = new Array(this.piecesCount).fill(0)
    for (const peer of this.connectedPeers) {
      if (peer.bitfield) {
        for (let i = 0; i < counts.length; i++) {
          if (peer.bitfield.get(i)) {
            counts[i]++
          }
        }
      }
    }
    return counts
  }

  disconnectPeer(ip: string, port: number) {
    const peer = this.connectedPeers.find((p) => p.remoteAddress === ip && p.remotePort === port)
    if (peer) {
      peer.close()
    }
  }

  setMaxPeers(max: number) {
    this.maxPeers = max
    // Sync with ConnectionManager
    this._connectionManager.updateConfig({ maxPeersPerTorrent: max })
  }

  addPeer(peer: PeerConnection) {
    // Validate address info exists - required for proper swarm tracking
    if (!peer.remoteAddress || !peer.remotePort) {
      this.logger.warn('addPeer called without address info - cannot track in swarm')
    }

    // Check for duplicate connection (race condition: incoming + outgoing to same peer)
    // Use swarm as single source of truth
    if (peer.remoteAddress && peer.remotePort) {
      const key = peerKey(peer.remoteAddress, peer.remotePort)
      const swarmPeer = this._swarm.getPeerByKey(key)
      if (swarmPeer?.state === 'connected') {
        this.logger.debug(`Rejecting duplicate connection to ${key} - already connected in swarm`)
        peer.close()
        return
      }
    }

    // Check total connections including pending (accounts for incoming during outgoing attempts)
    const total = this.numPeers + this.pendingConnections.size
    if (total >= this.maxPeers) {
      this.logger.warn(`Rejecting peer, max reached (${total}/${this.maxPeers})`)
      peer.close()
      // Clear swarm connecting state if this was an outgoing connection we initiated
      if (peer.remoteAddress && peer.remotePort) {
        const key = peerKey(peer.remoteAddress, peer.remotePort)
        this._swarm.markConnectFailed(key, 'max_peers_reached')
      }
      return
    }
    // Note: global limit for incoming is handled by BtEngine, but if we add manually we should check?
    // BtEngine calls addPeer for incoming.
    // If we call addPeer manually (e.g. from tests), we should check.
    if (!this.globalLimitCheck()) {
      this.logger.warn('Rejecting peer, global max connections reached')
      peer.close()
      // Clear swarm connecting state if this was an outgoing connection we initiated
      if (peer.remoteAddress && peer.remotePort) {
        const key = peerKey(peer.remoteAddress, peer.remotePort)
        this._swarm.markConnectFailed(key, 'global_limit_reached')
      }
      return
    }

    // Update swarm state FIRST - swarm is single source of truth (Phase 3)
    if (peer.remoteAddress && peer.remotePort) {
      const key = peerKey(peer.remoteAddress, peer.remotePort)
      if (this._swarm.hasPeer(key)) {
        // Outgoing connection we initiated
        this._swarm.markConnected(key, peer)
      } else {
        // Incoming connection - add to swarm
        this._swarm.addIncomingConnection(
          peer.remoteAddress,
          peer.remotePort,
          detectAddressFamily(peer.remoteAddress),
          peer,
        )
      }
    }

    this.assertConnectionLimit('addPeer')
    if (this.hasMetadata) {
      peer.bitfield = new BitField(this.piecesCount)
    }
    this.setupPeerListeners(peer)
  }

  private setupPeerListeners(peer: PeerConnection) {
    const onHandshake = (_infoHash: Uint8Array, peerId: Uint8Array, extensions: boolean) => {
      this.logger.debug('Handshake received')
      // Verify infoHash matches

      // If we initiated connection, we sent handshake first.
      // If they initiated, they sent handshake first.
      // PeerConnection handles the handshake exchange logic mostly.

      // Update swarm with peer identity
      if (peer.remoteAddress && peer.remotePort) {
        const key = peerKey(peer.remoteAddress, peer.remotePort)
        // Note: clientName is null here - could be parsed from peerId later if needed
        this._swarm.setIdentity(key, peerId, null)
      }

      if (extensions) {
        peer.sendExtendedHandshake()
      }

      // Send BitField
      if (this.bitfield) {
        this.logger.debug('Sending BitField to peer')
        peer.sendMessage(MessageType.BITFIELD, this.bitfield.toBuffer())
      } else {
        this.logger.debug('No bitfield to send')
      }
    }

    peer.on('handshake', onHandshake)

    // If handshake already received (e.g. incoming connection handled by BtEngine), trigger logic immediately
    if (peer.handshakeReceived && peer.infoHash && peer.peerId) {
      onHandshake(peer.infoHash, peer.peerId, peer.peerExtensions)
    }

    peer.on('extension_handshake', (_payload) => {
      this.logger.info(
        `Extension handshake received. metadataComplete=${this.metadataComplete}, peerMetadataId=${peer.peerMetadataId}`,
      )
      // Check if we need metadata and peer has it
      if (!this.metadataComplete && peer.peerMetadataId !== null) {
        // this.logger.info('Peer supports metadata, requesting piece 0...')
        peer.sendMetadataRequest(0)
      } else if (this.metadataComplete) {
        this.logger.debug('Already have metadata, not requesting')
      } else if (peer.peerMetadataId === null) {
        this.logger.warn('Peer does not support ut_metadata extension')
      }
    })

    peer.on('metadata_request', (piece) => {
      this.handleMetadataRequest(peer, piece)
    })

    peer.on('metadata_data', (piece, totalSize, data) => {
      this.handleMetadataData(peer, piece, totalSize, data)
    })

    peer.on('metadata_reject', (piece) => {
      this.logger.warn(`Metadata piece ${piece} rejected by peer`)
    })

    peer.on('bitfield', (_bf) => {
      this.logger.debug('Bitfield received')
      // Update interest
      this.updateInterest(peer)
    })

    peer.on('have', (_index) => {
      this.logger.debug(`Have received ${_index}`)
      this.updateInterest(peer)
    })

    peer.on('unchoke', () => {
      this.logger.debug('Unchoke received')
      this.requestPieces(peer)
    })

    peer.on('interested', () => {
      this.logger.debug('Interested received')
      this.handleInterested(peer)
    })

    peer.on('message', (msg) => {
      if (msg.type === MessageType.PIECE) {
        this.handleBlock(peer, msg)
      }
    })

    peer.on('request', (index, begin, length) => {
      this.handleRequest(peer, index, begin, length)
    })

    peer.on('error', (err) => {
      this.logger.error(`Peer error: ${err.message}`)
      this.removePeer(peer)
    })

    peer.on('close', () => {
      this.logger.debug('Peer closed')
      this.removePeer(peer)
    })

    peer.on('bytesDownloaded', (bytes) => {
      this.totalDownloaded += bytes
      this.emit('download', bytes) // Re-emit or keep existing 'download' event usage?
      // Existing 'download' event was emitted in handlePiece, but that's for valid pieces?
      // No, handlePiece emitted 'download' with block length.
      // Let's check handlePiece.
    })

    peer.on('bytesUploaded', (bytes) => {
      this.totalUploaded += bytes
      this.emit('upload', bytes)
    })

    // PEX: Listen for peers discovered via peer exchange
    // Note: pex_peers is emitted by PexHandler using (peer as any).emit()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(peer as any).on('pex_peers', (peers: import('./swarm').PeerAddress[]) => {
      const added = this._swarm.addPeers(peers, 'pex')
      if (added > 0) {
        this.logger.debug(`Added ${added} PEX peers to swarm (total: ${this._swarm.size})`)
        // Try to fill peer slots with newly discovered peers
        this.fillPeerSlots()
      }
    })
  }

  private removePeer(peer: PeerConnection) {
    // Update swarm state - swarm is single source of truth (Phase 3)
    if (peer.remoteAddress && peer.remotePort) {
      const key = peerKey(peer.remoteAddress, peer.remotePort)
      this._swarm.markDisconnected(key)
      this.logger.debug(`Removing peer ${key}, peers remaining: ${this.numPeers}`)
    } else {
      // Address info missing - this is a bug, but log it to help debug
      this.logger.warn('removePeer called without address info - swarm state may be inconsistent', {
        peerId: peer.peerId ? toHex(peer.peerId) : 'unknown',
      })
    }

    // THE KEY FIX: Clear requests for this peer so blocks can be re-requested
    // Unlike the old approach (clearing all requests for affected pieces),
    // this surgically removes only the requests from the disconnected peer
    const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
    const cleared = this.activePieces?.clearRequestsForPeer(peerId) || 0
    if (cleared > 0) {
      this.logger.debug(`Peer ${peerId} disconnected, cleared ${cleared} pending requests`)
    }

    // If we still have peers, try to request more pieces
    if (this.numPeers > 0) {
      for (const remainingPeer of this.connectedPeers) {
        if (!remainingPeer.peerChoking) {
          this.requestPieces(remainingPeer)
        }
      }
    }

    // Fill the vacated peer slot with a known peer
    this.fillPeerSlots()
  }

  /**
   * Fill peer slots from the swarm.
   * Delegates to runMaintenance() for single codepath.
   */
  private fillPeerSlots(): void {
    this.runMaintenance()
  }

  private async handleRequest(peer: PeerConnection, index: number, begin: number, length: number) {
    if (peer.amChoking) {
      // We are choking the peer, ignore request
      return
    }

    if (!this.bitfield || !this.bitfield.get(index)) {
      // We don't have this piece
      return
    }

    if (!this.contentStorage) return

    try {
      const block = await this.contentStorage.read(index, begin, length)
      peer.sendPiece(index, begin, block)
    } catch (err) {
      this.logger.error(
        `Error handling request: ${err instanceof Error ? err.message : String(err)}`,
        { err },
      )
    }
  }

  private handleInterested(peer: PeerConnection) {
    peer.peerInterested = true
    // Simple unchoke strategy: always unchoke interested peers
    if (peer.amChoking) {
      this.logger.debug('Unchoking peer')
      peer.amChoking = false
      peer.sendMessage(MessageType.UNCHOKE)
    }
  }

  private updateInterest(peer: PeerConnection) {
    if (peer.bitfield) {
      // Check if peer has any piece we are missing
      // For now, just set interested if they have anything (naive)
      // Better: check intersection of peer.bitfield and ~this.bitfield
      const interested = true // Placeholder for logic
      // console.log(`Torrent: Checking interest for peer. Interested: ${interested}, AmInterested: ${peer.amInterested}`)
      if (interested && !peer.amInterested) {
        this.logger.debug('Sending INTERESTED')
        peer.sendMessage(MessageType.INTERESTED)
        peer.amInterested = true
      }

      // If we are interested and unchoked, try to request
      if (interested && !peer.peerChoking) {
        this.requestPieces(peer)
      }
    }
  }

  private requestPieces(peer: PeerConnection) {
    if (peer.peerChoking) {
      // console.error(`requestPieces: Peer is choking us`)
      return
    }

    if (!this.hasMetadata) {
      return
    }

    // Initialize activePieces if needed (lazy init after metadata is available)
    if (!this.activePieces) {
      this.activePieces = new ActivePieceManager(
        this.engineInstance,
        (index) => this.getPieceLength(index),
        { requestTimeoutMs: 30000, maxActivePieces: 20, maxBufferedBytes: 16 * 1024 * 1024 },
      )
    }

    const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
    const missing = this.getMissingPieces()
    /*
    console.error(
      `requestPieces: ${missing.length} missing pieces, peer.bitfield=${!!peer.bitfield}, peerPending=${peer.requestsPending}`,
    )
      */

    const MAX_PIPELINE = 200

    let _requestsMade = 0
    let _skippedComplete = 0
    let _skippedCapacity = 0
    let _skippedPeerLacks = 0
    let _skippedNoNeeded = 0

    for (const index of missing) {
      if (peer.requestsPending >= MAX_PIPELINE) {
        //this.logger.debug(`requestPieces: Hit MAX_PIPELINE limit`)
        break
      }

      // Check peer has this piece
      if (!peer.bitfield?.get(index)) {
        _skippedPeerLacks++
        continue
      }

      // Get or create active piece
      let piece = this.activePieces.get(index)

      // If piece has all blocks, skip (waiting for hash/flush)
      if (piece?.haveAllBlocks) {
        _skippedComplete++
        continue
      }

      // Try to create if doesn't exist
      if (!piece) {
        const newPiece = this.activePieces.getOrCreate(index)
        if (!newPiece) {
          _skippedCapacity++
          continue // At capacity
        }
        piece = newPiece
      }

      // Get blocks we can request from this piece
      const neededBlocks = piece.getNeededBlocks(MAX_PIPELINE - peer.requestsPending)
      if (neededBlocks.length === 0) {
        _skippedNoNeeded++
        continue
      }

      for (const block of neededBlocks) {
        if (peer.requestsPending >= MAX_PIPELINE) break

        peer.sendRequest(index, block.begin, block.length)
        peer.requestsPending++
        _requestsMade++

        // Track request in ActivePiece (tied to this peer)
        const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
        piece.addRequest(blockIndex, peerId)
      }
    }

    /*
    console.error(
      `requestPieces: Made ${_requestsMade} requests, skipped: complete=${_skippedComplete}, capacity=${_skippedCapacity}, peerLacks=${_skippedPeerLacks}, noNeeded=${_skippedNoNeeded}`,
    )
      */
  }

  /**
   * Handle a received block from the wire protocol PIECE message.
   *
   * BitTorrent terminology:
   * - Piece: A fixed-size segment of the torrent (e.g., 256KB) with a SHA1 hash
   * - Block: A smaller chunk (typically 16KB) transferred in a single PIECE message
   *
   * This method buffers blocks in memory until the piece is complete,
   * then verifies the hash and writes the complete piece to storage.
   */
  private async handleBlock(peer: PeerConnection, msg: WireMessage) {
    if (msg.index === undefined || msg.begin === undefined || !msg.block) {
      return
    }

    if (peer.requestsPending > 0) peer.requestsPending--

    // Initialize activePieces if needed (lazy init after metadata is available)
    if (!this.activePieces && this.hasMetadata) {
      this.activePieces = new ActivePieceManager(
        this.engineInstance,
        (index) => this.getPieceLength(index),
        { requestTimeoutMs: 30000, maxActivePieces: 20, maxBufferedBytes: 16 * 1024 * 1024 },
      )
    }

    if (!this.activePieces) {
      this.logger.warn(
        `Received block ${msg.index}:${msg.begin} but activePieces not initialized (metadata not yet received?)`,
      )
      return
    }

    // Get or create active piece (may receive unsolicited blocks or from different peer)
    let piece = this.activePieces.get(msg.index)
    if (!piece) {
      // Try to create it - could be an unsolicited block or from a peer we just connected
      const newPiece = this.activePieces.getOrCreate(msg.index)
      if (!newPiece) {
        this.logger.debug(`Cannot buffer piece ${msg.index} - at capacity`)
        return
      }
      piece = newPiece
    }

    // Get peer ID for tracking
    const peerId = peer.peerId ? toHex(peer.peerId) : 'unknown'
    const blockIndex = Math.floor(msg.begin / BLOCK_SIZE)

    // Add block to piece
    const isNew = piece.addBlock(blockIndex, msg.block, peerId)
    if (!isNew) {
      this.logger.debug(`Duplicate block ${msg.index}:${msg.begin}`)
    }

    // Check if piece is complete
    if (piece.haveAllBlocks) {
      await this.finalizePiece(msg.index, piece)
    }

    // Continue requesting more pieces
    this.requestPieces(peer)
  }

  /**
   * Finalize a complete piece: verify hash and write to storage.
   * Uses verified write when available (io-daemon) for atomic hash verification.
   */
  private async finalizePiece(index: number, piece: ActivePiece): Promise<void> {
    // Assemble the complete piece
    const pieceData = piece.assemble()
    const expectedHash = this.getPieceHash(index)

    // Try to use verified write (atomic hash check in io-daemon)
    if (this.contentStorage) {
      try {
        const usedVerifiedWrite = await this.contentStorage.writePieceVerified(
          index,
          pieceData,
          expectedHash,
        )

        if (!usedVerifiedWrite && expectedHash) {
          // Verified write not available - verify hash in TypeScript
          const actualHash = await this.btEngine.hasher.sha1(pieceData)
          if (compare(actualHash, expectedHash) !== 0) {
            this.handleHashMismatch(index, piece)
            return
          }
        }
        // If usedVerifiedWrite is true, hash was already verified by io-daemon
      } catch (e) {
        if (e instanceof HashMismatchError) {
          // Hash verification failed in io-daemon
          this.handleHashMismatch(index, piece)
          return
        }
        this.logger.error(`Failed to write piece ${index}:`, e)
        this.activePieces?.remove(index)
        return
      }
    } else if (expectedHash) {
      // No storage but have hash - verify anyway (shouldn't happen in practice)
      const actualHash = await this.btEngine.hasher.sha1(pieceData)
      if (compare(actualHash, expectedHash) !== 0) {
        this.handleHashMismatch(index, piece)
        return
      }
    }

    // Mark as verified
    this.markPieceVerified(index)
    this.activePieces?.remove(index)

    const progressPct =
      this.piecesCount > 0 ? ((this.completedPiecesCount / this.piecesCount) * 100).toFixed(1) : '0'

    this.logger.info(
      `Piece ${index} verified [${this.completedPiecesCount}/${this.piecesCount}] ${progressPct}%`,
    )

    this.emit('piece', index)

    // Emit progress event with detailed info
    this.emit('progress', {
      pieceIndex: index,
      completedPieces: this.completedPiecesCount,
      totalPieces: this.piecesCount,
      progress: this.progress,
      downloaded: this.totalDownloaded,
    })

    // Emit verified event for persistence
    if (this.bitfield) {
      this.emit('verified', {
        bitfield: this.bitfield.toHex(),
      })
    }

    // Persist state (debounced to avoid excessive writes)
    const btEngine = this.engine as BtEngine
    btEngine.sessionPersistence?.saveTorrentStateDebounced(this)

    // Send HAVE message to all peers
    for (const p of this.connectedPeers) {
      if (p.handshakeReceived) {
        p.sendHave(index)
      }
    }

    this.checkCompletion()
  }

  /**
   * Handle hash mismatch for a piece - log, track contributors, and discard.
   */
  private handleHashMismatch(index: number, piece: ActivePiece): void {
    const contributors = piece.getContributingPeers()
    this.logger.warn(
      `Piece ${index} failed hash check. Contributors: ${Array.from(contributors).join(', ')}`,
    )

    // TODO: Increment suspicion count for these peers
    // TODO: Ban peers with too many failed pieces

    // Discard the failed piece data
    this.activePieces?.remove(index)
  }

  private async verifyPiece(index: number): Promise<boolean> {
    if (!this.hasMetadata || !this.contentStorage) return false
    const expectedHash = this.getPieceHash(index)
    if (!expectedHash) {
      // If no hashes provided (e.g. Phase 1), assume valid
      return true
    }

    // Read full piece from disk
    const pieceLength = this.getPieceLength(index)
    const data = await this.contentStorage.read(index, 0, pieceLength)

    // Calculate SHA1
    const hash = await this.btEngine.hasher.sha1(data)

    // Compare
    return compare(hash, expectedHash) === 0
  }
  async stop() {
    this.logger.info('Stopping')

    // Stop periodic maintenance
    this.stopMaintenance()

    // Cancel any pending connection attempts
    this._connectionManager.destroy()

    // Cleanup active pieces manager
    this.activePieces?.destroy()

    if (this.trackerManager) {
      await this.trackerManager.announce('stopped')
      this.trackerManager.destroy()
    }
    // Close all connected peers (swarm will be updated via markDisconnected)
    this.connectedPeers.forEach((peer) => peer.close())

    // Clear swarm state
    this._swarm.clear()

    if (this.contentStorage) {
      await this.contentStorage.close()
    }
    this.emit('stopped')
  }

  async recheckData() {
    this.logger.info(`Rechecking data for ${this.infoHashStr}`)
    // TODO: Pause peers?

    // We iterate through all pieces and verify them.
    // We don't clear the bitfield upfront because we want to keep what we have if it's valid.
    // But if we find an invalid piece that was marked valid, we must reset it.

    if (!this.hasMetadata) return

    for (let i = 0; i < this.piecesCount; i++) {
      try {
        const isValid = await this.verifyPiece(i)
        if (isValid) {
          if (!this.hasPiece(i)) {
            this.logger.debug(`Piece ${i} found valid during recheck`)
            this.markPieceVerified(i)
          }
        } else {
          if (this.hasPiece(i)) {
            this.logger.warn(`Piece ${i} found invalid during recheck`)
            this._bitfield?.set(i, false)
          }
        }
      } catch (err) {
        // Read error or other issue
        if (this.hasPiece(i)) {
          this.logger.error(`Piece ${i} error during recheck:`, { err })
          this._bitfield?.set(i, false)
        }
      }

      // Emit progress?
      if (i % 10 === 0) {
        // console.error(`Torrent: Recheck progress ${i}/${this.piecesCount}`)
      }
    }

    // Trigger save of resume data
    if (this.bitfield) {
      this.emit('verified', { bitfield: this.bitfield.toHex() })
    }
    this.emit('checked')
    this.logger.info(`Recheck complete for ${this.infoHashStr}`)
    this.checkCompletion()
  }

  private checkCompletion() {
    if (this.isDownloadComplete) {
      this.logger.info('Download complete!')
      this.emit('done')
      this.emit('complete')
    }
  }

  public recheckPeers() {
    this.logger.debug('Rechecking all peers')
    for (const peer of this.connectedPeers) {
      this.updateInterest(peer)
    }
  }

  // Metadata Logic

  private handleMetadataRequest(peer: PeerConnection, piece: number) {
    if (!this.metadataRaw) {
      peer.sendMetadataReject(piece)
      return
    }

    const METADATA_BLOCK_SIZE = 16 * 1024
    const start = piece * METADATA_BLOCK_SIZE
    if (start >= this.metadataRaw.length) {
      peer.sendMetadataReject(piece)
      return
    }

    const end = Math.min(start + METADATA_BLOCK_SIZE, this.metadataRaw.length)
    const data = this.metadataRaw.slice(start, end)
    peer.sendMetadataData(piece, this.metadataRaw.length, data)
  }

  private async handleMetadataData(
    peer: PeerConnection,
    piece: number,
    totalSize: number,
    data: Uint8Array,
  ) {
    this.logger.info(
      `Received metadata piece ${piece}, totalSize=${totalSize}, dataLen=${data.length}`,
    )
    if (this.metadataComplete) return

    if (this.metadataSize === null) {
      this.metadataSize = totalSize
      this.metadataBuffer = new Uint8Array(totalSize)
      this.logger.info(`Initialized metadata buffer for ${totalSize} bytes`)
    }

    if (this.metadataSize !== totalSize) {
      this.logger.error('Metadata size mismatch')
      return
    }

    const METADATA_BLOCK_SIZE = 16 * 1024
    const start = piece * METADATA_BLOCK_SIZE

    if (start + data.length > this.metadataSize) {
      this.logger.error('Metadata data overflow')
      return
    }

    if (this.metadataBuffer) {
      this.metadataBuffer.set(data, start)
      this.metadataPiecesReceived.add(piece)

      // Check if complete
      const totalPieces = Math.ceil(this.metadataSize / METADATA_BLOCK_SIZE)
      if (this.metadataPiecesReceived.size === totalPieces) {
        await this.verifyMetadata()
      } else {
        // Request next piece
        const nextPiece = piece + 1
        if (nextPiece < totalPieces && !this.metadataPiecesReceived.has(nextPiece)) {
          peer.sendMetadataRequest(nextPiece)
        }
      }
    }
  }

  private async verifyMetadata() {
    if (!this.metadataBuffer) return

    // SHA1 hash of metadataBuffer should match infoHash
    const hash = await this.btEngine.hasher.sha1(this.metadataBuffer)
    if (compare(hash, this.infoHash) === 0) {
      this.logger.info('Metadata verified successfully!')
      this.metadataComplete = true
      this._metadataRaw = this.metadataBuffer
      this.emit('metadata', this.metadataBuffer)

      // Initialize PieceManager and Storage if not already
      // We need to parse the info dictionary.
      // Since we don't have the parser imported here (circular dependency?),
      // we emit the event and let the BtEngine handle the parsing and initialization?
      // Or we import TorrentParser here.
      // BtEngine.ts handles 'torrent' event.
      // Maybe we should emit 'metadata' and let BtEngine do the rest?
      // But Torrent needs PieceManager to function.
      // Let's emit 'metadata' and expect the listener (BtEngine) to call a method to initialize?
      // Or we can import TorrentParser.
    } else {
      this.logger.warn('Metadata hash mismatch')
      this.metadataPiecesReceived.clear()
      this.metadataBuffer = new Uint8Array(this.metadataSize!)
      // Retry?
    }
  }

  // Called by BtEngine when metadata is provided initially (e.g. .torrent file or restored from session)
  public setMetadata(infoBuffer: Uint8Array) {
    this._metadataRaw = infoBuffer
    this._cachedInfoDict = undefined // Clear cache so infoDict getter re-parses
    this.metadataComplete = true
    this.metadataSize = infoBuffer.length
  }

  // === Persistence API ===

  /**
   * Get all persisted state for this torrent.
   * Used by SessionPersistence to save torrent state.
   */
  getPersistedState(): TorrentPersistedState {
    return {
      ...this._persisted,
      // Always sync bitfield → completedPieces
      completedPieces: this._bitfield?.getSetIndices() ?? [],
      // Always sync metadataRaw → infoBuffer
      infoBuffer: this._metadataRaw ?? undefined,
    }
  }

  /**
   * Restore persisted state for this torrent.
   * Used by SessionPersistence to restore torrent state.
   */
  restorePersistedState(state: TorrentPersistedState): void {
    this._persisted = { ...state }

    // Restore bitfield from completedPieces
    if (state.completedPieces.length && this._bitfield) {
      for (const i of state.completedPieces) {
        this._bitfield.set(i, true)
      }
    }

    // Restore metadata
    if (state.infoBuffer) {
      this._metadataRaw = state.infoBuffer
      this._cachedInfoDict = undefined // Clear cache so infoDict getter re-parses
      this.metadataComplete = true
      this.metadataSize = state.infoBuffer.length
    }
  }

  // === Initialization helpers ===

  /**
   * Initialize torrent from a magnet link.
   */
  initFromMagnet(magnetLink: string): void {
    this._persisted.magnetLink = magnetLink
  }

  /**
   * Initialize torrent from a .torrent file.
   */
  initFromTorrentFile(torrentFileBase64: string): void {
    this._persisted.torrentFileBase64 = torrentFileBase64
  }

  /**
   * Manually add a peer and attempt to connect immediately.
   * Useful for debugging.
   *
   * @param address - Peer address in format 'ip:port' (e.g., '127.0.0.1:8998' or '[::1]:8998')
   */
  manuallyAddPeer(address: string): void {
    // Parse address - handle IPv6 with brackets: [ip]:port
    let ip: string
    let port: number

    if (address.startsWith('[')) {
      // IPv6 format: [ip]:port
      const closeBracket = address.indexOf(']')
      if (closeBracket === -1 || address[closeBracket + 1] !== ':') {
        this.logger.error(`Invalid IPv6 address format: ${address} (expected [ip]:port)`)
        return
      }
      ip = address.slice(1, closeBracket)
      port = parseInt(address.slice(closeBracket + 2), 10)
    } else {
      // IPv4 format: ip:port
      const lastColon = address.lastIndexOf(':')
      if (lastColon === -1) {
        this.logger.error(`Invalid address format: ${address} (expected ip:port)`)
        return
      }
      ip = address.slice(0, lastColon)
      port = parseInt(address.slice(lastColon + 1), 10)
    }

    if (isNaN(port) || port < 1 || port > 65535) {
      this.logger.error(`Invalid port in address: ${address}`)
      return
    }

    this.logger.info(`Manually adding peer: ${ip}:${port}`)

    // Add to swarm with 'manual' source
    const family = detectAddressFamily(ip)
    this._swarm.addPeers([{ ip, port, family }], 'manual')

    // Attempt to connect immediately
    this.connectToPeer({ ip, port })
  }

  /**
   * Add peer hints from magnet link (x.pe parameter) to the swarm.
   * These are typically peers that have the torrent and can help with bootstrapping.
   *
   * @param hints - Array of PeerAddress objects (already parsed with family)
   */
  addPeerHints(hints: import('./swarm').PeerAddress[]): void {
    if (hints.length === 0) return

    const added = this._swarm.addPeers(hints, 'magnet_hint')
    if (added > 0) {
      this.logger.info(`Added ${added} magnet peer hints to swarm`)
    }

    // Trigger peer slot filling to connect to hints immediately
    this.fillPeerSlots()
  }
}
