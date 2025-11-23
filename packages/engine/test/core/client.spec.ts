/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Client } from '../../src/core/client'
import { Torrent } from '../../src/core/torrent'
import { MemoryFileSystem } from '../mocks/memory-filesystem'
import { ISocketFactory } from '../../src/interfaces/socket'

// Mock dependencies
const mockSocketFactory: ISocketFactory = {
  createTcpSocket: vi.fn(),
  createUdpSocket: vi.fn(),
}

// Mock Torrent
vi.mock('../../src/core/torrent', () => {
  return {
    Torrent: class MockTorrent {
      public infoHash: Uint8Array
      public on = vi.fn()
      public stop = vi.fn()
      constructor(infoHash: Uint8Array) {
        this.infoHash = infoHash
      }
    },
  }
})

describe('Client', () => {
  let client: Client
  let fileSystem: MemoryFileSystem

  beforeEach(() => {
    fileSystem = new MemoryFileSystem()
    client = new Client({
      downloadPath: '/downloads',
      socketFactory: mockSocketFactory,
      fileSystem: fileSystem,
    })
  })

  it('should add a torrent instance', () => {
    const infoHash = new Uint8Array(20).fill(1)
    const torrent = new Torrent(infoHash, {} as any, {} as any, {} as any)

    client.addTorrentInstance(torrent)
    expect(client.torrents).toContain(torrent)
  })

  it('should get a torrent by infoHash', () => {
    const infoHash = new Uint8Array(20).fill(0xab)
    const torrent = new Torrent(infoHash, {} as any, {} as any, {} as any)
    client.addTorrentInstance(torrent)

    const hex = Buffer.from(infoHash).toString('hex')
    const found = client.getTorrent(hex)
    expect(found).toBe(torrent)
  })

  it('should remove a torrent', () => {
    const infoHash = new Uint8Array(20).fill(2)
    const torrent = new Torrent(infoHash, {} as any, {} as any, {} as any)
    client.addTorrentInstance(torrent)

    client.removeTorrent(torrent)
    expect(client.torrents).not.toContain(torrent)
    expect(torrent.stop).toHaveBeenCalled()
  })

  it('should destroy client and stop all torrents', () => {
    const t1 = new Torrent(new Uint8Array(20).fill(1), {} as any, {} as any, {} as any)
    const t2 = new Torrent(new Uint8Array(20).fill(2), {} as any, {} as any, {} as any)
    client.addTorrentInstance(t1)
    client.addTorrentInstance(t2)

    client.destroy()
    expect(client.torrents.length).toBe(0)
    expect(t1.stop).toHaveBeenCalled()
    expect(t2.stop).toHaveBeenCalled()
  })
})
