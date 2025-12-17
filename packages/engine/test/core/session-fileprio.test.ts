import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { InMemoryFileSystem, MemorySessionStore } from '../../src/adapters/memory'
import { ISocketFactory } from '../../src/interfaces/socket'
import { Bencode } from '../../src/utils/bencode'
import { StorageRootManager } from '../../src/storage/storage-root-manager'

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

function createEngine(fs: InMemoryFileSystem, sessionStore: MemorySessionStore): BtEngine {
  const srm = new StorageRootManager(() => fs)
  srm.addRoot({ key: 'default', label: 'Default', path: '/downloads' })
  srm.setDefaultRoot('default')

  return new BtEngine({
    socketFactory: mockSocketFactory,
    storageRootManager: srm,
    sessionStore,
    startSuspended: true,
  })
}

/**
 * Create a multi-file torrent buffer.
 */
function createMultiFileTorrent(opts: {
  name: string
  files: { path: string; length: number }[]
  pieceLength: number
}): Uint8Array {
  const totalSize = opts.files.reduce((sum, f) => sum + f.length, 0)
  const piecesCount = Math.ceil(totalSize / opts.pieceLength)
  const pieces = new Uint8Array(piecesCount * 20)

  return Bencode.encode({
    announce: 'http://tracker.example.com',
    info: {
      name: opts.name,
      'piece length': opts.pieceLength,
      pieces,
      files: opts.files.map((f) => ({
        length: f.length,
        path: f.path.split('/'),
      })),
    },
  })
}

