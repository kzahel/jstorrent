/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { ITcpSocket } from '../interfaces/socket'
import { PeerWireProtocol, MessageType, WireMessage } from '../protocol/wire-protocol'
import { BitField } from '../utils/bitfield'
import { Bencode } from '../utils/bencode'
import { toHex } from '../utils/buffer'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import { SpeedCalculator } from '../utils/speed-calculator'
import { ChunkedBuffer } from './chunked-buffer'

export interface PeerConnection {
  on(event: 'connect', listener: () => void): this
  on(event: 'close', listener: (hadError: boolean) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(
    event: 'handshake',
    listener: (infoHash: Uint8Array, peerId: Uint8Array, extensions: boolean) => void,
  ): this
  on(event: 'message', listener: (message: WireMessage) => void): this
  on(event: 'bitfield', listener: (bitfield: BitField) => void): this
  on(event: 'have_all', listener: () => void): this
  on(event: 'have_none', listener: () => void): this
  on(event: 'have', listener: (index: number) => void): this
  on(event: 'choke', listener: () => void): this
  on(event: 'unchoke', listener: () => void): this
  on(event: 'extended', listener: (id: number, payload: Uint8Array) => void): this
  on(event: 'request', listener: (index: number, begin: number, length: number) => void): this
  on(event: 'piece', listener: (index: number, begin: number, data: Uint8Array) => void): this
  on(event: 'cancel', listener: (index: number, begin: number, length: number) => void): this
  on(event: 'interested', listener: () => void): this
  on(event: 'not_interested', listener: () => void): this
  on(event: 'extension_handshake', listener: (payload: Record<string, unknown>) => void): this
  on(event: 'metadata_request', listener: (piece: number) => void): this
  on(
    event: 'metadata_data',
    listener: (piece: number, totalSize: number, data: Uint8Array) => void,
  ): this
  on(event: 'metadata_reject', listener: (piece: number) => void): this
  on(event: 'bytesDownloaded', listener: (bytes: number) => void): this
  on(event: 'bytesUploaded', listener: (bytes: number) => void): this

  close(): void
}

export class PeerConnection extends EngineComponent {
  static logName = 'peer'

  private socket: ITcpSocket
  private buffer = new ChunkedBuffer()
  public handshakeReceived = false

  private send(data: Uint8Array) {
    this.socket.send(data)
    this.uploaded += data.length
    this.uploadSpeedCalculator.addBytes(data.length)
    this.emit('bytesUploaded', data.length)
  }

  public peerChoking = true
  public peerInterested = false
  public amChoking = true
  public amInterested = false
  public peerExtensions = false
  public peerFastExtension = false // BEP 6 Fast Extension support
  public requestsPending = 0 // Number of outstanding requests

  // Adaptive pipeline depth - starts conservative, ramps up for fast peers
  public pipelineDepth = 50 // Current allowed depth (5-500), starts higher for faster initial fill
  private blockCount = 0 // Blocks received since last rate check
  private lastRateCheckTime = 0 // Timestamp of last rate calculation
  private static readonly RATE_CHECK_INTERVAL = 1000 // Check rate every 1 second
  private static readonly MAX_PIPELINE_DEPTH = 500
  private static readonly MIN_PIPELINE_DEPTH = 5
  public peerMetadataId: number | null = null
  public peerMetadataSize: number | null = null
  public myMetadataId = 1 // Our ID for ut_metadata

  public uploaded = 0
  public downloaded = 0
  public uploadSpeedCalculator = new SpeedCalculator()
  public downloadSpeedCalculator = new SpeedCalculator()

  /** Timestamp when this connection was established */
  public connectedAt: number = Date.now()

  public peerId: Uint8Array | undefined = undefined
  public infoHash: Uint8Array | undefined = undefined
  public bitfield: BitField | null = null
  public remoteAddress?: string
  public remotePort?: number
  public isIncoming = false

  /** BEP 6: Peer sent HAVE_ALL before we had metadata to create bitfield */
  public deferredHaveAll = false

  /**
   * Whether this peer is a seed (has all pieces).
   * Seeds are tracked separately in Torrent._seedCount to avoid O(pieces)
   * availability updates on connect/disconnect.
   */
  public isSeed = false

