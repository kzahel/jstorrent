import { PeerConnection } from './peer-connection'
import { BitField } from '../utils/bitfield'
import { MessageType, WireMessage } from '../protocol/wire-protocol'
import { toHex, compare } from '../utils/buffer'
import { peerKey, PeerAddress } from './swarm'
import { PexHandler } from '../extensions/pex-handler'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import type { PieceAvailability } from './piece-availability'
import type { MetadataFetcher } from './metadata-fetcher'
import type { ActivePieceManager } from './active-piece-manager'
import type { Swarm } from './swarm'
import type { TorrentUploader } from './torrent-uploader'
import type { BandwidthTracker } from './bandwidth-tracker'

/**
 * Callback interface for TorrentPeerHandler to communicate with Torrent.
 * This decouples the peer event handling from the Torrent class.
 */
export interface PeerHandlerCallbacks {
  // State queries
  isPrivate(): boolean
  isComplete(): boolean
  getPeerId(): Uint8Array
  getPiecesCount(): number
  getMetadataSize(): number | null
  getAdvertisedBitfield(): BitField | null

  // Managers
  getSwarm(): Swarm
  getAvailability(): PieceAvailability
  getMetadataFetcher(): MetadataFetcher
  getActivePieces(): ActivePieceManager | undefined
  getUploader(): TorrentUploader
  getBandwidthTracker(): BandwidthTracker

  // Callbacks
  onPeerRemoved(peer: PeerConnection): void
  onBytesDownloaded(bytes: number): void
  onBytesUploaded(bytes: number): void
  onBlock(peer: PeerConnection, msg: WireMessage): void
  onInterested(peer: PeerConnection): void
  buildPeerPieceIndex(peer: PeerConnection): void
  updateInterest(peer: PeerConnection): void
  shouldAddToIndex(pieceIndex: number): boolean
  fillPeerSlots(): void
}

/**
 * Handles wire protocol events for connected peers.
 *
 * This class is responsible for:
 * - Setting up event listeners on peer connections
 * - Handling handshake, bitfield, have, choke/unchoke, interested messages
 * - Coordinating with availability tracking and metadata fetching
 * - Managing PEX (peer exchange) for non-private torrents
 *
 * Extracted from Torrent class to reduce complexity and improve testability.
 */
export class TorrentPeerHandler extends EngineComponent {
  static logName = 'peer-handler'

  constructor(
    engineInstance: ILoggingEngine,
    private callbacks: PeerHandlerCallbacks,
  ) {
    super(engineInstance)
  }

  /**
   * Set up all event listeners for a peer connection.
   * This is called after a connection is established and before the handshake.
   */
  setupListeners(peer: PeerConnection): void {
    // BEP 11: Enable PEX for non-private torrents
    // PexHandler listens for extended messages and emits 'pex_peers' events
    if (!this.callbacks.isPrivate()) {
      new PexHandler(peer)
    }

    const onHandshake = (_infoHash: Uint8Array, peerId: Uint8Array, extensions: boolean) => {
      this.logger.debug('Handshake received')

      // Check for self-connection (our own peerId)
      if (compare(peerId, this.callbacks.getPeerId()) === 0) {
        this.logger.warn('Self-connection detected, closing peer')
        peer.close()
        return
      }

      // Update swarm with peer identity
      if (peer.remoteAddress && peer.remotePort) {
        const key = peerKey(peer.remoteAddress, peer.remotePort)
        // Note: clientName is null here - could be parsed from peerId later if needed
        this.callbacks.getSwarm().setIdentity(key, peerId, null)
      }

      if (extensions) {
        // BEP 21: Send upload_only: 1 when we're seeding (complete)
        // BEP 9: Send metadata_size when we have metadata
        peer.sendExtendedHandshake({
          uploadOnly: this.callbacks.isComplete(),
          metadataSize: this.callbacks.getMetadataSize() ?? undefined,
        })
      }

      // Send piece availability (BitField, Have All, or Have None)
      // BEP 6: Use Have All/Have None if peer supports Fast Extension
      const advertisedBitfield = this.callbacks.getAdvertisedBitfield()
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
      this.callbacks.onPeerRemoved(peer)
    })

