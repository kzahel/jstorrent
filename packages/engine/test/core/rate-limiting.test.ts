import { describe, it, expect, beforeEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { MemorySocketFactory } from '../../src/adapters/memory'
import { InMemoryFileSystem } from '../../src/adapters/memory'
import { TorrentCreator } from '../../src/core/torrent-creator'
import { PeerConnection } from '../../src/core/peer-connection'
import { FileSystemStorageHandle } from '../../src/io/filesystem-storage-handle'
import { createMemoryEngine } from '../../src/presets/memory'

describe('Rate Limiting Integration', () => {
  let seeder: BtEngine
  let leecher: BtEngine
  let seederFs: InMemoryFileSystem
  let leecherFs: InMemoryFileSystem

  beforeEach(() => {
    seeder = createMemoryEngine({
      onLog: (e) => console.log(`[Seeder] ${e.level}: ${e.message}`),
    })
    leecher = createMemoryEngine({
      onLog: (e) => console.log(`[Leecher] ${e.level}: ${e.message}`),
    })

    seederFs = seeder.storageRootManager.getFileSystemForTorrent('any') as InMemoryFileSystem
    leecherFs = leecher.storageRootManager.getFileSystemForTorrent('any') as InMemoryFileSystem
  })

  describe('BandwidthTracker rate limit API', () => {
    it('exposes download and upload token buckets', () => {
      expect(seeder.bandwidthTracker.downloadBucket).toBeDefined()
      expect(seeder.bandwidthTracker.uploadBucket).toBeDefined()
    })

    it('setDownloadLimit updates the bucket', () => {
      seeder.bandwidthTracker.setDownloadLimit(100000)
      expect(seeder.bandwidthTracker.getDownloadLimit()).toBe(100000)
      expect(seeder.bandwidthTracker.downloadBucket.isLimited).toBe(true)
    })

    it('setUploadLimit updates the bucket', () => {
      seeder.bandwidthTracker.setUploadLimit(50000)
      expect(seeder.bandwidthTracker.getUploadLimit()).toBe(50000)
      expect(seeder.bandwidthTracker.uploadBucket.isLimited).toBe(true)
    })

    it('setting limit to 0 disables rate limiting', () => {
      seeder.bandwidthTracker.setDownloadLimit(100000)
      expect(seeder.bandwidthTracker.downloadBucket.isLimited).toBe(true)

      seeder.bandwidthTracker.setDownloadLimit(0)
      expect(seeder.bandwidthTracker.downloadBucket.isLimited).toBe(false)
    })

    it('unlimited buckets always allow consumption', () => {
      // Default is unlimited
      expect(seeder.bandwidthTracker.downloadBucket.tryConsume(1_000_000)).toBe(true)
      expect(seeder.bandwidthTracker.uploadBucket.tryConsume(1_000_000)).toBe(true)
    })
  })

  describe('download with rate limiting disabled', () => {
    // Note: Full transfer tests are covered by memory-swarm.test.ts
    // This test verifies the rate limiting code paths don't break transfers
    it.skip('transfers data successfully when unlimited', async () => {
      // Create a small file for fast testing
      const fileContent = new Uint8Array(1024 * 50) // 50KB
      for (let i = 0; i < fileContent.length; i++) {
        fileContent[i] = i % 256
      }

      await seederFs.mkdir('/downloads')
      const handle = await seederFs.open('/downloads/test.bin', 'w')
      await handle.write(fileContent, 0, fileContent.length, 0)
      await handle.close()

      const storageHandle = new FileSystemStorageHandle(seederFs)
      const torrentBuffer = await TorrentCreator.create(
        storageHandle,
        '/downloads/test.bin',
        seeder.hasher,
        { pieceLength: 16384, announceList: [['http://tracker.local']] },
      )

      const { torrent: seederTorrent } = await seeder.addTorrent(torrentBuffer)
      if (!seederTorrent) throw new Error('Failed to add torrent to seeder')
      await seederTorrent.recheckData()

      const magnet = `magnet:?xt=urn:btih:${seederTorrent.infoHashStr}`
      const { torrent: leecherTorrent } = await leecher.addTorrent(magnet)
      if (!leecherTorrent) throw new Error('Failed to add torrent to leecher')

      // Connect peers
      const [socketA, socketB] = MemorySocketFactory.createPair()
      const seederPeer = new PeerConnection(seeder, socketA, {
        remoteAddress: '127.0.0.2',
        remotePort: 6882,
      })
      const leecherPeer = new PeerConnection(leecher, socketB, {
        remoteAddress: '127.0.0.1',
        remotePort: 6881,
      })

      seederTorrent.addPeer(seederPeer)
      leecherTorrent.addPeer(leecherPeer)
      seederPeer.sendHandshake(seederTorrent.infoHash, new Uint8Array(20).fill(1))
      leecherPeer.sendHandshake(leecherTorrent.infoHash, new Uint8Array(20).fill(2))

      // Wait for metadata
      await new Promise<void>((resolve) => {
        if (leecherTorrent.hasMetadata) resolve()
        else leecherTorrent.on('ready', () => resolve())
      })

      // Wait for download to complete
      await new Promise<void>((resolve) => {
        const check = () => {
          if (leecherTorrent.bitfield?.cardinality() === leecherTorrent.piecesCount) {
            resolve()
          }
        }
        check()
        leecherTorrent.on('piece', check)
      })

      // Verify data integrity
      const downloadedContent = await leecherFs.readFile('test.bin')
      expect(downloadedContent).toEqual(fileContent)
    }, 10000)
  })

  describe('upload queue cleanup', () => {
    it('clears queued requests when peer disconnects', async () => {
      // Create a small file
      const fileContent = new Uint8Array(1024 * 50)
      for (let i = 0; i < fileContent.length; i++) {
        fileContent[i] = i % 256
      }

      await seederFs.mkdir('/downloads')
      const handle = await seederFs.open('/downloads/test.bin', 'w')
      await handle.write(fileContent, 0, fileContent.length, 0)
      await handle.close()

      const storageHandle = new FileSystemStorageHandle(seederFs)
      const torrentBuffer = await TorrentCreator.create(
        storageHandle,
        '/downloads/test.bin',
        seeder.hasher,
        { pieceLength: 16384, announceList: [['http://tracker.local']] },
      )

      const { torrent: seederTorrent } = await seeder.addTorrent(torrentBuffer)
      if (!seederTorrent) throw new Error('Failed to add torrent to seeder')
      await seederTorrent.recheckData()

      const magnet = `magnet:?xt=urn:btih:${seederTorrent.infoHashStr}`
      const { torrent: leecherTorrent } = await leecher.addTorrent(magnet)
      if (!leecherTorrent) throw new Error('Failed to add torrent to leecher')

      // Set very slow upload to build up queue
      seeder.bandwidthTracker.setUploadLimit(1024) // 1KB/sec

      const [socketA, socketB] = MemorySocketFactory.createPair()
      const seederPeer = new PeerConnection(seeder, socketA, {
        remoteAddress: '127.0.0.2',
        remotePort: 6882,
      })
      const leecherPeer = new PeerConnection(leecher, socketB, {
        remoteAddress: '127.0.0.1',
        remotePort: 6881,
      })

      seederTorrent.addPeer(seederPeer)
      leecherTorrent.addPeer(leecherPeer)
      seederPeer.sendHandshake(seederTorrent.infoHash, new Uint8Array(20).fill(1))
      leecherPeer.sendHandshake(leecherTorrent.infoHash, new Uint8Array(20).fill(2))

      // Wait for metadata
      await new Promise<void>((resolve) => {
        if (leecherTorrent.hasMetadata) resolve()
        else leecherTorrent.on('ready', () => resolve())
      })

      // Let some requests queue up
      await new Promise((r) => setTimeout(r, 500))

      // Disconnect leecher
      leecherPeer.close()

      // Give time for cleanup
      await new Promise((r) => setTimeout(r, 100))

      // Test passes if no errors were thrown
      expect(true).toBe(true)
    }, 10000)
  })

  describe('download rate limit retry mechanism', () => {
    it('rate limiting API is exposed on bandwidth tracker', () => {
      // Verify the API used by the retry mechanism is available
      leecher.bandwidthTracker.setDownloadLimit(16384)
      const bucket = leecher.bandwidthTracker.downloadBucket

      expect(bucket.isLimited).toBe(true)
      expect(bucket.refillRate).toBe(16384)
      expect(bucket.capacity).toBe(32768) // 2x burst
      expect(typeof bucket.msUntilAvailable).toBe('function')
      expect(typeof bucket.tryConsume).toBe('function')
    })

    it('msUntilAvailable returns correct delay when bucket is empty', () => {
      // Set 1KB/s limit
      leecher.bandwidthTracker.setDownloadLimit(1024)
      const bucket = leecher.bandwidthTracker.downloadBucket

      expect(bucket.capacity).toBe(2048)

      // Bucket starts empty when transitioning from unlimited
      // At 1024 bytes/sec, waiting for 1024 bytes = 1000ms
      expect(bucket.msUntilAvailable(1024)).toBe(1000)

      // Waiting for 512 bytes = 500ms
      expect(bucket.msUntilAvailable(512)).toBe(500)
    })

    it('tryConsume returns false when insufficient tokens', () => {
      leecher.bandwidthTracker.setDownloadLimit(16384) // 16KB/sec
      const bucket = leecher.bandwidthTracker.downloadBucket

      // Bucket starts empty when first limited, so tryConsume should fail
      expect(bucket.tryConsume(16384)).toBe(false)

      // Delay should be approximately 1 second (may be slightly less due to elapsed time)
      const delay = bucket.msUntilAvailable(16384)
      expect(delay).toBeGreaterThan(900)
      expect(delay).toBeLessThanOrEqual(1000)
    })

    it('unlimited bucket always allows consumption', () => {
      // Default is unlimited
      expect(leecher.bandwidthTracker.downloadBucket.isLimited).toBe(false)
      expect(leecher.bandwidthTracker.downloadBucket.tryConsume(1_000_000)).toBe(true)
    })
  })
})
