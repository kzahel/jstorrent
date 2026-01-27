/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { ITcpSocket } from '../interfaces/socket'
import {
  PeerWireProtocol,
  MessageType,
  WireMessage,
  requestMessagePool,
} from '../protocol/wire-protocol'
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

  // Send queue for batching - flushed at end of tick
  private sendQueue: Uint8Array[] = []
  private sendQueueBytes = 0

  private send(data: Uint8Array) {
    // Queue for batched send at end of tick
    this.sendQueue.push(data)
    this.sendQueueBytes += data.length

    // Track bytes immediately (matches previous behavior)
    this.uploaded += data.length
    this.uploadSpeedCalculator.addBytes(data.length)
    this.emit('bytesUploaded', data.length)
  }

  /**
   * Flush all queued sends to the socket.
   * Called at end of tick to batch multiple small messages into one send.
   */
  flush(): void {
    if (this.sendQueue.length === 0) return

    if (this.sendQueue.length === 1) {
      // Single message - send directly, no concat needed
      this.socket.send(this.sendQueue[0])
    } else {
      // Multiple messages - concat into single buffer
      const combined = new Uint8Array(this.sendQueueBytes)
      let offset = 0
      for (const buf of this.sendQueue) {
        combined.set(buf, offset)
        offset += buf.length
      }
      this.socket.send(combined)
    }

    this.sendQueue = []
    this.sendQueueBytes = 0
  }

  /**
   * Get the socket ID for batch send operations.
   * Returns undefined if socket doesn't expose an ID.
   */
  getSocketId(): number | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.socket as any).id as number | undefined
  }

  /**
   * Get queued data for batch send operations.
   * Returns the combined buffer and clears the queue.
   */
  getQueuedData(): Uint8Array | null {
    if (this.sendQueue.length === 0) return null

    let result: Uint8Array
    if (this.sendQueue.length === 1) {
      result = this.sendQueue[0]
    } else {
      result = new Uint8Array(this.sendQueueBytes)
      let offset = 0
      for (const buf of this.sendQueue) {
        result.set(buf, offset)
        offset += buf.length
      }
    }

    this.sendQueue = []
    this.sendQueueBytes = 0
    return result
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

  /**
   * Bytes received since last drainBuffer() call.
   * Used by tick-aligned processing to defer stats/event emission until drain time.
   */
  private pendingBytes = 0

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

  /**
   * BEP 21: Peer indicated upload_only in extended handshake.
   * When true, peer won't request any pieces (they're seeding or in upload-only mode).
   */
  public peerUploadOnly = false

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
    // Use pooled buffer to avoid allocation in hot path
    const [buffer, view] = requestMessagePool.acquire(index, begin, length)
    this.send(buffer)
    // Release immediately - native side copies data synchronously
    requestMessagePool.release(buffer, view)
  }

  // Reusable batch buffer for sendRequests (grows as needed)
  private _batchBuffer: Uint8Array | null = null
  private _batchView: DataView | null = null

  /**
   * Send multiple REQUEST messages in a single batched write.
   * Reduces FFI overhead by combining many small messages into one send call.
   * Each request is 17 bytes: [4-byte length][1-byte type][12-byte payload]
   */
  sendRequests(requests: Array<{ index: number; begin: number; length: number }>) {
    if (requests.length === 0) return

    // Single request: use pooled buffer (no batch overhead)
    if (requests.length === 1) {
      const { index, begin, length } = requests[0]
      this.sendRequest(index, begin, length)
      return
    }

    const messageSize = 17 // 4 + 1 + 12
    const totalSize = requests.length * messageSize

    // Grow batch buffer if needed (reuse across calls)
    if (!this._batchBuffer || this._batchBuffer.length < totalSize) {
      // Round up to next power of 2 for efficient growth
      const newSize = Math.max(256, 1 << Math.ceil(Math.log2(totalSize)))
      this._batchBuffer = new Uint8Array(newSize)
      this._batchView = new DataView(this._batchBuffer.buffer)
    }

    const buffer = this._batchBuffer
    const view = this._batchView!

    // Fill buffer with all requests
    let offset = 0
    for (const { index, begin, length } of requests) {
      view.setUint32(offset, 13, false) // length = 13
      buffer[offset + 4] = MessageType.REQUEST
      view.setUint32(offset + 5, index, false)
      view.setUint32(offset + 9, begin, false)
      view.setUint32(offset + 13, length, false)
      offset += messageSize
    }

    // Send the exact portion used (create subarray view, no copy)
    this.send(buffer.subarray(0, totalSize))
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

  /**
   * Handle incoming data from socket.
   * Phase 1 tick-aligned processing: buffer only, defer processing to drainBuffer().
   * Stats and events are also deferred to avoid work during callbacks.
   *
   * Exception: If handshake hasn't been received, process immediately.
   * This is necessary because:
   * 1. Incoming connections need the handshake to be parsed before being assigned to a torrent
   * 2. Handshakes are small (68 bytes) and infrequent (once per connection)
   * 3. The tick-aligned optimization targets high-frequency PIECE messages, not handshakes
   *
   * Also processes immediately if engine.autoDrainBuffers is set (for tests).
   */
  private handleData(data: Uint8Array) {
    // O(1) push to chunked buffer - no copy
    this.buffer.push(data)
    this.pendingBytes += data.length

    // Process immediately if:
    // 1. Handshake not yet received (required for connection establishment)
    // 2. autoDrainBuffers is enabled (for tests)
    // Otherwise: wait for tick to call drainBuffer()
    if (!this.handshakeReceived || this.engine.autoDrainBuffers) {
      this.drainBuffer()
    }
  }

  /**
   * Drain the receive buffer and process accumulated data.
   * Called by tick loop to perform all processing at once.
   *
   * Phase 1 tick-aligned processing: all stats, events, and protocol
   * processing happen here instead of in handleData().
   */
  drainBuffer(): void {
    // Update stats for accumulated bytes
    if (this.pendingBytes > 0) {
      this.downloaded += this.pendingBytes
      this.downloadSpeedCalculator.addBytes(this.pendingBytes)
      this.emit('bytesDownloaded', this.pendingBytes)
      this.pendingBytes = 0
    }

    // Process protocol messages
    this.processBuffer()
  }

  /**
   * Get the number of bytes pending in the receive buffer.
   * Used for backpressure monitoring.
   */
  get bufferedBytes(): number {
    return this.buffer.length
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

      // BEP 21: Extract upload_only flag
      // Peer is seeding or in upload-only mode (won't request pieces)
      if (typeof dict.upload_only === 'number' && dict.upload_only !== 0) {
        this.peerUploadOnly = true
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
        upload_only: this.peerUploadOnly,
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