describe('Session File Priority Persistence', () => {
  let fileSystem: InMemoryFileSystem
  let sessionStore: MemorySessionStore
  let engine: BtEngine

  beforeEach(() => {
    fileSystem = new InMemoryFileSystem()
    sessionStore = new MemorySessionStore()
    engine = createEngine(fileSystem, sessionStore)
  })

  describe('save', () => {
    it('filePriorities saved on priority change', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 20000 },
          { path: 'b.txt', length: 20000 },
          { path: 'c.txt', length: 20000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      const infoHash = Buffer.from(torrent.infoHash).toString('hex')

      // Skip file 1
      torrent.setFilePriority(1, 1)

      // Wait for async save
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Check persisted state
      const state = await engine.sessionPersistence!.loadTorrentState(infoHash)
      expect(state).not.toBeNull()
      expect(state!.filePriorities).toBeDefined()
      expect(state!.filePriorities).toEqual([0, 1, 0])
    })

    it('filePriorities array matches file count', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 10000 },
          { path: 'b.txt', length: 10000 },
          { path: 'c.txt', length: 10000 },
          { path: 'd.txt', length: 10000 },
          { path: 'e.txt', length: 10000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      const infoHash = Buffer.from(torrent.infoHash).toString('hex')

      // Skip some files
      torrent.setFilePriority(0, 1)
      torrent.setFilePriority(2, 1)
      torrent.setFilePriority(4, 1)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const state = await engine.sessionPersistence!.loadTorrentState(infoHash)
      expect(state!.filePriorities).toHaveLength(5)
      expect(state!.filePriorities).toEqual([1, 0, 1, 0, 1])
    })
  })

  describe('restore', () => {
    it('filePriorities restored on load', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 20000 },
          { path: 'b.txt', length: 20000 },
          { path: 'c.txt', length: 20000 },
          { path: 'd.txt', length: 20000 },
        ],
        pieceLength: 16384,
      })

      // Engine 1: Add torrent, set priorities, save
      const torrent1 = await engine.addTorrent(buffer)
      if (!torrent1) throw new Error('Torrent is null')

      torrent1.setFilePriority(0, 1)
      torrent1.setFilePriority(2, 1)

      await engine.sessionPersistence!.saveTorrentList()
      await engine.sessionPersistence!.saveTorrentState(torrent1)

      // Save torrent file for reload
      const infoHash = Buffer.from(torrent1.infoHash).toString('hex')
      await engine.sessionPersistence!.saveTorrentFile(infoHash, buffer)

      // Engine 2: Fresh load
      const engine2 = createEngine(fileSystem, sessionStore)
      await engine2.restoreSession()

      expect(engine2.torrents.length).toBe(1)
      const torrent2 = engine2.torrents[0]

      // Verify priorities restored
      expect(torrent2.filePriorities).toEqual([1, 0, 1, 0])
      expect(torrent2.pieceClassification[0]).toBe('blacklisted') // file 0 skipped
    })

    it('missing filePriorities defaults to all normal', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 20000 },
          { path: 'b.txt', length: 20000 },
        ],
        pieceLength: 16384,
      })

      // Add torrent but don't set any file priorities
      const torrent1 = await engine.addTorrent(buffer)
      if (!torrent1) throw new Error('Torrent is null')

      await engine.sessionPersistence!.saveTorrentList()
      // Save state without any file priority changes (filePriorities will be undefined or empty)
      await engine.sessionPersistence!.saveTorrentState(torrent1)

      const infoHash = Buffer.from(torrent1.infoHash).toString('hex')
      await engine.sessionPersistence!.saveTorrentFile(infoHash, buffer)

      // Engine 2: Fresh load
      const engine2 = createEngine(fileSystem, sessionStore)
      await engine2.restoreSession()

      const torrent2 = engine2.torrents[0]
      // Should be all normal (all 0s)
      expect(torrent2.filePriorities.every((p) => p === 0)).toBe(true)
    })
  })

  describe('piece classification after restore', () => {
    it('piece classification correct after restore with skipped files', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      // Engine 1: Set up with skipped file
      const torrent1 = await engine.addTorrent(buffer)
      if (!torrent1) throw new Error('Torrent is null')

      torrent1.setFilePriority(0, 1) // Skip file A

      await engine.sessionPersistence!.saveTorrentList()
      await engine.sessionPersistence!.saveTorrentState(torrent1)
      const infoHash = Buffer.from(torrent1.infoHash).toString('hex')
      await engine.sessionPersistence!.saveTorrentFile(infoHash, buffer)

      // Engine 2: Restore
      const engine2 = createEngine(fileSystem, sessionStore)
      await engine2.restoreSession()

      const torrent2 = engine2.torrents[0]

      // Verify classification matches
      expect(torrent2.pieceClassification[0]).toBe('blacklisted') // Entirely in A
      expect(torrent2.pieceClassification[3]).toBe('boundary') // Spans A and B
      expect(torrent2.pieceClassification[4]).toBe('wanted') // Entirely in B
    })
  })

  describe('restoreFilePriorities validation', () => {
    it('ignores priorities if length mismatches file count', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 20000 },
          { path: 'b.txt', length: 20000 },
          { path: 'c.txt', length: 20000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Try to restore with wrong length array
      torrent.restoreFilePriorities([1, 0]) // Only 2 elements, but 3 files

      // Should be ignored - all remain normal
      expect(torrent.filePriorities).toEqual([0, 0, 0])
    })

    it('ignores if no metadata', async () => {
      // Add via magnet (no metadata)
      const magnetLink = 'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=Test'
      const torrent = await engine.addTorrent(magnetLink)
      if (!torrent) throw new Error('Torrent is null')

      expect(torrent.hasMetadata).toBe(false)

      // Try to restore - should be no-op since no metadata
      torrent.restoreFilePriorities([1, 0, 1])

      // No crash, just ignored
      expect(torrent.filePriorities).toEqual([])
    })
  })

  describe('batch operations', () => {
    it('setFilePriorities triggers single save', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 20000 },
          { path: 'b.txt', length: 20000 },
          { path: 'c.txt', length: 20000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      const infoHash = Buffer.from(torrent.infoHash).toString('hex')

      // Batch update
      const priorities = new Map([
        [0, 1],
        [1, 1],
        [2, 0],
      ])
      torrent.setFilePriorities(priorities)

      await new Promise((resolve) => setTimeout(resolve, 50))

      const state = await engine.sessionPersistence!.loadTorrentState(infoHash)
      expect(state!.filePriorities).toEqual([1, 1, 0])
    })
  })
})
