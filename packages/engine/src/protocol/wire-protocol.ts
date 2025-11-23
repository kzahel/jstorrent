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
  EXTENDED = 20,
  KEEP_ALIVE = -1, // Internal representation
  HANDSHAKE = -2, // Internal representation
}

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
  static parseHandshake(
    buffer: Uint8Array,
  ): { infoHash: Uint8Array; peerId: Uint8Array; protocol: string; extensions: boolean } | null {
    if (buffer.length < 68) {
      console.error('Handshake too short:', buffer.length)
      return null
    }

    const pstrlen = buffer[0]
    if (pstrlen !== 19) {
      console.error('Invalid pstrlen:', pstrlen)
      return null
    }

    const pstr = new TextDecoder().decode(buffer.slice(1, 20))
    if (pstr !== 'BitTorrent protocol') {
      console.error('Invalid pstr:', pstr)
      return null
    }

    // 8 reserved bytes at offset 20
    const reserved = buffer.slice(20, 28)
    const extensions = !!(reserved[5] & 0x10)

    const infoHash = buffer.slice(28, 48)
    const peerId = buffer.slice(48, 68)

    return { infoHash, peerId, protocol: pstr, extensions }
  }

  static createHandshake(
    infoHash: Uint8Array,
    peerId: Uint8Array,
    extensions: boolean = true,
  ): Uint8Array {
    const buffer = new Uint8Array(68)
    buffer[0] = 19
    buffer.set(new TextEncoder().encode('BitTorrent protocol'), 1)
    // Reserved bytes (zeroed by default)
    if (extensions) {
      buffer[25] |= 0x10 // BEP 10 Extension Protocol
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
}