  /**
   * Number of pieces this peer has (popcount of bitfield).
   * Used to detect when a peer becomes a seed via HAVE messages.
   */
  public haveCount = 0

  /** Whether this connection is encrypted (MSE/PE) */
  get isEncrypted(): boolean {
    return this.socket.isEncrypted ?? false
  }

  constructor(
    engine: ILoggingEngine,
    socket: ITcpSocket,
    options?: { remoteAddress?: string; remotePort?: number },
  ) {
    super(engine)
    this.socket = socket
    if (options) {
      this.remoteAddress = options.remoteAddress
      this.remotePort = options.remotePort
    }

    this.socket.onData((data) => this.handleData(data))
    // Assuming ITcpSocket will be updated to support these or we wrap it
    if (this.socket.onClose) this.socket.onClose((hadError) => this.emit('close', hadError))
    if (this.socket.onError) this.socket.onError((err) => this.emit('error', err))
  }

  connect(port: number, host: string): Promise<void> {
    if (this.socket.connect) {
      return this.socket.connect(port, host)
    }
    return Promise.reject(new Error('Socket does not support connect'))
  }

  sendHandshake(infoHash: Uint8Array, peerId: Uint8Array, extensions: boolean = true) {
    const handshake = PeerWireProtocol.createHandshake(infoHash, peerId, {
      extensions,
      fastExtension: true,
    })
    this.send(handshake)
  }

  sendMessage(type: MessageType, payload?: Uint8Array) {
    const message = PeerWireProtocol.createMessage(type, payload)
    this.send(message)
  }

  sendRequest(index: number, begin: number, length: number) {
    const message = PeerWireProtocol.createRequest(index, begin, length)
    this.send(message)
  }

  sendCancel(index: number, begin: number, length: number) {
    const message = PeerWireProtocol.createCancel(index, begin, length)
    this.send(message)
  }

  sendHave(index: number) {
    // HAVE message payload is just the index (4 bytes)
    const payload = new Uint8Array(4)
    const view = new DataView(payload.buffer)
    view.setUint32(0, index, false)
    this.sendMessage(MessageType.HAVE, payload)
  }

  sendPiece(index: number, begin: number, block: Uint8Array) {
    const payload = new Uint8Array(8 + block.length)
    const view = new DataView(payload.buffer)
    view.setUint32(0, index, false)
    view.setUint32(4, begin, false)
    payload.set(block, 8)
    this.sendMessage(MessageType.PIECE, payload)
  }

  sendExtendedMessage(id: number, payload: Uint8Array) {
    const message = PeerWireProtocol.createExtendedMessage(id, payload)
    this.send(message)
  }

  // Our local extension IDs (peers use these when sending to us)
  readonly myPexId = 2

  sendExtendedHandshake(options: { uploadOnly?: boolean; metadataSize?: number } = {}) {
    // Build extension handshake dictionary
    // BEP 10: { m: { ut_metadata: 1, ut_pex: 2 } }
    // BEP 9: Add metadata_size when we have metadata
    // BEP 21: Add upload_only: 1 when seeding
    // Note: bencode requires sorted keys alphabetically
    // Keys in order: m, metadata_size, upload_only
    const mDict = `1:md11:ut_metadatai${this.myMetadataId}e6:ut_pexi${this.myPexId}ee`
    const metadataSizePart = options.metadataSize ? `13:metadata_sizei${options.metadataSize}e` : ''
    const uploadOnlyPart = options.uploadOnly ? `11:upload_onlyi1e` : ''
    const payload = `d${mDict}${metadataSizePart}${uploadOnlyPart}e`
    this.sendExtendedMessage(0, new TextEncoder().encode(payload))
  }

  /**
   * Send BEP 6 Have All message (we have all pieces).
   * Only valid if both peers support Fast Extension.
   */
  sendHaveAll() {
    this.sendMessage(MessageType.HAVE_ALL)
  }

  /**
   * Send BEP 6 Have None message (we have no pieces).
   * Only valid if both peers support Fast Extension.
   */
  sendHaveNone() {
    this.sendMessage(MessageType.HAVE_NONE)
  }

