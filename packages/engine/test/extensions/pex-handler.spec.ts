/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PexHandler } from '../../src/extensions/pex-handler'
import { PeerConnection } from '../../src/core/peer-connection'
import { ITcpSocket } from '../../src/interfaces/socket'
import { Bencode } from '../../src/utils/bencode'
import { MessageType } from '../../src/protocol/wire-protocol'
import { MockEngine } from '../utils/mock-engine'

// Mock Socket
class MockSocket implements ITcpSocket {
  public sentData: Uint8Array[] = []
  public onDataCb: ((data: Uint8Array) => void) | null = null

  on = vi.fn()
  write = vi.fn()
  send = vi.fn((data: Uint8Array) => {
    console.error('MockSocket.send called with length:', data.length)
    this.sentData.push(data)
  })
  onData(cb: (data: Uint8Array) => void) {
    this.onDataCb = cb
  }
  onClose = vi.fn()
  onError = vi.fn()
  close = vi.fn()
  connect = vi.fn(() => Promise.resolve())

  emitData(data: Uint8Array) {
    if (this.onDataCb) this.onDataCb(data)
  }
}

describe('PexHandler', () => {
  let socket: MockSocket
  let peer: PeerConnection
  let engine: MockEngine

  beforeEach(() => {
    socket = new MockSocket()
    engine = new MockEngine()
    peer = new PeerConnection(engine, socket)
    new PexHandler(peer)
    // Add spy to verify listener is attached? No, just modify src file.
  })

  it('should send extended handshake when peer supports extensions', () => {
    // Simulate handshake with extensions bit set
    // We need to trigger 'handshake' event on peer.
    // We can do this by emitting data to socket that looks like a handshake.

    const infoHash = new Uint8Array(20).fill(1)
    const peerId = new Uint8Array(20).fill(2)

    // Create handshake buffer with extension bit
    const handshake = new Uint8Array(68)
    handshake[0] = 19
    handshake.set(new TextEncoder().encode('BitTorrent protocol'), 1)
    handshake[25] |= 0x10 // Extension bit
    handshake.set(infoHash, 28)
    handshake.set(peerId, 48)

    socket.emitData(handshake)

    // Check if extended handshake was sent
    // It should be an EXTENDED message (ID 20) with ID 0 (handshake)
    expect(socket.sentData.length).toBeGreaterThan(0)
    const lastMsg = socket.sentData[socket.sentData.length - 1]

    // Parse message
    const view = new DataView(lastMsg.buffer)
    view.getUint32(0, false)
    const type = lastMsg[4]
    expect(type).toBe(MessageType.EXTENDED)

    const extId = lastMsg[5]
    expect(extId).toBe(0) // Handshake ID

    const payload = lastMsg.slice(6)
    const dict = Bencode.decode(payload)
    expect(dict.m['ut_pex']).toBe(1)
  })

  it('should handle extended handshake and PEX message', () => {
    // 1. Simulate handshake
    const infoHash = new Uint8Array(20).fill(1)
    const peerId = new Uint8Array(20).fill(2)
    const handshake = new Uint8Array(68)
    handshake[0] = 19
    handshake.set(new TextEncoder().encode('BitTorrent protocol'), 1)
    handshake[25] |= 0x10
    handshake.set(infoHash, 28)
    handshake.set(peerId, 48)
    socket.emitData(handshake)

    // 2. Simulate incoming extended handshake from peer saying it supports PEX (ID 1)
    // Message: Len(4) + ID(20) + ExtID(0) + Bencoded Payload
    const extHandshakePayload = Bencode.encode({ m: { ut_pex: 1 } })
    const extHandshakeMsg = new Uint8Array(4 + 1 + 1 + extHandshakePayload.length)
    const view = new DataView(extHandshakeMsg.buffer)
    view.setUint32(0, 2 + extHandshakePayload.length, false)
    extHandshakeMsg[4] = MessageType.EXTENDED
    extHandshakeMsg[5] = 0 // Handshake
    extHandshakeMsg.set(extHandshakePayload, 6)

    socket.emitData(extHandshakeMsg)

    // 3. Simulate incoming PEX message (ID 1)
    // Payload: { added: ... }
    const added = new Uint8Array([1, 2, 3, 4, 0x1f, 0x90]) // 1.2.3.4:8080
    const pexPayload = Bencode.encode({ added })
    const pexMsg = new Uint8Array(4 + 1 + 1 + pexPayload.length)
    const view2 = new DataView(pexMsg.buffer)
    view2.setUint32(0, 2 + pexPayload.length, false)
    pexMsg[4] = MessageType.EXTENDED
    pexMsg[5] = 1 // PEX ID (negotiated)
    pexMsg.set(pexPayload, 6)

    const pexSpy = vi.fn()
    ;(peer as any).on('pex_peer', pexSpy)

    socket.emitData(pexMsg)

    expect(pexSpy).toHaveBeenCalledWith({ ip: '1.2.3.4', port: 8080 })
  })
})