    peer.on('close', () => {
      this.logger.debug('Peer closed')
      this.callbacks.onPeerRemoved(peer)
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
        this.callbacks.getSwarm().setIdentity(key, peer.peerId, clientName)
      }

      // Delegate metadata handling to the fetcher
      this.callbacks.getMetadataFetcher().onExtensionHandshake(peer)
    })

    peer.on('metadata_request', (piece) => {
      this.callbacks.getMetadataFetcher().onMetadataRequest(peer, piece)
    })

    peer.on('metadata_data', (piece, totalSize, data) => {
      this.callbacks.getMetadataFetcher().onMetadataData(peer, piece, totalSize, data)
    })

    peer.on('metadata_reject', (piece) => {
      this.callbacks.getMetadataFetcher().onMetadataReject(peer, piece)
    })

    peer.on('bitfield', (bf) => {
      this.handleBitfield(peer, bf)
    })

    // BEP 6 Fast Extension: Handle Have All
    peer.on('have_all', () => {
      this.handleHaveAll(peer)
    })

    // BEP 6 Fast Extension: Handle Have None
    peer.on('have_none', () => {
      this.handleHaveNone(peer)
    })

    peer.on('have', (index) => {
      this.handleHave(peer, index)
    })

    peer.on('unchoke', () => {
      this.logger.debug('Unchoke received')
      // Request pipeline filled by requestTick() game loop
    })

    peer.on('choke', () => {
      this.handleChoke(peer)
    })

    peer.on('interested', () => {
      this.logger.debug('Interested received')
      this.callbacks.onInterested(peer)
    })

    peer.on('not_interested', () => {
      this.logger.debug('Not interested received')
      // Peer no longer wants data - choke algorithm will handle slot reallocation
    })

    peer.on('message', (msg) => {
      if (msg.type === MessageType.PIECE) {
        this.callbacks.onBlock(peer, msg)
      }
    })

    peer.on('request', (index, begin, length) => {
      this.callbacks.getUploader().queueRequest(peer, index, begin, length)
    })

    peer.on('bytesDownloaded', (bytes) => {
      this.callbacks.onBytesDownloaded(bytes)
      this.callbacks.getBandwidthTracker().record('peer:protocol', bytes, 'down')
    })

    peer.on('bytesUploaded', (bytes) => {
      this.callbacks.onBytesUploaded(bytes)
      this.callbacks.getBandwidthTracker().record('peer:protocol', bytes, 'up')
    })

    // PEX: Listen for peers discovered via peer exchange
    // Note: pex_peers is emitted by PexHandler using (peer as any).emit()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(peer as any).on('pex_peers', (peers: PeerAddress[]) => {
      // BEP 27: Private torrents must not use PEX
      if (this.callbacks.isPrivate()) {
        return
      }
      const added = this.callbacks.getSwarm().addPeers(peers, 'pex')
      if (added > 0) {
        this.logger.debug(
          `Added ${added} PEX peers to swarm (total: ${this.callbacks.getSwarm().size})`,
        )
        // Try to fill peer slots with newly discovered peers
        this.callbacks.fillPeerSlots()
      }
    })
  }

  /**
   * Handle bitfield message from peer.
   */
  private handleBitfield(peer: PeerConnection, bf: BitField): void {
    this.logger.debug('Bitfield received')

    const availability = this.callbacks.getAvailability()
    const piecesCount = this.callbacks.getPiecesCount()

    // Update availability tracking
    const result = availability.onBitfield(bf, piecesCount)
    peer.haveCount = result.haveCount
    peer.isSeed = result.isSeed

    if (peer.isSeed) {
      this.logger.debug(`Peer is a seed (seedCount: ${availability.seedCount})`)
    }

    // Phase 8: Build peer piece index for non-seeds
    this.callbacks.buildPeerPieceIndex(peer)

    // Update interest
    this.callbacks.updateInterest(peer)
  }

  /**
   * Handle HAVE_ALL message (BEP 6 Fast Extension).
   */
  private handleHaveAll(peer: PeerConnection): void {
    this.logger.debug('Have All received (peer is a seeder)')

    const piecesCount = this.callbacks.getPiecesCount()
    const availability = this.callbacks.getAvailability()

    // If we don't have metadata yet, defer creating the bitfield
    // recheckPeers() will handle it when metadata arrives
    if (piecesCount === 0) {
      this.logger.debug('Deferring have_all - no metadata yet')
      peer.deferredHaveAll = true
      return
    }

    // Create a full bitfield for the peer
    peer.bitfield = BitField.createFull(piecesCount)
    peer.haveCount = piecesCount
    peer.isSeed = true

    // Seeds are tracked separately - don't add to per-piece availability
    availability.onHaveAll()
    this.logger.debug(`Peer is a seed via HAVE_ALL (seedCount: ${availability.seedCount})`)

    // Update interest
    this.callbacks.updateInterest(peer)
  }

  /**
   * Handle HAVE_NONE message (BEP 6 Fast Extension).
   */
  private handleHaveNone(peer: PeerConnection): void {
    this.logger.debug('Have None received (peer has no pieces)')

    const piecesCount = this.callbacks.getPiecesCount()

    // Create an empty bitfield for the peer
    peer.bitfield = BitField.createEmpty(piecesCount)

    // No availability updates needed - peer has nothing
    // Update interest (we won't be interested)
    this.callbacks.updateInterest(peer)
  }

  /**
   * Handle HAVE message from peer.
   */
  private handleHave(peer: PeerConnection, index: number): void {
    this.logger.debug(`Have received ${index}`)

    // If peer is already a seed, shouldn't receive HAVE messages
    if (peer.isSeed) {
      this.logger.warn(`Received HAVE from peer already marked as seed`)
      return
    }

    const availability = this.callbacks.getAvailability()
    const piecesCount = this.callbacks.getPiecesCount()
    const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`

    const result = availability.onHave(peerId, index, piecesCount, peer.haveCount, peer.bitfield)

    // Update peer state
    peer.haveCount++
    if (result.becameSeed) {
      peer.isSeed = true
      this.logger.debug(
        `Peer converted to seed via HAVE messages (seedCount: ${availability.seedCount})`,
      )
    } else if (this.callbacks.shouldAddToIndex(index)) {
      // Add piece to peer's index if we need it
      availability.addPieceToIndex(peerId, index)
    }

    this.callbacks.updateInterest(peer)
  }

  /**
   * Handle CHOKE message from peer.
   */
  private handleChoke(peer: PeerConnection): void {
    this.logger.debug('Choke received')

    // Peer has discarded all our pending requests per BitTorrent spec
    const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
    const activePieces = this.callbacks.getActivePieces()
    const cleared = activePieces?.clearRequestsForPeer(peerId) || 0

    peer.requestsPending = 0 // Critical: reset so we can request again after unchoke
    // Reduce pipeline depth - choke is a congestion signal
    peer.reduceDepth()

    if (cleared > 0) {
      this.logger.debug(`Cleared ${cleared} tracked requests after choke`)
    }
  }
}