  sendMetadataRequest(piece: number) {
    if (this.peerMetadataId === null) return
    const msg = PeerWireProtocol.createMetadataRequest(this.peerMetadataId, piece)
    this.send(msg)
  }

  sendMetadataData(piece: number, totalSize: number, data: Uint8Array) {
    if (this.peerMetadataId === null) return
    const msg = PeerWireProtocol.createMetadataData(this.peerMetadataId, piece, totalSize, data)
    this.send(msg)
  }

  sendMetadataReject(piece: number) {
    if (this.peerMetadataId === null) return
    const msg = PeerWireProtocol.createMetadataReject(this.peerMetadataId, piece)
    this.send(msg)
  }

  close() {
    this.socket.close()
  }

  private handleData(data: Uint8Array) {
    // this.logger.debug(`Received ${data.length} bytes`)
    // O(1) push to chunked buffer - no copy
    this.buffer.push(data)

    this.downloaded += data.length
    this.downloadSpeedCalculator.addBytes(data.length)
    this.emit('bytesDownloaded', data.length)

    this.processBuffer()
  }

  private processBuffer() {
    if (!this.handshakeReceived) {
      // Need 68 bytes for handshake
      const handshakeBytes = this.buffer.peekBytes(0, 68)
      if (!handshakeBytes) {
        return // Wait for more data
      }

      const result = PeerWireProtocol.parseHandshake(handshakeBytes)
      if (result) {
        this.handshakeReceived = true
        this.infoHash = result.infoHash
        this.peerId = result.peerId
        this.peerExtensions = result.extensions
        this.peerFastExtension = result.fastExtension
        // this.logger.debug('Handshake parsed, extensions:', this.peerExtensions, 'fast:', this.peerFastExtension)
        this.buffer.discard(68)
        this.emit('handshake', this.infoHash, this.peerId, this.peerExtensions)
        // Continue processing in case there are more messages
      } else {
        return // Wait for more data
      }
    }

    while (this.buffer.length > 4) {
      const length = this.buffer.peekUint32(0)
      if (length === null) break

      const totalLength = 4 + length
      if (this.buffer.length < totalLength) break

      const message = this.buffer.consume(totalLength)
      try {
        const msg = PeerWireProtocol.parseMessage(message)
        if (msg) {
          this.handleMessage(msg)
        }
      } catch (err) {
        this.logger.error('Error parsing message:', { err })
        this.close()
        return
      }
    }
  }

  private handleMessage(message: WireMessage) {
    this.emit('message', message)

    switch (message.type) {
      case MessageType.CHOKE:
        this.peerChoking = true
        this.emit('choke')
        break
      case MessageType.UNCHOKE:
        this.peerChoking = false
        this.emit('unchoke')
        break
      case MessageType.INTERESTED:
        this.peerInterested = true
        this.emit('interested')
        break
      case MessageType.NOT_INTERESTED:
        this.peerInterested = false
        this.emit('not_interested')
        break
      case MessageType.HAVE:
        // Only emit if this is new information (avoid double-counting in availability)
        if (message.index !== undefined && this.bitfield && !this.bitfield.get(message.index)) {
          this.bitfield.set(message.index, true)
          this.emit('have', message.index)
        }
        break
      case MessageType.BITFIELD:
        if (message.payload) {
          this.bitfield = new BitField(message.payload)
          this.emit('bitfield', this.bitfield)
        }
        break
      case MessageType.HAVE_ALL:
        // BEP 6: Peer has all pieces. Emit event for torrent to create bitfield.
        // Only valid if peer supports Fast Extension (already verified by message receipt).
        this.emit('have_all')
        break
      case MessageType.HAVE_NONE:
        // BEP 6: Peer has no pieces. Emit event for torrent to create empty bitfield.
        this.emit('have_none')
        break
      case MessageType.EXTENDED:
        // this.logger.debug(
        //   'Handling EXTENDED message',
        //   message.extendedId,
        //   message.extendedPayload?.length,
        // )
        if (message.extendedId !== undefined && message.extendedPayload) {
          // Always emit 'extended' event so extensions (like PexHandler) can process it
          this.emit('extended', message.extendedId, message.extendedPayload)

          if (message.extendedId === 0) {
            // Extended Handshake
            this.handleExtendedHandshake(message.extendedPayload)
          } else {
            // Handle metadata messages - peer uses OUR ID (myMetadataId) when sending to us
            if (message.extendedId === this.myMetadataId) {
              this.handleMetadataMessage(message.extendedPayload)
            }
          }
        }
        break
      case MessageType.REQUEST:
        if (
          message.index !== undefined &&
          message.begin !== undefined &&
          message.length !== undefined
        ) {
          this.emit('request', message.index, message.begin, message.length)
        }
        break
      case MessageType.PIECE:
        if (message.index !== undefined && message.begin !== undefined && message.payload) {
          this.emit('piece', message.index, message.begin, message.payload)
        }
        break
      case MessageType.CANCEL:
        if (
          message.index !== undefined &&
          message.begin !== undefined &&
          message.length !== undefined
        ) {
          this.emit('cancel', message.index, message.begin, message.length)
        }
        break
    }
  }

