import { PeerConnection } from './peer-connection'
import { ActivePiece, BLOCK_SIZE } from './active-piece'
import { PeerCoordinator, PeerSnapshot, ChokeDecision, DropDecision } from './peer-coordinator'
import { ActivePieceManager } from './active-piece-manager'
import { TorrentContentStorage } from './torrent-content-storage'
import { HashMismatchError } from '../adapters/daemon/daemon-file-handle'
import { BitField } from '../utils/bitfield'
import { MessageType, WireMessage } from '../protocol/wire-protocol'
import { toHex, toString, compare } from '../utils/buffer'
import { InfoHashHex, infoHashFromBytes } from '../utils/infohash'
import { Bencode } from '../utils/bencode'
import { TrackerManager } from '../tracker/tracker-manager'
import { ISocketFactory } from '../interfaces/socket'
import { PeerInfo, TrackerStats } from '../interfaces/tracker'
import { TorrentFileInfo } from './torrent-file-info'
import { EngineComponent } from '../logging/logger'
import type { BtEngine, DaemonOpType, PendingOpCounts } from './bt-engine'
import { TorrentUserState, TorrentActivityState, computeActivityState } from './torrent-state'
import { Swarm, SwarmStats, SwarmPeer, detectAddressFamily, peerKey, PeerAddress } from './swarm'
import { ConnectionManager } from './connection-manager'
import { ConnectionTimingTracker } from './connection-timing'
import { initializeTorrentStorage } from './torrent-initializer'
import { TorrentDiskQueue, DiskQueueSnapshot } from './disk-queue'
import { EndgameManager } from './endgame-manager'

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
 * Unified peer representation for UI display.
 * Can represent either a connected peer (with full PeerConnection) or a connecting peer.
 */
export interface DisplayPeer {
  /** Unique key: "ip:port" or "[ipv6]:port" */
  key: string
  /** Remote IP address */
  ip: string
  /** Remote port */
  port: number
  /** Connection state */
  state: 'connecting' | 'connected'
  /** Full connection (only for connected peers) */
  connection: PeerConnection | null
  /** Swarm peer data (available for both states) */
  swarmPeer: SwarmPeer | null
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

/** Queued upload request for rate limiting */
interface QueuedUploadRequest {
  peer: PeerConnection
  index: number
  begin: number
  length: number
  queuedAt: number
}

export class Torrent extends EngineComponent {
  static logName = 'torrent'

  private btEngine: BtEngine
  private _swarm: Swarm // Single source of truth for peer state
  private _connectionManager: ConnectionManager // Handles outgoing connection lifecycle
  private connectionTiming: ConnectionTimingTracker // Tracks connection timing for adaptive timeouts
  private _peerCoordinator: PeerCoordinator // Coordinates choke/unchoke and peer dropping decisions
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
  private _diskQueue: TorrentDiskQueue = new TorrentDiskQueue()
  private _endgameManager: EndgameManager = new EndgameManager()
  private _bitfield?: BitField
  public announce: string[] = []
  public trackerManager?: TrackerManager
  private _files: TorrentFileInfo[] = []
  public maxPeers: number = 20
  private maxUploadSlots: number = 4

  // Metadata Phase
  public metadataSize: number | null = null
  public metadataBuffer: Uint8Array | null = null
  public metadataComplete = false
  public metadataPiecesReceived = new Set<number>()
  private _metadataRaw: Uint8Array | null = null // The full info dictionary buffer

  // Upload queue for rate limiting
  private uploadQueue: QueuedUploadRequest[] = []
  private uploadDrainScheduled = false

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

  /**
   * Peer hints from magnet link (x.pe parameter).
   * These are added to the swarm every time the torrent starts.
   */
  public magnetPeerHints: PeerAddress[] = []

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
   * Progress of data checking (0-1).
   */
  private _checkingProgress: number = 0

  /**
   * Current error message if any.
   */
  public errorMessage?: string

  /**
   * Get the disk queue for this torrent.
   * Used by TorrentContentStorage to queue disk operations.
   */
  get diskQueue(): TorrentDiskQueue {
    return this._diskQueue
  }

  /**
   * Get disk queue snapshot for UI display.
   */
  getDiskQueueSnapshot(): DiskQueueSnapshot {
    return this._diskQueue.getSnapshot()
  }

