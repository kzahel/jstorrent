import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Torrent } from '../../src/core/torrent'
import { PeerConnection } from '../../src/core/peer-connection'
import { ISocketFactory, ITcpSocket } from '../../src/interfaces/socket'
import { MockEngine } from '../utils/mock-engine'
import { PeerWireProtocol } from '../../src/protocol/wire-protocol'
import type { BtEngine } from '../../src/core/bt-engine'

type SwarmAccess = {
  _swarm: {
    connectedCount: number
    getPeer: (ip: string, port: number, family: string) => { state: string } | undefined
  }
}

/**
 * MockSocket that supports emitData() to simulate incoming data
 */
class MockSocket implements ITcpSocket {
  public sentData: Uint8Array[] = []
  public onDataCb: ((data: Uint8Array) => void) | null = null
  public onCloseCb: ((hadError: boolean) => void) | null = null
  public onErrorCb: ((err: Error) => void) | null = null
  public remoteAddress?: string
  public remotePort?: number

  constructor(remoteAddress?: string, remotePort?: number) {
    this.remoteAddress = remoteAddress
    this.remotePort = remotePort
  }

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

describe('Self-Connection Detection', () => {
  let mockEngine: MockEngine
  let mockSocketFactory: ISocketFactory
  const infoHash = new Uint8Array(20).fill(1)
  const ourPeerId = new Uint8Array(20).fill(42)

  beforeEach(() => {
    mockEngine = new MockEngine()
    mockSocketFactory = {
      createTcpSocket: vi.fn(),
    } as unknown as ISocketFactory
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function createTorrent(peerId: Uint8Array = ourPeerId): Torrent {
    return new Torrent(
      mockEngine as unknown as BtEngine,
      infoHash,
      peerId,
      mockSocketFactory,
      6881,
      undefined, // contentStorage
      [], // announce
      50, // maxPeers
    )
  }

  it('should detect and close self-connection when peer ID matches', () => {
    const torrent = createTorrent()

    const socket = new MockSocket('192.168.1.100', 6881)
    const peer = new PeerConnection(mockEngine, socket, {
      remoteAddress: '192.168.1.100',
      remotePort: 6881,
    })

    // Add peer to torrent (this adds to swarm and sets up listeners)
    torrent.addPeer(peer)

    // Initially peer is connected
    expect(torrent.numPeers).toBe(1)

    // Simulate receiving handshake with OUR peer ID (self-connection!)
    const handshake = PeerWireProtocol.createHandshake(infoHash, ourPeerId)
    socket.emitData(handshake)

    // Peer should be closed and removed from swarm
    expect(torrent.numPeers).toBe(0)
  })

  it('should remove peer from swarm after self-connection detection', () => {
    const torrent = createTorrent()

    const socket = new MockSocket('192.168.1.100', 6881)
    const peer = new PeerConnection(mockEngine, socket, {
      remoteAddress: '192.168.1.100',
      remotePort: 6881,
    })

    torrent.addPeer(peer)

    // Initially peer is connected
    const swarm = (torrent as unknown as SwarmAccess)._swarm
    expect(swarm.connectedCount).toBe(1)

    // Trigger self-connection
    const handshake = PeerWireProtocol.createHandshake(infoHash, ourPeerId)
    socket.emitData(handshake)

    // Swarm should be cleaned up
    expect(swarm.connectedCount).toBe(0)
    const peerState = swarm.getPeer('192.168.1.100', 6881, 'ipv4')
    expect(peerState?.state).toBe('idle') // Reset to idle, not 'connected'
  })

  it('should accept connection when peer ID differs from ours', () => {
    const torrent = createTorrent()
    const theirPeerId = new Uint8Array(20).fill(99) // Different from ours

    const socket = new MockSocket('192.168.1.100', 6881)
    const peer = new PeerConnection(mockEngine, socket, {
      remoteAddress: '192.168.1.100',
      remotePort: 6881,
    })

    torrent.addPeer(peer)

    // Handshake with DIFFERENT peer ID
    const handshake = PeerWireProtocol.createHandshake(infoHash, theirPeerId)
    socket.emitData(handshake)

    // Peer should remain connected
    expect(torrent.numPeers).toBe(1)

    // Verify swarm state
    const swarm = (torrent as unknown as SwarmAccess)._swarm
    expect(swarm.connectedCount).toBe(1)
    const peerState = swarm.getPeer('192.168.1.100', 6881, 'ipv4')
    expect(peerState?.state).toBe('connected')
  })

  it('should handle self-connection when handshake already received (incoming connection flow)', () => {
    // This tests the specific bug path:
    // For incoming connections, BtEngine receives handshake first, then calls addPeer()
    // At that point, peer.handshakeReceived is already true
    const torrent = createTorrent()

    const socket = new MockSocket('192.168.1.100', 6881)
    const peer = new PeerConnection(mockEngine, socket, {
      remoteAddress: '192.168.1.100',
      remotePort: 6881,
    })

    // Simulate what BtEngine does: receive handshake BEFORE addPeer
    // This sets peer.handshakeReceived = true, peer.peerId, peer.infoHash
    const handshake = PeerWireProtocol.createHandshake(infoHash, ourPeerId) // Self-connection!
    socket.emitData(handshake)

    // Verify peer received handshake and recorded our peer ID
    expect(peer.handshakeReceived).toBe(true)
    expect(peer.peerId).toEqual(ourPeerId)

    // Now add peer (this should immediately detect self-connection in setupPeerListeners)
    torrent.addPeer(peer)

    // Peer should be closed and removed from swarm
    // The bug was: close handler wasn't registered yet, so removePeer never called
    expect(torrent.numPeers).toBe(0)

    const swarm = (torrent as unknown as SwarmAccess)._swarm
    expect(swarm.connectedCount).toBe(0)
  })

  it('should not detect self-connection for different peer on same IP', () => {
    // Ensure we're comparing peer IDs, not IP addresses
    const torrent = createTorrent()
    const differentPeerId = new Uint8Array(20).fill(123)

    const socket = new MockSocket('127.0.0.1', 6881) // localhost, but different peer ID
    const peer = new PeerConnection(mockEngine, socket, {
      remoteAddress: '127.0.0.1',
      remotePort: 6881,
    })

    torrent.addPeer(peer)

    // Handshake with different peer ID (not a self-connection)
    const handshake = PeerWireProtocol.createHandshake(infoHash, differentPeerId)
    socket.emitData(handshake)

    // Should remain connected (peer ID is different)
    expect(torrent.numPeers).toBe(1)
  })
})
