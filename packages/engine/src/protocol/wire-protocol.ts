export enum MessageType {
  CHOKE = 0,
  UNCHOKE = 1,
  INTERESTED = 2,
  NOT_INTERESTED = 3,
  HAVE = 4,
  BITFIELD = 5,
  REQUEST = 6,
  PIECE = 7,
  CANCEL = 8,
  // BEP 6 Fast Extension messages
  HAVE_ALL = 0x0e,
  HAVE_NONE = 0x0f,
  EXTENDED = 20,
  KEEP_ALIVE = -1, // Internal representation
  HANDSHAKE = -2, // Internal representation
}

export enum MetadataMsgType {
  REQUEST = 0,
  DATA = 1,
  REJECT = 2,
}

export const EXTENDED_HANDSHAKE_ID = 0

export interface WireMessage {
  type: MessageType
  payload?: Uint8Array
  // Specific fields for convenience
  index?: number
  begin?: number
  length?: number
  block?: Uint8Array
  extendedId?: number
  extendedPayload?: Uint8Array
}

export class PeerWireProtocol {
  static parseHandshake(buffer: Uint8Array): {
    infoHash: Uint8Array
    peerId: Uint8Array
    protocol: string
    extensions: boolean
    fastExtension: boolean
  } | null {
    if (buffer.length < 68) {
      // console.error(`PeerWireProtocol: buffer too short ${buffer.length}`)
      // console.error('Buffer:', buffer)
      return null
    }
    // console.error('Buffer start:', buffer.slice(0, 20))
    const pstrlen = buffer[0]
    if (pstrlen !== 19) {
      return null
    }

    const pstr = new TextDecoder().decode(buffer.slice(1, 20))
    if (pstr !== 'BitTorrent protocol') {
      return null
    }

    // 8 reserved bytes at offset 20
    const reserved = buffer.slice(20, 28)
    const extensions = !!(reserved[5] & 0x10) // BEP 10 Extension Protocol
    const fastExtension = !!(reserved[7] & 0x04) // BEP 6 Fast Extension

    const infoHash = buffer.slice(28, 48)
    const peerId = buffer.slice(48, 68)

    return { infoHash, peerId, protocol: pstr, extensions, fastExtension }
  }

  static createHandshake(
    infoHash: Uint8Array,
    peerId: Uint8Array,
    options: { extensions?: boolean; fastExtension?: boolean } = {},
  ): Uint8Array {
    const { extensions = true, fastExtension = true } = options
    const buffer = new Uint8Array(68)
    buffer[0] = 19
    buffer.set(new TextEncoder().encode('BitTorrent protocol'), 1)
    // Reserved bytes (zeroed by default)
    if (extensions) {
      buffer[25] |= 0x10 // BEP 10 Extension Protocol
    }
    if (fastExtension) {
      buffer[27] |= 0x04 // BEP 6 Fast Extension
    }
    buffer.set(infoHash, 28)
    buffer.set(peerId, 48)
    return buffer
  }

  // ... (parseMessage remains mostly same, maybe add EXTENDED case)

  static parseMessage(buffer: Uint8Array): WireMessage | null {
    if (buffer.length < 4) return null // Need at least length prefix

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    const length = view.getUint32(0, false) // Big-endian

    if (length === 0) {
      return { type: MessageType.KEEP_ALIVE }
    }

    if (buffer.length < 4 + length) return null // Incomplete message

    const id = buffer[4]
    const payload = buffer.slice(5, 4 + length)

    // require('fs').appendFileSync('debug.log', `PeerWireProtocol: Parsing message id=${id} len=${length}\n`)

    const message: WireMessage = { type: id, payload }

    // Parse specific messages
    const payloadView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)

    switch (id) {
      case MessageType.HAVE:
        if (payload.length >= 4) message.index = payloadView.getUint32(0, false)
        break
      case MessageType.REQUEST:
      case MessageType.CANCEL:
        if (payload.length >= 12) {
          message.index = payloadView.getUint32(0, false)
          message.begin = payloadView.getUint32(4, false)
          message.length = payloadView.getUint32(8, false)
        }
        break
      case MessageType.PIECE:
        if (payload.length >= 8) {
          message.index = payloadView.getUint32(0, false)
          message.begin = payloadView.getUint32(4, false)
          message.block = payload.slice(8)
        }
        break
      case MessageType.EXTENDED:
        if (payload.length >= 1) {
          message.extendedId = payload[0]
          message.extendedPayload = payload.slice(1)
        }
        break
    }