  /**
   * Get tracker stats for UI display.
   */
  getTrackerStats(): TrackerStats[] {
    return this.trackerManager?.getTrackerStats() ?? []
  }

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
    maxUploadSlots: number = 4,
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
    this.maxUploadSlots = maxUploadSlots

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

    // Initialize peer coordinator for BEP 3 choke algorithm
    this._peerCoordinator = new PeerCoordinator(
      { maxUploadSlots: this.maxUploadSlots },
      {}, // Use default download optimizer config
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

    // Add magnet peer hints on every start
    if (this.magnetPeerHints.length > 0) {
      this.logger.info(`Adding ${this.magnetPeerHints.length} peer hints from magnet link`)
      this.addPeerHints(this.magnetPeerHints)
    }

    if (this.trackerManager) {
      this.logger.info('Starting tracker announce')
      await this.trackerManager.announce('started')
    }
  }

  async connectToPeer(peerInfo: PeerInfo) {
    if (this.isKillSwitchEnabled) return

    const key = peerKey(peerInfo.ip, peerInfo.port)

    // Check if already connected or connecting (swarm is source of truth)
    const existingPeer = this._swarm.getPeerByKey(key)
    if (existingPeer?.state === 'connected' || existingPeer?.state === 'connecting') return

    // Ensure peer exists in swarm before marking connecting
    // (connectToPeer may be called for peers not yet discovered via tracker)
    if (!existingPeer) {
      const family = detectAddressFamily(peerInfo.ip)
      this._swarm.addPeer({ ip: peerInfo.ip, port: peerInfo.port, family }, 'manual')
    }

    // Mark connecting in swarm FIRST (prevents race condition)
    this._swarm.markConnecting(key)

    // Check limits AFTER marking (so count is accurate)
    const totalConnections = this.numPeers + this._swarm.connectingCount
    if (totalConnections > this.maxPeers) {
      this.logger.debug(
        `Skipping peer ${peerInfo.ip}, max peers reached (${totalConnections}/${this.maxPeers})`,
      )
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

      // Swarm state will be updated in addPeer() via markConnected()
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
      // Swarm state already tracked via markConnecting, now mark failed
      this._swarm.markConnectFailed(key, 'connection_error')
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

  get infoHashStr(): InfoHashHex {
    return infoHashFromBytes(this.infoHash)
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
   * Get all swarm peers as a stable array (for UI).
   * Returns cached array that only rebuilds when peers are added/removed.
   */
  get swarmPeersArray(): import('./swarm').SwarmPeer[] {
    return this._swarm.getAllPeersArray()
  }

  /**
   * Get connection timing statistics for debugging/UI.
   */
  getConnectionTimingStats(): import('./connection-timing').ConnectionTimingStats {
    return this.connectionTiming.getStats()
  }

  /**
   * Get peer coordinator state for debugging/UI.
   */
  getPeerCoordinatorState(): {
    protectedPeers: string[]
    optimisticPeer: string | null
    config: ReturnType<PeerCoordinator['getConfig']>
  } {
    const state = this._peerCoordinator.getUnchokeState()
    return {
      protectedPeers: Array.from(state.unchokedPeerIds),
      optimisticPeer: state.optimisticPeerId,
      config: this._peerCoordinator.getConfig(),
    }
  }

  /**
   * Get active pieces being downloaded.
   * Returns raw array for efficient RAF-driven UI updates.
   */
  getActivePieces(): ActivePiece[] {
    return this.activePieces?.activePieces ?? []
  }

  get isComplete(): boolean {
    return this.isDownloadComplete
  }

  /**
   * Whether this torrent is in endgame mode.
   */
  get isEndgame(): boolean {
    return this._endgameManager.isEndgame
  }

  get files(): TorrentFileInfo[] {
    if (this._files.length > 0) return this._files

    if (this.contentStorage && this.hasMetadata) {
      const rawFiles = this.contentStorage.filesList
      this._files = rawFiles.map((f, i) => new TorrentFileInfo(f, this, i))
      return this._files
    }
    return []
  }

  get progress(): number {
    if (this.piecesCount === 0) return 0
    return this.completedPiecesCount / this.piecesCount
  }

  /**
   * Progress of data checking operation (0-1).
   * Only meaningful when activityState is 'checking'.
   */
  get checkingProgress(): number {
    return this._checkingProgress
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
   * Returns true if network activity should be blocked.
   * Check this at the top of network-related functions.
   */
  get isKillSwitchEnabled(): boolean {
    return (
      this.userState === 'stopped' ||
      this.userState === 'queued' ||
      !!this.errorMessage ||
      (this.engine as BtEngine).isSuspended
    )
  }

  /**
   * Whether this torrent is actively networking.
   * Used by BtEngine connection queue to check if slots should be granted.
   */
  get isActive(): boolean {
    return this._networkActive && !this.isKillSwitchEnabled
  }

  /**
   * Whether this torrent has metadata (piece info, files, etc).
   */
  get hasMetadata(): boolean {
    return this.piecesCount > 0
  }

  /**
   * Connect to one peer from the swarm.
   * Called by BtEngine when granting a connection slot.
   * @returns true if a connection was initiated, false if no candidates available
   */
  connectOnePeer(): boolean {
    // Don't initiate outgoing connections when seeding - accept incoming only
    if (this.isDownloadComplete) return false
    if (!this._networkActive) return false
    if (this.isKillSwitchEnabled) return false

    // Check we still have room
    const connected = this.numPeers
    const connecting = this._swarm.connectingCount
    if (connected + connecting >= this.maxPeers) return false

    // Get best candidate right now
    const candidates = this._swarm.getConnectablePeers(1)
    if (candidates.length === 0) return false

    const peer = candidates[0]
    this.connectToPeer({ ip: peer.ip, port: peer.port })
    return true
  }

  /**
   * Use a granted daemon operation slot.
   * Called by BtEngine when granting a slot.
   * Executes the highest priority pending operation.
   *
   * Priority order:
   * 1. tcp_connect - peer connections for download speed
   * 2. udp_announce / http_announce - peer discovery
   * 3. utp_connect - future
   *
   * @param pending - Current pending counts (for reference)
   * @returns The operation type that was executed, or null if nothing pending
   */
  useDaemonSlot(pending: PendingOpCounts): DaemonOpType | null {
    if (!this._networkActive) return null

    // Priority 1: TCP peer connections
    if (pending.tcp_connect > 0) {
      if (this.connectOnePeer()) {
        return 'tcp_connect'
      }
    }

    // Priority 2: Tracker announces (UDP and HTTP)
    if (pending.udp_announce > 0 || pending.http_announce > 0) {
      const announcedType = this.trackerManager?.announceOne()
      if (announcedType) {
        return announcedType // 'udp_announce' or 'http_announce'
      }
    }

    // Priority 3: uTP connections (future)
    if (pending.utp_connect > 0) {
      // TODO: implement when uTP is added
      // if (this.connectOneUtpPeer()) return 'utp_connect'
    }

    return null
  }

  /**
   * Try to initialize storage for this torrent.
   * Used for recovery when storage becomes available after initial failure.
   * @throws MissingStorageRootError if storage is still unavailable
   */
  async tryInitializeStorage(): Promise<void> {
    if (this.contentStorage) {
      return // Already initialized
    }
    if (!this.hasMetadata || !this.metadataRaw) {
      throw new Error('Cannot initialize storage without metadata')
    }
    await initializeTorrentStorage(this.engine as BtEngine, this, this.metadataRaw)
  }

  /**
   * User action: Start the torrent.
   * Changes userState to 'active' and starts networking if engine allows.
   * If storage was missing, attempts to initialize it first.
   */
  async userStart(): Promise<void> {
    this.logger.info('User starting torrent')

    // If storage is missing but we have metadata, try to initialize storage
    if (!this.contentStorage && this.hasMetadata) {
      try {
        await this.tryInitializeStorage()
      } catch (e) {
        // Use name check instead of instanceof (instanceof fails across module boundaries)
        if (e instanceof Error && e.name === 'MissingStorageRootError') {
          this.errorMessage = `Download location unavailable. Storage root not found.`
          this.logger.warn('Cannot start - storage still unavailable')
          return // Stay in error state, don't change userState
        }
        throw e
      }
    }

    this.userState = 'active'
    this.errorMessage = undefined

    if (!(this.engine as BtEngine).isSuspended) {
      this.resumeNetwork()
    }

    // Persist state change (userState + bitfield)
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)
  }

  /**
   * User action: Stop the torrent.
   * Changes userState to 'stopped' and stops all networking.
   */
  userStop(): void {
    this.logger.info('User stopping torrent')
    this.userState = 'stopped'

    // Cancel pending connection requests
    this.btEngine.cancelConnectionRequests(this.infoHashStr)

    this.suspendNetwork()

    // Persist state change (userState + bitfield)
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)
  }

  /**
   * Internal: Suspend network activity.
   * Called by engine.suspend() or userStop().
   */
  suspendNetwork(): void {
    const wasActive = this._networkActive

    // Cancel pending connection requests from the global queue
    this.btEngine.cancelConnectionRequests(this.infoHashStr)

    // Cancel in-flight connection attempts (clears timers, marks peers as failed in swarm)
    this._connectionManager.cancelAllPendingConnections()

    // Mark ALL connecting peers as failed (handles peers from both ConnectionManager and connectToPeer)
    // Copy keys first since markConnectFailed modifies connectingKeys
    const connectingKeys = [...this._swarm.getConnectingKeys()]
    for (const key of connectingKeys) {
      this._swarm.markConnectFailed(key, 'stopped')
    }

    // Always close peers, even if already suspended (handles race conditions)
    for (const peer of this.connectedPeers) {
      peer.close()
    }

    if (!wasActive) return

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

    // Clear active pieces - release buffered data and pending requests
    this.activePieces?.destroy()
    this.activePieces = undefined

    // Reset endgame state
    this._endgameManager.reset()
  }

  /**
   * Internal: Resume network activity.
   * Called by engine.resume() (for active torrents) or userStart().
   */
  resumeNetwork(): void {
    if (this._networkActive) return
    if (this.isKillSwitchEnabled) return

    this.logger.debug('Resuming network')
    this._networkActive = true

    // Reset backoff state so we immediately try reconnecting to known peers
    this._swarm.resetBackoffState()

    // Add magnet peer hints on every resume
    if (this.magnetPeerHints.length > 0) {
      this.logger.info(`Adding ${this.magnetPeerHints.length} peer hints from magnet link`)
      this.addPeerHints(this.magnetPeerHints)
    }

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
   * Swarm is single source of truth for connection state.
   */
  private checkSwarmInvariants(): void {
    const swarmStats = this._swarm.getStats()

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
   * Run maintenance: peer coordination and slot filling.
   */
  private runMaintenance(): void {
    // Always check invariants regardless of state
    this.checkSwarmInvariants()

    if (!this._networkActive) return
    if (this.isKillSwitchEnabled) return

    // === Run peer coordinator (BEP 3 choke algorithm + download optimizer) ===
    const snapshots = this.buildPeerSnapshots()
    const hasSwarmCandidates = this._swarm.getConnectablePeers(1).length > 0

    const { unchoke, drop } = this._peerCoordinator.evaluate(snapshots, hasSwarmCandidates)

    // Apply unchoke decisions
    for (const decision of unchoke) {
      this.applyUnchokeDecision(decision)
    }

    // Apply drop decisions
    for (const decision of drop) {
      this.applyDropDecision(decision)
    }

    // === Request connection slots from engine ===
    if (this.isComplete) return // Don't seek peers when complete

    const connected = this.numPeers
    const connecting = this._swarm.connectingCount
    const slotsAvailable = this.maxPeers - connected - connecting

    if (slotsAvailable <= 0) return

    // Check if we have candidates before requesting slots
    const candidateCount = this._swarm.getConnectablePeers(slotsAvailable).length
    if (candidateCount === 0) return

    // Request slots from engine (will be granted fairly via round-robin)
    const slotsToRequest = Math.min(slotsAvailable, candidateCount)
    this.btEngine.requestConnections(this.infoHashStr, slotsToRequest)

    this.logger.debug(
      `Maintenance: ${connected} connected, ${connecting} connecting, ` +
        `requested ${slotsToRequest} slots (${candidateCount} candidates available)`,
    )
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

  /**
   * Get all peers for UI display, including those currently connecting.
   * Returns unified DisplayPeer objects that work for both states.
   */
  getDisplayPeers(): DisplayPeer[] {
    const result: DisplayPeer[] = []

    // Add connected peers
    for (const conn of this._swarm.getConnectedPeers()) {
      const key = peerKey(conn.remoteAddress ?? '', conn.remotePort ?? 0)
      const swarmPeer = this._swarm.getPeerByKey(key) ?? null
      result.push({
        key,
        ip: conn.remoteAddress ?? '',
        port: conn.remotePort ?? 0,
        state: 'connected',
        connection: conn,
        swarmPeer,
      })
    }

    // Add connecting peers
    for (const key of this._swarm.getConnectingKeys()) {
      const swarmPeer = this._swarm.getPeerByKey(key)
      if (swarmPeer) {
        result.push({
          key,
          ip: swarmPeer.ip,
          port: swarmPeer.port,
          state: 'connecting',
          connection: null,
          swarmPeer,
        })
      }
    }

    return result
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

  setMaxUploadSlots(max: number) {
    this.maxUploadSlots = max
    this._peerCoordinator.updateUnchokeConfig({ maxUploadSlots: max })
  }

  addPeer(peer: PeerConnection) {
    // Reject peers when kill switch is enabled (stopped, queued, error, or engine suspended)
    if (this.isKillSwitchEnabled) {
      this.logger.debug('Rejecting peer - kill switch enabled')
      peer.close()
      return
    }

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

    // Check total connections including connecting (accounts for incoming during outgoing attempts)
    // If peer is already in connecting state (outgoing connection), it's already counted
    // so we use > instead of >= to avoid double-counting
    const key =
      peer.remoteAddress && peer.remotePort ? peerKey(peer.remoteAddress, peer.remotePort) : null
    const existingSwarmPeer = key ? this._swarm.getPeerByKey(key) : null
    const peerAlreadyCounted = existingSwarmPeer?.state === 'connecting'
    const total = this.numPeers + this._swarm.connectingCount
    const effectiveTotal = peerAlreadyCounted ? total : total + 1

    if (effectiveTotal > this.maxPeers) {
      this.logger.warn(`Rejecting peer, max reached (${effectiveTotal}/${this.maxPeers})`)
      peer.close()
      // Clear swarm connecting state if this was an outgoing connection we initiated
      if (key) {
        this._swarm.markConnectFailed(key, 'max_peers_reached')
      }
      return
    }
    // Note: global limit for incoming is handled by BtEngine via connection queue

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

      // Check for self-connection (our own peerId)
      if (compare(peerId, this.peerId) === 0) {
        this.logger.warn('Self-connection detected, closing peer')
        peer.close()
        return
      }

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

    peer.on('extension_handshake', (payload) => {
      // Extract clientName from BEP 10 "v" field
      const clientName = typeof payload.v === 'string' ? payload.v : null

      // Update swarm with clientName
      if (peer.remoteAddress && peer.remotePort && peer.peerId) {
        const key = peerKey(peer.remoteAddress, peer.remotePort)
        this._swarm.setIdentity(key, peer.peerId, clientName)
      }

      this.logger.info(
        `Extension handshake received. metadataComplete=${this.metadataComplete}, peerMetadataId=${peer.peerMetadataId}`,
      )

      // Check if we need metadata and peer has it
      if (!this.metadataComplete && peer.peerMetadataId !== null) {
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

    peer.on('choke', () => {
      this.logger.debug('Choke received')
      // Peer has discarded all our pending requests per BitTorrent spec
      const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
      const cleared = this.activePieces?.clearRequestsForPeer(peerId) || 0
      peer.requestsPending = 0 // Critical: reset so we can request again after unchoke
      // Reduce pipeline depth - choke is a congestion signal
      peer.reduceDepth()
      if (cleared > 0) {
        this.logger.debug(`Cleared ${cleared} tracked requests after choke`)
      }
    })

    peer.on('interested', () => {
      this.logger.debug('Interested received')
      this.handleInterested(peer)
    })

    peer.on('not_interested', () => {
      this.logger.debug('Not interested received')
      // Peer no longer wants data - choke algorithm will handle slot reallocation
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
      // Peer left - choke algorithm will handle slot reallocation
    })

    peer.on('bytesDownloaded', (bytes) => {
      this.totalDownloaded += bytes
      this.emit('download', bytes)
      ;(this.engine as BtEngine).bandwidthTracker.recordDownload(bytes)
    })

    peer.on('bytesUploaded', (bytes) => {
      this.totalUploaded += bytes
      this.emit('upload', bytes)
      ;(this.engine as BtEngine).bandwidthTracker.recordUpload(bytes)
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
    // Clear any queued uploads for this peer
    const queueLengthBefore = this.uploadQueue.length
    this.uploadQueue = this.uploadQueue.filter((req) => req.peer !== peer)
    const removedUploads = queueLengthBefore - this.uploadQueue.length
    if (removedUploads > 0) {
      this.logger.debug(`Cleared ${removedUploads} queued uploads for disconnected peer`)
    }

    // Update swarm state - swarm is single source of truth (Phase 3)
    if (peer.remoteAddress && peer.remotePort) {
      const key = peerKey(peer.remoteAddress, peer.remotePort)
      this._swarm.markDisconnected(key)
      // Notify peer coordinator of disconnect
      this._peerCoordinator.peerDisconnected(key)
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

  private handleRequest(peer: PeerConnection, index: number, begin: number, length: number): void {
    // Validate: we must not be choking this peer
    if (peer.amChoking) {
      this.logger.debug('Ignoring request from choked peer')
      return
    }

    // Validate: we have this piece
    if (!this.bitfield || !this.bitfield.get(index)) {
      this.logger.debug(`Ignoring request for piece ${index} we don't have`)
      return
    }

    if (!this.contentStorage) {
      this.logger.debug('Ignoring request: no content storage')
      return
    }

    // Queue the request
    this.uploadQueue.push({
      peer,
      index,
      begin,
      length,
      queuedAt: Date.now(),
    })

    // Trigger drain
    this.drainUploadQueue()
  }

  private async drainUploadQueue(): Promise<void> {
    // Prevent concurrent drain loops
    if (this.uploadDrainScheduled) return

    while (this.uploadQueue.length > 0) {
      const req = this.uploadQueue[0]

      // Skip if peer disconnected
      if (!this.connectedPeers.includes(req.peer)) {
        this.uploadQueue.shift()
        continue
      }

      // Skip if we've since choked this peer
      if (req.peer.amChoking) {
        this.uploadQueue.shift()
        this.logger.debug('Discarding queued request: peer now choked')
        continue
      }

      // Rate limit check
      const uploadBucket = this.btEngine.bandwidthTracker.uploadBucket
      if (uploadBucket.isLimited && !uploadBucket.tryConsume(req.length)) {
        // Schedule retry when tokens available
        const delayMs = uploadBucket.msUntilAvailable(req.length)
        this.uploadDrainScheduled = true
        setTimeout(
          () => {
            this.uploadDrainScheduled = false
            this.drainUploadQueue()
          },
          Math.max(delayMs, 10),
        ) // minimum 10ms to avoid tight loop
        return
      }

      // Dequeue and process
      this.uploadQueue.shift()

      try {
        const block = await this.contentStorage!.read(req.index, req.begin, req.length)

        // Final check: peer still connected and unchoked
        if (!this.connectedPeers.includes(req.peer)) {
          this.logger.debug('Peer disconnected before upload could complete')
          continue
        }
        if (req.peer.amChoking) {
          this.logger.debug('Peer choked before upload could complete')
          continue
        }

        req.peer.sendPiece(req.index, req.begin, block)
      } catch (err) {
        this.logger.error(
          `Error handling queued request: ${err instanceof Error ? err.message : String(err)}`,
          { err },
        )
      }
    }
  }

  /**
   * Build peer snapshots for the coordinator algorithms.
   */
  private buildPeerSnapshots(): PeerSnapshot[] {
    const now = Date.now()
    return this.peers.map((peer) => ({
      id: peerKey(peer.remoteAddress!, peer.remotePort!),
      peerInterested: peer.peerInterested,
      peerChoking: peer.peerChoking,
      amChoking: peer.amChoking,
      downloadRate: peer.downloadSpeed,
      connectedAt: peer.connectedAt,
      lastDataReceived: peer.downloadSpeedCalculator.lastActivity || now,
    }))
  }

  /**
   * Apply an unchoke decision to a peer.
   */
  private applyUnchokeDecision(decision: ChokeDecision): void {
    const peer = this.peers.find(
      (p) => peerKey(p.remoteAddress!, p.remotePort!) === decision.peerId,
    )
    if (!peer) return

    if (decision.action === 'unchoke') {
      if (peer.amChoking) {
        peer.amChoking = false
        peer.sendMessage(MessageType.UNCHOKE)
        this.logger.debug(`Unchoked ${decision.peerId} (${decision.reason})`)
      }
    } else {
      this.chokePeer(peer)
      this.logger.debug(`Choked ${decision.peerId} (${decision.reason})`)
    }
  }

  /**
   * Apply a drop decision to a peer.
   */
  private applyDropDecision(decision: DropDecision): void {
    const peer = this.peers.find(
      (p) => peerKey(p.remoteAddress!, p.remotePort!) === decision.peerId,
    )
    if (!peer) return

    this.logger.info(`Dropping slow peer ${decision.peerId}: ${decision.reason}`)
    peer.close()
  }

  /**
   * Choke a peer and clear their upload queue.
   */
  private chokePeer(peer: PeerConnection): void {
    if (peer.amChoking) return

    peer.amChoking = true
    peer.sendMessage(MessageType.CHOKE)

    // Clear queued uploads for this peer
    const before = this.uploadQueue.length
    this.uploadQueue = this.uploadQueue.filter((req) => req.peer !== peer)
    const removed = before - this.uploadQueue.length
    if (removed > 0) {
      this.logger.debug(`Cleared ${removed} queued uploads for choked peer`)
    }
  }

  private handleInterested(peer: PeerConnection) {
    peer.peerInterested = true
    // Don't unchoke immediately - let the choke algorithm decide on next tick
    // This prevents fibrillation (rapid choke/unchoke cycling)
    this.logger.debug(`Peer ${peer.remoteAddress} is interested (will evaluate on next tick)`)
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
    if (this.isKillSwitchEnabled) return

    if (peer.peerChoking) {
      // console.error(`requestPieces: Peer is choking us`)
      return
    }

    if (!this.hasMetadata) {
      return
    }

    // Initialize activePieces if needed (lazy init after metadata is available)
    if (!this.activePieces) {
      this.activePieces = new ActivePieceManager(this.engineInstance, (index) =>
        this.getPieceLength(index),
      )
      this.activePieces.on('requestsCleared', (clearedByPeer: Map<string, number>) => {
        // Decrement requestsPending for each affected peer
        for (const p of this.connectedPeers) {
          const pId = p.peerId ? toHex(p.peerId) : `${p.remoteAddress}:${p.remotePort}`
          const cleared = clearedByPeer.get(pId)
          if (cleared) {
            p.requestsPending = Math.max(0, p.requestsPending - cleared)
            this.logger.debug(`Decremented ${cleared} pending requests for peer ${pId}`)
          }
        }
        // Then re-request from all unchoked peers
        for (const p of this.connectedPeers) {
          if (!p.peerChoking) {
            this.requestPieces(p)
          }
        }
      })
    }

    const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
    const missing = this.getMissingPieces()

    // Use per-peer adaptive pipeline depth (starts at 10, ramps up for fast peers)
    const pipelineLimit = peer.pipelineDepth

    let _requestsMade = 0
    let _skippedComplete = 0
    let _skippedCapacity = 0
    let _skippedPeerLacks = 0
    let _skippedNoNeeded = 0

    for (const index of missing) {
      if (peer.requestsPending >= pipelineLimit) {
        //this.logger.debug(`requestPieces: Hit pipeline limit`)
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
      // In endgame mode, use peer-specific method to allow duplicate requests
      const neededBlocks = this._endgameManager.isEndgame
        ? piece.getNeededBlocksEndgame(peerId, pipelineLimit - peer.requestsPending)
        : piece.getNeededBlocks(pipelineLimit - peer.requestsPending)

      if (neededBlocks.length === 0) {
        _skippedNoNeeded++
        continue
      }

      for (const block of neededBlocks) {
        if (peer.requestsPending >= pipelineLimit) break

        // Rate limit check - bail if out of tokens
        const downloadBucket = this.btEngine.bandwidthTracker.downloadBucket
        if (downloadBucket.isLimited && !downloadBucket.tryConsume(block.length)) {
          break // Out of budget for this round, will retry on next trigger
        }

        peer.sendRequest(index, block.begin, block.length)
        peer.requestsPending++
        _requestsMade++

        // Track request in ActivePiece (tied to this peer)
        const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
        piece.addRequest(blockIndex, peerId)
      }
    }

    // Check if we should enter/exit endgame mode
    if (this.activePieces) {
      const decision = this._endgameManager.evaluate(
        missing.length,
        this.activePieces.activeCount,
        this.activePieces.hasUnrequestedBlocks(),
      )
      if (decision) {
        this.logger.info(`Endgame: ${decision.type}`)
      }
    }
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

    // Track block receipt for adaptive pipeline depth adjustment
    peer.recordBlockReceived()

    // Initialize activePieces if needed (lazy init after metadata is available)
    if (!this.activePieces && this.hasMetadata) {
      this.activePieces = new ActivePieceManager(this.engineInstance, (index) =>
        this.getPieceLength(index),
      )
      this.activePieces.on('requestsCleared', (clearedByPeer: Map<string, number>) => {
        // Decrement requestsPending for each affected peer
        for (const p of this.connectedPeers) {
          const pId = p.peerId ? toHex(p.peerId) : `${p.remoteAddress}:${p.remotePort}`
          const cleared = clearedByPeer.get(pId)
          if (cleared) {
            p.requestsPending = Math.max(0, p.requestsPending - cleared)
            this.logger.debug(`Decremented ${cleared} pending requests for peer ${pId}`)
          }
        }
        // Then re-request from all unchoked peers
        for (const p of this.connectedPeers) {
          if (!p.peerChoking) {
            this.requestPieces(p)
          }
        }
      })
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

    // In endgame mode, send CANCEL to other peers that requested this block
    if (isNew && this._endgameManager.isEndgame) {
      const cancels = this._endgameManager.getCancels(piece, blockIndex, peerId)
      for (const cancel of cancels) {
        // Find peer by ID and send cancel
        for (const p of this.connectedPeers) {
          const pId = p.peerId ? toHex(p.peerId) : `${p.remoteAddress}:${p.remotePort}`
          if (pId === cancel.peerId) {
            p.sendCancel(cancel.index, cancel.begin, cancel.length)
            this.logger.debug(`Endgame: sent CANCEL to ${pId} for ${cancel.index}:${cancel.begin}`)
            break
          }
        }
      }
    }

    // Refill request pipeline immediately (before any async I/O)
    // This prevents sawtooth download patterns on fast peers
    this.requestPieces(peer)

    // Then finalize if piece is complete
    if (piece.haveAllBlocks) {
      await this.finalizePiece(msg.index, piece)
    }
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

        // ANY write failure is fatal - fail fast
        const errorMsg = e instanceof Error ? e.message : String(e)
        this.logger.error(`Fatal write error - stopping torrent:`, errorMsg)
        this.errorMessage = `Write failed: ${errorMsg}`
        this.suspendNetwork()
        this.activePieces?.remove(index)
        ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)
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

    // Update cached downloaded bytes on file objects
    for (const file of this._files) {
      file.updateForPiece(index)
    }

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

    // Persist state immediately
    const btEngine = this.engine as BtEngine
    btEngine.sessionPersistence?.saveTorrentState(this)

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
      try {
        await this.trackerManager.announce('stopped')
      } catch (err) {
        // Announce may fail if IO is disconnected during shutdown - that's ok
        this.logger.warn(`Failed to announce stopped: ${err instanceof Error ? err.message : err}`)
      }
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
    // Prevent re-entry if already checking
    if (this._isChecking) {
      this.logger.warn('Recheck already in progress, ignoring')
      return
    }

    this.logger.info(`Rechecking data for ${this.infoHashStr}`)

    if (!this.hasMetadata) return

    // Suspend networking during check (non-destructive, unlike stop())
    const wasNetworkActive = this._networkActive
    if (wasNetworkActive) {
      this.suspendNetwork()
    }

    // Set checking state
    this._isChecking = true
    this._checkingProgress = 0

    // Reset bitfield to 0% (create fresh bitfield)
    this._bitfield = new BitField(this.piecesCount)

    try {
      for (let i = 0; i < this.piecesCount; i++) {
        try {
          const isValid = await this.verifyPiece(i)
          if (isValid) {
            this.markPieceVerified(i)
          }
        } catch (err) {
          // Read error - piece remains unchecked
          this.logger.debug(`Piece ${i} read error during recheck:`, { err })
        }

        // Update progress
        this._checkingProgress = (i + 1) / this.piecesCount
      }
    } finally {
      // Always clear checking state
      this._isChecking = false
      this._checkingProgress = 0
    }

    // Trigger save of resume data
    if (this.bitfield) {
      this.emit('verified', { bitfield: this.bitfield.toHex() })
    }
    this.emit('checked')
    this.logger.info(`Recheck complete for ${this.infoHashStr}`)
    // Note: Don't call checkCompletion() here - recheck shouldn't trigger
    // "download complete" notifications, it's just verifying existing data

    // Resume networking if it was active before recheck
    if (wasNetworkActive) {
      this.resumeNetwork()
    }
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
  addPeerHints(hints: PeerAddress[]): void {
    if (hints.length === 0) return

    const added = this._swarm.addPeers(hints, 'magnet_hint')
    if (added > 0) {
      this.logger.info(`Added ${added} magnet peer hints to swarm`)
    }

    // Trigger peer slot filling to connect to hints immediately
    this.fillPeerSlots()
  }
}
