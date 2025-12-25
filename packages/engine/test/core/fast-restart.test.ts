import { describe, it, expect, beforeEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { MemorySocketFactory } from '../../src/adapters/memory'
import { InMemoryFileSystem } from '../../src/adapters/memory'
import { TorrentCreator } from '../../src/core/torrent-creator'
import { PeerConnection } from '../../src/core/peer-connection'
import { FileSystemStorageHandle } from '../../src/io/filesystem-storage-handle'
import { createMemoryEngine } from '../../src/presets/memory'

describe('Fast Restart', () => {
  let seeder: BtEngine
  let leecher: BtEngine
  let fsSeeder: InMemoryFileSystem
  let fsLeecher: InMemoryFileSystem

  beforeEach(() => {
    seeder = createMemoryEngine({
      onLog: (e) => console.log(`[S] ${e.level}: ${e.message}`, ...e.args),
    })
    leecher = createMemoryEngine({
      onLog: (e) => console.log(`[L] ${e.level}: ${e.message}`, ...e.args),
    })

    // Get filesystems (same pattern as memory-swarm.test.ts)
    fsSeeder = seeder.storageRootManager.getFileSystemForTorrent('any') as InMemoryFileSystem
    fsLeecher = leecher.storageRootManager.getFileSystemForTorrent('any') as InMemoryFileSystem
  })

  it('should start downloading within 1 second of restart', async () => {
    // 1. Create file content (256KB = 16 pieces at 16KB each)
    // Use larger file so download doesn't complete before restart
    const fileContent = new Uint8Array(1024 * 256).fill(1)
    for (let i = 0; i < fileContent.length; i++) {
      fileContent[i] = i % 256
    }

    // Write file to root first (for TorrentCreator)
    const filename = 'test.txt'
    const fileHandle = await fsSeeder.open(filename, 'w')
    await fileHandle.write(fileContent, 0, fileContent.length, 0)
    await fileHandle.close()

    const storageHandle = new FileSystemStorageHandle(fsSeeder)
    const torrentBuffer = await TorrentCreator.create(storageHandle, filename, seeder.hasher, {
      pieceLength: 16384,
      announceList: [['http://tracker.local']],
    })

    // Add first torrent (to get infoHash)
    const { torrent: tempTorrent } = await seeder.addTorrent(torrentBuffer)
    if (!tempTorrent) throw new Error('Failed to add temp torrent')

    // Re-write file to /downloads path (where client expects it)
    await fsSeeder.mkdir('/downloads')
    const fileHandleDownloads = await fsSeeder.open('/downloads/test.txt', 'w')
    await fileHandleDownloads.write(fileContent, 0, fileContent.length, 0)
    await fileHandleDownloads.close()

    // Re-create torrent from /downloads path
    const torrentBuffer2 = await TorrentCreator.create(
      storageHandle,
      '/downloads/test.txt',
      seeder.hasher,
      {
        pieceLength: 16384,
        announceList: [['http://tracker.local']],
      },
    )

    // Add second torrent and recheck
    const { torrent: seederTorrent } = await seeder.addTorrent(torrentBuffer2)
    if (!seederTorrent) throw new Error('Failed to add seeder torrent')
    await seederTorrent.recheckData()

    // Verify seeder has all pieces
    console.log(
      `Seeder has ${seederTorrent.bitfield?.cardinality()}/${seederTorrent.piecesCount} pieces`,
    )
    expect(seederTorrent.bitfield?.cardinality()).toBe(seederTorrent.piecesCount)

    // Add leecher via magnet
    const magnet = `magnet:?xt=urn:btih:${seederTorrent.infoHashStr}&tr=http://tracker.local`
    const { torrent: leecherTorrent } = await leecher.addTorrent(magnet)
    if (!leecherTorrent) throw new Error('Failed to add leecher torrent')

    // Connect peers (same pattern as memory-swarm.test.ts)
    const [socketS, socketL] = MemorySocketFactory.createPair()
    const peerS = new PeerConnection(seeder, socketS, {
      remoteAddress: '127.0.0.2',
      remotePort: 6882,
    })
    const peerL = new PeerConnection(leecher, socketL, {
      remoteAddress: '127.0.0.1',
      remotePort: 6881,
    })

    seederTorrent.addPeer(peerS)
    leecherTorrent.addPeer(peerL)

    // Trigger handshakes
    peerS.sendHandshake(seederTorrent.infoHash, new Uint8Array(20).fill(1))
    peerL.sendHandshake(leecherTorrent.infoHash, new Uint8Array(20).fill(2))

    // Wait for metadata
    await new Promise<void>((resolve) => {
      if (leecherTorrent.hasMetadata) resolve()
      leecherTorrent.on('ready', resolve)
    })
    console.log('Metadata received')

    // Wait for at least one piece (proves transfer works)
    console.log('Waiting for first piece...')
    await new Promise<void>((resolve) => {
      const check = () => {
        const received = leecherTorrent.bitfield?.cardinality() ?? 0
        const total = leecherTorrent.piecesCount
        console.log(`Progress: ${received}/${total}`)
        if (received > 0) resolve()
      }
      if ((leecherTorrent.bitfield?.cardinality() ?? 0) > 0) {
        resolve()
        return
      }
      leecherTorrent.on('piece', check)
    })
    console.log('Got first piece')

    // STOP and record pieces received
    const piecesBeforeStop = leecherTorrent.bitfield?.cardinality() || 0
    const totalPieces = leecherTorrent.piecesCount
    console.log(`Stopping with ${piecesBeforeStop}/${totalPieces} pieces`)

    // Close old connections explicitly so they don't continue downloading
    peerS.close()
    peerL.close()

    leecherTorrent.userStop()

    // Brief pause for cleanup
    await new Promise((r) => setTimeout(r, 100))

    // Verify we're not already complete
    expect(piecesBeforeStop).toBeLessThan(totalPieces)

    // Reconnect with new sockets
    const [socketS2, socketL2] = MemorySocketFactory.createPair()
    const peerS2 = new PeerConnection(seeder, socketS2, {
      remoteAddress: '127.0.0.2',
      remotePort: 6883,
    })
    const peerL2 = new PeerConnection(leecher, socketL2, {
      remoteAddress: '127.0.0.1',
      remotePort: 6882,
    })

    // START and measure time to first new piece
    const startTime = Date.now()
    leecherTorrent.userStart()

    seederTorrent.addPeer(peerS2)
    leecherTorrent.addPeer(peerL2)

    peerS2.sendHandshake(seederTorrent.infoHash, new Uint8Array(20).fill(3))
    peerL2.sendHandshake(leecherTorrent.infoHash, new Uint8Array(20).fill(4))

    // Wait for a new piece (or timeout)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Download did not resume within 2s')),
        2000,
      )
      leecherTorrent.on('piece', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    const elapsed = Date.now() - startTime
    console.log(`Time to first piece after restart: ${elapsed}ms`)

    // Should be less than 1 second (not 5 seconds!)
    expect(elapsed).toBeLessThan(1000)
  }, 15000)
})
