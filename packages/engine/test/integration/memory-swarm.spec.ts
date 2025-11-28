import { describe, it, expect, beforeEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { MemorySocketFactory } from '../../src/adapters/memory'
import { InMemoryFileSystem } from '../../src/adapters/memory'
import { TorrentCreator } from '../../src/core/torrent-creator'
import { PeerConnection } from '../../src/core/peer-connection'
import { ISocketFactory, ITcpSocket, IUdpSocket } from '../../src/interfaces/socket'
import { FileSystemStorageHandle } from '../../src/io/filesystem-storage-handle'

// Mock Socket Factory for Client (though we manually connect peers in this test)
class MockSocketFactory implements ISocketFactory {
  createTcpSocket(_host?: string, _port?: number): Promise<ITcpSocket> {
    throw new Error('Method not implemented.')
  }
  createUdpSocket(_bindAddr?: string, _bindPort?: number): Promise<IUdpSocket> {
    throw new Error('Method not implemented.')
  }
  createTcpServer() {
    return {
      on: () => {},
      listen: () => {},
      address: () => ({ port: 0 }),
      close: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as any // Cast to any to satisfy strict interface if needed, but we want to avoid explicit any error.
    // Actually, let's just use 'as any' with disable comment if we must, or better, return a partial mock.
    // The interface expects a Server.
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapTcpSocket(_socket: any): ITcpSocket {
    throw new Error('Method not implemented.')
  }
}

describe('Memory Swarm Integration', () => {
  let clientA: BtEngine
  let clientB: BtEngine
  let fsA: InMemoryFileSystem
  let fsB: InMemoryFileSystem

  beforeEach(() => {
    fsA = new InMemoryFileSystem()
    fsB = new InMemoryFileSystem()

    clientA = new BtEngine({
      downloadPath: '/downloads',
      fileSystem: fsA,
      socketFactory: new MockSocketFactory(),
    })

    clientB = new BtEngine({
      downloadPath: '/downloads',
      fileSystem: fsB,
      socketFactory: new MockSocketFactory(),
    })
  })

  it('should transfer metadata and pieces between two in-memory clients', async () => {
    // 1. Create a torrent file
    const fileContent = new Uint8Array(1024 * 50).fill(1) // 50KB file
    // Fill with some pattern to verify data
    for (let i = 0; i < fileContent.length; i++) {
      fileContent[i] = i % 256
    }

    // Write file to fsA so TorrentCreator can read it
    const filename = 'test.txt'
    const fileHandle = await fsA.open(filename, 'w')
    await fileHandle.write(fileContent, 0, fileContent.length, 0)
    await fileHandle.close()

    const storageHandle = new FileSystemStorageHandle(fsA)
    const torrentBuffer = await TorrentCreator.create(storageHandle, filename, {
      pieceLength: 16384,
      announceList: [['http://tracker.local']],
    })

    // 2. Add torrent to Client A (Seeder)
    const torrentA = await clientA.addTorrent(torrentBuffer)
    expect(torrentA.infoHash).toBeDefined()

    // Verify A has data
    // Since we wrote the file to fsA root, and Client downloads to /downloads,
    // we might have a path mismatch if Client expects files in /downloads.
    // TorrentContentStorage uses `storageHandle` which uses `fs`.
    // If we open `test.txt`, it opens relative to fs root?
    // InMemoryFileSystem handles paths.
    // Client options has `downloadPath: '/downloads'`.
    // TorrentContentStorage usually joins downloadPath with file path.
    // Let's check TorrentContentStorage.
    // But wait, TorrentCreator used the file at root.
    // If Client expects it at /downloads/test.txt, we need to move it or configure Client.
    // Or we can just write it to /downloads/test.txt initially?
    // But TorrentCreator needs to find it.
    // Let's write to /downloads/test.txt and pass that to TorrentCreator.

    // Re-write file to correct location for Client A
    await fsA.mkdir('/downloads')
    const fileHandleA = await fsA.open('/downloads/test.txt', 'w')
    await fileHandleA.write(fileContent, 0, fileContent.length, 0)
    await fileHandleA.close()

    // We also need it for TorrentCreator.
    // If we pass '/downloads/test.txt' to TorrentCreator, the name in torrent will be 'test.txt' (basename).
    // That matches what Client expects (name in torrent).

    // Re-create torrent from the file in /downloads
    const torrentBuffer2 = await TorrentCreator.create(storageHandle, '/downloads/test.txt', {
      pieceLength: 16384,
      announceList: [['http://tracker.local']],
    })

    // Add torrent to Client A
    // We need to clear previous add if any (but we haven't added yet in this flow)
    // Actually we added it above, let's redo.

    // Reset client A for clean state
    clientA = new BtEngine({
      downloadPath: '/downloads',
      fileSystem: fsA,
      socketFactory: new MockSocketFactory(),
    })

    const torrentA2 = await clientA.addTorrent(torrentBuffer2)

    // Now verify data
    await torrentA2.recheckData()
    expect(torrentA2.bitfield?.cardinality()).toBe(torrentA2.pieceManager?.getPieceCount())

    // 3. Add torrent to Client B via Magnet (Leecher)
    const magnetLink = `magnet:?xt=urn:btih:${torrentA2.infoHashStr}&tr=http://tracker.local`
    const torrentB = await clientB.addTorrent(magnetLink)

    expect(torrentB.metadataComplete).toBe(false)
    expect(torrentB.pieceManager).toBeUndefined()

    // 4. Connect A and B
    const [socketA, socketB] = MemorySocketFactory.createPair()

    const peerA = new PeerConnection(clientA, socketA) // Connection FROM A TO B? No, socketA is A's end.
    const peerB = new PeerConnection(clientB, socketB) // Connection FROM B TO A.

    // Add peers to torrents
    // We need to simulate incoming connection or outgoing.
    // Let's just add them directly.
    torrentA2.addPeer(peerA)
    torrentB.addPeer(peerB)

    // Trigger handshakes
    // In our implementation, addPeer doesn't automatically send handshake?
    // We commented it out in Torrent.ts: // peer.sendHandshake(...)
    // So we must manually trigger.

    // Peer B sends handshake to A
    // Note: B doesn't have full info yet, but it has infoHash from magnet.
    console.log('Sending handshakes...')
    peerA.sendHandshake(torrentA2.infoHash, new Uint8Array(20).fill(1)) // PeerID A
    peerB.sendHandshake(torrentB.infoHash, new Uint8Array(20).fill(2)) // PeerID B

    // Wait for metadata transfer
    console.log('Waiting for metadata...')
    await new Promise<void>((resolve) => {
      if (torrentB.metadataComplete) resolve()
      torrentB.on('metadata', () => {
        console.log('Metadata received!')
        resolve()
      })
    })

    expect(torrentB.metadataComplete).toBe(true)
    expect(torrentB.pieceManager).toBeDefined()
    expect(torrentB.metadataSize).toBeGreaterThan(0)

    // 5. Verify Piece Transfer
    // B should now be interested in A
    // A should unchoke B
    // B should request pieces

    console.log('Waiting for pieces...')
    // We need to wait for B to finish downloading
    await new Promise<void>((resolve) => {
      const check = () => {
        const received = torrentB.bitfield?.cardinality()
        const total = torrentB.pieceManager?.getPieceCount()
        console.log(`Progress: ${received}/${total}`)
        if (received === total) resolve()
      }
      if (torrentB.bitfield?.cardinality() === torrentB.pieceManager?.getPieceCount()) resolve()
      torrentB.on('piece', check)
    })

    // Verify data on B
    // Note: BtEngine doesn't currently prepend downloadPath to files, so it writes to root (or relative path in torrent)
    const downloadedContent = await fsB.readFile('test.txt')
    expect(downloadedContent).toEqual(fileContent)
  }, 10000)
})
