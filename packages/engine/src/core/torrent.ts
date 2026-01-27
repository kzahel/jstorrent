import { PeerConnection } from './peer-connection'
import { ActivePiece, BLOCK_SIZE } from './active-piece'
import { PeerCoordinator, PeerSnapshot, ChokeDecision, DropDecision } from './peer-coordinator'
import { ActivePieceManager } from './active-piece-manager'
import { TorrentContentStorage } from './torrent-content-storage'
// HashMismatchError is checked by name (not instanceof) to support both
// daemon-file-handle and native-file-handle error classes
import { BitField } from '../utils/bitfield'
import { MessageType, WireMessage } from '../protocol/wire-protocol'
import { toHex, toString, compare } from '../utils/buffer'
import { InfoHashHex, infoHashFromBytes } from '../utils/infohash'
import { Bencode } from '../utils/bencode'
import { TrackerManager } from '../tracker/tracker-manager'
import { ISocketFactory } from '../interfaces/socket'
import { AnnounceStats, PeerInfo, TrackerStats } from '../interfaces/tracker'
import { TorrentFileInfo } from './torrent-file-info'
import { EngineComponent } from '../logging/logger'
import type { BtEngine, DaemonOpType, PendingOpCounts } from './bt-engine'
import { TorrentUserState, TorrentActivityState, computeActivityState } from './torrent-state'
import {
  Swarm,
  SwarmStats,
  SwarmPeer,
  detectAddressFamily,
  peerKey,
  addressKey,
  PeerAddress,
} from './swarm'
import { ConnectionManager } from './connection-manager'
import type { EncryptionPolicy } from '../crypto'
import { randomBytes } from '../utils/hash'
import { ConnectionTimingTracker } from './connection-timing'
import { initializeTorrentStorage } from './torrent-initializer'
import { TorrentDiskQueue, DiskQueueSnapshot } from './disk-queue'
import { EndgameManager } from './endgame-manager'
import { PartsFile } from './parts-file'
import type { LookupResult } from '../dht'
import { PexHandler } from '../extensions/pex-handler'
import { CorruptionTracker, BanDecision } from './corruption-tracker'

/**
 * Maximum ratio of peer slots that incoming connections can occupy.
 * This prevents incoming connections from filling all slots, ensuring
 * we always have capacity to initiate outgoing connections to better peers.
 */
export const MAX_INCOMING_RATIO = 0.6

// === Phase 5: Piece Health Management Constants ===

/**
 * Timeout for individual block requests.
 * Requests older than this are cancelled and the blocks become available
 * for reassignment to other peers.
 *
 * libtorrent reference: peer_connection.cpp:4565-4588
 */
export const BLOCK_REQUEST_TIMEOUT_MS = 10_000 // 10 seconds

/**
 * Timeout for piece abandonment.
 * Pieces older than this with less than PIECE_ABANDON_MIN_PROGRESS
 * are abandoned and removed from the active set.
 */
export const PIECE_ABANDON_TIMEOUT_MS = 30_000 // 30 seconds

/**
 * Minimum progress ratio (0-1) to keep a stuck piece.
 * Pieces with >= 50% completion are worth keeping even if stuck.
 */
export const PIECE_ABANDON_MIN_PROGRESS = 0.5 // 50%

/**
 * How often to run piece health cleanup (every N ticks).
 * With 100ms tick interval, 5 = every 500ms.
 */
export const CLEANUP_TICK_INTERVAL = 5

/**
 * Piece classification for file priority system.
 * - 'wanted': All files touched by this piece are non-skipped
 * - 'boundary': Piece touches both skipped and non-skipped files
 * - 'blacklisted': All files touched by this piece are skipped
 */
