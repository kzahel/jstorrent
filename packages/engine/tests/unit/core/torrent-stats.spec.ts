import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Torrent } from '../../../src/core/torrent'
import { PeerConnection } from '../../../src/core/peer-connection'
import { ISocketFactory, ITcpSocket } from '../../../src/interfaces/socket'
import { MockEngine } from '../../../test/utils/mock-engine'
import type { BtEngine } from '../../../src/core/bt-engine'

describe('Torrent Stats', () => {
  let torrent: Torrent
  let mockEngine: MockEngine
  let mockSocketFactory: ISocketFactory

  beforeEach(() => {
    mockEngine = new MockEngine()

    mockSocketFactory = {
      createTcpSocket: vi.fn(),
    } as unknown as ISocketFactory

    torrent = new Torrent(
      mockEngine as unknown as BtEngine,
      new Uint8Array(20),
      new Uint8Array(20),
      mockSocketFactory,
      6881,
    )
  })

  it('should aggregate total downloaded/uploaded from peers', () => {
    // Create a mock peer
    const mockSocket = {
      onData: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as ITcpSocket

    const peer = new PeerConnection(mockEngine, mockSocket, {
      remoteAddress: '1.2.3.4',
      remotePort: 6881,
    })
    torrent.addPeer(peer)

    // Simulate peer events
    peer.emit('bytesDownloaded', 100)
    peer.emit('bytesUploaded', 50)

    expect(torrent.totalDownloaded).toBe(100)
    expect(torrent.totalUploaded).toBe(50)

    // Add another peer
    const peer2 = new PeerConnection(mockEngine, mockSocket, {
      remoteAddress: '1.2.3.5',
      remotePort: 6882,
    })
    torrent.addPeer(peer2)

    peer2.emit('bytesDownloaded', 200)
    expect(torrent.totalDownloaded).toBe(300)
  })

  it('should calculate aggregate speed', () => {
    const mockSocket = {
      onData: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
    } as unknown as ITcpSocket

    const peer1 = new PeerConnection(mockEngine, mockSocket, {
      remoteAddress: '1.2.3.4',
      remotePort: 6881,
    })
    const peer2 = new PeerConnection(mockEngine, mockSocket, {
      remoteAddress: '1.2.3.5',
      remotePort: 6882,
    })

    // Mock speed getters
    vi.spyOn(peer1, 'downloadSpeed', 'get').mockReturnValue(100)
    vi.spyOn(peer1, 'uploadSpeed', 'get').mockReturnValue(50)
    vi.spyOn(peer2, 'downloadSpeed', 'get').mockReturnValue(200)
    vi.spyOn(peer2, 'uploadSpeed', 'get').mockReturnValue(100)

    torrent.addPeer(peer1)
    torrent.addPeer(peer2)

    expect(torrent.downloadSpeed).toBe(300)
    expect(torrent.uploadSpeed).toBe(150)
  })
})
