import { PeerWireProtocol, MessageType } from '../protocol/wire-protocol'
import { BitField } from '../utils/bitfield'
import { EngineComponent } from '../logging/logger'
import { SpeedCalculator } from '../utils/speed-calculator'
export class PeerConnection extends EngineComponent {
  send(data) {
    this.socket.send(data)
    this.uploaded += data.length
    this.uploadSpeedCalculator.addBytes(data.length)
    this.emit('bytesUploaded', data.length)
  }
  constructor(engine, socket, options) {
    super(engine)
    this.buffer = new Uint8Array(0)
    this.handshakeReceived = false
    this.peerChoking = true
    this.peerInterested = false
    this.amChoking = true
    this.amInterested = false
    this.peerExtensions = false
    this.requestsPending = 0 // Number of outstanding requests
    this.peerMetadataId = null
    this.myMetadataId = 1 // Our ID for ut_metadata
    this.uploaded = 0
    this.downloaded = 0
    this.uploadSpeedCalculator = new SpeedCalculator()
    this.downloadSpeedCalculator = new SpeedCalculator()
    this.peerId = undefined
    this.infoHash = undefined
    this.bitfield = null
    this.isIncoming = false
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
  connect(port, host) {
    if (this.socket.connect) {
      return this.socket.connect(port, host)
    }
    return Promise.reject(new Error('Socket does not support connect'))
  }
  sendHandshake(infoHash, peerId, extensions = true) {
    const handshake = PeerWireProtocol.createHandshake(infoHash, peerId, extensions)
    this.send(handshake)
  }
  sendMessage(type, payload) {
    const message = PeerWireProtocol.createMessage(type, payload)
    this.send(message)
  }
  sendRequest(index, begin, length) {
    const message = PeerWireProtocol.createRequest(index, begin, length)
    this.send(message)
  }
  sendHave(index) {
    // HAVE message payload is just the index (4 bytes)
    const payload = new Uint8Array(4)
    const view = new DataView(payload.buffer)
    view.setUint32(0, index, false)
    this.sendMessage(MessageType.HAVE, payload)
  }
  sendPiece(index, begin, block) {
    const payload = new Uint8Array(8 + block.length)
    const view = new DataView(payload.buffer)
    view.setUint32(0, index, false)
    view.setUint32(4, begin, false)
    payload.set(block, 8)
    this.sendMessage(MessageType.PIECE, payload)
  }
  sendExtendedMessage(id, payload) {
    const message = PeerWireProtocol.createExtendedMessage(id, payload)
    this.send(message)
  }
  sendExtendedHandshake() {
    // Simple dictionary: { m: { ut_metadata: 1 } }
    // We construct it manually as bencoded string
    // d1:md11:ut_metadatai1eee
    const payload = new TextEncoder().encode(`d1:md11:ut_metadatai${this.myMetadataId}eee`)
    this.sendExtendedMessage(0, payload)
  }
  sendMetadataRequest(piece) {
    if (this.peerMetadataId === null) return
    const msg = PeerWireProtocol.createMetadataRequest(this.peerMetadataId, piece)
    this.send(msg)
  }
  sendMetadataData(piece, totalSize, data) {
    if (this.peerMetadataId === null) return
    const msg = PeerWireProtocol.createMetadataData(this.peerMetadataId, piece, totalSize, data)
    this.send(msg)
  }
  sendMetadataReject(piece) {
    if (this.peerMetadataId === null) return
    const msg = PeerWireProtocol.createMetadataReject(this.peerMetadataId, piece)
    this.send(msg)
  }
  close() {
    this.socket.close()
  }
  handleData(data) {
    // this.logger.debug(`Received ${data.length} bytes`)
    // Append to buffer
    const newBuffer = new Uint8Array(this.buffer.length + data.length)
    newBuffer.set(this.buffer)
    newBuffer.set(data, this.buffer.length)
    this.buffer = newBuffer
    this.downloaded += data.length
    this.downloadSpeedCalculator.addBytes(data.length)
    this.emit('bytesDownloaded', data.length)
    this.processBuffer()
  }
  processBuffer() {
    if (!this.handshakeReceived) {
      const result = PeerWireProtocol.parseHandshake(this.buffer)
      if (result) {
        this.handshakeReceived = true
        this.infoHash = result.infoHash
        this.peerId = result.peerId
        this.peerExtensions = result.extensions
        // this.logger.debug('Handshake parsed, extensions:', this.peerExtensions)
        this.buffer = this.buffer.slice(68)
        this.emit('handshake', this.infoHash, this.peerId, this.peerExtensions)
        // Continue processing in case there are more messages
      } else {
        return // Wait for more data
      }
    }
    while (this.buffer.length > 4) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
      const length = view.getUint32(0, false)
      const totalLength = 4 + length
      if (this.buffer.length >= totalLength) {
        const message = this.buffer.slice(0, totalLength)
        this.buffer = this.buffer.slice(totalLength)
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
      } else {
        break // Wait for more data
      }
    }
  }
  handleMessage(message) {
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
        break
      case MessageType.HAVE:
        if (message.index !== undefined) {
          this.bitfield?.set(message.index, true)
          this.emit('have', message.index)
        }
        break
      case MessageType.BITFIELD:
        if (message.payload) {
          this.bitfield = new BitField(message.payload)
          this.emit('bitfield', this.bitfield)
        }
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
  handleExtendedHandshake(payload) {
    try {
      // Decode bencoded dictionary
      // For now, simple regex parsing or string search since we know the structure
      // We look for "ut_metadata" and the integer following it
      const str = new TextDecoder().decode(payload)
      this.logger.debug('Extended Handshake payload:', str)
      // Very naive parsing for "ut_metadata"i{id}e
      const match = str.match(/ut_metadatai(\d+)e/)
      if (match) {
        this.peerMetadataId = parseInt(match[1], 10)
        // this.logger.info(`Peer supports ut_metadata with ID ${this.peerMetadataId}`)
      } else {
        this.logger.warn('Peer does not support ut_metadata')
      }
      // Also check for metadata_size
      const sizeMatch = str.match(/metadata_sizei(\d+)e/)
      if (sizeMatch) {
        // this.logger.info(`Peer reports metadata_size: ${sizeMatch[1]}`)
      }
      // Emit generic event (we might want to parse more properly later)
      this.emit('extension_handshake', { raw: str })
    } catch (err) {
      this.logger.error('Error parsing extended handshake', { err })
    }
  }
  handleMetadataMessage(payload) {
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
  get uploadSpeed() {
    return this.uploadSpeedCalculator.getSpeed()
  }
  get downloadSpeed() {
    return this.downloadSpeedCalculator.getSpeed()
  }
}
PeerConnection.logName = 'peer'
