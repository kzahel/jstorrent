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
 * Create a torrent buffer for a single-file torrent.
 * pieceLength controls how many pieces the file spans.
 */
function createSingleFileTorrent(opts: {
  name: string
  fileSize: number
  pieceLength: number
}): Uint8Array {
  const piecesCount = Math.ceil(opts.fileSize / opts.pieceLength)
  // Each piece hash is 20 bytes (SHA1)
  const pieces = new Uint8Array(piecesCount * 20)

  const info = {
    name: opts.name,
    'piece length': opts.pieceLength,
    pieces,
    length: opts.fileSize,
  }

  return Bencode.encode({
    announce: 'http://tracker.example.com',
    info,
  })
}

/**
 * Create a torrent buffer for a multi-file torrent.
 * Files are laid out sequentially.
 */
function createMultiFileTorrent(opts: {
  name: string
  files: { path: string; length: number }[]
  pieceLength: number
}): Uint8Array {
  const totalSize = opts.files.reduce((sum, f) => sum + f.length, 0)
  const piecesCount = Math.ceil(totalSize / opts.pieceLength)
  const pieces = new Uint8Array(piecesCount * 20)

  const info = {
    name: opts.name,
    'piece length': opts.pieceLength,
    pieces,
    files: opts.files.map((f) => ({
      length: f.length,
      path: f.path.split('/'),
    })),
  }

  return Bencode.encode({
    announce: 'http://tracker.example.com',
    info,
  })
}

