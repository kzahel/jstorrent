import { PeerConnection } from './peer-connection'
import { TorrentContentStorage } from './torrent-content-storage'
import { BitField } from '../utils/bitfield'
import { TrackerManager } from '../tracker/tracker-manager'
import { ISocketFactory } from '../interfaces/socket'
import { PeerInfo } from '../interfaces/tracker'
import { TorrentFileInfo } from './torrent-file-info'
import { EngineComponent } from '../logging/logger'
import type { BtEngine } from './bt-engine'
import { TorrentUserState, TorrentActivityState } from './torrent-state'
import { SwarmStats } from './swarm'
/**
 * All persisted fields for a torrent.
 * Adding a new persisted field = add to this interface + add getter/setter in Torrent.
 */
export interface TorrentPersistedState {
  magnetLink?: string
  torrentFileBase64?: string
  infoBuffer?: Uint8Array
  addedAt: number
  completedAt?: number
  userState: TorrentUserState
  queuePosition?: number
  totalDownloaded: number
  totalUploaded: number
  completedPieces: number[]
}
/**
 * Create default persisted state for new torrents.
 */
export declare function createDefaultPersistedState(): TorrentPersistedState
export declare class Torrent extends EngineComponent {
  static logName: string
  private btEngine
  private pendingConnections
  private _swarm
  private _connectionManager
  private connectionTiming
  infoHash: Uint8Array
  peerId: Uint8Array
  socketFactory: ISocketFactory
  port: number
  private activePieces?
  pieceHashes: Uint8Array[]
  pieceLength: number
  lastPieceLength: number
  piecesCount: number
  contentStorage?: TorrentContentStorage
  private _bitfield?
  announce: string[]
  trackerManager?: TrackerManager
  private _files
  maxPeers: number
  globalLimitCheck: () => boolean
  metadataSize: number | null
  metadataBuffer: Uint8Array | null
  metadataComplete: boolean
  metadataPiecesReceived: Set<number>
  private _metadataRaw
  /**
   * The raw info dictionary buffer (verified via SHA1 against infoHash).
   * This is the bencoded "info" dictionary from the .torrent file.
   * Available for session persistence.
   */
  get metadataRaw(): Uint8Array | null
  private _cachedInfoDict?
  /**
   * The parsed info dictionary (decoded from metadataRaw).
   * This is the official BitTorrent "info dict" containing name, piece hashes, files, etc.
   * Lazily parsed and cached to avoid repeated bencode decoding.
   */
  get infoDict(): Record<string, unknown> | undefined
  _magnetDisplayName?: string
  private _persisted
  get totalDownloaded(): number
  set totalDownloaded(value: number)
  get totalUploaded(): number
  set totalUploaded(value: number)
  get userState(): TorrentUserState
  set userState(value: TorrentUserState)
  get queuePosition(): number | undefined
  set queuePosition(value: number | undefined)
  get addedAt(): number
  set addedAt(value: number)
  get completedAt(): number | undefined
  set completedAt(value: number | undefined)
  get magnetLink(): string | undefined
  set magnetLink(value: string | undefined)
  get torrentFileBase64(): string | undefined
  set torrentFileBase64(value: string | undefined)
  /**
   * Whether the torrent is currently checking data.
   */
  private _isChecking
  /**
   * Current error message if any.
   */
  errorMessage?: string
  /**
   * Whether network is currently active for this torrent.
   */
  private _networkActive
  /**
   * Periodic maintenance interval for peer slot filling.
   */
  private _maintenanceInterval
  isPrivate: boolean
  creationDate?: number
  constructor(
    engine: BtEngine,
    infoHash: Uint8Array,
    peerId: Uint8Array,
    socketFactory: ISocketFactory,
    port: number,
    contentStorage?: TorrentContentStorage,
    announce?: string[],
    maxPeers?: number,
    globalLimitCheck?: () => boolean,
  )
  start(): Promise<void>
  connectToPeer(peerInfo: PeerInfo): Promise<void>
  /**
   * Create a TCP connection with an internal timeout.
   * This runs independently of the io-daemon's 30s backstop.
   */
  private createConnectionWithTimeout
  get infoHashStr(): string
  get bitfield(): BitField | undefined
  /**
   * Initialize the bitfield with the given piece count.
   * Called when metadata is available and we know how many pieces there are.
   */
  initBitfield(pieceCount: number): void
  /**
   * Initialize piece info from parsed torrent metadata.
   * Called when metadata becomes available.
   */
  initPieceInfo(pieceHashes: Uint8Array[], pieceLength: number, lastPieceLength: number): void
  getPieceHash(index: number): Uint8Array | undefined
  getPieceLength(index: number): number
  hasPiece(index: number): boolean
  markPieceVerified(index: number): void
  getMissingPieces(): number[]
  get completedPiecesCount(): number
  get isDownloadComplete(): boolean
  restoreBitfieldFromHex(hex: string): void
  get numPeers(): number
  /**
   * Get all connected peer connections.
   * With Phase 3, swarm is single source of truth.
   */
  get peers(): PeerConnection[]
  /**
   * Alias for peers - used internally.
   */
  private get connectedPeers()
  /**
   * Get swarm statistics for debugging/UI.
   * Shows all known peers from all discovery sources.
   */
  get swarm(): SwarmStats
  /**
   * Get all swarm peers (for detailed debugging).
   */
  get swarmPeers(): IterableIterator<import('./swarm').SwarmPeer>
  /**
   * Get connection timing statistics for debugging/UI.
   */
  getConnectionTimingStats(): import('./connection-timing').ConnectionTimingStats
  get isComplete(): boolean
  get files(): TorrentFileInfo[]
  get progress(): number
  get name(): string
  get downloadSpeed(): number
  get uploadSpeed(): number
  /**
   * Get the current activity state (derived, not persisted).
   */
  get activityState(): TorrentActivityState
  /**
   * Whether this torrent has metadata (piece info, files, etc).
   */
  get hasMetadata(): boolean
  /**
   * User action: Start the torrent.
   * Changes userState to 'active' and starts networking if engine allows.
   */
  userStart(): void
  /**
   * User action: Stop the torrent.
   * Changes userState to 'stopped' and stops all networking.
   */
  userStop(): void
  /**
   * Internal: Suspend network activity.
   * Called by engine.suspend() or userStop().
   */
  suspendNetwork(): void
  /**
   * Internal: Resume network activity.
   * Called by engine.resume() (for active torrents) or userStart().
   */
  resumeNetwork(): void
  /**
   * Start periodic maintenance to fill peer slots.
   * Runs every 5 seconds to check if we need more peers.
   */
  private startMaintenance
  /**
   * Stop periodic maintenance.
   */
  private stopMaintenance
  /**
   * Validate connection state invariants.
   * With Phase 3, swarm is single source of truth, so these checks are simpler.
   */
  private checkSwarmInvariants
  /**
   * Assert connection limit immediately after state changes.
   * Allows headroom for in-flight connections.
   */
  private assertConnectionLimit
  /**
   * Run maintenance: try to fill peer slots from swarm.
   */
  private runMaintenance
  /**
   * Initialize the tracker manager.
   */
  private initTrackerManager
  /**
   * Get information about all connected peers.
   *
   * Choking/Interest fields follow BitTorrent wire protocol semantics:
   * - peerChoking: Peer is choking us (we cannot download from them)
   * - peerInterested: Peer wants to download from us
   * - amChoking: We are choking peer (blocking their downloads)
   * - amInterested: We want to download from peer
   */
  getPeerInfo(): {
    ip: string | undefined
    port: number | undefined
    client: string
    peerId: string | null
    downloaded: number
    uploaded: number
    downloadSpeed: number
    uploadSpeed: number
    percent: number
    peerChoking: boolean
    peerInterested: boolean
    amChoking: boolean
    amInterested: boolean
    piecesHave: number
    connectionType: 'incoming' | 'outgoing'
  }[]
  getPieceAvailability(): number[]
  disconnectPeer(ip: string, port: number): void
  setMaxPeers(max: number): void
  addPeer(peer: PeerConnection): void
  private setupPeerListeners
  private removePeer
  /**
   * Fill peer slots from the swarm.
   * Delegates to runMaintenance() for single codepath.
   */
  private fillPeerSlots
  private handleRequest
  private handleInterested
  private updateInterest
  private requestPieces
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
  private handleBlock
  /**
   * Finalize a complete piece: verify hash and write to storage.
   * Uses verified write when available (io-daemon) for atomic hash verification.
   */
  private finalizePiece
  /**
   * Handle hash mismatch for a piece - log, track contributors, and discard.
   */
  private handleHashMismatch
  private verifyPiece
  stop(): Promise<void>
  recheckData(): Promise<void>
  private checkCompletion
  recheckPeers(): void
  private handleMetadataRequest
  private handleMetadataData
  private verifyMetadata
  setMetadata(infoBuffer: Uint8Array): void
  /**
   * Get all persisted state for this torrent.
   * Used by SessionPersistence to save torrent state.
   */
  getPersistedState(): TorrentPersistedState
  /**
   * Restore persisted state for this torrent.
   * Used by SessionPersistence to restore torrent state.
   */
  restorePersistedState(state: TorrentPersistedState): void
  /**
   * Initialize torrent from a magnet link.
   */
  initFromMagnet(magnetLink: string): void
  /**
   * Initialize torrent from a .torrent file.
   */
  initFromTorrentFile(torrentFileBase64: string): void
  /**
   * Manually add a peer and attempt to connect immediately.
   * Useful for debugging.
   *
   * @param address - Peer address in format 'ip:port' (e.g., '127.0.0.1:8998' or '[::1]:8998')
   */
  manuallyAddPeer(address: string): void
  /**
   * Add peer hints from magnet link (x.pe parameter) to the swarm.
   * These are typically peers that have the torrent and can help with bootstrapping.
   *
   * @param hints - Array of PeerAddress objects (already parsed with family)
   */
  addPeerHints(hints: import('./swarm').PeerAddress[]): void
}
//# sourceMappingURL=torrent.d.ts.map
