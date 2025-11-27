import { PeerConnection } from './peer-connection'
import { PieceManager } from './piece-manager'
import { TorrentContentStorage } from './torrent-content-storage'
import { BitField } from '../utils/bitfield'
import { MessageType, WireMessage } from '../protocol/wire-protocol'
import * as crypto from 'crypto'
import { TrackerManager } from '../tracker/tracker-manager'
import { ISocketFactory } from '../interfaces/socket'
import { PeerInfo } from '../interfaces/tracker'
import { TorrentFileInfo } from './torrent-file-info'
import { EngineComponent, ILoggingEngine } from '../logging/logger'

export class Torrent extends EngineComponent {
  static logName = 'torrent'

  // EventEmitter is mixed in via EngineComponent? No, EngineComponent doesn't extend EventEmitter.
  // BtEngine extends EventEmitter.
  // Torrent extends EventEmitter in original code.
  // TypeScript doesn't support multiple inheritance.
  // I should make EngineComponent extend EventEmitter?
  // Or make Torrent implement EventEmitter interface and use composition or mixin?
  // Or just make EngineComponent extend EventEmitter.
  // The design doc says "class BtEngine extends EventEmitter".
  // "All engine components extend EngineComponent".
  // It doesn't say EngineComponent extends EventEmitter.
  // But Torrent needs to emit events.
  // I will make EngineComponent extend EventEmitter in logger.ts first?
  // Or I can just manually implement EventEmitter methods on Torrent or use a property.
  // Actually, many components might want to emit events.
  // Let's check if EngineComponent should extend EventEmitter.
  // If I change EngineComponent to extend EventEmitter, I need to update logger.ts.
  // Let's assume for now I can change EngineComponent.

  private peers: PeerConnection[] = []
  public infoHash: Uint8Array
  public peerId: Uint8Array
  public socketFactory: ISocketFactory
  public port: number
  public pieceManager?: PieceManager
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

  // We need to re-implement EventEmitter methods if we don't extend it.
  // Or I can modify EngineComponent to extend EventEmitter.
  // Let's modify EngineComponent first.