export type PieceClassification = 'wanted' | 'boundary' | 'blacklisted'

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

  // === File Priorities ===
  filePriorities?: number[] // Per-file priority: 0=normal, 1=skip
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
  private _corruptionTracker: CorruptionTracker = new CorruptionTracker()
  private _connectionManager: ConnectionManager // Handles outgoing connection lifecycle
  private connectionTiming: ConnectionTimingTracker // Tracks connection timing for adaptive timeouts
  private _peerCoordinator: PeerCoordinator // Coordinates choke/unchoke and peer dropping decisions
  declare public infoHash: Uint8Array
  declare public peerId: Uint8Array
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
  /** Optimization: track the first piece index we still need (for sequential mode) */
  private _firstNeededPiece: number = 0
  public announce: string[] = []
  public trackerManager?: TrackerManager
  private _files: TorrentFileInfo[] = []
  public maxPeers: number = 20

  // === File Priority System ===
  /** Per-file priorities: 0 = normal, 1 = skip */
  private _filePriorities: number[] = []
  /** Cached piece classification (recomputed on file priority changes) */
  private _pieceClassification: PieceClassification[] = []
  /** Per-piece availability count (how many connected peers have each piece) */
  private _pieceAvailability: Uint16Array | null = null
  /**
   * Number of connected seed peers.
   * Seeds are tracked separately to avoid O(pieces) updates on connect/disconnect.
   * For availability calculations, use: pieceAvailability[i] + seedCount
   */
  private _seedCount: number = 0
  /** Per-piece priority derived from file priorities (0=skip, 1=normal, 2=high) */
  private _piecePriority: Uint8Array | null = null
  /** Pieces currently stored in .parts file (not in regular files) */
  private _partsFilePieces: Set<number> = new Set()
  /** .parts file manager for boundary pieces */
  private _partsFile?: PartsFile
  private maxUploadSlots: number = 4

  // Metadata Phase
  private static readonly METADATA_BLOCK_SIZE = 16 * 1024
  public metadataSize: number | null = null
  public metadataComplete = false
  /** Per-peer metadata buffers. Each peer gets their own array of pieces. */
  private peerMetadataBuffers = new Map<PeerConnection, (Uint8Array | null)[]>()
  private _metadataRaw: Uint8Array | null = null // The full info dictionary buffer

  // Upload queue for rate limiting
  private uploadQueue: QueuedUploadRequest[] = []
  private uploadDrainScheduled = false

  // Download rate limit retry scheduling
  private downloadRateLimitRetryScheduled = false

  // Round-robin index for fair peer request scheduling
  private _peerRequestRoundRobin = 0

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
   * Uses setTimeout for adaptive intervals (not setInterval).
   */
  private _maintenanceInterval: ReturnType<typeof setTimeout> | null = null

  /** Tracks which interval step we're on for adaptive maintenance */
  private _maintenanceStep: number = 0

  /** Adaptive maintenance intervals: run frequently at first, then back off */
  private static readonly MAINTENANCE_INTERVALS = [500, 1000, 1000, 2000, 2000, 5000]

  /** DHT lookup timer - periodically queries DHT for peers */
  private _dhtLookupTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Request tick interval for game-loop style piece requesting.
   * Replaces edge-triggered scheduling for better QuickJS performance.
   */
  private _requestTickInterval: ReturnType<typeof setInterval> | null = null

  /** Request tick interval in ms (runtime configurable, default 100ms) */
  public requestTickIntervalMs: number = 100

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
    encryptionPolicy: EncryptionPolicy = 'disabled',
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
        encryptionPolicy, // MSE/PE encryption policy
      },
    )

    // Set MSE encryption context for the connection manager
    this._connectionManager.setEncryptionContext({
      infoHash: this.infoHash,
      sha1: (data: Uint8Array) => this.btEngine.hasher.sha1(data),
      getRandomBytes: randomBytes,
    })

    // Register callback for when ConnectionManager establishes a connection
    this._connectionManager.setOnPeerConnected((key, peer) => {
      this.handleNewPeerConnection(key, peer)
    })

    // Initialize peer coordinator for BEP 3 choke algorithm
    this._peerCoordinator = new PeerCoordinator(
      { maxUploadSlots: this.maxUploadSlots },
      {}, // Use default download optimizer config
    )

    if (this.announce.length > 0) {
      this.initTrackerManager()
    }
  }

  /**
   * Start network activity for this torrent.
   * Single source of truth for activating networking (trackers, DHT, maintenance).
   * Idempotent - safe to call multiple times.
   */
  async start() {
    // Idempotent - already active
    if (this._networkActive) return

    if (this.btEngine.isSuspended) {
      this.logger.debug('Engine suspended, not starting')
      return
    }

    if (this.userState !== 'active') {
      this.logger.debug('User state is not active, not starting')
      return
    }

    if (this.isKillSwitchEnabled) {
      this.logger.debug('Kill switch enabled, not starting')
      return
    }

    this.logger.debug('Starting network')
    this._networkActive = true

    // Reset backoff state so we immediately try reconnecting to known peers
    this._swarm.resetBackoffState()

    // Start periodic maintenance (idempotent)
    this.startMaintenance()

    // Start request tick game loop
    this.startRequestTick()

    // Add magnet peer hints on every start
    if (this.magnetPeerHints.length > 0) {
      this.logger.info(`Adding ${this.magnetPeerHints.length} peer hints from magnet link`)
      this.addPeerHints(this.magnetPeerHints)
    }

    // Start tracker announces
    if (this.trackerManager) {
      this.logger.info('Starting tracker announce')
      await this.trackerManager.announce('started')
    } else if (this.announce.length > 0) {
      // Initialize tracker manager if we have announces but no manager yet
      this.initTrackerManager()
    }

    // Start DHT peer discovery (if enabled and not private)
    if (!this.isPrivate) {
      this.startDHTLookup()
    }
  }

  async connectToPeer(peerInfo: PeerInfo) {
    if (this.isKillSwitchEnabled) return

    const key = peerKey(peerInfo.ip, peerInfo.port)

    // Check if already connected or connecting (swarm is source of truth)
    const existingPeer = this._swarm.getPeerByKey(key)
    if (existingPeer?.state === 'connected' || existingPeer?.state === 'connecting') return

    // Ensure peer exists in swarm before initiating connection
    // (connectToPeer may be called for peers not yet discovered via tracker)
    if (!existingPeer) {
      const family = detectAddressFamily(peerInfo.ip)
      this._swarm.addPeer({ ip: peerInfo.ip, port: peerInfo.port, family }, 'manual')
    }

    // Check global connection limit before attempting
    if (this.btEngine.numConnections >= this.btEngine.maxConnections) {
      this.logger.debug(
        `Skipping peer ${peerInfo.ip}, global limit reached (${this.btEngine.numConnections}/${this.btEngine.maxConnections})`,
      )
      return
    }

    // Delegate to ConnectionManager which handles:
    // - Swarm state tracking (markConnecting/markConnected/markFailed)
    // - MSE/PE encryption handshake (if enabled)
    // - PeerConnection creation
    // - Callback to handleNewPeerConnection for BT handshake
    const swarmPeer = this._swarm.getPeerByKey(key)
    if (swarmPeer) {
      await this._connectionManager.initiateConnection(swarmPeer)
    }
  }

  get infoHashStr(): InfoHashHex {
    return infoHashFromBytes(this.infoHash)
  }

  /** Get the storage root for this torrent */
  get storageRoot(): { key: string; label: string; path: string } | null {
    return this.btEngine.storageRootManager.getRootForTorrent(this.infoHashStr)
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
    this._firstNeededPiece = 0
  }

  /**
   * Initialize piece availability tracking.
   * Call after metadata is available (same time as initBitfield).
   */
  initPieceAvailability(pieceCount: number): void {
    this._pieceAvailability = new Uint16Array(pieceCount) // All zeros
  }

  get pieceAvailability(): Uint16Array | null {
    return this._pieceAvailability
  }

  /**
   * Number of connected seed peers.
   * Use this + pieceAvailability[i] for true availability of a piece.
   */
  get seedCount(): number {
    return this._seedCount
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

    // Advance firstNeededPiece if this was it (or earlier)
    if (index <= this._firstNeededPiece && this._bitfield) {
      // Scan forward to find next incomplete piece
      while (
        this._firstNeededPiece < this.piecesCount &&
        this._bitfield.get(this._firstNeededPiece)
      ) {
        this._firstNeededPiece++
      }
    }
  }

  getMissingPieces(): number[] {
    if (!this._bitfield) return []
    const missing: number[] = []
    for (let i = 0; i < this.piecesCount; i++) {
      if (this.shouldRequestPiece(i)) {
        missing.push(i)
      }
    }
    return missing
  }

  // --- Progress ---

  get completedPiecesCount(): number {
    return this._bitfield?.count() ?? 0
  }

  /**
   * Number of pieces we actually want (not blacklisted).
   */
  get wantedPiecesCount(): number {
    if (this._pieceClassification.length === 0) return this.piecesCount
    return this._pieceClassification.filter((c) => c !== 'blacklisted').length
  }

  /**
   * Number of wanted pieces we have (verified).
   * Counts pieces that are wanted or boundary and have bitfield=1.
   */
  get completedWantedPiecesCount(): number {
    if (!this._bitfield) return 0
    if (this._pieceClassification.length === 0) return this.completedPiecesCount

    let count = 0
    for (let i = 0; i < this.piecesCount; i++) {
      if (this._pieceClassification[i] !== 'blacklisted' && this._bitfield.get(i)) {
        count++
      }
    }
    return count
  }

  get isDownloadComplete(): boolean {
    if (this.piecesCount === 0) return false

    // If we have file priorities, check only wanted pieces
    if (this._pieceClassification.length > 0) {
      return this.completedWantedPiecesCount === this.wantedPiecesCount
    }

    // No file priorities - all pieces must be complete
    return this.completedPiecesCount === this.piecesCount
  }

  // --- Session Restore ---

  restoreBitfieldFromHex(hex: string): void {
    this._bitfield?.restoreFromHex(hex)
    this._recalculateFirstNeededPiece()
  }

  /** Recalculate _firstNeededPiece by scanning from 0. Call after bulk bitfield changes. */
  private _recalculateFirstNeededPiece(): void {
    this._firstNeededPiece = 0
    if (this._bitfield) {
      while (
        this._firstNeededPiece < this.piecesCount &&
        this._bitfield.get(this._firstNeededPiece)
      ) {
        this._firstNeededPiece++
      }
    }
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

  // === File Priority System ===

  /**
   * Get file priorities array. Returns empty array if no files.
   */
  get filePriorities(): number[] {
    return this._filePriorities
  }

  /**
   * Get the piece classification array.
   */
  get pieceClassification(): PieceClassification[] {
    return this._pieceClassification
  }

  /**
   * Get per-piece priority (0=skip, 1=normal, 2=high).
   */
  get piecePriority(): Uint8Array | null {
    return this._piecePriority
  }

  /**
   * Get pieces currently stored in .parts file.
   */
  get partsFilePieces(): Set<number> {
    return this._partsFilePieces
  }

  /**
   * Get the PartsFile manager (if initialized).
   */
  get partsFile(): PartsFile | undefined {
    return this._partsFile
  }

  /**
   * Initialize the PartsFile for boundary piece storage.
   * Called after storage is initialized.
   */
  async initPartsFile(): Promise<void> {
    if (!this.contentStorage) return

    const storageHandle = this.contentStorage.storage
    if (!storageHandle) {
      this.logger.warn('Cannot initialize PartsFile: no storage handle')
      return
    }

    this._partsFile = new PartsFile(this.engineInstance, storageHandle, this.infoHashStr)
    await this._partsFile.load()

    // Sync partsFilePieces set with loaded data
    this._partsFilePieces = this._partsFile.pieces
    this.logger.debug(`PartsFile initialized with ${this._partsFilePieces.size} pieces`)
  }

  /**
   * Check if a file is skipped.
   */
  isFileSkipped(fileIndex: number): boolean {
    return this._filePriorities[fileIndex] === 1
  }

  /**
   * Check if a file is complete (all pieces touching it are verified).
   */
  isFileComplete(fileIndex: number): boolean {
    if (!this.hasMetadata || !this._bitfield) return false
    const file = this.contentStorage?.filesList[fileIndex]
    if (!file) return false

    const startPiece = Math.floor(file.offset / this.pieceLength)
    const endPiece = Math.floor((file.offset + file.length - 1) / this.pieceLength)

    for (let i = startPiece; i <= endPiece; i++) {
      if (!this._bitfield.get(i)) return false
    }
    return true
  }

  /**
   * Set file priority for a single file.
   * @param fileIndex - Index of the file
   * @param priority - 0 = normal, 1 = skip
   * @returns true if priority was changed, false if ignored (e.g., file already complete)
   */
  setFilePriority(fileIndex: number, priority: number): boolean {
    if (!this.hasMetadata) return false
    const fileCount = this.contentStorage?.filesList.length ?? 0
    if (fileIndex < 0 || fileIndex >= fileCount) return false

    // Prevent skipping completed files
    if (priority === 1 && this.isFileComplete(fileIndex)) {
      this.logger.debug(`Ignoring skip request for completed file ${fileIndex}`)
      return false
    }

    // Ensure array is initialized
    if (this._filePriorities.length !== fileCount) {
      this._filePriorities = new Array(fileCount).fill(0)
    }

    if (this._filePriorities[fileIndex] === priority) return false

    const wasSkipped = this._filePriorities[fileIndex] === 1
    this._filePriorities[fileIndex] = priority
    this.recomputePieceClassification()

    // Persist state change
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)

    this.logger.info(`File ${fileIndex} priority set to ${priority === 1 ? 'skip' : 'normal'}`)

    // If un-skipping, try to materialize any boundary pieces
    if (wasSkipped && priority === 0) {
      // Fire and forget - don't block the caller
      this.materializeEligiblePieces().catch((e) => {
        this.logger.error('Error materializing pieces:', e)
      })
    }

    return true
  }

  /**
   * Set priorities for multiple files at once.
   * @param priorities - Map of fileIndex -> priority
   * @returns Number of files whose priority was changed
   */
  setFilePriorities(priorities: Map<number, number>): number {
    if (!this.hasMetadata) return 0
    const fileCount = this.contentStorage?.filesList.length ?? 0

    // Ensure array is initialized
    if (this._filePriorities.length !== fileCount) {
      this._filePriorities = new Array(fileCount).fill(0)
    }

    let changed = 0
    let anyUnskipped = false
    for (const [fileIndex, priority] of priorities) {
      if (fileIndex < 0 || fileIndex >= fileCount) continue

      // Prevent skipping completed files
      if (priority === 1 && this.isFileComplete(fileIndex)) {
        this.logger.debug(`Ignoring skip request for completed file ${fileIndex}`)
        continue
      }

      if (this._filePriorities[fileIndex] !== priority) {
        if (this._filePriorities[fileIndex] === 1 && priority === 0) {
          anyUnskipped = true
        }
        this._filePriorities[fileIndex] = priority
        changed++
      }
    }

    if (changed > 0) {
      this.recomputePieceClassification()
      ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)
      this.logger.info(`Updated ${changed} file priorities`)

      // If any files were un-skipped, try to materialize boundary pieces
      if (anyUnskipped) {
        this.materializeEligiblePieces().catch((e) => {
          this.logger.error('Error materializing pieces:', e)
        })
      }
    }

    return changed
  }

  /**
   * Initialize file priorities array (called when metadata becomes available).
   */
  initFilePriorities(): void {
    const fileCount = this.contentStorage?.filesList.length ?? 0
    if (fileCount === 0) return

    // Initialize all to normal (0) if not already set
    if (this._filePriorities.length !== fileCount) {
      this._filePriorities = new Array(fileCount).fill(0)
    }

    this.recomputePieceClassification()
  }

  /**
   * Restore file priorities from persisted state.
   * Bypasses validation since we're restoring saved state.
   * Called during session restore after metadata is available.
   */
  restoreFilePriorities(priorities: number[]): void {
    if (!this.hasMetadata) return

    const fileCount = this.contentStorage?.filesList.length ?? 0
    if (priorities.length !== fileCount) {
      this.logger.warn(
        `File priorities length mismatch: ${priorities.length} vs ${fileCount} files, ignoring`,
      )
      return
    }

    this._filePriorities = [...priorities]
    this.recomputePieceClassification()
    this.logger.debug(`Restored file priorities for ${fileCount} files`)
  }

  /**
   * Materialize a boundary piece from .parts to regular files.
   * Called when all files touched by a boundary piece become non-skipped.
   *
   * @returns true if successfully materialized, false otherwise
   */
  private async materializePiece(pieceIndex: number): Promise<boolean> {
    if (!this._partsFile || !this.contentStorage) return false

    const pieceData = this._partsFile.getPiece(pieceIndex)
    if (!pieceData) {
      this.logger.warn(`Cannot materialize piece ${pieceIndex}: not in .parts`)
      return false
    }

    try {
      // Drain disk queue before modifying files
      await this._diskQueue.drain()

      // Write to regular files
      await this.contentStorage.writePiece(pieceIndex, pieceData)

      // Remove from .parts file
      await this._partsFile.removePieceAndFlush(pieceIndex)

      // Update tracking
      this._partsFilePieces.delete(pieceIndex)

      // Resume disk queue
      this._diskQueue.resume()

      this.logger.debug(`Materialized piece ${pieceIndex} from .parts to regular files`)

      // Update cached downloaded bytes on file objects
      for (const file of this._files) {
        file.updateForPiece(pieceIndex)
      }

      // Now we can advertise this piece - send HAVE to all peers
      for (const p of this.connectedPeers) {
        if (p.handshakeReceived) {
          p.sendHave(pieceIndex)
        }
      }

      return true
    } catch (e) {
      this._diskQueue.resume()
      this.logger.error(`Failed to materialize piece ${pieceIndex}:`, e)
      return false
    }
  }

  /**
   * Check if a piece can be materialized (all files it touches are non-skipped).
   */
  private canMaterializePiece(pieceIndex: number): boolean {
    // Must be a verified piece currently in .parts
    if (!this._partsFilePieces.has(pieceIndex)) return false
    if (!this._bitfield?.get(pieceIndex)) return false

    // The new classification should be 'wanted' (all files non-skipped)
    return this._pieceClassification[pieceIndex] === 'wanted'
  }

  /**
   * Attempt to materialize any boundary pieces that can now be written to regular files.
   * Called after file priorities change (un-skip).
   */
  async materializeEligiblePieces(): Promise<number> {
    if (!this._partsFile || this._partsFilePieces.size === 0) return 0

    const toMaterialize: number[] = []
    for (const pieceIndex of this._partsFilePieces) {
      if (this.canMaterializePiece(pieceIndex)) {
        toMaterialize.push(pieceIndex)
      }
    }

    if (toMaterialize.length === 0) return 0

    this.logger.info(`Materializing ${toMaterialize.length} pieces from .parts`)

    let materialized = 0
    for (const pieceIndex of toMaterialize) {
      if (await this.materializePiece(pieceIndex)) {
        materialized++
      }
    }

    if (materialized > 0) {
      // Persist state change
      ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)
    }

    return materialized
  }

  /**
   * Recompute piece classification based on current file priorities.
   * Called whenever file priorities change.
   */
  private recomputePieceClassification(): void {
    if (!this.hasMetadata || !this.contentStorage) {
      this._pieceClassification = []
      return
    }

    const files = this.contentStorage.filesList
    const classification: PieceClassification[] = new Array(this.piecesCount)

    for (let pieceIndex = 0; pieceIndex < this.piecesCount; pieceIndex++) {
      const pieceStart = pieceIndex * this.pieceLength
      const pieceEnd = pieceStart + this.getPieceLength(pieceIndex)

      let touchesSkipped = false
      let touchesNonSkipped = false

      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex]
        const fileEnd = file.offset + file.length

        // Check if piece overlaps with this file
        if (pieceStart < fileEnd && pieceEnd > file.offset) {
          if (this._filePriorities[fileIndex] === 1) {
            touchesSkipped = true
          } else {
            touchesNonSkipped = true
          }
        }

        // Early exit if we've found both
        if (touchesSkipped && touchesNonSkipped) break
      }

      if (touchesSkipped && touchesNonSkipped) {
        classification[pieceIndex] = 'boundary'
      } else if (touchesSkipped) {
        classification[pieceIndex] = 'blacklisted'
      } else {
        classification[pieceIndex] = 'wanted'
      }
    }

    this._pieceClassification = classification

    // Propagate file priorities to contentStorage for filtered writes
    this.contentStorage.setFilePriorities(this._filePriorities)

    // Log summary
    const wanted = classification.filter((c) => c === 'wanted').length
    const boundary = classification.filter((c) => c === 'boundary').length
    const blacklisted = classification.filter((c) => c === 'blacklisted').length
    this.logger.debug(
      `Piece classification: ${wanted} wanted, ${boundary} boundary, ${blacklisted} blacklisted`,
    )

    // Clear any active pieces that are now blacklisted
    this.clearBlacklistedActivePieces()

    // Recompute piece priorities (for rarest-first selection)
    this.recomputePiecePriority()
  }

  /**
   * Recompute piece priorities from file priorities.
   * Piece priority = max(priority of files it touches), mapped as:
   *   - File priority 0 (normal) → contributes piece priority 1
   *   - File priority 1 (skip) → contributes piece priority 0
   *   - File priority 2 (high) → contributes piece priority 2
   *
   * This means:
   *   - Piece priority 0 = skip (all touching files are skipped)
   *   - Piece priority 1 = normal (at least one touching file is normal)
   *   - Piece priority 2 = high (at least one touching file is high priority)
   */
  private recomputePiecePriority(): void {
    if (!this.hasMetadata || !this.contentStorage || this.piecesCount === 0) {
      this._piecePriority = null
      return
    }

    if (!this._piecePriority || this._piecePriority.length !== this.piecesCount) {
      this._piecePriority = new Uint8Array(this.piecesCount)
    }

    const files = this.contentStorage.filesList

    for (let pieceIndex = 0; pieceIndex < this.piecesCount; pieceIndex++) {
      const pieceStart = pieceIndex * this.pieceLength
      const pieceEnd = pieceStart + this.getPieceLength(pieceIndex)

      let maxPriority = 0 // Start as skip

      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex]
        const fileEnd = file.offset + file.length

        // Check if piece overlaps with this file
        if (pieceStart < fileEnd && pieceEnd > file.offset) {
          const filePriority = this._filePriorities[fileIndex] ?? 0

          // Map file priority to piece priority contribution
          let contribution = 0
          if (filePriority === 2) {
            contribution = 2 // High priority
          } else if (filePriority === 0) {
            contribution = 1 // Normal priority
          }
          // filePriority === 1 (skip) contributes 0

          maxPriority = Math.max(maxPriority, contribution)

          // Early exit if we hit high priority (can't go higher)
          if (maxPriority === 2) break
        }
      }

      this._piecePriority[pieceIndex] = maxPriority
    }

    // Log summary
    let skip = 0,
      normal = 0,
      high = 0
    for (let i = 0; i < this.piecesCount; i++) {
      const p = this._piecePriority[i]
      if (p === 0) skip++
      else if (p === 1) normal++
      else high++
    }
    if (high > 0) {
      this.logger.debug(`Piece priority: ${high} high, ${normal} normal, ${skip} skip`)
    }
  }

  /**
   * Remove any active pieces that are blacklisted.
   * Called when file priorities change or on completion.
   */
  private clearBlacklistedActivePieces(): void {
    if (!this.activePieces || this._pieceClassification.length === 0) return

    let cleared = 0
    for (const index of this.activePieces.activeIndices) {
      if (this._pieceClassification[index] === 'blacklisted') {
        this.activePieces.remove(index)
        cleared++
      }
    }
    if (cleared > 0) {
      this.logger.debug(`Cleared ${cleared} blacklisted active pieces`)
    }
  }

  /**
   * Check if a piece should be requested based on priority.
   */
  shouldRequestPiece(index: number): boolean {
    // Already have it
    if (this._bitfield?.get(index)) return false

    // Check piece priority (0 = skip)
    if (this._piecePriority && this._piecePriority[index] === 0) return false

    // Fallback to classification for backwards compatibility
    if (this._pieceClassification.length > 0) {
      if (this._pieceClassification[index] === 'blacklisted') return false
    }

    return true // Wanted or boundary - both get requested
  }

  /**
   * Get the advertised bitfield (for sending to peers).
   * This excludes boundary pieces that are stored in .parts file.
   * We don't advertise pieces we can't actually serve from regular files.
   */
  getAdvertisedBitfield(): BitField | undefined {
    if (!this._bitfield) return undefined

    // If no pieces in .parts, return the regular bitfield
    if (this._partsFilePieces.size === 0) {
      return this._bitfield
    }

    // Clone the bitfield and clear boundary pieces
    const advertised = this._bitfield.clone()
    for (const pieceIndex of this._partsFilePieces) {
      advertised.set(pieceIndex, false)
    }
    return advertised
  }

  /**
   * Check if a piece can be served to peers (in regular files, not .parts).
   */
  canServePiece(index: number): boolean {
    if (!this._bitfield?.get(index)) return false
    return !this._partsFilePieces.has(index)
  }

  get progress(): number {
    if (this.piecesCount === 0) return 0

    // If we have file priorities, calculate progress based on wanted pieces
    if (this._pieceClassification.length > 0) {
      const wanted = this.wantedPiecesCount
      if (wanted === 0) return 1 // All files skipped = 100% (nothing to do)
      return this.completedWantedPiecesCount / wanted
    }

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
   * Get stats for tracker announce (uploaded, downloaded, left).
   * Used by TrackerManager to include accurate stats in announces.
   */
  getAnnounceStats(): AnnounceStats {
    // If no metadata yet (magnet before metadata fetched), left is unknown
    if (!this.hasMetadata) {
      return {
        uploaded: this.totalUploaded,
        downloaded: this.totalDownloaded,
        left: null,
      }
    }

    // Calculate total size: (piecesCount - 1) * pieceLength + lastPieceLength
    const totalSize =
      this.piecesCount > 0 ? (this.piecesCount - 1) * this.pieceLength + this.lastPieceLength : 0

    // Calculate bytes downloaded by summing completed piece sizes
    let bytesDownloaded = 0
    if (this._bitfield) {
      for (let i = 0; i < this.piecesCount; i++) {
        if (this._bitfield.get(i)) {
          bytesDownloaded += this.getPieceLength(i)
        }
      }
    }

    return {
      uploaded: this.totalUploaded,
      downloaded: this.totalDownloaded,
      left: totalSize - bytesDownloaded,
    }
  }

  /**
   * Connect to one peer from the swarm.
   * Called by BtEngine when granting a connection slot.
   * @returns true if a connection was initiated, false if no candidates available
   */
  connectOnePeer(): boolean {
    // Don't initiate outgoing connections when seeding - accept incoming only
    if (this.isDownloadComplete) {
      this.logger.debug(`connectOnePeer: blocked by isDownloadComplete`)
      return false
    }
    if (!this._networkActive) {
      this.logger.debug(`connectOnePeer: blocked by !_networkActive`)
      return false
    }
    if (this.isKillSwitchEnabled) {
      this.logger.debug(`connectOnePeer: blocked by isKillSwitchEnabled`)
      return false
    }

    // Check we still have room
    const connected = this.numPeers
    const connecting = this._swarm.connectingCount
    if (connected + connecting >= this.maxPeers) {
      this.logger.debug(
        `connectOnePeer: blocked by maxPeers (${connected}+${connecting}>=${this.maxPeers})`,
      )
      return false
    }

    // Get best candidate right now
    const swarmSize = this._swarm.size
    const candidates = this._swarm.getConnectablePeers(1)
    if (candidates.length === 0) {
      this.logger.warn(
        `connectOnePeer: no candidates! swarm=${swarmSize}, connected=${connected}, connecting=${connecting}`,
      )
      return false
    }

    const peer = candidates[0]
    this.logger.info(`connectOnePeer: connecting to ${peer.ip}:${peer.port}`)
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

    // start() checks isSuspended internally
    await this.start()

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
    this.stopNetwork()

    // Persist state change (userState + bitfield)
    ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)
  }

  /**
   * Stop network activity for this torrent.
   * Single source of truth for deactivating networking (trackers, DHT, maintenance).
   * Idempotent - safe to call multiple times.
   * Note: This pauses networking; use the async stop() method to fully destroy the torrent.
   */
  stopNetwork(): void {
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

    // Stop request tick game loop
    this.stopRequestTick()

    // Stop DHT lookup timer
    this.stopDHTLookup()

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

    // Reset peer coordinator so next start gets fresh isFirstEvaluation
    this._peerCoordinator.reset()
  }

  /**
   * Start adaptive maintenance - runs frequently at first, then backs off.
   * Intervals: 500ms, 1s, 1s, 2s, 2s, then 5s steady-state
   */
  private startMaintenance(): void {
    if (this._maintenanceInterval) return

    this._maintenanceStep = 0
    this.scheduleNextMaintenance()
  }

  /**
   * Schedule the next maintenance cycle with adaptive interval.
   */
  private scheduleNextMaintenance(): void {
    const intervals = Torrent.MAINTENANCE_INTERVALS
    const delay = intervals[Math.min(this._maintenanceStep, intervals.length - 1)]

    this._maintenanceInterval = setTimeout(() => {
      this.runMaintenance()
      this._maintenanceStep++

      if (this._networkActive) {
        this.scheduleNextMaintenance()
      }
    }, delay)
  }

  /**
   * Stop periodic maintenance.
   */
  private stopMaintenance(): void {
    if (this._maintenanceInterval) {
      clearTimeout(this._maintenanceInterval)
      this._maintenanceInterval = null
    }
    this._maintenanceStep = 0
  }

  // ==========================================================================
  // Request Tick (Game Loop)
  // ==========================================================================

  /**
   * Start the request tick game loop.
   * This replaces edge-triggered request scheduling for better QuickJS performance.
   * All piece requesting is done in fixed intervals instead of per-block.
   */
  private startRequestTick(): void {
    if (this._requestTickInterval) return

    this._requestTickInterval = setInterval(() => {
      this.requestTick()
    }, this.requestTickIntervalMs)

    this.logger.debug(`Request tick started (${this.requestTickIntervalMs}ms interval)`)
  }

  /**
   * Stop the request tick game loop.
   */
  private stopRequestTick(): void {
    if (this._requestTickInterval) {
      clearInterval(this._requestTickInterval)
      this._requestTickInterval = null
    }
  }

  // Track request tick performance
  private _tickCount = 0
  private _tickTotalMs = 0
  private _tickMaxMs = 0
  private _lastTickLogTime = 0
  private _cleanupTickCounter = 0

  /**
   * Request tick - fill all peers' request pipelines.
   * Called at fixed intervals instead of on every block arrival.
   */
  private requestTick(): void {
    if (!this._networkActive) return

    const startTime = Date.now()

    // Phase 5: Periodic cleanup of stuck pieces (every CLEANUP_TICK_INTERVAL ticks)
    this._cleanupTickCounter++
    if (this._cleanupTickCounter >= CLEANUP_TICK_INTERVAL) {
      this._cleanupTickCounter = 0
      this.cleanupStuckPieces()
    }

    let peersProcessed = 0
    for (const peer of this.connectedPeers) {
      if (!peer.peerChoking && peer.requestsPending < peer.pipelineDepth) {
        this.requestPieces(peer)
        peersProcessed++
      }
    }

    const elapsed = Date.now() - startTime
    this._tickCount++
    this._tickTotalMs += elapsed
    if (elapsed > this._tickMaxMs) {
      this._tickMaxMs = elapsed
    }

    // Log tick stats every 5 seconds
    const now = Date.now()
    if (now - this._lastTickLogTime >= 5000 && this._tickCount > 0) {
      const avgMs = (this._tickTotalMs / this._tickCount).toFixed(1)
      const activePieces = this.activePieces?.activeCount ?? 0
      this.logger.info(
        `RequestTick: ${this._tickCount} ticks, avg ${avgMs}ms, max ${this._tickMaxMs}ms, ` +
          `${activePieces} active pieces, ${peersProcessed} peers/tick`,
      )
      this._tickCount = 0
      this._tickTotalMs = 0
      this._tickMaxMs = 0
      this._lastTickLogTime = now
    }
  }

  /**
   * Get current tick statistics for health monitoring.
   * Returns stats from the current logging window (resets every 5 seconds).
   */
  getTickStats(): {
    tickCount: number
    tickTotalMs: number
    tickMaxMs: number
    activePieces: number
    connectedPeers: number
  } {
    return {
      tickCount: this._tickCount,
      tickTotalMs: this._tickTotalMs,
      tickMaxMs: this._tickMaxMs,
      activePieces: this.activePieces?.activeCount ?? 0,
      connectedPeers: this.connectedPeers.length,
    }
  }

  // ==========================================================================
  // Phase 5: Piece Health Management
  // ==========================================================================

  /**
   * Clean up stuck pieces: timeout stale requests and abandon hopeless pieces.
   *
   * This method:
   * 1. Finds and cancels stale block requests (>10s old)
   * 2. Sends CANCEL messages to peers for those requests
   * 3. Clears exclusive ownership when the owner times out
   * 4. Demotes full pieces back to partial if they now have unrequested blocks
   * 5. Abandons pieces that are stuck (>30s old with <50% progress)
   *
   * libtorrent reference: peer_connection.cpp:4565-4588
   */
  private cleanupStuckPieces(): void {
    if (!this.activePieces) return

    const piecesToRemove: number[] = []
    const piecesToDemote: number[] = []
    let staleRequestsCleared = 0
    let piecesAbandoned = 0

    // Check partial pieces for stale requests and abandonment
    for (const piece of this.activePieces.partialValues()) {
      // Step 1: Check for stale requests
      const staleRequests = piece.getStaleRequests(BLOCK_REQUEST_TIMEOUT_MS)
      for (const { blockIndex, peerId } of staleRequests) {
        // Find the peer to send CANCEL
        const peer = this.findPeerById(peerId)
        if (peer) {
          const begin = blockIndex * BLOCK_SIZE
          const length = Math.min(BLOCK_SIZE, piece.length - begin)
          peer.sendCancel(piece.index, begin, length)

          // Decrement peer's pending request count
          peer.requestsPending = Math.max(0, peer.requestsPending - 1)
        }

        // Clean up the request from the piece
        piece.cancelRequest(blockIndex, peerId)
        staleRequestsCleared++
      }

      // Step 2: Check if piece should be abandoned
      if (piece.shouldAbandon(PIECE_ABANDON_TIMEOUT_MS, PIECE_ABANDON_MIN_PROGRESS)) {
        const progress = Math.round((piece.blocksReceived / piece.blocksNeeded) * 100)
        this.logger.info(`Abandoning stuck piece ${piece.index} (${progress}% complete)`)
        piecesToRemove.push(piece.index)
        piecesAbandoned++
      }
    }

    // Also check full pieces for stale requests (Option A state model)
    // Full pieces have all blocks requested but not all received
    for (const piece of this.activePieces.fullValues()) {
      const staleRequests = piece.getStaleRequests(BLOCK_REQUEST_TIMEOUT_MS)
      for (const { blockIndex, peerId } of staleRequests) {
        // Find the peer to send CANCEL
        const peer = this.findPeerById(peerId)
        if (peer) {
          const begin = blockIndex * BLOCK_SIZE
          const length = Math.min(BLOCK_SIZE, piece.length - begin)
          peer.sendCancel(piece.index, begin, length)

          // Decrement peer's pending request count
          peer.requestsPending = Math.max(0, peer.requestsPending - 1)
        }

        // Clean up the request from the piece
        piece.cancelRequest(blockIndex, peerId)
        staleRequestsCleared++
      }

      // If full piece now has unrequested blocks, mark for demotion
      if (piece.hasUnrequestedBlocks()) {
        piecesToDemote.push(piece.index)
      }
    }

    // Demote full pieces back to partial if they have unrequested blocks
    for (const index of piecesToDemote) {
      this.activePieces.demoteToPartial(index)
    }

    // Remove abandoned pieces
    for (const index of piecesToRemove) {
      this.activePieces.remove(index)
    }

    // Log if we did any cleanup
    if (staleRequestsCleared > 0 || piecesAbandoned > 0 || piecesToDemote.length > 0) {
      this.logger.debug(
        `Piece health cleanup: ${staleRequestsCleared} stale requests cancelled, ` +
          `${piecesAbandoned} pieces abandoned, ${piecesToDemote.length} demoted to partial`,
      )
    }
  }

  /**
   * Find a connected peer by their ID string.
   * Used by cleanupStuckPieces to send CANCEL messages.
   *
   * @param peerId - The peer ID string (hex peerId or "ip:port" format)
   * @returns The peer connection if found, undefined otherwise
   */
  private findPeerById(peerId: string): PeerConnection | undefined {
    for (const peer of this.connectedPeers) {
      const pId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
      if (pId === peerId) {
        return peer
      }
    }
    return undefined
  }

  // ==========================================================================
  // DHT Peer Discovery
  // ==========================================================================

  /**
   * Start periodic DHT lookups for peer discovery.
   * Runs immediately, then every 5 minutes.
   */
  private startDHTLookup(): void {
    if (this._dhtLookupTimer) return
    if (!this.btEngine.dhtEnabled || !this.btEngine.dhtNode) return

    // Run immediately - lookup handles sparse routing table gracefully
    this.requestDHTPeers()

    // Schedule periodic lookups (every 5 minutes)
    const scheduleLookup = () => {
      this._dhtLookupTimer = setTimeout(
        () => {
          this.requestDHTPeers()
          if (this._networkActive && !this.isPrivate) {
            scheduleLookup()
          }
        },
        5 * 60 * 1000,
      )
    }
    scheduleLookup()
  }

  /**
   * Stop DHT lookup timer.
   */
  private stopDHTLookup(): void {
    if (this._dhtLookupTimer) {
      clearTimeout(this._dhtLookupTimer)
      this._dhtLookupTimer = null
    }
  }

  /**
   * Called by the engine when DHT becomes ready (bootstrap complete).
   * Triggers an immediate lookup now that the routing table is populated.
   */
  onDHTReady(): void {
    if (!this._networkActive) return
    if (this.isPrivate) return
    // Start periodic lookups if not already started
    this.startDHTLookup()
    // Lookup again now that routing table is populated
    this.requestDHTPeers()
  }

  /**
   * Request peers from DHT via iterative lookup.
   * Adds discovered peers to the swarm.
   */
  private async requestDHTPeers(): Promise<void> {
    const dhtNode = this.btEngine.dhtNode
    if (!dhtNode) return
    if (!this._networkActive) return

    try {
      this.logger.debug('DHT: Starting peer lookup')
      const result: LookupResult = await dhtNode.lookup(this.infoHash)

      if (result.peers.length > 0) {
        this.logger.info(`DHT: Found ${result.peers.length} peers`)

        // Add peers to swarm
        const peerAddresses = result.peers.map((p) => ({
          ip: p.host,
          port: p.port,
          family: detectAddressFamily(p.host),
        }))
        const swarmSizeBefore = this._swarm.size
        const added = this._swarm.addPeers(peerAddresses, 'dht')
        this.logger.info(
          `DHT: swarm before=${swarmSizeBefore}, added=${added}, swarm after=${this._swarm.size}`,
        )
        if (added > 0) {
          dhtNode.recordPeersDiscovered(added)
          this.logger.info(`DHT: Added ${added} new peers to swarm, calling fillPeerSlots`)
          this.fillPeerSlots()
        }
      } else {
        this.logger.debug(`DHT: No peers found, got ${result.closestNodes.length} closer nodes`)
      }

      // Announce ourselves to the nodes that gave us tokens
      if (result.tokens.size > 0 && this.port > 0) {
        const announceResult = await dhtNode.announce(this.infoHash, this.port, result.tokens)
        this.logger.debug(
          `DHT: Announced to ${announceResult.successCount}/${announceResult.totalCount} nodes`,
        )
      }
    } catch (err) {
      this.logger.warn(`DHT: Lookup failed: ${err}`)
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

    // Skip speed-based peer drops when we're heavily rate-limited
    // (peers appear slow due to our throttling, not their actual speed)
    const skipSpeedChecks = this.btEngine.bandwidthTracker.isDownloadRateLimited()

    const { unchoke, drop } = this._peerCoordinator.evaluate(snapshots, hasSwarmCandidates, {
      skipSpeedChecks,
    })

    // Apply unchoke decisions
    for (const decision of unchoke) {
      this.applyUnchokeDecision(decision)
    }

    // Apply drop decisions (only when downloading - don't drop peers for slow download when seeding)
    if (!this.isComplete) {
      for (const decision of drop) {
        this.applyDropDecision(decision)
      }
    }

    // === Request connection slots from engine ===
    if (this.isComplete) {
      this.logger.debug(`Maintenance: skipping - torrent complete`)
      return // Don't seek peers when complete
    }

    const connected = this.numPeers
    const connecting = this._swarm.connectingCount
    const slotsAvailable = this.maxPeers - connected - connecting
    const swarmSize = this._swarm.size

    if (slotsAvailable <= 0) {
      this.logger.debug(
        `Maintenance: no slots (connected=${connected}, connecting=${connecting}, max=${this.maxPeers})`,
      )
      return
    }

    // Check if we have candidates before requesting slots
    const candidateCount = this._swarm.getConnectablePeers(slotsAvailable).length
    if (candidateCount === 0) {
      this.logger.warn(
        `Maintenance: 0 candidates! swarm=${swarmSize}, connected=${connected}, connecting=${connecting}`,
      )
      return
    }

    // Request slots from engine (will be granted fairly via round-robin)
    const slotsToRequest = Math.min(slotsAvailable, candidateCount)
    this.btEngine.requestConnections(this.infoHashStr, slotsToRequest)

    this.logger.info(
      `Maintenance: swarm=${swarmSize}, connected=${connected}, connecting=${connecting}, ` +
        `requested ${slotsToRequest} slots (${candidateCount} candidates)`,
    )

    // Log backpressure stats periodically (every 5s in steady state)
    this.logBackpressureStats()
  }

  // Track last backpressure log time
  private _lastBackpressureLogTime = 0

  /**
   * Log backpressure-related stats for debugging download performance.
   * Logs: active pieces, buffered bytes, outstanding requests.
   */
  private logBackpressureStats(): void {
    const now = Date.now()
    if (now - this._lastBackpressureLogTime < 5000) return
    this._lastBackpressureLogTime = now

    if (!this.activePieces) return

    const activeCount = this.activePieces.activeCount
    const bufferedBytes = this.activePieces.totalBufferedBytes
    const bufferedMB = (bufferedBytes / (1024 * 1024)).toFixed(2)

    // Sum outstanding requests across all active pieces
    let totalRequests = 0
    for (const piece of this.activePieces.values()) {
      totalRequests += piece.outstandingRequests
    }

    // Get disk queue stats
    const diskSnapshot = this._diskQueue.getSnapshot()
    const diskPending = diskSnapshot.pending.length
    const diskRunning = diskSnapshot.running.length

    // Get disk write rate
    const diskRate = this.btEngine.bandwidthTracker.getCategoryRate('down', 'disk')
    const diskRateMB = (diskRate / (1024 * 1024)).toFixed(1)

    this.logger.info(
      `Backpressure: ${activeCount} active pieces, ${bufferedMB}MB buffered, ${totalRequests} outstanding requests, disk queue: ${diskPending} pending/${diskRunning} running, disk write: ${diskRateMB}MB/s`,
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
      (this.engine as BtEngine).bandwidthTracker,
    )

    // Set the stats getter so trackers can include accurate uploaded/downloaded/left values
    this.trackerManager.setStatsGetter(() => this.getAnnounceStats())

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
      percent: peer.bitfield && this.piecesCount > 0 ? peer.bitfield.count() / this.piecesCount : 0,
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

  /**
   * Set encryption policy at runtime.
   * Takes effect for new connections only.
   */
  setEncryptionPolicy(policy: EncryptionPolicy): void {
    this._connectionManager.setEncryptionPolicy(policy)
  }

  /**
   * Handle a new peer connection from ConnectionManager.
   * This is called after MSE handshake (if enabled) completes.
   */
  private handleNewPeerConnection(_key: string, peer: PeerConnection) {
    // Set up the peer with event listeners etc
    this.addPeer(peer)

    // Initiate BitTorrent handshake
    peer.sendHandshake(this.infoHash, this.peerId)
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

    // Check incoming connection limit - reserve slots for outgoing connections
    // This prevents incoming connections from filling all slots during sleep/wake bursts
    if (peer.isIncoming) {
      const incomingCount = this.peers.filter((p) => p.isIncoming).length
      const maxIncoming = Math.floor(this.maxPeers * MAX_INCOMING_RATIO)
      if (incomingCount >= maxIncoming) {
        this.logger.info(
          `Rejecting incoming peer, incoming limit reached (${incomingCount}/${maxIncoming})`,
        )
        peer.close()
        if (peer.remoteAddress && peer.remotePort) {
          this._swarm.rejectIncoming(
            peer.remoteAddress,
            peer.remotePort,
            detectAddressFamily(peer.remoteAddress),
            'incoming_limit_reached',
          )
        }
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
      this.logger.info(`Rejecting peer, max reached (${effectiveTotal}/${this.maxPeers})`)
      peer.close()
      if (existingSwarmPeer) {
        // Outgoing connection we initiated - mark as failed
        this._swarm.markConnectFailed(key!, 'max_peers_reached')
      } else if (peer.remoteAddress && peer.remotePort) {
        // Incoming connection - track the rejection
        this._swarm.rejectIncoming(
          peer.remoteAddress,
          peer.remotePort,
          detectAddressFamily(peer.remoteAddress),
          'max_peers_reached',
        )
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
      // Phase 4: Set piece length for isFast calculation
      peer.setPieceLength(this.pieceLength)
    }
    this.setupPeerListeners(peer)
  }

  private setupPeerListeners(peer: PeerConnection) {
    // BEP 11: Enable PEX for non-private torrents
    // PexHandler listens for extended messages and emits 'pex_peers' events
    if (!this.isPrivate) {
      new PexHandler(peer)
    }

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
        // BEP 21: Send upload_only: 1 when we're seeding (complete)
        // BEP 9: Send metadata_size when we have metadata
        peer.sendExtendedHandshake({
          uploadOnly: this.isComplete,
          metadataSize: this.metadataSize ?? undefined,
        })
      }

      // Send piece availability (BitField, Have All, or Have None)
      // BEP 6: Use Have All/Have None if peer supports Fast Extension
      const advertisedBitfield = this.getAdvertisedBitfield()
      if (peer.peerFastExtension && advertisedBitfield?.hasAll()) {
        this.logger.debug('Sending Have All to peer (Fast Extension)')
        peer.sendHaveAll()
      } else if (peer.peerFastExtension && advertisedBitfield?.hasNone()) {
        this.logger.debug('Sending Have None to peer (Fast Extension)')
        peer.sendHaveNone()
      } else if (advertisedBitfield) {
        this.logger.debug('Sending BitField to peer')
        peer.sendMessage(MessageType.BITFIELD, advertisedBitfield.toBuffer())
      } else {
        this.logger.debug('No bitfield to send')
      }
    }

    // CRITICAL: Register error and close handlers FIRST, before any code that might call peer.close()
    // This ensures that when self-connection is detected and peer.close() is called in onHandshake,
    // the close event handler exists and removePeer() will be called to clean up swarm state.
    peer.on('error', (err) => {
      this.logger.error(`Peer error: ${err.message}`)
      this.removePeer(peer)
    })

    peer.on('close', () => {
      this.logger.debug('Peer closed')
      this.removePeer(peer)
      // Peer left - choke algorithm will handle slot reallocation
    })

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

      this.logger.debug(
        `Extension handshake received. metadataComplete=${this.metadataComplete}, peerMetadataId=${peer.peerMetadataId}`,
      )

      // Check if we need metadata and peer has it
      if (!this.metadataComplete && peer.peerMetadataId !== null && peer.peerMetadataSize) {
        // Set or validate metadata size
        if (this.metadataSize === null) {
          this.metadataSize = peer.peerMetadataSize
        } else if (this.metadataSize !== peer.peerMetadataSize) {
          this.logger.warn(
            `Peer metadata size ${peer.peerMetadataSize} differs from expected ${this.metadataSize}`,
          )
          return
        }

        // Create per-peer buffer and request ALL pieces upfront (pipelined)
        const totalPieces = Math.ceil(this.metadataSize / Torrent.METADATA_BLOCK_SIZE)
        this.peerMetadataBuffers.set(peer, new Array(totalPieces).fill(null))
        for (let i = 0; i < totalPieces; i++) {
          peer.sendMetadataRequest(i)
        }
        this.logger.info(`Requesting ${totalPieces} metadata pieces from peer`)
      } else if (this.metadataComplete) {
        this.logger.debug('Already have metadata, not requesting')
      } else if (peer.peerMetadataId === null) {
        this.logger.warn('Peer does not support ut_metadata extension')
      } else if (!peer.peerMetadataSize) {
        this.logger.warn('Peer supports ut_metadata but did not send metadata_size')
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

    peer.on('bitfield', (bf) => {
      this.logger.debug('Bitfield received')

      // Calculate how many pieces this peer has
      peer.haveCount = bf.count()
      peer.isSeed = peer.haveCount === this.piecesCount && this.piecesCount > 0

      if (peer.isSeed) {
        // Seeds are tracked separately - don't add to per-piece availability
        this._seedCount++
        this.logger.debug(`Peer is a seed (seedCount: ${this._seedCount})`)
      } else if (this._pieceAvailability) {
        // Non-seeds: update per-piece availability
        for (let i = 0; i < this.piecesCount; i++) {
          if (bf.get(i)) {
            this._pieceAvailability[i]++
          }
        }
      }

      // Update interest
      this.updateInterest(peer)
    })

    // BEP 6 Fast Extension: Handle Have All
    peer.on('have_all', () => {
      this.logger.debug('Have All received (peer is a seeder)')

      // If we don't have metadata yet, defer creating the bitfield
      // recheckPeers() will handle it when metadata arrives
      if (this.piecesCount === 0) {
        this.logger.debug('Deferring have_all - no metadata yet')
        peer.deferredHaveAll = true
        return
      }

      // Create a full bitfield for the peer
      peer.bitfield = BitField.createFull(this.piecesCount)
      peer.haveCount = this.piecesCount
      peer.isSeed = true

      // Seeds are tracked separately - don't add to per-piece availability
      // This avoids O(pieces) updates on seed connect/disconnect
      this._seedCount++
      this.logger.debug(`Peer is a seed via HAVE_ALL (seedCount: ${this._seedCount})`)

      // Update interest
      this.updateInterest(peer)
    })

    // BEP 6 Fast Extension: Handle Have None
    peer.on('have_none', () => {
      this.logger.debug('Have None received (peer has no pieces)')

      // Create an empty bitfield for the peer
      peer.bitfield = BitField.createEmpty(this.piecesCount)

      // No availability updates needed - peer has nothing
      // Update interest (we won't be interested)
      this.updateInterest(peer)
    })

    peer.on('have', (index) => {
      this.logger.debug(`Have received ${index}`)

      // Track how many pieces peer has (for seed detection)
      peer.haveCount++

      // If peer is already a seed, shouldn't receive HAVE messages
      if (peer.isSeed) {
        this.logger.warn(`Received HAVE from peer already marked as seed`)
        return
      }

      // Check if peer just became a seed
      if (peer.haveCount === this.piecesCount && this.piecesCount > 0) {
        this.convertToSeed(peer)
      } else if (this._pieceAvailability && index < this._pieceAvailability.length) {
        // Non-seed: update per-piece availability
        this._pieceAvailability[index]++
      }

      this.updateInterest(peer)
    })

    peer.on('unchoke', () => {
      this.logger.debug('Unchoke received')
      // Request pipeline filled by requestTick() game loop
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

    peer.on('bytesDownloaded', (bytes) => {
      this.totalDownloaded += bytes
      this.emit('download', bytes)
      ;(this.engine as BtEngine).bandwidthTracker.record('peer:protocol', bytes, 'down')
    })

    peer.on('bytesUploaded', (bytes) => {
      this.totalUploaded += bytes
      this.emit('upload', bytes)
      ;(this.engine as BtEngine).bandwidthTracker.record('peer:protocol', bytes, 'up')
    })

    // PEX: Listen for peers discovered via peer exchange
    // Note: pex_peers is emitted by PexHandler using (peer as any).emit()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(peer as any).on('pex_peers', (peers: import('./swarm').PeerAddress[]) => {
      // BEP 27: Private torrents must not use PEX
      if (this.isPrivate) {
        return
      }
      const added = this._swarm.addPeers(peers, 'pex')
      if (added > 0) {
        this.logger.debug(`Added ${added} PEX peers to swarm (total: ${this._swarm.size})`)
        // Try to fill peer slots with newly discovered peers
        this.fillPeerSlots()
      }
    })
  }

  /**
   * Convert a peer to seed status when they acquire all pieces.
   * This happens when a peer sends HAVE for their final missing piece.
   * We remove their contribution from per-piece availability and track them
   * in _seedCount instead, to avoid O(pieces) updates on future disconnect.
   */
  private convertToSeed(peer: PeerConnection): void {
    if (peer.isSeed) return // Already a seed

    // Remove from per-piece availability
    if (this._pieceAvailability && peer.bitfield) {
      for (let i = 0; i < this.piecesCount; i++) {
        if (peer.bitfield.get(i) && this._pieceAvailability[i] > 0) {
          this._pieceAvailability[i]--
        }
      }
    }

    // Mark as seed and add to seed count
    peer.isSeed = true
    this._seedCount++
    this.logger.debug(`Peer converted to seed via HAVE messages (seedCount: ${this._seedCount})`)
  }

  private removePeer(peer: PeerConnection) {
    // Handle availability cleanup based on seed status
    if (peer.isSeed) {
      // Seeds are tracked separately - just decrement the count
      if (this._seedCount > 0) {
        this._seedCount--
        this.logger.debug(`Seed disconnected (seedCount: ${this._seedCount})`)
      }
    } else if (this._pieceAvailability && peer.bitfield) {
      // Non-seeds: decrement per-piece availability
      for (let i = 0; i < this.piecesCount; i++) {
        if (peer.bitfield.get(i) && this._pieceAvailability[i] > 0) {
          this._pieceAvailability[i]--
        }
      }
    }

    // Clear any queued uploads for this peer
    const queueLengthBefore = this.uploadQueue.length
    this.uploadQueue = this.uploadQueue.filter((req) => req.peer !== peer)
    const removedUploads = queueLengthBefore - this.uploadQueue.length
    if (removedUploads > 0) {
      this.logger.debug(`Cleared ${removedUploads} queued uploads for disconnected peer`)
    }

    // Clean up any pending metadata fetch from this peer
    this.peerMetadataBuffers.delete(peer)

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

    // Phase 4: Clear exclusive ownership for pieces owned by this peer
    // This allows other peers to take over downloading those pieces
    if (this.activePieces) {
      for (const piece of this.activePieces.partialValues()) {
        if (piece.exclusivePeer === peerId) {
          piece.clearExclusivePeer()
        }
      }
    }

    // Request pipeline refilled by requestTick() game loop

    // Fill the vacated peer slot with a known peer
    this.fillPeerSlots()
  }

  /**
   * Iterate connected peers starting from round-robin index.
   * Advances the index for next call to ensure fair bandwidth distribution.
   */
  private *iteratePeersRoundRobin(): Generator<PeerConnection> {
    const peers = this.connectedPeers
    if (peers.length === 0) return
    const startIndex = this._peerRequestRoundRobin % peers.length
    for (let i = 0; i < peers.length; i++) {
      yield peers[(startIndex + i) % peers.length]
    }
    this._peerRequestRoundRobin = (startIndex + 1) % peers.length
  }

  /**
   * Schedule retry when download rate limit blocks requests.
   * Uses round-robin to be fair across peers when resuming.
   */
  private scheduleDownloadRateLimitRetry(blockSize: number): void {
    if (this.downloadRateLimitRetryScheduled) return

    const downloadBucket = this.btEngine.bandwidthTracker.downloadBucket
    const delayMs = downloadBucket.msUntilAvailable(blockSize)
    this.downloadRateLimitRetryScheduled = true
    setTimeout(
      () => {
        this.downloadRateLimitRetryScheduled = false
        // Use round-robin for fair bandwidth distribution across peers
        for (const peer of this.iteratePeersRoundRobin()) {
          if (!peer.peerChoking) {
            this.requestPieces(peer)
          }
        }
      },
      Math.max(delayMs, 10),
    )
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

    // Validate: we have this piece and it's serveable (not in .parts)
    if (!this.canServePiece(index)) {
      this.logger.debug(`Ignoring request for piece ${index} - not serveable`)
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
        // Record payload bytes for uploaded piece data
        ;(this.engine as BtEngine).bandwidthTracker.record('peer:payload', block.length, 'up')
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
      isIncoming: peer.isIncoming,
      totalBytesReceived: peer.downloadSpeedCalculator.totalBytes,
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
    // Try quick unchoke if slots available (otherwise algorithm handles on next maintenance)
    this.tryQuickUnchoke(peer)
  }

  /**
   * Quick unchoke for new peers when slots are available.
   * Provides immediate reciprocity without waiting for maintenance cycle.
   * The regular unchoke algorithm may adjust later if needed.
   */
  private tryQuickUnchoke(peer: PeerConnection): void {
    if (!this._networkActive) return
    if (!peer.amChoking) return // Already unchoked

    // Only consider peers where there's mutual potential benefit
    // - Peer is interested in us (they want to download)
    // - OR we're interested in them (we want reciprocity)
    if (!peer.peerInterested && !peer.amInterested) return

    // Count currently unchoked interested peers
    const unchokedCount = this.peers.filter((p) => !p.amChoking && p.peerInterested).length
    const maxSlots = this._peerCoordinator.getConfig().unchoke.maxUploadSlots

    if (unchokedCount < maxSlots) {
      peer.amChoking = false
      peer.sendMessage(MessageType.UNCHOKE)
      this.logger.debug(
        `Quick unchoke for ${peerKey(peer.remoteAddress!, peer.remotePort!)} ` +
          `(${unchokedCount + 1}/${maxSlots} slots)`,
      )
    }

    // Request pipeline filled by requestTick() game loop
  }

  private updateInterest(peer: PeerConnection) {
    if (!peer.bitfield) return

    // Calculate if peer has any piece we want and don't have
    let interested = false
    if (!this.isComplete && this.bitfield) {
      for (let i = 0; i < this.bitfield.size; i++) {
        // Use shouldRequestPiece which checks both bitfield and classification
        if (this.shouldRequestPiece(i) && peer.bitfield.get(i)) {
          interested = true
          break
        }
      }
    }

    // Send INTERESTED if newly interested
    if (interested && !peer.amInterested) {
      this.logger.debug('Sending INTERESTED')
      peer.sendMessage(MessageType.INTERESTED)
      peer.amInterested = true
      // Try to get reciprocity by unchoking them if we have slots
      this.tryQuickUnchoke(peer)
    }

    // Send NOT_INTERESTED if no longer interested
    if (!interested && peer.amInterested) {
      this.logger.debug('Sending NOT_INTERESTED')
      peer.sendMessage(MessageType.NOT_INTERESTED)
      peer.amInterested = false
    }

    // Request pipeline filled by requestTick() game loop
  }

  private requestPieces(peer: PeerConnection) {
    if (!this._networkActive) return
    if (this.isKillSwitchEnabled) return
    if (peer.peerChoking) return
    if (!this.hasMetadata) return

    // Initialize activePieces if needed (lazy init after metadata is available)
    if (!this.activePieces) {
      this.activePieces = new ActivePieceManager(
        this.engineInstance,
        (index) => this.getPieceLength(index),
        { standardPieceLength: this.pieceLength },
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
        // Request pipeline refilled by requestTick() game loop
      })
    }

    // Use per-peer adaptive pipeline depth (starts at 10, ramps up for fast peers)
    let pipelineLimit = peer.pipelineDepth

    // Apply configurable pipeline depth cap
    const maxPipelineDepth = this.btEngine.config?.maxPipelineDepth.get() ?? 500
    pipelineLimit = Math.min(pipelineLimit, maxPipelineDepth)

    // Cap pipeline depth when rate limited to prevent fast peers from monopolizing bandwidth
    const downloadBucket = this.btEngine.bandwidthTracker.downloadBucket
    if (downloadBucket.isLimited) {
      const rateLimit = downloadBucket.refillRate // bytes per second
      const blockSize = 16384 // 16KB standard block

      // Cap at ~1 second worth of bandwidth, minimum 1
      // At 100KB/s: cap = floor(100000 / 16384) = 6
      // At 50KB/s: cap = floor(50000 / 16384) = 3
      // At 16KB/s or less: cap = 1
      const rateLimitCap = Math.max(1, Math.floor(rateLimit / blockSize))
      pipelineLimit = Math.min(pipelineLimit, rateLimitCap)
    }

    // Early exit if pipeline is already full
    if (peer.requestsPending >= pipelineLimit) return

    const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
    const peerBitfield = peer.bitfield
    const isEndgame = this._endgameManager.isEndgame
    const peerIsFast = peer.isFast

    // PHASE 1: Request from existing partial pieces (rarest-first with speed affinity)
    // Phase 3: Use getPartialsRarestFirst() to prioritize rare pieces and nearly-complete pieces
    // Phase 4: Use speed affinity to prevent piece fragmentation
    if (this._pieceAvailability && this._piecePriority) {
      const sortedPartials = this.activePieces.getPartialsRarestFirst(
        this._pieceAvailability,
        this._seedCount,
        this._piecePriority,
      )

      for (const piece of sortedPartials) {
        if (peer.requestsPending >= pipelineLimit) return

        // Skip if peer doesn't have this piece (seeds have everything)
        if (!peer.isSeed && !peerBitfield?.get(piece.index)) continue

        // Phase 4: Speed affinity - check if this peer can request from this piece
        if (!piece.canRequestFrom(peerId, peerIsFast)) continue

        // Fast path: In normal mode, skip pieces with no unrequested blocks
        if (!isEndgame && !piece.hasUnrequestedBlocks()) continue

        // Phase 4: Fast peer claims exclusive ownership
        if (piece.exclusivePeer === null && peerIsFast) {
          piece.claimExclusive(peerId)
        }

        // Get blocks we can request from this piece
        const neededBlocks = isEndgame
          ? piece.getNeededBlocksEndgame(peerId, pipelineLimit - peer.requestsPending)
          : piece.getNeededBlocks(pipelineLimit - peer.requestsPending)

        for (const block of neededBlocks) {
          if (peer.requestsPending >= pipelineLimit) return

          // Rate limit check
          if (downloadBucket.isLimited && !downloadBucket.tryConsume(block.length)) {
            this.scheduleDownloadRateLimitRetry(block.length)
            return
          }

          peer.sendRequest(piece.index, block.begin, block.length)
          peer.requestsPending++

          const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
          piece.addRequest(blockIndex, peerId)

          // Promote to full if all blocks are now requested (Option A state model)
          if (!piece.hasUnrequestedBlocks()) {
            this.activePieces.promoteToFull(piece.index)
          }
        }
      }
    } else {
      // Fallback: iterate in arbitrary order if availability tracking not ready
      for (const piece of this.activePieces.partialValues()) {
        if (peer.requestsPending >= pipelineLimit) return
        if (!peerBitfield?.get(piece.index)) continue
        if (!isEndgame && !piece.hasUnrequestedBlocks()) continue

        const neededBlocks = isEndgame
          ? piece.getNeededBlocksEndgame(peerId, pipelineLimit - peer.requestsPending)
          : piece.getNeededBlocks(pipelineLimit - peer.requestsPending)

        for (const block of neededBlocks) {
          if (peer.requestsPending >= pipelineLimit) return
          if (downloadBucket.isLimited && !downloadBucket.tryConsume(block.length)) {
            this.scheduleDownloadRateLimitRetry(block.length)
            return
          }
          peer.sendRequest(piece.index, block.begin, block.length)
          peer.requestsPending++
          const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
          piece.addRequest(blockIndex, peerId)

          // Promote to full if all blocks are now requested (Option A state model)
          if (!piece.hasUnrequestedBlocks()) {
            this.activePieces.promoteToFull(piece.index)
          }
        }
      }
    }

    // PHASE 2: Activate new pieces (rarest-first selection)
    // Only runs when we need NEW pieces, not on every block
    if (peer.requestsPending >= pipelineLimit) return
    if (!peerBitfield || !this._bitfield || !this._piecePriority || !this._pieceAvailability) return

    // Phase 2 Partial Cap: Don't start new pieces if we have too many partials
    // This prevents the "600 active pieces" death spiral
    //
    // With Option A state model: pieces with all blocks requested are promoted
    // to "full" state which doesn't count against the partial cap. This allows
    // single-peer scenarios to fill the pipeline without needing the workaround.
    const connectedPeerCount = this.connectedPeers.length
    if (this.activePieces.shouldPrioritizePartials(connectedPeerCount)) {
      return // Partial pieces have unrequested blocks - prioritize completion
    }

    // Phase 3+4: Find candidate pieces sorted by rarity
    const candidates = this.findNewPieceCandidates(peer, pipelineLimit - peer.requestsPending)

    for (const pieceIndex of candidates) {
      if (peer.requestsPending >= pipelineLimit) break

      // Create new active piece
      const piece = this.activePieces.getOrCreate(pieceIndex)
      if (!piece) break // At capacity

      // Phase 4: Fast peer claims exclusive ownership on new pieces
      if (peerIsFast) {
        piece.claimExclusive(peerId)
      }

      const neededBlocks = this._endgameManager.isEndgame
        ? piece.getNeededBlocksEndgame(peerId, pipelineLimit - peer.requestsPending)
        : piece.getNeededBlocks(pipelineLimit - peer.requestsPending)

      for (const block of neededBlocks) {
        if (peer.requestsPending >= pipelineLimit) break

        // Rate limit check
        if (downloadBucket.isLimited && !downloadBucket.tryConsume(block.length)) {
          this.scheduleDownloadRateLimitRetry(block.length)
          return
        }

        peer.sendRequest(pieceIndex, block.begin, block.length)
        peer.requestsPending++

        const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
        piece.addRequest(blockIndex, peerId)

        // Promote to full if all blocks are now requested (Option A state model)
        if (!piece.hasUnrequestedBlocks()) {
          this.activePieces.promoteToFull(piece.index)
        }
      }
    }

    // Check if we should enter/exit endgame mode
    const missingCount = this.piecesCount - this.completedPiecesCount
    const decision = this._endgameManager.evaluate(
      missingCount,
      this.activePieces.activeCount,
      this.activePieces.hasUnrequestedBlocks(),
    )
    if (decision) {
      this.logger.info(`Endgame: ${decision.type}`)
    }
  }

  /**
   * Phase 3+4: Find new pieces to activate, sorted by rarity.
   *
   * Uses libtorrent's priority formula:
   * sortKey = availability × (PRIORITY_LEVELS - piecePriority) × PRIO_FACTOR
   *
   * Lower sort key = picked first (rarer + higher priority wins)
   *
   * @param peer - The peer to find pieces for
   * @param maxCount - Maximum number of candidates to return
   * @returns Array of piece indices sorted by rarity (rarest first)
   */
  private findNewPieceCandidates(peer: PeerConnection, maxCount: number): number[] {
    if (!this._bitfield || !this._piecePriority || !this._pieceAvailability || !this.activePieces) {
      return []
    }

    const bitfield = peer.bitfield
    const candidates: Array<{ index: number; sortKey: number }> = []

    // Collect candidate pieces (up to 2x maxCount for better selection after sorting)
    const collectLimit = maxCount * 2
    for (
      let i = this._firstNeededPiece;
      i < this.piecesCount && candidates.length < collectLimit;
      i++
    ) {
      // Skip if we have it
      if (this._bitfield.get(i)) continue

      // Skip if peer doesn't have it (seeds have everything)
      if (!peer.isSeed && !bitfield?.get(i)) continue

      // Skip if priority is 0 (skipped file)
      const prio = this._piecePriority[i]
      if (prio === 0) continue

      // Skip if already active (handled in phase 1)
      if (this.activePieces.has(i)) continue

      // Calculate sort key using libtorrent formula
      const availability = this._pieceAvailability[i] + this._seedCount
      const sortKey = availability * (8 - prio) * 3 // 8 = PRIORITY_LEVELS, 3 = PRIO_FACTOR

      candidates.push({ index: i, sortKey })
    }

    // Sort by rarity (lower sortKey = rarer/higher priority = first)
    candidates.sort((a, b) => a.sortKey - b.sortKey)

    // Return just the indices
    return candidates.slice(0, maxCount).map((c) => c.index)
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
      this.activePieces = new ActivePieceManager(
        this.engineInstance,
        (index) => this.getPieceLength(index),
        { standardPieceLength: this.pieceLength },
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
        // Request pipeline refilled by requestTick() game loop
      })
    }

    if (!this.activePieces) {
      this.logger.warn(
        `Received block ${msg.index}:${msg.begin} but activePieces not initialized (metadata not yet received?)`,
      )
      return
    }

    // Early exit if we already have this piece (prevents creating active pieces for complete pieces)
    if (this._bitfield?.get(msg.index)) {
      this.logger.debug(`Ignoring block ${msg.index}:${msg.begin} - piece already complete`)
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
    } else {
      // Record payload bytes (piece data only, not protocol overhead)
      ;(this.engine as BtEngine).bandwidthTracker.record('peer:payload', msg.block.length, 'down')
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

    // Request pipeline is refilled by requestTick() game loop (not edge-triggered)

    // Then finalize if piece is complete
    if (piece.haveAllBlocks) {
      // Promote to pending state - no longer counts against partial cap
      // This allows new pieces to start downloading while this one awaits verification
      this.activePieces.promoteToPending(msg.index)
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

    // Check piece classification to determine storage destination
    const classification = this._pieceClassification[index]
    const isBoundaryPiece = classification === 'boundary'

    if (isBoundaryPiece && this._partsFile) {
      // Boundary piece: verify hash then store in .parts file
      if (expectedHash) {
        const actualHash = await this.btEngine.hasher.sha1(pieceData)
        if (compare(actualHash, expectedHash) !== 0) {
          this.handleHashMismatch(index, piece)
          return
        }
      }

      try {
        // Drain disk queue before modifying .parts
        await this._diskQueue.drain()

        // Write to .parts file
        await this._partsFile.addPieceAndFlush(index, pieceData)

        // Resume disk queue
        this._diskQueue.resume()

        // Track in partsFilePieces set
        this._partsFilePieces.add(index)

        // Also write the wanted portions to their files immediately
        // (skipped file portions stay only in .parts)
        if (this.contentStorage) {
          await this.contentStorage.writePieceFilteredByPriority(index, pieceData)
        }

        this.logger.debug(
          `Boundary piece ${index} stored in .parts file (wanted portions written to files)`,
        )
      } catch (e) {
        this._diskQueue.resume()
        const errorMsg = e instanceof Error ? e.message : String(e)
        this.logger.error(`Failed to write boundary piece to .parts:`, errorMsg)
        this.errorMessage = `Write failed: ${errorMsg}`
        this.stopNetwork()
        this.activePieces?.removePending(index)
        ;(this.engine as BtEngine).sessionPersistence?.saveTorrentState(this)
        return
      }

      // Mark as verified in internal bitfield
      this.markPieceVerified(index)
      this.activePieces?.removePending(index)

      // Track disk write throughput
      ;(this.engine as BtEngine).bandwidthTracker.record('disk', pieceData.length, 'down')

      // Update cached downloaded bytes on file objects
      for (const file of this._files) {
        file.updateForPiece(index)
      }

      // Note: Do NOT send HAVE for boundary pieces (they're in .parts, not serveable)
      // Progress still counts toward completion
    } else {
      // Wanted piece (or no classification): write to regular files
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
          // Check by name to handle HashMismatchError from different sources
          // (daemon-file-handle and native-file-handle have separate error classes)
          if (e instanceof Error && e.name === 'HashMismatchError') {
            // Hash verification failed in storage layer
            this.handleHashMismatch(index, piece)
            return
          }

          // ANY write failure is fatal - fail fast
          const errorMsg = e instanceof Error ? e.message : String(e)
          this.logger.error(`Fatal write error - stopping torrent:`, errorMsg)
          this.errorMessage = `Write failed: ${errorMsg}`
          this.stopNetwork()
          this.activePieces?.removePending(index)
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
      this.activePieces?.removePending(index)

      // Track disk write throughput
      ;(this.engine as BtEngine).bandwidthTracker.record('disk', pieceData.length, 'down')

      // Update cached downloaded bytes on file objects
      for (const file of this._files) {
        file.updateForPiece(index)
      }

      // Send HAVE message to all peers (only for non-boundary pieces)
      for (const p of this.connectedPeers) {
        if (p.handshakeReceived) {
          p.sendHave(index)
        }
      }
    }

    const progressPct =
      this.piecesCount > 0 ? ((this.completedPiecesCount / this.piecesCount) * 100).toFixed(1) : '0'

    this.logger.debug(
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

    // Check completion first so completedAt is set before persisting
    const hadCompletedAt = !!this.completedAt
    this.checkCompletion()

    const btEngine = this.engine as BtEngine
    if (!hadCompletedAt && this.completedAt) {
      // Torrent just completed - save immediately
      btEngine.sessionPersistence?.saveTorrentState(this)
    } else {
      // Schedule throttled persistence for piece completions
      // (avoids excessive storage writes during fast downloads)
      btEngine.sessionPersistence?.schedulePiecePersistence(this)
    }
  }

  /**
   * Handle hash mismatch for a piece - log, track contributors, and potentially ban.
   *
   * Uses a Bayesian-inspired corruption tracker to decide when to ban:
   * - Sole contributor to a failed piece = immediate ban (proof of guilt)
   * - Multiple failures with same peer as common denominator = likely ban
   * - Swarm health affects threshold (sparse swarm = more cautious)
   */
  private handleHashMismatch(index: number, piece: ActivePiece): void {
    const contributors = Array.from(piece.getContributingPeers())
    this.logger.warn(`Piece ${index} failed hash check. Contributors: ${contributors.join(', ')}`)

    // Get swarm health for threshold adjustment
    const swarmHealth = {
      connected: this._swarm.connectedCount,
      total: this._swarm.size,
    }

    // Record failure and get ban recommendations
    const banDecisions = this._corruptionTracker.recordHashFailure(index, contributors, swarmHealth)

    // Execute bans
    for (const decision of banDecisions) {
      this.banPeerByPeerId(decision)
    }

    // Discard the failed piece data (piece is in pending state after all blocks received)
    this.activePieces?.removePending(index)
  }

  /**
   * Ban a peer by their peer ID (from corruption tracker decision).
   * Looks up all swarm entries for this peer ID and bans them.
   */
  private banPeerByPeerId(decision: BanDecision): void {
    const swarmPeers = this._swarm.getPeersByPeerId(decision.peerId)

    if (swarmPeers.length === 0) {
      this.logger.warn(
        `Cannot ban peer ${decision.peerId}: not found in swarm (may have disconnected)`,
      )
      return
    }

    for (const peer of swarmPeers) {
      const key = addressKey(peer)
      this._swarm.ban(key, decision.reason)
      this.logger.info(`Banned ${key} (${peer.clientName ?? 'unknown client'}): ${decision.reason}`)
    }

    // Remove from corruption tracker (no need to track banned peers)
    this._corruptionTracker.removePeer(decision.peerId)
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
  /**
   * Destroy the torrent - full teardown before removal.
   * Closes all connections, destroys managers, clears swarm.
   * Use stopNetwork() for temporary pause that preserves state.
   */
  async destroy(options?: { skipAnnounce?: boolean }) {
    const t0 = Date.now()
    this.logger.info(`Destroying (skipAnnounce=${options?.skipAnnounce ?? false})`)

    // CRITICAL: Disable network activity FIRST to prevent new connections.
    // When we close peers below, the 'close' event triggers removePeer() which
    // calls fillPeerSlots() -> runMaintenance() -> requestConnections().
    // Without this flag, we'd create 45+ new connection promises while stopping.
    this._networkActive = false

    // Stop periodic maintenance
    this.stopMaintenance()
    this.stopRequestTick()
    this.logger.info(`stopMaintenance done at ${Date.now() - t0}ms`)

    // Cancel any pending connection attempts
    this._connectionManager.destroy()
    this.logger.info(`connectionManager.destroy done at ${Date.now() - t0}ms`)

    // Cleanup active pieces manager
    this.activePieces?.destroy()
    this.logger.info(`activePieces.destroy done at ${Date.now() - t0}ms`)

    this.logger.info(`about to check trackerManager (exists=${!!this.trackerManager})`)
    if (this.trackerManager) {
      if (!options?.skipAnnounce) {
        try {
          const t1 = Date.now()
          this.logger.info('starting tracker announce...')
          await this.trackerManager.announce('stopped')
          this.logger.info(`Tracker announce took ${Date.now() - t1}ms`)
        } catch (err) {
          // Announce may fail if IO is disconnected during shutdown - that's ok
          this.logger.warn(
            `Failed to announce stopped: ${err instanceof Error ? err.message : err}`,
          )
        }
      } else {
        this.logger.info('skipping tracker announce (skipAnnounce=true)')
      }
      this.logger.info('calling trackerManager.destroy()...')
      this.trackerManager.destroy()
      this.logger.info(`trackerManager.destroy done at ${Date.now() - t0}ms`)
    } else {
      this.logger.info('no trackerManager to destroy')
    }
    // Close all connected peers (swarm will be updated via markDisconnected)
    const numPeers = this.connectedPeers.length
    this.connectedPeers.forEach((peer) => peer.close())
    this.logger.info(`Closed ${numPeers} peers`)

    // Clear swarm state
    this._swarm.clear()

    if (this.contentStorage) {
      const t2 = Date.now()
      await this.contentStorage.close()
      this.logger.info(`contentStorage.close took ${Date.now() - t2}ms`)
    }
    this.logger.info(`destroy() complete, total ${Date.now() - t0}ms`)
    this.emit('destroyed')
  }

  /**
   * Reset torrent state (progress, stats, file priorities) without clearing metadata.
   * This is used for "Reset State" which clears download progress but preserves the
   * infodict for magnet torrents so metadata doesn't need to be re-fetched.
   */
  resetState(): void {
    this.logger.info('Resetting torrent state')

    // Reset bitfield (progress) to empty
    if (this.hasMetadata && this.piecesCount > 0) {
      this._bitfield = new BitField(this.piecesCount)
      this._firstNeededPiece = 0
    }

    // Reset stats
    this._persisted.totalDownloaded = 0
    this._persisted.totalUploaded = 0

    // Reset file priorities to all normal (0)
    const fileCount = this.contentStorage?.filesList.length ?? 0
    if (fileCount > 0) {
      this._filePriorities = new Array(fileCount).fill(0)
      this._pieceClassification = []
      this.recomputePieceClassification()

      // Also reset on content storage
      this.contentStorage?.setFilePriorities(this._filePriorities)
    } else {
      this._filePriorities = []
      this._pieceClassification = []
    }

    // Clear cached file info so it's recomputed with fresh values
    this._files = []

    // Clear partsFilePieces tracking
    this._partsFilePieces.clear()

    this.logger.info('Torrent state reset complete')
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
      this.stopNetwork()
    }

    // Set checking state
    this._isChecking = true
    this._checkingProgress = 0

    // Reset bitfield to 0% (create fresh bitfield)
    this._bitfield = new BitField(this.piecesCount)
    this._firstNeededPiece = 0

    // Clear cached file info so it's recomputed with fresh downloaded values
    this._files = []

    // Clear partsFilePieces tracking - will be rebuilt during recheck
    this._partsFilePieces.clear()

    // Reload .parts file to get current state
    if (this._partsFile) {
      await this._partsFile.load()
    }

    // Close file handles so they're reopened fresh during verification.
    // This detects deleted files - on Linux, deleted files with open handles
    // remain readable until handles are closed.
    if (this.contentStorage) {
      await this.contentStorage.close()
    }

    try {
      for (let i = 0; i < this.piecesCount; i++) {
        try {
          // Check if this is a boundary piece that might be in .parts
          const isBoundary = this._pieceClassification[i] === 'boundary'
          let isValid = false

          if (isBoundary && this._partsFile?.hasPiece(i)) {
            // Try to verify from .parts file
            isValid = await this.verifyPieceFromParts(i)
            if (isValid) {
              this._partsFilePieces.add(i)
            }
          } else {
            // Verify from regular files
            isValid = await this.verifyPiece(i)
          }

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
    this.logger.info(
      `Recheck complete for ${this.infoHashStr} (${this._partsFilePieces.size} pieces in .parts)`,
    )
    // Note: Don't call checkCompletion() here - recheck shouldn't trigger
    // "download complete" notifications, it's just verifying existing data

    // Resume networking if it was active before recheck
    if (wasNetworkActive) {
      this.start()
    }
  }

  /**
   * Verify a piece from the .parts file.
   */
  private async verifyPieceFromParts(index: number): Promise<boolean> {
    if (!this._partsFile) return false

    const data = this._partsFile.getPiece(index)
    if (!data) return false

    const expectedHash = this.getPieceHash(index)
    if (!expectedHash) {
      // If no hashes provided, assume valid
      return true
    }

    // Calculate SHA1
    const hash = await this.btEngine.hasher.sha1(data)

    // Compare
    return compare(hash, expectedHash) === 0
  }

  private checkCompletion() {
    if (this.isDownloadComplete) {
      // Clear ALL active pieces - downloading is done, release memory
      this.activePieces?.destroy()
      this.activePieces = undefined

      // Reset endgame state
      this._endgameManager.reset()

      // Only emit completion events once (completedAt guards against duplicates)
      if (!this.completedAt) {
        this.completedAt = Date.now()
        this.logger.info('Download complete!')
        this.emit('done')
        this.emit('complete')
        // Tell all peers we're no longer interested and that we're now a seeder
        this.notifyPeersWeAreSeeding()

        // Prune swarm to release memory - keep only connected peers for seeding
        // This is especially important on mobile where memory is constrained
        this._swarm.pruneForSeeding()
      }
    }
  }

  public recheckPeers() {
    this.logger.debug('Rechecking all peers')
    for (const peer of this.connectedPeers) {
      // Phase 4: Set piece length for isFast calculation
      if (this.pieceLength > 0) {
        peer.setPieceLength(this.pieceLength)
      }

      // Handle deferred have_all - peer sent HAVE_ALL before we had metadata
      if (peer.deferredHaveAll && this.piecesCount > 0) {
        this.logger.debug('Processing deferred have_all for peer')
        peer.deferredHaveAll = false
        peer.bitfield = BitField.createFull(this.piecesCount)
        peer.haveCount = this.piecesCount
        peer.isSeed = true

        // Seeds are tracked separately - don't add to per-piece availability
        this._seedCount++
        this.logger.debug(`Deferred seed processed (seedCount: ${this._seedCount})`)
      }

      this.updateInterest(peer)
    }
  }

  /**
   * Notify all connected peers that we've become a seeder.
   * - Re-send extension handshake with upload_only: 1 (BEP 21)
   * - Send NOT_INTERESTED to all peers
   */
  private notifyPeersWeAreSeeding() {
    this.logger.debug('Notifying peers we are now seeding')
    for (const peer of this.connectedPeers) {
      // Re-send extension handshake with upload_only: 1 (BEP 10 allows multiple handshakes)
      if (peer.peerExtensions) {
        peer.sendExtendedHandshake({
          uploadOnly: true,
          metadataSize: this.metadataSize ?? undefined,
        })
      }

      // Send NOT_INTERESTED if we were interested
      if (peer.amInterested) {
        peer.sendMessage(MessageType.NOT_INTERESTED)
        peer.amInterested = false
      }
    }
  }

  // Metadata Logic

  private handleMetadataRequest(peer: PeerConnection, piece: number) {
    if (!this.metadataRaw) {
      peer.sendMetadataReject(piece)
      return
    }

    const start = piece * Torrent.METADATA_BLOCK_SIZE
    if (start >= this.metadataRaw.length) {
      peer.sendMetadataReject(piece)
      return
    }

    const end = Math.min(start + Torrent.METADATA_BLOCK_SIZE, this.metadataRaw.length)
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

    // Get this peer's buffer
    const peerBuffer = this.peerMetadataBuffers.get(peer)
    if (!peerBuffer) {
      this.logger.warn('Received metadata from peer we are not tracking')
      return
    }

    // Validate size matches
    if (this.metadataSize !== totalSize) {
      this.logger.error(`Metadata size mismatch: expected ${this.metadataSize}, got ${totalSize}`)
      this.peerMetadataBuffers.delete(peer)
      return
    }

    // Validate piece index
    if (piece < 0 || piece >= peerBuffer.length) {
      this.logger.error(`Invalid metadata piece index: ${piece}`)
      return
    }

    // Store the piece
    peerBuffer[piece] = data

    // Check if all pieces received from this peer
    if (peerBuffer.every((p) => p !== null)) {
      await this.verifyPeerMetadata(peer, peerBuffer as Uint8Array[])
    }
  }

  private async verifyPeerMetadata(peer: PeerConnection, pieces: Uint8Array[]) {
    if (this.metadataComplete) return

    // Concatenate all pieces into full metadata buffer
    const totalSize = this.metadataSize!
    const fullBuffer = new Uint8Array(totalSize)
    let offset = 0
    for (const piece of pieces) {
      fullBuffer.set(piece, offset)
      offset += piece.length
    }

    // SHA1 hash should match infoHash
    const hash = await this.btEngine.hasher.sha1(fullBuffer)
    if (compare(hash, this.infoHash) === 0) {
      this.logger.info('Metadata verified successfully!')
      this.metadataComplete = true
      this._metadataRaw = fullBuffer
      // Clean up all peer metadata buffers
      this.peerMetadataBuffers.clear()
      this.emit('metadata', fullBuffer)
    } else {
      this.logger.warn(
        `Metadata hash mismatch from peer - sent info dict that doesn't match expected hash. ` +
          `This could be: (1) peer sent invalid/corrupted data, or ` +
          `(2) you connected with a truncated v2 info hash to a hybrid torrent ` +
          `(use the v1 SHA-1 hash instead). Discarding this peer's metadata.`,
      )
      // Just remove this peer's buffer, other peers may still succeed
      this.peerMetadataBuffers.delete(peer)
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
      // Always sync filePriorities
      filePriorities: this._filePriorities.length > 0 ? [...this._filePriorities] : undefined,
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

    // Restore file priorities
    if (state.filePriorities && state.filePriorities.length > 0) {
      this._filePriorities = [...state.filePriorities]
      // Note: pieceClassification will be recomputed after metadata is initialized
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