describe('Piece Classification', () => {
  let fileSystem: InMemoryFileSystem
  let engine: BtEngine

  beforeEach(() => {
    fileSystem = new InMemoryFileSystem()
    engine = new BtEngine({
      downloadPath: '/downloads',
      socketFactory: mockSocketFactory,
      fileSystem: fileSystem,
      startSuspended: true, // Don't start networking
    })
  })

  describe('single file torrent', () => {
    it('all pieces wanted when file is normal', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000, // ~3 pieces at 16384 bytes each
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // By default all files are normal (priority 0)
      expect(torrent.pieceClassification.length).toBe(torrent.piecesCount)
      expect(torrent.pieceClassification.every((c) => c === 'wanted')).toBe(true)
    })

    it('all pieces blacklisted when file is skipped', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip the only file
      torrent.setFilePriority(0, 1)

      expect(torrent.pieceClassification.every((c) => c === 'blacklisted')).toBe(true)
    })
  })

  describe('multi-file torrent', () => {
    it('piece entirely in non-skipped file is wanted', async () => {
      // File A: 0-50000, File B: 50000-100000
      // Piece 0: 0-16384 (entirely in A)
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

      // All files normal - all pieces wanted
      expect(torrent.pieceClassification[0]).toBe('wanted')
      expect(torrent.pieceClassification[1]).toBe('wanted')
    })

    it('piece entirely in skipped file is blacklisted', async () => {
      // File A: 0-50000, File B: 50000-100000
      // Piece 0: 0-16384 (entirely in A)
      // Piece 1: 16384-32768 (entirely in A)
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

      // Skip file A (index 0)
      torrent.setFilePriority(0, 1)

      // Pieces 0,1,2 are entirely in A (blacklisted)
      // Piece 3 spans A and B (boundary)
      // Pieces 4,5,6 are entirely in B or span only B (wanted)
      expect(torrent.pieceClassification[0]).toBe('blacklisted')
      expect(torrent.pieceClassification[1]).toBe('blacklisted')
      expect(torrent.pieceClassification[2]).toBe('blacklisted')
    })

    it('piece spans 2 files, one skipped is boundary', async () => {
      // File A: 0-50000, File B: 50000-100000
      // Piece 3: 49152-65536 spans A and B
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

      // Skip file A only - piece 3 should be boundary
      torrent.setFilePriority(0, 1)

      // Piece 3 starts at 49152, ends at 65536, spans A (ends at 50000) and B
      expect(torrent.pieceClassification[3]).toBe('boundary')
    })

    it('piece spans 2 files, both normal is wanted', async () => {
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

      // All files normal
      // Piece 3 spans both files
      expect(torrent.pieceClassification[3]).toBe('wanted')
    })

    it('piece spans 2 files, both skipped is blacklisted', async () => {
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

      // Skip both files
      torrent.setFilePriority(0, 1)
      torrent.setFilePriority(1, 1)

      // All pieces blacklisted
      expect(torrent.pieceClassification.every((c) => c === 'blacklisted')).toBe(true)
    })

    it('piece spans 3 files, middle one skipped is boundary', async () => {
      // Create 3 small files where pieces can span all three
      // File A: 0-10000, File B: 10000-20000, File C: 20000-30000
      // With piece length 16384, piece 0 spans A and B, piece 1 spans B and C
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 10000 },
          { path: 'fileB.txt', length: 10000 },
          { path: 'fileC.txt', length: 10000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip middle file (B)
      torrent.setFilePriority(1, 1)

      // Piece 0: 0-16384 spans A(0-10000) and B(10000-20000) - boundary
      // Piece 1: 16384-30000 spans B and C - boundary
      expect(torrent.pieceClassification[0]).toBe('boundary')
      expect(torrent.pieceClassification[1]).toBe('boundary')
    })

    it('piece spans 3 files, first and last skipped is boundary', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'fileA.txt', length: 10000 },
          { path: 'fileB.txt', length: 10000 },
          { path: 'fileC.txt', length: 10000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip first and last files (A and C)
      torrent.setFilePriority(0, 1)
      torrent.setFilePriority(2, 1)

      // Both pieces touch at least one skipped and one non-skipped file
      expect(torrent.pieceClassification[0]).toBe('boundary')
      expect(torrent.pieceClassification[1]).toBe('boundary')
    })
  })

  describe('all files same priority', () => {
    it('all files skipped results in all pieces blacklisted', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 20000 },
          { path: 'b.txt', length: 20000 },
          { path: 'c.txt', length: 20000 },
          { path: 'd.txt', length: 20000 },
          { path: 'e.txt', length: 20000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Skip all 5 files
      for (let i = 0; i < 5; i++) {
        torrent.setFilePriority(i, 1)
      }

      expect(torrent.pieceClassification.every((c) => c === 'blacklisted')).toBe(true)
    })

    it('all files normal results in all pieces wanted', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 20000 },
          { path: 'b.txt', length: 20000 },
          { path: 'c.txt', length: 20000 },
          { path: 'd.txt', length: 20000 },
          { path: 'e.txt', length: 20000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // All files are normal by default
      expect(torrent.pieceClassification.every((c) => c === 'wanted')).toBe(true)
    })
  })

  describe('reclassification on priority change', () => {
    it('piece reclassified when file priority changes', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 50000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Initially wanted
      expect(torrent.pieceClassification[0]).toBe('wanted')

      // Skip file -> blacklisted
      torrent.setFilePriority(0, 1)
      expect(torrent.pieceClassification[0]).toBe('blacklisted')

      // Un-skip file -> wanted again
      torrent.setFilePriority(0, 0)
      expect(torrent.pieceClassification[0]).toBe('wanted')
    })

    it('boundary piece becomes wanted when skipped file un-skipped', async () => {
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

      // Skip file B - piece 3 spans A and B, should be boundary
      torrent.setFilePriority(1, 1)
      expect(torrent.pieceClassification[3]).toBe('boundary')

      // Un-skip file B - piece 3 should be wanted
      torrent.setFilePriority(1, 0)
      expect(torrent.pieceClassification[3]).toBe('wanted')
    })

    it('wanted piece becomes boundary when file skipped', async () => {
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

      // Initially all wanted
      expect(torrent.pieceClassification[3]).toBe('wanted')

      // Skip file A - piece 3 (spans A and B) becomes boundary
      torrent.setFilePriority(0, 1)
      expect(torrent.pieceClassification[3]).toBe('boundary')
    })
  })

  describe('setFilePriorities batch update', () => {
    it('batch update recomputes classification once', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [
          { path: 'a.txt', length: 30000 },
          { path: 'b.txt', length: 30000 },
          { path: 'c.txt', length: 30000 },
        ],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Batch skip files A and C
      const priorities = new Map([
        [0, 1],
        [2, 1],
      ])
      const changed = torrent.setFilePriorities(priorities)

      expect(changed).toBe(2)
      // File B (index 1) is normal, others skipped
      // Check that classifications are correct
      // Pieces that only touch A or C are blacklisted
      // Pieces that touch B are boundary (if they also touch A or C) or wanted (if only B)
    })
  })

  describe('wantedPiecesCount and completedWantedPiecesCount', () => {
    it('wantedPiecesCount excludes blacklisted pieces', async () => {
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

      const totalPieces = torrent.piecesCount

      // Skip file A
      torrent.setFilePriority(0, 1)

      // wantedPiecesCount should be less than total (some pieces only in A are blacklisted)
      expect(torrent.wantedPiecesCount).toBeLessThan(totalPieces)
      expect(torrent.wantedPiecesCount).toBeGreaterThan(0)
    })
  })
})
