/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { PeerConnection } from './peer-connection'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import { compare } from '../utils/buffer'

/**
 * BEP 9 metadata (info dictionary) fetcher.
 *
 * Handles fetching the info dictionary from peers for magnet links.
 * Each peer's metadata is fetched independently and verified against
 * the expected info hash before being accepted.
 *
 * Events:
 * - 'metadata': Emitted with the verified info buffer when metadata is complete
 */
export class MetadataFetcher extends EngineComponent {
  static override logName = 'metadata'

  /** BEP 9 metadata block size (16 KiB) */
  private static readonly BLOCK_SIZE = 16 * 1024

  /** Per-peer metadata piece buffers */
  private peerBuffers = new Map<PeerConnection, (Uint8Array | null)[]>()

  /** Expected total metadata size (from first peer's extension handshake) */
  private _metadataSize: number | null = null

  /** Whether we have verified complete metadata */
  private _complete = false

  /** The verified info dictionary buffer */
  private _buffer: Uint8Array | null = null

  /** Expected info hash for verification */
  private readonly _expectedInfoHash: Uint8Array

  /** SHA1 hasher function */
  private readonly sha1: (data: Uint8Array) => Promise<Uint8Array>

  constructor(config: {
    engine: ILoggingEngine
    infoHash: Uint8Array
    sha1: (data: Uint8Array) => Promise<Uint8Array>
  }) {
    super(config.engine)
    this._expectedInfoHash = config.infoHash
    // Set inherited infoHash for logging context
    this.infoHash = config.infoHash
    this.sha1 = config.sha1
  }

  // === Public getters ===

  get metadataSize(): number | null {
    return this._metadataSize
  }

  get isComplete(): boolean {
    return this._complete
  }

  get buffer(): Uint8Array | null {
    return this._buffer
  }

  // === External metadata (from .torrent file or restored state) ===

  /**
   * Set metadata from an external source (e.g., .torrent file or session restore).
   * Skips verification since the source is trusted.
   */
  setMetadata(infoBuffer: Uint8Array): void {
    this._buffer = infoBuffer
    this._complete = true
    this._metadataSize = infoBuffer.length
  }

  // === Peer event handlers ===

  /**
   * Handle extension handshake from a peer.
   * If we need metadata and peer supports ut_metadata, request all pieces.
   */
  onExtensionHandshake(peer: PeerConnection): void {
    this.logger.debug(
      `Extension handshake. complete=${this._complete}, peerMetadataId=${peer.peerMetadataId}`,
    )

    if (this._complete) {
      this.logger.debug('Already have metadata, not requesting')
      return
    }

    if (peer.peerMetadataId === null) {
      this.logger.warn('Peer does not support ut_metadata extension')
      return
    }

    if (!peer.peerMetadataSize) {
      this.logger.warn('Peer supports ut_metadata but did not send metadata_size')
      return
    }

    // Set or validate metadata size
    if (this._metadataSize === null) {
      this._metadataSize = peer.peerMetadataSize
    } else if (this._metadataSize !== peer.peerMetadataSize) {
      this.logger.warn(
        `Peer metadata size ${peer.peerMetadataSize} differs from expected ${this._metadataSize}`,
      )
      return
    }

    // Create per-peer buffer and request ALL pieces upfront (pipelined)
    const totalPieces = Math.ceil(this._metadataSize / MetadataFetcher.BLOCK_SIZE)
    this.peerBuffers.set(peer, new Array(totalPieces).fill(null))
    for (let i = 0; i < totalPieces; i++) {
      peer.sendMetadataRequest(i)
    }
    this.logger.info(`Requesting ${totalPieces} metadata pieces from peer`)
  }

  /**
   * Handle metadata request from a peer (they want our metadata).
   */
  onMetadataRequest(peer: PeerConnection, piece: number): void {
    if (!this._buffer) {
      peer.sendMetadataReject(piece)
      return
    }

    const start = piece * MetadataFetcher.BLOCK_SIZE
    if (start >= this._buffer.length) {
      peer.sendMetadataReject(piece)
      return
    }

    const end = Math.min(start + MetadataFetcher.BLOCK_SIZE, this._buffer.length)
    const data = this._buffer.slice(start, end)
    peer.sendMetadataData(piece, this._buffer.length, data)
  }

  /**
   * Handle metadata data from a peer.
   */
  async onMetadataData(
    peer: PeerConnection,
    piece: number,
    totalSize: number,
    data: Uint8Array,
  ): Promise<void> {
    this.logger.info(
      `Received metadata piece ${piece}, totalSize=${totalSize}, dataLen=${data.length}`,
    )
    if (this._complete) return

    // Get this peer's buffer
    const peerBuffer = this.peerBuffers.get(peer)
    if (!peerBuffer) {
      this.logger.warn('Received metadata from peer we are not tracking')
      return
    }

    // Validate size matches
    if (this._metadataSize !== totalSize) {
      this.logger.error(`Metadata size mismatch: expected ${this._metadataSize}, got ${totalSize}`)
      this.peerBuffers.delete(peer)
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

  /**
   * Handle metadata reject from a peer.
   */
  onMetadataReject(_peer: PeerConnection, piece: number): void {
    this.logger.warn(`Metadata piece ${piece} rejected by peer`)
  }

  /**
   * Clean up when a peer disconnects.
   */
  onPeerDisconnected(peer: PeerConnection): void {
    this.peerBuffers.delete(peer)
  }

  // === Private methods ===

  private async verifyPeerMetadata(peer: PeerConnection, pieces: Uint8Array[]): Promise<void> {
    if (this._complete) return

    // Concatenate all pieces into full metadata buffer
    const totalSize = this._metadataSize!
    const fullBuffer = new Uint8Array(totalSize)
    let offset = 0
    for (const piece of pieces) {
      fullBuffer.set(piece, offset)
      offset += piece.length
    }

    // SHA1 hash should match infoHash
    const hash = await this.sha1(fullBuffer)
    if (compare(hash, this._expectedInfoHash) === 0) {
      this.logger.info('Metadata verified successfully!')
      this._complete = true
      this._buffer = fullBuffer
      // Clean up all peer metadata buffers
      this.peerBuffers.clear()
      this.emit('metadata', fullBuffer)
    } else {
      this.logger.warn(
        `Metadata hash mismatch from peer - sent info dict that doesn't match expected hash. ` +
          `This could be: (1) peer sent invalid/corrupted data, or ` +
          `(2) you connected with a truncated v2 info hash to a hybrid torrent ` +
          `(use the v1 SHA-1 hash instead). Discarding this peer's metadata.`,
      )
      // Just remove this peer's buffer, other peers may still succeed
      this.peerBuffers.delete(peer)
    }
  }
}

// Type augmentation for events
export interface MetadataFetcher {
  on(event: 'metadata', listener: (buffer: Uint8Array) => void): this
  emit(event: 'metadata', buffer: Uint8Array): boolean
}