    return message
  }

  static createMessage(type: MessageType, payload?: Uint8Array): Uint8Array {
    if (type === MessageType.KEEP_ALIVE) {
      return new Uint8Array(4) // 00 00 00 00
    }

    const length = 1 + (payload ? payload.length : 0)
    const buffer = new Uint8Array(4 + length)
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

    view.setUint32(0, length, false)
    buffer[4] = type

    if (payload) {
      buffer.set(payload, 5)
    }

    return buffer
  }

  static createRequest(index: number, begin: number, length: number): Uint8Array {
    const payload = new Uint8Array(12)
    const view = new DataView(payload.buffer)
    view.setUint32(0, index, false)
    view.setUint32(4, begin, false)
    view.setUint32(8, length, false)
    return this.createMessage(MessageType.REQUEST, payload)
  }

  static createCancel(index: number, begin: number, length: number): Uint8Array {
    const payload = new Uint8Array(12)
    const view = new DataView(payload.buffer)
    view.setUint32(0, index, false)
    view.setUint32(4, begin, false)
    view.setUint32(8, length, false)
    return this.createMessage(MessageType.CANCEL, payload)
  }

  static createPiece(index: number, begin: number, block: Uint8Array): Uint8Array {
    const payload = new Uint8Array(8 + block.length)
    const view = new DataView(payload.buffer)
    view.setUint32(0, index, false)
    view.setUint32(4, begin, false)
    payload.set(block, 8)
    return this.createMessage(MessageType.PIECE, payload)
  }

  static createExtendedMessage(id: number, payload: Uint8Array): Uint8Array {
    const buf = new Uint8Array(1 + payload.length)
    buf[0] = id
    buf.set(payload, 1)
    return this.createMessage(MessageType.EXTENDED, buf)
  }

  static createMetadataRequest(metadataId: number, piece: number): Uint8Array {
    // We need a bencoder. For now, let's construct simple bencoded dictionary manually or use a library if available.
    // Since we don't have a bencoder imported here, let's assume the caller handles encoding or we implement a simple one.
    // Wait, we should probably keep this class low-level.
    // Let's just return the payload structure and let the caller encode it?
    // No, createMessage returns Uint8Array.
    // I'll assume we can use a simple manual encoding for this specific message as it's small.
    // d8:msg_typei0e5:piecei{piece}ee
    const str = `d8:msg_typei${MetadataMsgType.REQUEST}e5:piecei${piece}ee`
    return this.createExtendedMessage(metadataId, new TextEncoder().encode(str))
  }

  static createMetadataReject(metadataId: number, piece: number): Uint8Array {
    const str = `d8:msg_typei${MetadataMsgType.REJECT}e5:piecei${piece}ee`
    return this.createExtendedMessage(metadataId, new TextEncoder().encode(str))
  }

  static createMetadataData(
    metadataId: number,
    piece: number,
    totalSize: number,
    data: Uint8Array,
  ): Uint8Array {
    // d8:msg_typei1e5:piecei{piece}e10:total_sizei{totalSize}ee + data (but data is NOT part of bencoded dict in standard ut_metadata?)
    // BEP 9: "The dictionary is bencoded. The data follows the dictionary."
    const dictStr = `d8:msg_typei${MetadataMsgType.DATA}e5:piecei${piece}e10:total_sizei${totalSize}ee`
    const dictBytes = new TextEncoder().encode(dictStr)
    const payload = new Uint8Array(dictBytes.length + data.length)
    payload.set(dictBytes)
    payload.set(data, dictBytes.length)
    return this.createExtendedMessage(metadataId, payload)
  }

  /**
   * Fill an existing 17-byte buffer with a REQUEST message.
   * Used with RequestMessagePool to avoid allocations in hot paths.
   */
  static fillRequestMessage(
    buffer: Uint8Array,
    view: DataView,
    index: number,
    begin: number,
    length: number,
  ): void {
    // Message format: [4-byte length][1-byte type][12-byte payload]
    // Length is 13 (1 type + 12 payload)
    view.setUint32(0, 13, false) // length = 13
    buffer[4] = MessageType.REQUEST // type
    view.setUint32(5, index, false) // piece index
    view.setUint32(9, begin, false) // block offset
    view.setUint32(13, length, false) // block length
  }
}

/**
 * Pool of reusable 17-byte buffers for REQUEST messages.
 * Avoids allocation overhead in the hot request path.
 *
 * REQUEST messages are always exactly 17 bytes:
 * - 4 bytes: message length (13)
 * - 1 byte: message type (REQUEST = 6)
 * - 4 bytes: piece index
 * - 4 bytes: block offset
 * - 4 bytes: block length
 */
export class RequestMessagePool {
  private static readonly MESSAGE_SIZE = 17
  private static readonly POOL_SIZE = 128

  private pool: Uint8Array[] = []
  private views: DataView[] = []

  constructor() {
    // Pre-allocate pool
    for (let i = 0; i < RequestMessagePool.POOL_SIZE; i++) {
      const buffer = new Uint8Array(RequestMessagePool.MESSAGE_SIZE)
      this.pool.push(buffer)
      this.views.push(new DataView(buffer.buffer))
    }
  }

  /**
   * Acquire a buffer filled with a REQUEST message.
   * Returns [buffer, view] tuple for sending.
   * Call release() after sending.
   */
  acquire(index: number, begin: number, length: number): [Uint8Array, DataView] {
    let buffer: Uint8Array
    let view: DataView

    if (this.pool.length > 0) {
      buffer = this.pool.pop()!
      view = this.views.pop()!
    } else {
      // Pool exhausted, allocate new (will be added to pool on release)
      buffer = new Uint8Array(RequestMessagePool.MESSAGE_SIZE)
      view = new DataView(buffer.buffer)
    }

    PeerWireProtocol.fillRequestMessage(buffer, view, index, begin, length)
    return [buffer, view]
  }

  /**
   * Return a buffer to the pool after sending.
   */
  release(buffer: Uint8Array, view: DataView): void {
    // Don't grow pool beyond initial size
    if (this.pool.length < RequestMessagePool.POOL_SIZE) {
      this.pool.push(buffer)
      this.views.push(view)
    }
  }

  /**
   * Get current pool size (for debugging).
   */
  get available(): number {
    return this.pool.length
  }
}

// Global singleton pool
export const requestMessagePool = new RequestMessagePool()