  private handleExtendedHandshake(payload: Uint8Array) {
    try {
      const dict = Bencode.decode(payload) as Record<string, unknown>
      this.logger.debug('Extended Handshake payload:', dict)

      // BEP 52: info_hash2 presence means we connected with truncated v2 hash
      // This happens when we accidentally use the first 20 bytes of a v2 SHA256 hash
      // instead of the proper v1 SHA1 hash. Piece indices won't align, so disconnect.
      if (dict.info_hash2 instanceof Uint8Array && dict.info_hash2.length === 32) {
        const fullV2Hex = toHex(dict.info_hash2)
        const truncatedHex = toHex(dict.info_hash2.slice(0, 20))

        this.logger.warn(
          `Connected with truncated v2 info hash to hybrid torrent. ` +
            `Piece indices will not align - disconnecting. ` +
            `Full v2 hash: ${fullV2Hex}, truncated (what we used): ${truncatedHex}. ` +
            `Use the v1 info hash instead.`,
        )

        this.close()
        return // Don't emit extension_handshake or continue processing
      }

      // Extract ut_metadata ID from 'm' dictionary
      if (dict.m && typeof dict.m === 'object') {
        const m = dict.m as Record<string, unknown>
        if (typeof m.ut_metadata === 'number') {
          this.peerMetadataId = m.ut_metadata
        }
      }

      if (this.peerMetadataId === null) {
        this.logger.warn('Peer does not support ut_metadata')
      }

      // Extract metadata_size
      if (typeof dict.metadata_size === 'number') {
        this.peerMetadataSize = dict.metadata_size
      }

      // Extract client version from 'v' field (BEP 10)
      let clientName: string | null = null
      if (dict.v) {
        if (dict.v instanceof Uint8Array) {
          clientName = new TextDecoder('utf-8', { fatal: false }).decode(dict.v)
        } else if (typeof dict.v === 'string') {
          clientName = dict.v
        }
        if (clientName && clientName.length > 64) {
          clientName = clientName.slice(0, 64)
        }
      }

      this.emit('extension_handshake', {
        m: dict.m,
        v: clientName,
        metadata_size: dict.metadata_size,
      })
    } catch (err) {
      this.logger.error('Error parsing extended handshake', { err })
    }
  }

