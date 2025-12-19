import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { InMemoryFileSystem } from '../../src/adapters/memory'
import { ISocketFactory } from '../../src/interfaces/socket'
import { Bencode } from '../../src/utils/bencode'

// Mock dependencies
const mockSocketFactory: ISocketFactory = {
  createTcpSocket: vi.fn(),
  createUdpSocket: vi.fn().mockResolvedValue({
    send: vi.fn(),
    onMessage: vi.fn(),
    close: vi.fn(),
  }),
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

    const { torrent } = await client.addTorrent(buffer)
    if (!torrent) throw new Error('Torrent is null')

    expect(torrent).toBeDefined()
    expect(client.torrents).toContain(torrent)
    expect(torrent.hasMetadata).toBe(true)
    expect(torrent.piecesCount).toBe(1)
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
    const { torrent } = await client.addTorrent(magnetLink)
    if (!torrent) throw new Error('Torrent is null')

    expect(torrent).toBeDefined()
    expect(client.torrents).toContain(torrent)
    expect(Buffer.from(torrent.infoHash).toString('hex')).toBe(
      'c12fe1c06bba254a9dc9f519b335aa7c1367a88a',
    )
    expect(torrent.announce).toContain('udp://tracker.opentrackr.org:1337/announce')
    expect(torrent.hasMetadata).toBe(false)
    expect(torrent.contentStorage).toBeUndefined()
  }, 10000)

  it('should get a torrent by infoHash', async () => {
    const info = {
      name: 'test-torrent-2',
      'piece length': 16384,
      pieces: new Uint8Array(20),
      length: 1000,
    }
    const buffer = Bencode.encode({
      announce: 'http://tracker.example.com',
      info,
    })

    const { torrent } = await client.addTorrent(buffer)
    if (!torrent) throw new Error('Torrent is null')

    const hex = Buffer.from(torrent.infoHash).toString('hex')
    const found = client.getTorrent(hex)
    expect(found).toBe(torrent)
  })

  it('should remove a torrent', async () => {
    const info = {
      name: 'test-torrent-3',
      'piece length': 16384,
      pieces: new Uint8Array(20),
      length: 1000,
    }
    const buffer = Bencode.encode({
      announce: 'http://tracker.example.com',
      info,
    })

    const { torrent } = await client.addTorrent(buffer)
    if (!torrent) throw new Error('Torrent is null')

    // Mock stop method
    const originalStop = torrent.stop
    torrent.stop = vi.fn().mockImplementation(originalStop)

    await client.removeTorrent(torrent)
    expect(client.torrents).not.toContain(torrent)
    expect(torrent.stop).toHaveBeenCalled()
  })

  it('should destroy client and stop all torrents', async () => {
    const info1 = {
      name: 'test-torrent-4',
      'piece length': 16384,
      pieces: new Uint8Array(20),
      length: 1000,
    }
    const buffer1 = Bencode.encode({ info: info1 })

    const info2 = {
      name: 'test-torrent-5',
      'piece length': 16384,
      pieces: new Uint8Array(20),
      length: 1000,
    }
    const buffer2 = Bencode.encode({ info: info2 })

    const { torrent: t1 } = await client.addTorrent(buffer1)
    const { torrent: t2 } = await client.addTorrent(buffer2)

    if (!t1 || !t2) throw new Error('Failed to create torrents')

    const stop1 = vi.spyOn(t1, 'stop')
    const stop2 = vi.spyOn(t2, 'stop')

    await client.destroy()
    expect(client.torrents.length).toBe(0)
    expect(stop1).toHaveBeenCalled()
    expect(stop2).toHaveBeenCalled()
  })
})
