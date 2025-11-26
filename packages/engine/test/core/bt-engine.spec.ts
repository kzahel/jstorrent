/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { Torrent } from '../../src/core/torrent'
import { InMemoryFileSystem } from '../../src/io/memory/memory-filesystem'
import { ISocketFactory } from '../../src/interfaces/socket'
import { Bencode } from '../../src/utils/bencode'
import { PieceManager } from '../../src/core/piece-manager'
import { TorrentContentStorage } from '../../src/core/torrent-content-storage'
import { BitField } from '../../src/utils/bitfield'

// Mock dependencies
const mockSocketFactory: ISocketFactory = {
  createTcpSocket: vi.fn(),
  createUdpSocket: vi.fn(),
  createTcpServer: vi.fn().mockReturnValue({
    on: vi.fn(),
    listen: vi.fn(),
    address: vi.fn().mockReturnValue({ port: 0 }),
  }),
  wrapTcpSocket: vi.fn(),
}

describe('BtEngine', () => {
  let fileSystem: InMemoryFileSystem
  let client: BtEngine

  beforeEach(() => {
    fileSystem = new InMemoryFileSystem()
    client = new BtEngine({
      downloadPath: '/downloads',
      socketFactory: mockSocketFactory,
      fileSystem: fileSystem,
    })
  })

  it('should add a torrent from a buffer', async () => {
    // Create a mock torrent file buffer
    const info = {
      name: 'test-torrent',
      'piece length': 16384,
      pieces: new Uint8Array(20), // One piece (SHA1 hash length)
      length: 1000,
    }

    const torrentDict = {
      announce: 'http://tracker.example.com',
      info: info,
    }

    const buffer = Bencode.encode(torrentDict)

    const torrent = await client.addTorrent(buffer)

    expect(torrent).toBeDefined()
    expect(client.torrents).toContain(torrent)
    expect(torrent.pieceManager).toBeDefined()
    expect(torrent.pieceManager?.getPieceCount()).toBe(1)
    expect(torrent.contentStorage).toBeDefined()
    expect(torrent.infoHash).toBeDefined()
    expect(torrent.infoHash.length).toBe(20)
  })

  it('should throw on invalid buffer', async () => {
    const buffer = new Uint8Array([0, 1, 2, 3]) // Not bencoded
    await expect(client.addTorrent(buffer)).rejects.toThrow()
  })

  it('should add a torrent from a magnet link', async () => {
    const magnetLink =
      'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=Test+Torrent&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce'
    const torrent = await client.addTorrent(magnetLink)

    expect(torrent).toBeDefined()
    expect(client.torrents).toContain(torrent)
    expect(Buffer.from(torrent.infoHash).toString('hex')).toBe(
      'c12fe1c06bba254a9dc9f519b335aa7c1367a88a',
    )
    expect(torrent.announce).toContain('udp://tracker.opentrackr.org:1337/announce')
    expect(torrent.pieceManager).toBeUndefined()
    expect(torrent.contentStorage).toBeUndefined()
  })

  it('should add a torrent instance (manual)', () => {
    const infoHash = new Uint8Array(20).fill(1)
    // Create dependencies for manual Torrent creation
    const pieceManager = new PieceManager(1, 16384, 1000)
    const contentStorage = new TorrentContentStorage({} as any)
    const bitfield = new BitField(1)

    const torrent = new Torrent(
      infoHash,
      new Uint8Array(20).fill(0),
      mockSocketFactory,
      0,
      pieceManager,
      contentStorage,
      bitfield,
    )

    client.addTorrentInstance(torrent)
    expect(client.torrents).toContain(torrent)
  })

  it('should get a torrent by infoHash', () => {
    const infoHash = new Uint8Array(20).fill(0xab)
    const pieceManager = new PieceManager(1, 16384, 1000)
    const contentStorage = new TorrentContentStorage({} as any)
    const bitfield = new BitField(1)
    const torrent = new Torrent(
      infoHash,
      new Uint8Array(20).fill(0),
      mockSocketFactory,
      0,
      pieceManager,
      contentStorage,
      bitfield,
    )

    client.addTorrentInstance(torrent)

    const hex = Buffer.from(infoHash).toString('hex')
    const found = client.getTorrent(hex)
    expect(found).toBe(torrent)
  })

  it('should remove a torrent', () => {
    const infoHash = new Uint8Array(20).fill(2)
    const pieceManager = new PieceManager(1, 16384, 1000)
    const contentStorage = new TorrentContentStorage({} as any)
    const bitfield = new BitField(1)
    const torrent = new Torrent(
      infoHash,
      new Uint8Array(20).fill(0),
      mockSocketFactory,
      0,
      pieceManager,
      contentStorage,
      bitfield,
    )

    // Mock stop method
    torrent.stop = vi.fn()

    client.addTorrentInstance(torrent)

    client.removeTorrent(torrent)
    expect(client.torrents).not.toContain(torrent)
    expect(torrent.stop).toHaveBeenCalled()
  })

  it('should destroy client and stop all torrents', () => {
    const t1 = new Torrent(
      new Uint8Array(20).fill(1),
      new Uint8Array(20).fill(0),
      mockSocketFactory,
      0,
      new PieceManager(1, 100, 100),
      {} as any,
      new BitField(1),
    )
    const t2 = new Torrent(
      new Uint8Array(20).fill(2),
      new Uint8Array(20).fill(0),
      mockSocketFactory,
      0,
      new PieceManager(1, 100, 100),
      {} as any,
      new BitField(1),
    )

    t1.stop = vi.fn()
    t2.stop = vi.fn()

    client.addTorrentInstance(t1)
    client.addTorrentInstance(t2)

    client.destroy()
    expect(client.torrents.length).toBe(0)
    expect(t1.stop).toHaveBeenCalled()
    expect(t2.stop).toHaveBeenCalled()
  })
})
