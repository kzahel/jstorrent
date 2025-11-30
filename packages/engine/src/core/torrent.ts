import { PeerConnection } from './peer-connection'
import { PieceManager, BLOCK_SIZE } from './piece-manager'
import { ActivePiece } from './active-piece'
import { ActivePieceManager } from './active-piece-manager'
import { TorrentContentStorage } from './torrent-content-storage'
import { BitField } from '../utils/bitfield'
import { MessageType, WireMessage } from '../protocol/wire-protocol'
import { toHex, toString, compare } from '../utils/buffer'
import { TrackerManager } from '../tracker/tracker-manager'
import { ISocketFactory } from '../interfaces/socket'
import { PeerInfo } from '../interfaces/tracker'
import { TorrentFileInfo } from './torrent-file-info'
import { EngineComponent } from '../logging/logger'
import type { BtEngine } from './bt-engine'
import { TorrentUserState, TorrentActivityState, computeActivityState } from './torrent-state'

export class Torrent extends EngineComponent {
  static logName = 'torrent'

  private btEngine: BtEngine
  private peers: PeerConnection[] = []
  public infoHash: Uint8Array
  public peerId: Uint8Array
  public socketFactory: ISocketFactory
  public port: number
  public pieceManager?: PieceManager
  private activePieces?: ActivePieceManager
  public contentStorage?: TorrentContentStorage
  public bitfield?: BitField
  public announce: string[] = []
  public trackerManager?: TrackerManager
  private _files: TorrentFileInfo[] = []
  public maxPeers: number = 50
  public globalLimitCheck: () => boolean = () => true

  // Metadata Phase
  public metadataSize: number | null = null
  public metadataBuffer: Uint8Array | null = null
  public metadataComplete = false
  public metadataPiecesReceived = new Set<number>()
  private metadataRaw: Uint8Array | null = null // The full info dictionary buffer

  public totalDownloaded = 0
  public totalUploaded = 0

  // State
  /**
   * User's intent for this torrent - persisted.
   */
  public userState: TorrentUserState = 'active'

  /**
   * Queue position when userState is 'queued'.
   */
  public queuePosition?: number

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

  public isPrivate: boolean = false
  public creationDate?: number
  public completedAt?: number

  // For session persistence
  public magnetLink?: string // Original magnet if added via magnet
  public torrentFileBase64?: string // Base64 .torrent file if added via file
  public addedAt: number = Date.now()

  // We need to re-implement EventEmitter methods if we don't extend it.
  // Or I can modify EngineComponent to extend EventEmitter.
  // Let's modify EngineComponent first.