  private handleMetadataMessage(payload: Uint8Array) {
    try {
      // Payload is bencoded dictionary + optional data
      // d8:msg_typei{type}e5:piecei{piece}e...e + data

      // Find end of dictionary 'ee'
      // This is tricky without a real decoder.
      // But for the specific messages we expect:
      // REQUEST: d8:msg_typei0e5:piecei{piece}ee
      // REJECT: d8:msg_typei2e5:piecei{piece}ee
      // DATA: d8:msg_typei1e5:piecei{piece}e10:total_sizei{size}ee...data...

      const str = new TextDecoder().decode(payload)
      this.logger.debug(`Received metadata message: ${str.substring(0, 100)}...`)
      const typeMatch = str.match(/msg_typei(\d+)e/)
      const pieceMatch = str.match(/piecei(\d+)e/)

      if (typeMatch && pieceMatch) {
        const type = parseInt(typeMatch[1], 10)
        const piece = parseInt(pieceMatch[1], 10)

        if (type === 0) {
          // REQUEST
          this.emit('metadata_request', piece)
        } else if (type === 2) {
          // REJECT
          this.emit('metadata_reject', piece)
        } else if (type === 1) {
          // DATA
          const sizeMatch = str.match(/total_sizei(\d+)e/)
          if (sizeMatch) {
            const totalSize = parseInt(sizeMatch[1], 10)
            // We need to find where the dictionary ends to get the data
            // The dictionary ends with 'ee'.
            // But 'ee' might appear in other places? No, integers end with 'e'.
            // The outer dictionary ends with 'e'.
            // Let's assume the dictionary is contiguous at the start.
            // We can find the last 'ee' that closes the dictionary?
            // Or just scan for 'ee' after the known keys?

            // Hacky way: find the index of "total_sizei...e" and then the next "e"
            const sizeIndex = str.indexOf(`total_sizei${totalSize}e`)
            const dictEnd = str.indexOf('e', sizeIndex + `total_sizei${totalSize}e`.length) + 1

            // The data starts after dictEnd
            const data = payload.slice(dictEnd)
            this.emit('metadata_data', piece, totalSize, data)
          }
        }
      }
    } catch (err) {
      this.logger.error('Error parsing metadata message', { err })
    }
  }

  get uploadSpeed(): number {
    return this.uploadSpeedCalculator.getSpeed()
  }

  get downloadSpeed(): number {
    return this.downloadSpeedCalculator.getSpeed()
  }

  // === Phase 4: Speed Affinity ===

  /**
   * Default piece length for isFast calculation.
   * This is set by the Torrent when the peer is added.
   * Used to calculate if the peer can finish a piece in under 30 seconds.
   */
  private _pieceLength: number = 262144 // Default 256KB

  /**
   * Set the piece length for speed calculations.
   * Called by Torrent when adding the peer.
   */
  setPieceLength(length: number): void {
    this._pieceLength = length
  }

  /**
   * Check if this peer is "fast" - can finish a piece in under 30 seconds.
   *
   * Fast peers are given exclusive ownership of pieces to prevent fragmentation
   * (where fast and slow peers share a piece, causing the fast peer to wait).
   *
   * Matches libtorrent behavior from piece_picker.cpp:2596-2639
   */
  get isFast(): boolean {
    const speed = this.downloadSpeed
    if (speed <= 0) return false

    // Time to finish a piece at current speed
    const secondsToFinish = this._pieceLength / speed
    return secondsToFinish < 30
  }

  /**
   * Record a block received from this peer. Adjusts pipeline depth based on
   * response rate - fast peers get more requests, slow peers get fewer.
   * O(1) - only recalculates rate every RATE_CHECK_INTERVAL ms.
   */
  recordBlockReceived(): void {
    this.blockCount++

    const now = Date.now()
    const elapsed = now - this.lastRateCheckTime

    // Only check rate periodically to avoid overhead
    if (elapsed >= PeerConnection.RATE_CHECK_INTERVAL) {
      const rate = (this.blockCount * 1000) / elapsed // blocks per second

      // Adjust depth based on rate (aggressive ramp-up for game loop tick model)
      if (rate > 10) {
        // Fast peer - increase depth aggressively (+50/sec to reach 500 in ~9s)
        this.pipelineDepth = Math.min(PeerConnection.MAX_PIPELINE_DEPTH, this.pipelineDepth + 50)
      } else if (rate < 2 && this.pipelineDepth > 50) {
        // Slow peer - decrease depth gradually
        this.pipelineDepth = Math.max(50, this.pipelineDepth - 10)
      }

      // Reset counters
      this.blockCount = 0
      this.lastRateCheckTime = now
    }
  }

  /**
   * Reduce pipeline depth - called on choke as a congestion signal.
   * Uses multiplicative decrease (halve) for faster recovery from congestion.
   */
  reduceDepth(): void {
    this.pipelineDepth = Math.max(
      PeerConnection.MIN_PIPELINE_DEPTH,
      Math.floor(this.pipelineDepth / 2),
    )
    this.blockCount = 0
    this.lastRateCheckTime = Date.now()
  }
}
