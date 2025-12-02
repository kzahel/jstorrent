export var MessageType
;(function (MessageType) {
  MessageType[(MessageType['CHOKE'] = 0)] = 'CHOKE'
  MessageType[(MessageType['UNCHOKE'] = 1)] = 'UNCHOKE'
  MessageType[(MessageType['INTERESTED'] = 2)] = 'INTERESTED'
  MessageType[(MessageType['NOT_INTERESTED'] = 3)] = 'NOT_INTERESTED'
  MessageType[(MessageType['HAVE'] = 4)] = 'HAVE'
  MessageType[(MessageType['BITFIELD'] = 5)] = 'BITFIELD'
  MessageType[(MessageType['REQUEST'] = 6)] = 'REQUEST'
  MessageType[(MessageType['PIECE'] = 7)] = 'PIECE'
  MessageType[(MessageType['CANCEL'] = 8)] = 'CANCEL'
  MessageType[(MessageType['EXTENDED'] = 20)] = 'EXTENDED'
  MessageType[(MessageType['KEEP_ALIVE'] = -1)] = 'KEEP_ALIVE'
  MessageType[(MessageType['HANDSHAKE'] = -2)] = 'HANDSHAKE'
})(MessageType || (MessageType = {}))
export var MetadataMsgType
;(function (MetadataMsgType) {
  MetadataMsgType[(MetadataMsgType['REQUEST'] = 0)] = 'REQUEST'
  MetadataMsgType[(MetadataMsgType['DATA'] = 1)] = 'DATA'
  MetadataMsgType[(MetadataMsgType['REJECT'] = 2)] = 'REJECT'
})(MetadataMsgType || (MetadataMsgType = {}))
export const EXTENDED_HANDSHAKE_ID = 0
export class PeerWireProtocol {
  static parseHandshake(buffer) {
    if (buffer.length < 68) {
      // console.error(`PeerWireProtocol: buffer too short ${buffer.length}`)
      // console.error('Buffer:', buffer)
      return null
    }
    // console.error('Buffer start:', buffer.slice(0, 20))
    const pstrlen = buffer[0]
    if (pstrlen !== 19) {
      console.error(`PeerWireProtocol: invalid pstrlen ${pstrlen}`)
      return null
    }
    const pstr = new TextDecoder().decode(buffer.slice(1, 20))
    if (pstr !== 'BitTorrent protocol') {
      console.error(`PeerWireProtocol: invalid pstr ${pstr}`)
      return null
    }
    // 8 reserved bytes at offset 20
    const reserved = buffer.slice(20, 28)
    const extensions = !!(reserved[5] & 0x10)
    const infoHash = buffer.slice(28, 48)
    const peerId = buffer.slice(48, 68)
    return { infoHash, peerId, protocol: pstr, extensions }
  }
  static createHandshake(infoHash, peerId, extensions = true) {
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
  static parseMessage(buffer) {
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
    const message = { type: id, payload }
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
  static createMessage(type, payload) {
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
  static createRequest(index, begin, length) {
    const payload = new Uint8Array(12)
    const view = new DataView(payload.buffer)
    view.setUint32(0, index, false)
    view.setUint32(4, begin, false)
    view.setUint32(8, length, false)
    return this.createMessage(MessageType.REQUEST, payload)
  }
  static createPiece(index, begin, block) {
    const payload = new Uint8Array(8 + block.length)
    const view = new DataView(payload.buffer)
    view.setUint32(0, index, false)
    view.setUint32(4, begin, false)
    payload.set(block, 8)
    return this.createMessage(MessageType.PIECE, payload)
  }
  static createExtendedMessage(id, payload) {
    const buf = new Uint8Array(1 + payload.length)
    buf[0] = id
    buf.set(payload, 1)
    return this.createMessage(MessageType.EXTENDED, buf)
  }
  static createMetadataRequest(metadataId, piece) {
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
  static createMetadataReject(metadataId, piece) {
    const str = `d8:msg_typei${MetadataMsgType.REJECT}e5:piecei${piece}ee`
    return this.createExtendedMessage(metadataId, new TextEncoder().encode(str))
  }
  static createMetadataData(metadataId, piece, totalSize, data) {
    // d8:msg_typei1e5:piecei{piece}e10:total_sizei{totalSize}ee + data (but data is NOT part of bencoded dict in standard ut_metadata?)
    // BEP 9: "The dictionary is bencoded. The data follows the dictionary."
    const dictStr = `d8:msg_typei${MetadataMsgType.DATA}e5:piecei${piece}e10:total_sizei${totalSize}ee`
    const dictBytes = new TextEncoder().encode(dictStr)
    const payload = new Uint8Array(dictBytes.length + data.length)
    payload.set(dictBytes)
    payload.set(data, dictBytes.length)
    return this.createExtendedMessage(metadataId, payload)
  }
}
