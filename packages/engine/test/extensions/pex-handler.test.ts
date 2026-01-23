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
  })

  // Helper to create and send a BitTorrent handshake
  function sendBitTorrentHandshake() {
    const infoHash = new Uint8Array(20).fill(1)
    const peerId = new Uint8Array(20).fill(2)
    const handshake = new Uint8Array(68)
    handshake[0] = 19
    handshake.set(new TextEncoder().encode('BitTorrent protocol'), 1)
    handshake[25] |= 0x10 // Extension bit
    handshake.set(infoHash, 28)
    handshake.set(peerId, 48)
    socket.emitData(handshake)
  }

  it('should extract peer PEX ID from extended handshake', () => {
    // PexHandler listens for extended handshakes and extracts the peer's ut_pex ID
    // (Note: PexHandler no longer sends its own handshake - PeerConnection handles that)
    const handler = new PexHandler(peer)

    // Initially, peer doesn't support PEX
    expect(handler.peerSupportsPex).toBe(false)

    // Send BitTorrent handshake first (required before extended messages are processed)
    sendBitTorrentHandshake()

    // Simulate incoming extended handshake from peer saying it supports PEX (ID 3)
    const extHandshakePayload = Bencode.encode({ m: { ut_pex: 3 } })
    const extHandshakeMsg = new Uint8Array(4 + 1 + 1 + extHandshakePayload.length)
    const view = new DataView(extHandshakeMsg.buffer)
    view.setUint32(0, 2 + extHandshakePayload.length, false)
    extHandshakeMsg[4] = MessageType.EXTENDED
    extHandshakeMsg[5] = 0 // Handshake ID
    extHandshakeMsg.set(extHandshakePayload, 6)

    socket.emitData(extHandshakeMsg)

    // Now peer supports PEX
    expect(handler.peerSupportsPex).toBe(true)
  })

  it('should handle extended handshake and PEX message', () => {
    // Create handler
    new PexHandler(peer)

    // Set up pex_peers listener
    const pexSpy = vi.fn()
    ;(peer as any).on('pex_peers', pexSpy)

    // Send BitTorrent handshake first (required before extended messages are processed)
    sendBitTorrentHandshake()

    // 1. Simulate incoming extended handshake from peer saying it supports PEX (ID 3)
    // Message: Len(4) + ID(20) + ExtID(0) + Bencoded Payload
    const extHandshakePayload = Bencode.encode({ m: { ut_pex: 3 } })
    const extHandshakeMsg = new Uint8Array(4 + 1 + 1 + extHandshakePayload.length)
    const view = new DataView(extHandshakeMsg.buffer)
    view.setUint32(0, 2 + extHandshakePayload.length, false)
    extHandshakeMsg[4] = MessageType.EXTENDED
    extHandshakeMsg[5] = 0 // Handshake
    extHandshakeMsg.set(extHandshakePayload, 6)

    socket.emitData(extHandshakeMsg)

    // 2. Simulate incoming PEX message
    // Peer uses OUR PEX ID (peer.myPexId = 2) when sending to us
    const added = new Uint8Array([1, 2, 3, 4, 0x1f, 0x90]) // 1.2.3.4:8080
    const pexPayload = Bencode.encode({ added })
    const pexMsg = new Uint8Array(4 + 1 + 1 + pexPayload.length)
    const view2 = new DataView(pexMsg.buffer)
    view2.setUint32(0, 2 + pexPayload.length, false)
    pexMsg[4] = MessageType.EXTENDED
    pexMsg[5] = peer.myPexId // Peer uses OUR ID when sending to us
    pexMsg.set(pexPayload, 6)

    socket.emitData(pexMsg)

    // Now emits array of PeerAddress with family field
    expect(pexSpy).toHaveBeenCalledWith([{ ip: '1.2.3.4', port: 8080, family: 'ipv4' }])
  })
})
