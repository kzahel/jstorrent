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

describe('Piece Selection Filtering', () => {
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

  describe('shouldRequestPiece()', () => {
    it('blacklisted piece returns false', async () => {
      // File A: 0-50000, File B: 50000-100000
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip file A - pieces 0,1,2 are entirely in A (blacklisted)
      torrent.setFilePriority(0, 1)

      expect(torrent.pieceClassification[0]).toBe('blacklisted')
      expect(torrent.shouldRequestPiece(0)).toBe(false)
      expect(torrent.shouldRequestPiece(1)).toBe(false)
      expect(torrent.shouldRequestPiece(2)).toBe(false)
    })

    it('boundary piece returns true', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip file A - piece 3 spans A and B (boundary)
      torrent.setFilePriority(0, 1)

      expect(torrent.pieceClassification[3]).toBe('boundary')
      expect(torrent.shouldRequestPiece(3)).toBe(true)
    })

    it('wanted piece returns true', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // All files normal - all pieces wanted
      expect(torrent.pieceClassification[0]).toBe('wanted')
      expect(torrent.shouldRequestPiece(0)).toBe(true)
    })

    it('already have piece returns false regardless of classification', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Piece 0 is wanted
      expect(torrent.pieceClassification[0]).toBe('wanted')

      // But we already have it
      torrent.bitfield!.set(0, true)

      expect(torrent.shouldRequestPiece(0)).toBe(false)
    })
  })

  describe('filtering in download context', () => {
    it('excludes blacklisted from needed pieces', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip file A
      torrent.setFilePriority(0, 1)

      // Count how many pieces should be requested
      let requestablePieces = 0
      for (let i = 0; i < torrent.piecesCount; i++) {
        if (torrent.shouldRequestPiece(i)) {
          requestablePieces++
        }
      }

      // Should exclude blacklisted pieces (0,1,2) but include boundary (3) and wanted (4,5,6)
      const blacklistedCount = torrent.pieceClassification.filter((c) => c === 'blacklisted').length

      expect(requestablePieces).toBe(torrent.piecesCount - blacklistedCount)
    })

    it('includes boundary pieces in needed count', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip file A
      torrent.setFilePriority(0, 1)

      // Piece 3 is boundary
      expect(torrent.pieceClassification[3]).toBe('boundary')
      expect(torrent.shouldRequestPiece(3)).toBe(true)
    })

    it('excludes already-have pieces', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Complete pieces 0, 1, 2
      torrent.bitfield!.set(0, true)
      torrent.bitfield!.set(1, true)
      torrent.bitfield!.set(2, true)

      // Count requestable
      let requestablePieces = 0
      for (let i = 0; i < torrent.piecesCount; i++) {
        if (torrent.shouldRequestPiece(i)) {
          requestablePieces++
        }
      }

      expect(requestablePieces).toBe(torrent.piecesCount - 3)
    })
  })

  describe('combined filtering', () => {
    it('piece cannot be requested if blacklisted OR already have', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip file A -> pieces 0,1,2 blacklisted
      torrent.setFilePriority(0, 1)

      // Complete pieces 4,5
      torrent.bitfield!.set(4, true)
      torrent.bitfield!.set(5, true)

      // Piece 0: blacklisted -> false
      expect(torrent.shouldRequestPiece(0)).toBe(false)

      // Piece 3: boundary, don't have -> true
      expect(torrent.shouldRequestPiece(3)).toBe(true)

      // Piece 4: wanted but have -> false
      expect(torrent.shouldRequestPiece(4)).toBe(false)

      // Piece 6: wanted, don't have -> true
      expect(torrent.shouldRequestPiece(6)).toBe(true)
    })
  })

  describe('reclassification affects shouldRequestPiece', () => {
    it('un-skipping file makes blacklisted pieces requestable', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip file A
      torrent.setFilePriority(0, 1)
      expect(torrent.shouldRequestPiece(0)).toBe(false)

      // Un-skip file A
      torrent.setFilePriority(0, 0)
      expect(torrent.shouldRequestPiece(0)).toBe(true)
    })

    it('skipping file makes wanted pieces blacklisted and non-requestable', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Initially wanted
      expect(torrent.shouldRequestPiece(0)).toBe(true)

      // Skip file A
      torrent.setFilePriority(0, 1)
      expect(torrent.shouldRequestPiece(0)).toBe(false)
    })
  })

  describe('no file priorities set', () => {
    it('all pieces are requestable when no priorities set', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 50000 },
          { path: 'fileB.txt', length: 50000 },
        ],
        pieceLength: 16384,
      })

      const { torrent } = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // All pieces should be requestable (default is all normal)
      for (let i = 0; i < torrent.piecesCount; i++) {
        expect(torrent.shouldRequestPiece(i)).toBe(true)
      }
    })
  })
})
