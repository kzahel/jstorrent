import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '../../src/core/client'
import { TorrentCreator } from '../../src/core/torrent-creator'
import { ScopedNodeFileSystem } from '../../src/io/node/scoped-node-filesystem'
import { NodeSocketFactory } from '../../src/io/node/node-socket'
import { NodeStorageHandle } from '../../src/io/node/node-storage-handle'
// @ts-expect-error - bittorrent-tracker has no types
import { Server } from 'bittorrent-tracker'
import * as crypto from 'crypto'
import path from 'path'
import os from 'os'
import fs from 'fs'

describe('UDP Tracker Integration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let trackerServer: any
  let trackerPort: number
  let trackerUrl: string
  let tmpDir: string
  let socketFactory: NodeSocketFactory

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'udp-tracker-test-'))
    socketFactory = new NodeSocketFactory()
    // Start local UDP tracker
    trackerServer = new Server({
      udp: true,
      http: false,
      ws: false,
    })

    await new Promise<void>((resolve) => {
      trackerServer.listen(0, () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        trackerPort = (trackerServer as any).udp.address().port
        trackerUrl = `udp://127.0.0.1:${trackerPort}`
        console.log(`Tracker listening on ${trackerUrl}`)
        resolve()
      })
    })
  })

  afterAll(() => {
    trackerServer.close()
  })

  it('should discover peers via UDP tracker and download file', async () => {
    // Create random file
    const filePath = path.join(tmpDir, 'test.txt')
    const fileContent = crypto.randomBytes(1024 * 1024) // 1MB
    fs.writeFileSync(filePath, fileContent)

    // Create torrent
    const storage = new NodeStorageHandle('test', 'test', tmpDir)
    const torrentBuffer = await TorrentCreator.create(storage, 'test.txt', {
      announceList: [[trackerUrl]], // Use local UDP tracker
      pieceLength: 16 * 1024,
    })

    // Client A (Seeder)
    const clientA = new Client({
      socketFactory,
      fileSystem: new ScopedNodeFileSystem(tmpDir),
      downloadPath: tmpDir,
      port: 6882,
    })

    // Client B (Leecher)
    const downloadDir = path.join(tmpDir, 'download')
    fs.mkdirSync(downloadDir, { recursive: true })

    const clientB = new Client({
      socketFactory,
      fileSystem: new ScopedNodeFileSystem(downloadDir),
      downloadPath: downloadDir,
      port: 6883,
    })

    // Add torrent to Client A (Seeding)
    const torrentA = await clientA.addTorrent(torrentBuffer)
    console.log('Client A added torrent, rechecking data...')
    await torrentA.recheckData()
    console.log('Client A recheck complete')

    // Add torrent to Client B (Leeching)
    const torrentB = await clientB.addTorrent(torrentBuffer)
    console.log('Client B added torrent')

    torrentB.on('wire', () => console.log('Client B: Wire connected'))
    torrentB.on('download', (bytes) => console.log(`Client B: Downloaded ${bytes} bytes`))
    torrentB.on('done', () => console.log('Client B: Download done'))

    // Wait for discovery and download
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout waiting for download'))
      }, 30000) // 30s timeout

      torrentB.on('complete', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    // Verify file content
    const downloadedContent = fs.readFileSync(path.join(downloadDir, 'test.txt'))
    expect(downloadedContent.equals(fileContent)).toBe(true)

    // Cleanup
    clientA.destroy()
    clientB.destroy()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }, 40000)
})