  constructor(
    engine: BtEngine,
    infoHash: Uint8Array,
    peerId: Uint8Array,
    socketFactory: ISocketFactory,
    port: number,
    pieceManager?: PieceManager,
    contentStorage?: TorrentContentStorage,
    bitfield?: BitField,
    announce: string[] = [],
    maxPeers: number = 50,
    globalLimitCheck: () => boolean = () => true,
  ) {
    super(engine)
    this.btEngine = engine
    this.infoHash = infoHash
    this.peerId = peerId
    this.socketFactory = socketFactory
    this.port = port
    this.pieceManager = pieceManager
    this.contentStorage = contentStorage
    this.bitfield = bitfield
    this.announce = announce
    this.maxPeers = maxPeers
    this.globalLimitCheck = globalLimitCheck

    this.instanceLogName = `t:${toHex(infoHash).slice(0, 6)}`

    if (this.announce.length > 0) {
      // Group announce URLs into tiers (for now just one tier per URL or all in one)
      // TrackerManager expects string[][]
      const tiers = [this.announce]
      this.trackerManager = new TrackerManager(
        this.engine,
        tiers,
        this.infoHash,
        this.peerId,
        this.socketFactory,
        this.port,
      )

      this.trackerManager.on('peer', (peer: PeerInfo) => {
        // this.logger.info(`Discovered peer ${peer.ip}:${peer.port}`)
        // We need to initiate connection.
        // But PeerConnection usually wraps an existing socket or initiates one?
        // PeerConnection currently takes a socket.
        // We need to create a socket and connect.
        this.connectToPeer(peer)
      })

      this.trackerManager.on('warning', (msg) => {
        this.logger.warn(`Tracker warning: ${msg}`)
      })

      this.trackerManager.on('error', (err) => {
        this.logger.error(`Tracker error: ${err.message}`)
      })
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

    if (this.trackerManager) {
      this.logger.info('Starting tracker announce')
      await this.trackerManager.announce('started')
    }
  }

  async connectToPeer(peerInfo: PeerInfo) {
    // Check if already connected
    // This is a simple check, ideally we check against known peers map
    const alreadyConnected = this.peers.some(
      (p) => p.remoteAddress === peerInfo.ip && p.remotePort === peerInfo.port,
    )
    if (alreadyConnected) return

    if (this.numPeers >= this.maxPeers) {
      this.logger.debug(`Skipping peer ${peerInfo.ip}, max peers reached`)
      return
    }

    if (!this.globalLimitCheck()) {
      this.logger.debug(`Skipping peer ${peerInfo.ip}, global max connections reached`)
      return
    }

    try {
      this.logger.info(`Connecting to ${peerInfo.ip}:${peerInfo.port}`)
      const socket = await this.socketFactory.createTcpSocket(peerInfo.ip, peerInfo.port)

      // Wait for connection? createTcpSocket with args usually connects.
      // But let's assume it returns a connected socket or one that connects.
      // If it's the interface from extension, it might need explicit connect if not handled by factory?
      // The interface says: createTcpSocket(host, port) -> Promise<ITcpSocket>
      // So it should be connected.

      const peer = new PeerConnection(this.engineInstance, socket, {
        remoteAddress: peerInfo.ip,
        remotePort: peerInfo.port,
      })

      // We need to set up the peer
      this.addPeer(peer)

      // Initiate handshake
      peer.sendHandshake(this.infoHash, this.peerId)
    } catch (_err) {
      // very common to happen, don't log
      // this.logger.error(`Failed to connect to peer ${peerInfo.ip}:${peerInfo.port}`, { err })
    }
  }

  get infoHashStr(): string {
    return toHex(this.infoHash)
  }

  get numPeers(): number {
    return this.peers.length
  }

  get files(): TorrentFileInfo[] {
    if (this._files.length > 0) return this._files

    if (this.contentStorage && this.pieceManager) {
      const rawFiles = this.contentStorage.filesList
      const pieceLength = this.pieceManager.getPieceLength(0) // Assuming constant piece length for now, or use pieceManager property
      // pieceManager doesn't expose pieceLength directly as a property, but getPieceLength(index).
      // We can use index 0.

      this._files = rawFiles.map((f) => new TorrentFileInfo(f, this.pieceManager!, pieceLength))
      return this._files
    }
    return []
  }

  get progress(): number {
    return this.pieceManager?.getProgress() || 0
  }

  get name(): string {
    return `Torrent-${this.infoHashStr.substring(0, 8)}...`
  }

  get downloadSpeed(): number {
    return this.peers.reduce((acc, peer) => acc + peer.downloadSpeed, 0)
  }

  get uploadSpeed(): number {
    return this.peers.reduce((acc, peer) => acc + peer.uploadSpeed, 0)
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
    return !!this.pieceManager
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

    // Stop tracker announces
    if (this.trackerManager) {
      this.trackerManager.stop()
    }

    // Close all peer connections
    for (const peer of this.peers) {
      peer.close()
    }
    this.peers = []
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
      this.trackerManager.start()
    } else if (this.announce.length > 0) {
      // Initialize tracker manager if we have announces but no manager yet
      this.initTrackerManager()
    }

    // Note: Peer connections will come from tracker responses
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

    this.trackerManager.on('peer', (peer: PeerInfo) => {
      this.connectToPeer(peer)
    })

    this.trackerManager.on('warning', (msg) => {
      this.logger.warn(`Tracker warning: ${msg}`)
    })

    this.trackerManager.on('error', (err) => {
      this.logger.error(`Tracker error: ${err.message}`)
    })
  }

  getPeerInfo() {
    return this.peers.map((peer) => ({
      ip: peer.remoteAddress,
      port: peer.remotePort,
      client: peer.peerId ? toString(peer.peerId) : 'unknown',
      peerId: peer.peerId ? toHex(peer.peerId) : null,
      downloaded: peer.downloaded,
      uploaded: peer.uploaded,
      downloadSpeed: peer.downloadSpeed,
      uploadSpeed: peer.uploadSpeed,
      percent: peer.bitfield ? peer.bitfield.count() / peer.bitfield.size : 0,
      choking: peer.peerChoking,
      interested: peer.peerInterested,
    }))
  }

