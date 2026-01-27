import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PeerConnection } from '../../src/core/peer-connection'
import { ITcpSocket } from '../../src/interfaces/socket'
import { PeerWireProtocol, MessageType } from '../../src/protocol/wire-protocol'
import { MockEngine } from '../utils/mock-engine'

class MockSocket implements ITcpSocket {
  public sentData: Uint8Array[] = []
  public onDataCb: ((data: Uint8Array) => void) | null = null
  public onCloseCb: ((hadError: boolean) => void) | null = null
  public onErrorCb: ((err: Error) => void) | null = null

  send(data: Uint8Array) {
    this.sentData.push(data)
  }

  onData(cb: (data: Uint8Array) => void) {
    this.onDataCb = cb
  }

  onClose(cb: (hadError: boolean) => void) {
    this.onCloseCb = cb
  }

  onError(cb: (err: Error) => void) {
    this.onErrorCb = cb
  }

  close() {
    if (this.onCloseCb) this.onCloseCb(false)
  }

  // Helper to simulate incoming data
  emitData(data: Uint8Array) {
    if (this.onDataCb) this.onDataCb(data)
  }
}

describe('PeerConnection', () => {
  let socket: MockSocket
  let connection: PeerConnection
  let engine: MockEngine
  const infoHash = new Uint8Array(20).fill(1)
  const peerId = new Uint8Array(20).fill(2)

  beforeEach(() => {
    socket = new MockSocket()
    engine = new MockEngine()
    connection = new PeerConnection(engine, socket)
  })

  it('should send handshake', () => {
    connection.sendHandshake(infoHash, peerId)
    connection.flush() // Flush queued sends
    expect(socket.sentData.length).toBe(1)
    const parsed = PeerWireProtocol.parseHandshake(socket.sentData[0])
    expect(parsed?.infoHash).toEqual(infoHash)
  })

  it('should emit handshake event on valid handshake', () => {
    const handshakeFn = vi.fn()
    connection.on('handshake', handshakeFn)

    const handshake = PeerWireProtocol.createHandshake(infoHash, peerId)
    socket.emitData(handshake)

    expect(handshakeFn).toHaveBeenCalledWith(infoHash, peerId, true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((connection as any).handshakeReceived).toBe(true)
  })

  it('should handle choke message', () => {
    // First establish handshake
    socket.emitData(PeerWireProtocol.createHandshake(infoHash, peerId))

    const chokeFn = vi.fn()
    connection.on('choke', chokeFn)

    const chokeMsg = PeerWireProtocol.createMessage(MessageType.CHOKE)
    socket.emitData(chokeMsg)

    expect(chokeFn).toHaveBeenCalled()
    expect(connection.peerChoking).toBe(true)
  })

  it('should handle unchoke message', () => {
    // First establish handshake
    socket.emitData(PeerWireProtocol.createHandshake(infoHash, peerId))
    connection.peerChoking = true

    const unchokeFn = vi.fn()
    connection.on('unchoke', unchokeFn)

    const unchokeMsg = PeerWireProtocol.createMessage(MessageType.UNCHOKE)
    socket.emitData(unchokeMsg)

    expect(unchokeFn).toHaveBeenCalled()
    expect(connection.peerChoking).toBe(false)
  })

  it('should buffer partial messages', () => {
    socket.emitData(PeerWireProtocol.createHandshake(infoHash, peerId))

    const msgFn = vi.fn()
    connection.on('message', msgFn)

    const msg = PeerWireProtocol.createMessage(MessageType.HAVE, new Uint8Array([0, 0, 0, 1]))
    // Split message in two
    const part1 = msg.slice(0, 3)
    const part2 = msg.slice(3)

    socket.emitData(part1)
    expect(msgFn).not.toHaveBeenCalled()

    socket.emitData(part2)
    expect(msgFn).toHaveBeenCalled()
  })
})