  constructor(
    engine: ILoggingEngine,
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

    this.instanceLogName = `t:${Buffer.from(infoHash).toString('hex').slice(0, 6)}`

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
        // TODO: Connect to peer
        this.logger.info(`Discovered peer ${peer.ip}:${peer.port}`)
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
    } catch (err) {
      this.logger.error(`Failed to connect to peer ${peerInfo.ip}:${peerInfo.port}`, { err })
    }
  }

  get infoHashStr(): string {
    return Buffer.from(this.infoHash).toString('hex')
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
    peer.on('handshake', (_infoHash, _peerId, extensions) => {
      // console.error('Torrent: Handshake received')
      // Verify infoHash matches

      // If we initiated connection, we sent handshake first.
      // If they initiated, they sent handshake first.
      // PeerConnection handles the handshake exchange logic mostly.

      if (extensions) {
        peer.sendExtendedHandshake()
      }

      // Send BitField
      if (this.bitfield) {
        peer.sendMessage(MessageType.BITFIELD, this.bitfield.toBuffer())
      }
    })

    peer.on('extension_handshake', (_payload) => {
      // Check if we need metadata and peer has it
      if (!this.metadataComplete && peer.peerMetadataId !== null) {
        // Request metadata size?
        // Actually, the extended handshake usually contains 'metadata_size' in the 'm' dictionary or top level?
        // BEP 9: "The handshake dictionary will also contain a key "metadata_size" (integer)."
        // We need to parse that from the payload.
        // For now, let's assume we request piece 0 and see what happens or rely on parsing.
        // Our current parser in PeerConnection is very simple.
        // Let's just try to request piece 0 if we don't have it.
        this.requestMetadata(peer)
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
        this.handlePiece(peer, msg)
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
  }

  private removePeer(peer: PeerConnection) {
    const index = this.peers.indexOf(peer)
    if (index !== -1) {
      this.peers.splice(index, 1)
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
      return
    }

    // Simple strategy: request missing blocks from pieces that peer has
    if (!this.pieceManager) return
    const missing = this.pieceManager.getMissingPieces()
    this.logger.debug(`Missing pieces: ${missing.length}`)

    // Count pending requests for this peer
    // We need to track this on the peer object or calculate it.
    // For now, let's just limit the loop iterations if we assume we call this frequently.
    // But we don't track pending requests per peer yet.
    // Let's add a simple counter to PeerConnection?
    // Or just rely on the fact that we only call this on unchoke and piece receive.

    // Pipelining: Keep a certain number of requests in flight.
    // We need to know how many are already in flight.
    // Since we don't track per-peer requests yet, let's just limit the *new* requests we send in this batch.
    // But if we already have 100 pending, we shouldn't send more.
    // We need to add `requestsPending` to PeerConnection.

    const MAX_PIPELINE = 200

    for (const index of missing) {
      if (peer.requestsPending >= MAX_PIPELINE) break

      const hasPiece = peer.bitfield?.get(index)
      // console.log(`Torrent: Checking piece ${index}, peer has: ${hasPiece}`)

      if (hasPiece) {
        const neededBlocks = this.pieceManager.getNeededBlocks(index)
        if (neededBlocks.length > 0) {
          for (const block of neededBlocks) {
            if (peer.requestsPending >= MAX_PIPELINE) break

            // Check if already requested (global check)
            // This is a bit weak for multi-peer but okay for single peer.
            // Ideally we check if *anyone* requested it.
            // pieceManager.getNeededBlocks already filters out requested blocks?
            // No, getNeededBlocks returns blocks that are not received.
            // We need to check if they are requested.
            // pieceManager.addRequested marks them.
            // We should check isRequested inside getNeededBlocks or here.
            // pieceManager.getNeededBlocks DOES NOT check requested status in current implementation?
            // Let's check PieceManager.

            // Assuming getNeededBlocks returns un-requested blocks or we need to check.
            // Let's assume we need to check.
            if (this.pieceManager.isBlockRequested(index, block.begin)) continue

            peer.sendRequest(index, block.begin, block.length)
            peer.requestsPending++
            this.pieceManager?.addRequested(index, block.begin)
          }
        }
      }
    }
  }

  private async handlePiece(peer: PeerConnection, msg: WireMessage) {
    if (msg.index !== undefined && msg.begin !== undefined && msg.block) {
      // console.error(`Torrent: Received piece ${msg.index} begin ${msg.begin} `)
      if (peer.requestsPending > 0) peer.requestsPending--

      if (this.contentStorage) {
        await this.contentStorage.write(msg.index, msg.begin, msg.block)
      }

      this.pieceManager?.addReceived(msg.index, msg.begin)

      this.emit('download', msg.block.length)

      if (this.pieceManager?.isPieceComplete(msg.index)) {
        // Verify hash
        const isValid = await this.verifyPiece(msg.index)
        if (isValid) {
          this.logger.info(`Piece ${msg.index} verified and complete`)
          this.pieceManager?.markVerified(msg.index)
          this.emit('piece', msg.index)

          // Emit verified event for persistence
          if (this.bitfield) {
            this.emit('verified', {
              bitfield: this.bitfield.toHex(),
            })
          }

          // Send HAVE message to all peers
          for (const p of this.peers) {
            if (p.handshakeReceived) {
              p.sendHave(msg.index)
            }
          }

          this.checkCompletion()
        } else {
          this.logger.warn(`Piece ${msg.index} failed hash check`)
          this.pieceManager?.resetPiece(msg.index)
        }
      }

      // Continue requesting
      this.requestPieces(peer)
    }
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

    const hash = crypto.createHash('sha1').update(data).digest()

    // Compare
    return Buffer.compare(hash, expectedHash) === 0
  }
  async stop() {
    this.logger.info('Stopping')
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

  // Metadata Logic

  private requestMetadata(peer: PeerConnection) {
    if (this.metadataComplete) return
    // Request piece 0 first.
    // Block size is usually 16KB.
    // We don't know total size yet unless we parsed it from handshake.
    // Let's just request 0.
    if (!this.metadataPiecesReceived.has(0)) {
      peer.sendMetadataRequest(0)
    }
  }

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

  private handleMetadataData(
    peer: PeerConnection,
    piece: number,
    totalSize: number,
    data: Uint8Array,
  ) {
    if (this.metadataComplete) return

    if (this.metadataSize === null) {
      this.metadataSize = totalSize
      this.metadataBuffer = new Uint8Array(totalSize)
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
        this.verifyMetadata()
      } else {
        // Request next piece
        const nextPiece = piece + 1
        if (nextPiece < totalPieces && !this.metadataPiecesReceived.has(nextPiece)) {
          peer.sendMetadataRequest(nextPiece)
        }
      }
    }
  }

  private verifyMetadata() {
    if (!this.metadataBuffer) return

    // SHA1 hash of metadataBuffer should match infoHash
    const hash = crypto.createHash('sha1').update(this.metadataBuffer).digest()
    if (Buffer.compare(hash, this.infoHash) === 0) {
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