  getPieceAvailability(): number[] {
    if (!this.pieceManager) return []
    const counts = new Array(this.pieceManager.getPieceCount()).fill(0)
    for (const peer of this.peers) {
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
    const peer = this.peers.find((p) => p.remoteAddress === ip && p.remotePort === port)
    if (peer) {
      peer.close()
    }
  }

  setMaxPeers(max: number) {
    this.maxPeers = max
  }

  addPeer(peer: PeerConnection) {
    if (this.numPeers >= this.maxPeers) {
      this.logger.warn('Rejecting peer, max peers reached')
      peer.close()
      return
    }
    // Note: global limit for incoming is handled by BtEngine, but if we add manually we should check?
    // BtEngine calls addPeer for incoming.
    // If we call addPeer manually (e.g. from tests), we should check.
    if (!this.globalLimitCheck()) {
      this.logger.warn('Rejecting peer, global max connections reached')
      peer.close()
      return
    }

    this.peers.push(peer)
    if (this.pieceManager) {
      peer.bitfield = new BitField(this.pieceManager.getPieceCount())
    }
    this.setupPeerListeners(peer)
  }

  private setupPeerListeners(peer: PeerConnection) {
    const onHandshake = (_infoHash: Uint8Array, _peerId: Uint8Array, extensions: boolean) => {
      this.logger.debug('Handshake received')
      // Verify infoHash matches

      // If we initiated connection, we sent handshake first.
      // If they initiated, they sent handshake first.
      // PeerConnection handles the handshake exchange logic mostly.

      if (extensions) {
        peer.sendExtendedHandshake()
      }

      // Send BitField
      if (this.bitfield) {
        this.logger.debug('Sending BitField to peer')
        peer.sendMessage(MessageType.BITFIELD, this.bitfield.toBuffer())
      } else {
        console.log('Torrent: No bitfield to send')
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
  }

  private removePeer(peer: PeerConnection) {
    console.error(`removePeer: Removing peer, peers remaining: ${this.peers.length - 1}`)
    const index = this.peers.indexOf(peer)
    if (index !== -1) {
      this.peers.splice(index, 1)
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
    if (this.peers.length > 0) {
      for (const remainingPeer of this.peers) {
        if (!remainingPeer.peerChoking) {
          this.requestPieces(remainingPeer)
        }
      }
    }
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

    if (!this.pieceManager) {
      // this.logger.warn('requestPieces: No pieceManager')
      return
    }

    // Initialize activePieces if needed (lazy init after pieceManager is set)
    if (!this.activePieces) {
      this.activePieces = new ActivePieceManager(
        this.engineInstance,
        (index) => this.pieceManager!.getPieceLength(index),
        { requestTimeoutMs: 30000, maxActivePieces: 20, maxBufferedBytes: 16 * 1024 * 1024 },
      )
    }

    const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
    const missing = this.pieceManager.getMissingPieces()
    /*
    console.error(
      `requestPieces: ${missing.length} missing pieces, peer.bitfield=${!!peer.bitfield}, peerPending=${peer.requestsPending}`,
    )
      */

    const MAX_PIPELINE = 200

    let requestsMade = 0
    let skippedComplete = 0
    let skippedCapacity = 0
    let skippedPeerLacks = 0
    let skippedNoNeeded = 0

    for (const index of missing) {
      if (peer.requestsPending >= MAX_PIPELINE) {
        //this.logger.debug(`requestPieces: Hit MAX_PIPELINE limit`)
        break
      }

      // Check peer has this piece
      if (!peer.bitfield?.get(index)) {
        skippedPeerLacks++
        continue
      }

      // Get or create active piece
      let piece = this.activePieces.get(index)

      // If piece has all blocks, skip (waiting for hash/flush)
      if (piece?.haveAllBlocks) {
        skippedComplete++
        continue
      }

      // Try to create if doesn't exist
      if (!piece) {
        const newPiece = this.activePieces.getOrCreate(index)
        if (!newPiece) {
          skippedCapacity++
          continue // At capacity
        }
        piece = newPiece
      }

      // Get blocks we can request from this piece
      const neededBlocks = piece.getNeededBlocks(MAX_PIPELINE - peer.requestsPending)
      if (neededBlocks.length === 0) {
        skippedNoNeeded++
        continue
      }

      for (const block of neededBlocks) {
        if (peer.requestsPending >= MAX_PIPELINE) break

        peer.sendRequest(index, block.begin, block.length)
        peer.requestsPending++
        requestsMade++

        // Track request in ActivePiece (tied to this peer)
        const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
        piece.addRequest(blockIndex, peerId)
      }
    }

    /*
    console.error(
      `requestPieces: Made ${requestsMade} requests, skipped: complete=${skippedComplete}, capacity=${skippedCapacity}, peerLacks=${skippedPeerLacks}, noNeeded=${skippedNoNeeded}`,
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

    // Initialize activePieces if needed (lazy init after pieceManager is set)
    if (!this.activePieces && this.pieceManager) {
      this.activePieces = new ActivePieceManager(
        this.engineInstance,
        (index) => this.pieceManager!.getPieceLength(index),
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
   */
  private async finalizePiece(index: number, piece: ActivePiece): Promise<void> {
    // Assemble the complete piece
    const pieceData = piece.assemble()

    // Verify hash BEFORE writing to disk
    const expectedHash = this.pieceManager?.getPieceHash(index)
    if (expectedHash) {
      const actualHash = await this.btEngine.hasher.sha1(pieceData)

      if (compare(actualHash, expectedHash) !== 0) {
        // Hash failed - track suspicious peers
        const contributors = piece.getContributingPeers()
        this.logger.warn(
          `Piece ${index} failed hash check. Contributors: ${Array.from(contributors).join(', ')}`,
        )

        // TODO: Increment suspicion count for these peers
        // TODO: Ban peers with too many failed pieces

        // Reset piece state
        this.pieceManager?.resetPiece(index)
        this.activePieces?.remove(index)
        return
      }
    }

    // Hash verified - write to storage
    if (this.contentStorage) {
      try {
        await this.contentStorage.writePiece(index, pieceData)
      } catch (e) {
        this.logger.error(`Failed to write piece ${index}:`, e)
        this.pieceManager?.resetPiece(index)
        this.activePieces?.remove(index)
        return
      }
    }

    // Mark as verified
    this.pieceManager?.markVerified(index)
    this.activePieces?.remove(index)

    const pieceCount = this.pieceManager?.getPieceCount() ?? 0
    const completedPieces = this.pieceManager?.getCompletedCount() ?? 0
    const progressPct = pieceCount > 0 ? ((completedPieces / pieceCount) * 100).toFixed(1) : '0'

    this.logger.info(`Piece ${index} verified [${completedPieces}/${pieceCount}] ${progressPct}%`)

    this.emit('piece', index)

    // Emit progress event with detailed info
    this.emit('progress', {
      pieceIndex: index,
      completedPieces,
      totalPieces: pieceCount,
      progress: pieceCount > 0 ? completedPieces / pieceCount : 0,
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
    for (const p of this.peers) {
      if (p.handshakeReceived) {
        p.sendHave(index)
      }
    }

    this.checkCompletion()
  }

  private async verifyPiece(index: number): Promise<boolean> {
    if (!this.pieceManager || !this.contentStorage) return false
    const expectedHash = this.pieceManager.getPieceHash(index)
    if (!expectedHash) {
      // If no hashes provided (e.g. Phase 1), assume valid
      return true
    }

    // Read full piece from disk
    const pieceLength = this.pieceManager.getPieceLength(index)
    const data = await this.contentStorage.read(index, 0, pieceLength)

    // Calculate SHA1
    const hash = await this.btEngine.hasher.sha1(data)

    // Compare
    return compare(hash, expectedHash) === 0
  }
  async stop() {
    this.logger.info('Stopping')

    // Cleanup active pieces manager
    this.activePieces?.destroy()

    if (this.trackerManager) {
      await this.trackerManager.announce('stopped')
      this.trackerManager.destroy()
    }
    this.peers.forEach((peer) => peer.close())
    this.peers = []
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

    if (!this.pieceManager) return

    const piecesCount = this.pieceManager.getPieceCount()
    for (let i = 0; i < piecesCount; i++) {
      try {
        const isValid = await this.verifyPiece(i)
        if (isValid) {
          if (!this.pieceManager.hasPiece(i)) {
            this.logger.debug(`Piece ${i} found valid during recheck`)
            this.pieceManager.markVerified(i)
          }
        } else {
          if (this.pieceManager.hasPiece(i)) {
            this.logger.warn(`Piece ${i} found invalid during recheck`)
            this.pieceManager.resetPiece(i)
          }
        }
      } catch (err) {
        // Read error or other issue
        if (this.pieceManager.hasPiece(i)) {
          this.logger.error(`Piece ${i} error during recheck:`, { err })
          this.pieceManager.resetPiece(i)
        }
      }

      // Emit progress?
      if (i % 10 === 0) {
        // console.error(`Torrent: Recheck progress ${i}/${piecesCount}`)
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
    if (this.pieceManager?.isComplete()) {
      this.logger.info('Download complete!')
      this.emit('done')
      this.emit('complete')
    }
  }

  public recheckPeers() {
    this.logger.debug('Rechecking all peers')
    for (const peer of this.peers) {
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
      this.metadataRaw = this.metadataBuffer
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

  // Called by BtEngine when metadata is provided initially (e.g. .torrent file)
  public setMetadata(infoBuffer: Uint8Array) {
    this.metadataRaw = infoBuffer
    this.metadataComplete = true
    this.metadataSize = infoBuffer.length
  }
}
