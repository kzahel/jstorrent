import { describe, it, expect } from 'vitest'
import { PeerWireProtocol, MessageType } from '../../src/protocol/wire-protocol'

describe('PeerWireProtocol', () => {
  it('should parse handshake', () => {
    const infoHash = new Uint8Array(20).fill(1)
    const peerId = new Uint8Array(20).fill(2)
    const buffer = PeerWireProtocol.createHandshake(infoHash, peerId)

    const parsed = PeerWireProtocol.parseHandshake(buffer)
    expect(parsed).not.toBeNull()
    expect(parsed?.protocol).toBe('BitTorrent protocol')
    expect(parsed?.infoHash).toEqual(infoHash)
    expect(parsed?.peerId).toEqual(peerId)
  })

  it('should parse keep-alive', () => {
    const buffer = new Uint8Array(4) // 00 00 00 00
    const msg = PeerWireProtocol.parseMessage(buffer)
    expect(msg?.type).toBe(MessageType.KEEP_ALIVE)
  })

  it('should create and parse choke message', () => {
    const buffer = PeerWireProtocol.createMessage(MessageType.CHOKE)
    const msg = PeerWireProtocol.parseMessage(buffer)
    expect(msg?.type).toBe(MessageType.CHOKE)
  })

  it('should create and parse request message', () => {
    const buffer = PeerWireProtocol.createRequest(1, 0, 16384)
    const msg = PeerWireProtocol.parseMessage(buffer)
    expect(msg?.type).toBe(MessageType.REQUEST)
    expect(msg?.index).toBe(1)
    expect(msg?.begin).toBe(0)
    expect(msg?.length).toBe(16384)
  })

  it('should create and parse piece message', () => {
    const block = new Uint8Array([1, 2, 3, 4])
    const buffer = PeerWireProtocol.createPiece(0, 0, block)
    const msg = PeerWireProtocol.parseMessage(buffer)
    expect(msg?.type).toBe(MessageType.PIECE)
    expect(msg?.index).toBe(0)
    expect(msg?.begin).toBe(0)
    expect(msg?.block).toEqual(block)
  })
})
