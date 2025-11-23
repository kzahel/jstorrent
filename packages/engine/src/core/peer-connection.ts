/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { EventEmitter } from 'events'
import { ITcpSocket } from '../interfaces/socket'
import { PeerWireProtocol, MessageType, WireMessage } from '../protocol/wire-protocol'
import { BitField } from '../utils/bitfield'

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
  on(event: 'have', listener: (index: number) => void): this
  on(event: 'choke', listener: () => void): this
  on(event: 'unchoke', listener: () => void): this
  on(event: 'extended', listener: (id: number, payload: Uint8Array) => void): this
  on(event: 'request', listener: (index: number, begin: number, length: number) => void): this
  on(event: 'piece', listener: (index: number, begin: number, data: Uint8Array) => void): this
  on(event: 'cancel', listener: (index: number, begin: number, length: number) => void): this

  close(): void
}

export class PeerConnection extends EventEmitter {
  private socket: ITcpSocket
  private buffer: Uint8Array = new Uint8Array(0)
  private handshakeReceived = false

  public peerChoking = true
  public peerInterested = false
  public amChoking = true
  public amInterested = false
  public peerExtensions = false

  public peerId: Uint8Array | null = null
  public infoHash: Uint8Array | null = null
  public bitfield: BitField | null = null

  constructor(socket: ITcpSocket) {
    super()
    this.socket = socket

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
    const handshake = PeerWireProtocol.createHandshake(infoHash, peerId, extensions)
    this.socket.send(handshake)
  }

  sendMessage(type: MessageType, payload?: Uint8Array) {
    const message = PeerWireProtocol.createMessage(type, payload)
    this.socket.send(message)
  }

  sendExtendedMessage(id: number, payload: Uint8Array) {
    const message = PeerWireProtocol.createExtendedMessage(id, payload)
    this.socket.send(message)
  }

  sendRequest(index: number, begin: number, length: number) {
    const message = PeerWireProtocol.createRequest(index, begin, length)
    this.socket.send(message)
  }

  close() {
    this.socket.close()
  }

  private handleData(data: Uint8Array) {
    console.error('PeerConnection: handleData called, length:', data.length)
    // Append new data to buffer
    const newBuffer = new Uint8Array(this.buffer.length + data.length)
    newBuffer.set(this.buffer)
    newBuffer.set(data, this.buffer.length)
    this.buffer = newBuffer
    this.processBuffer()
  }

  private processBuffer() {
    if (!this.handshakeReceived) {
      const result = PeerWireProtocol.parseHandshake(this.buffer)
      if (result) {
        this.handshakeReceived = true
        this.infoHash = result.infoHash
        this.peerId = result.peerId
        this.peerExtensions = result.extensions
        console.log('PeerConnection: Handshake parsed, extensions:', this.peerExtensions)
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

      const message = PeerWireProtocol.parseMessage(this.buffer)
      if (message) {
        // We need to know the length of the message to slice the buffer
        // PeerWireProtocol.parseMessage doesn't return consumed bytes.
        // I should probably update PeerWireProtocol to return consumed bytes or calculate it.
        // For now, I'll calculate it based on the message type and payload.
        // Actually, parseMessage reads the length prefix.

        if (this.buffer.length >= totalLength) {
          this.handleMessage(message)
          this.buffer = this.buffer.slice(totalLength)
        } else {
          break // Wait for more data
        }
      } else {
        break // Wait for more data
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
        console.error(
          'PeerConnection: Handling EXTENDED message',
          message.extendedId,
          message.extendedPayload?.length,
        )
        if (message.extendedId !== undefined && message.extendedPayload) {
          this.emit('extended', message.extendedId, message.extendedPayload)
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
}
