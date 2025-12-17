import { describe, it, expect, beforeEach, vi } from 'vitest'
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

/**
 * Create a single-file torrent buffer.
 */
function createSingleFileTorrent(opts: {
  name: string
  fileSize: number
  pieceLength: number
}): Uint8Array {
  const piecesCount = Math.ceil(opts.fileSize / opts.pieceLength)
  const pieces = new Uint8Array(piecesCount * 20)

  return Bencode.encode({
    announce: 'http://tracker.example.com',
    info: {
      name: opts.name,
      'piece length': opts.pieceLength,
      pieces,
      length: opts.fileSize,
    },
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

describe('File Skip Prevention', () => {
  let fileSystem: InMemoryFileSystem
  let engine: BtEngine

  beforeEach(() => {
    fileSystem = new InMemoryFileSystem()
    engine = new BtEngine({
      downloadPath: '/downloads',
      socketFactory: mockSocketFactory,
      fileSystem: fileSystem,
      startSuspended: true,
    })
  })

  describe('isFileComplete detection', () => {
    it('returns false when no pieces are complete', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      expect(torrent.isFileComplete(0)).toBe(false)
    })

    it('returns true when all pieces for file are complete', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000, // 4 pieces (0-3)
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Mark all pieces as complete via bitfield
      for (let i = 0; i < torrent.piecesCount; i++) {
        torrent.bitfield!.set(i, true)
      }

      expect(torrent.isFileComplete(0)).toBe(true)
    })

    it('returns false when some pieces are missing', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000, // 4 pieces
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Mark only some pieces as complete
      torrent.bitfield!.set(0, true)
      torrent.bitfield!.set(1, true)
      // Pieces 2 and 3 are missing

      expect(torrent.isFileComplete(0)).toBe(false)
    })

    it('checks only pieces that touch the specific file', async () => {
      // File A: 0-50000, File B: 50000-100000
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // File A spans pieces 0-3 (piece 3 is boundary)
      // File B spans pieces 3-6 (piece 3 is boundary)

      // Complete only file B's pieces (4, 5, 6) plus boundary (3)
      torrent.bitfield!.set(3, true) // boundary
      torrent.bitfield!.set(4, true)
      torrent.bitfield!.set(5, true)
      torrent.bitfield!.set(6, true)

      // File A is not complete (pieces 0,1,2 missing)
      expect(torrent.isFileComplete(0)).toBe(false)

      // File B is complete (pieces 3,4,5,6 all set)
      expect(torrent.isFileComplete(1)).toBe(true)
    })
  })

  describe('skip prevention on completed files', () => {
    it('file with all pieces complete cannot be skipped', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Complete all pieces
      for (let i = 0; i < torrent.piecesCount; i++) {
        torrent.bitfield!.set(i, true)
      }

      // Attempt to skip - should be rejected
      const changed = torrent.setFilePriority(0, 1)

      expect(changed).toBe(false)
      expect(torrent.filePriorities[0]).toBe(0) // Still normal
    })

    it('file with some pieces complete can be skipped', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Only complete pieces 0,1,2 (missing piece 3)
      torrent.bitfield!.set(0, true)
      torrent.bitfield!.set(1, true)
      torrent.bitfield!.set(2, true)

      // Attempt to skip - should be allowed
      const changed = torrent.setFilePriority(0, 1)

      expect(changed).toBe(true)
      expect(torrent.filePriorities[0]).toBe(1)
    })

    it('file with no pieces complete can be skipped', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // No pieces complete (default state)
      const changed = torrent.setFilePriority(0, 1)

      expect(changed).toBe(true)
      expect(torrent.filePriorities[0]).toBe(1)
    })
  })

  describe('multi-select skip', () => {
    it('mixed completion: only incomplete files skipped', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'complete.txt', length: 16384 }, // 1 piece
          { path: 'partial.txt', length: 16384 }, // 1 piece
          { path: 'empty.txt', length: 16384 }, // 1 piece
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // File 0: complete (piece 0)
      torrent.bitfield!.set(0, true)
      // File 1: partial (some bytes but piece not complete = still counts as incomplete)
      // File 2: empty

      // Try to skip all three
      const priorities = new Map([
        [0, 1], // complete - should be rejected
        [1, 1], // incomplete - should be accepted
        [2, 1], // empty - should be accepted
      ])

      const changed = torrent.setFilePriorities(priorities)

      expect(changed).toBe(2) // Only 2 files changed
      expect(torrent.filePriorities[0]).toBe(0) // Complete - still normal
      expect(torrent.filePriorities[1]).toBe(1) // Skipped
      expect(torrent.filePriorities[2]).toBe(1) // Skipped
    })

    it('all complete: none skipped', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 16384 },
          { path: 'b.txt', length: 16384 },
          { path: 'c.txt', length: 16384 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Complete all pieces
      for (let i = 0; i < torrent.piecesCount; i++) {
        torrent.bitfield!.set(i, true)
      }

      // Try to skip all
      const priorities = new Map([
        [0, 1],
        [1, 1],
        [2, 1],
      ])

      const changed = torrent.setFilePriorities(priorities)

      expect(changed).toBe(0) // None changed
      expect(torrent.filePriorities[0]).toBe(0)
      expect(torrent.filePriorities[1]).toBe(0)
      expect(torrent.filePriorities[2]).toBe(0)
    })

    it('all incomplete: all skipped', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 16384 },
          { path: 'b.txt', length: 16384 },
          { path: 'c.txt', length: 16384 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // No pieces complete
      const priorities = new Map([
        [0, 1],
        [1, 1],
        [2, 1],
      ])

      const changed = torrent.setFilePriorities(priorities)

      expect(changed).toBe(3) // All changed
      expect(torrent.filePriorities[0]).toBe(1)
      expect(torrent.filePriorities[1]).toBe(1)
      expect(torrent.filePriorities[2]).toBe(1)
    })
  })

  describe('single-file torrent', () => {
    it('100% complete cannot be skipped', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 32768, // 2 pieces
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Complete all
      torrent.bitfield!.set(0, true)
      torrent.bitfield!.set(1, true)

      const changed = torrent.setFilePriority(0, 1)
      expect(changed).toBe(false)
    })

    it('partial (< 100%) can be skipped', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 32768, // 2 pieces
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Only 50% complete
      torrent.bitfield!.set(0, true)

      const changed = torrent.setFilePriority(0, 1)
      expect(changed).toBe(true)
      expect(torrent.filePriorities[0]).toBe(1)
    })
  })

  describe('un-skip (restore priority)', () => {
    it('skipped file can be un-skipped', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip then un-skip
      torrent.setFilePriority(0, 1)
      expect(torrent.filePriorities[0]).toBe(1)

      const changed = torrent.setFilePriority(0, 0)
      expect(changed).toBe(true)
      expect(torrent.filePriorities[0]).toBe(0)
    })

    it('setting same priority returns false (no change)', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Already normal (0)
      const changed = torrent.setFilePriority(0, 0)
      expect(changed).toBe(false)
    })
  })

  describe('boundary cases', () => {
    it('handles invalid file index gracefully', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Invalid indices
      expect(torrent.setFilePriority(-1, 1)).toBe(false)
      expect(torrent.setFilePriority(999, 1)).toBe(false)
    })

    it('handles torrent without metadata', async () => {
      // Add magnet (no metadata)
      const magnetLink = 'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=Test'
      const torrent = await engine.addTorrent(magnetLink)
      if (!torrent) throw new Error('Torrent is null')

      // No metadata - operations should fail gracefully
      expect(torrent.setFilePriority(0, 1)).toBe(false)
      expect(torrent.isFileComplete(0)).toBe(false)
    })
  })
})
