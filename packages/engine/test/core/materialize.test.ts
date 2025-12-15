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

describe('Materialization', () => {
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

  describe('materializeEligiblePieces()', () => {
    it('materializes piece when file is un-skipped', async () => {
      // Create torrent with boundary piece scenario
      // File A: 0-50000, File B: 50000-100000
      // Piece 3 (49152-65536) spans both files
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

      // Skip file A - piece 3 becomes boundary
      torrent.setFilePriority(0, 1)
      expect(torrent.pieceClassification[3]).toBe('boundary')

      // Simulate having piece 3 verified and in .parts
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(3)
      torrent.bitfield!.set(3, true)

      // Create a mock PartsFile with the piece data
      const pieceData = new Uint8Array(16384).fill(0xab)
      // @ts-expect-error - accessing private member for testing
      if (torrent._partsFile) {
        // @ts-expect-error - accessing private member for testing
        torrent._partsFile.addPiece(3, pieceData)
      }

      // Un-skip file A - should trigger materialization
      torrent.setFilePriority(0, 0)

      // Wait a tick for async materialization
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Piece should no longer be in partsFilePieces
      expect(torrent.partsFilePieces.has(3)).toBe(false)
      // Piece should still be in bitfield (verified)
      expect(torrent.bitfield!.get(3)).toBe(true)
      // Classification should now be 'wanted'
      expect(torrent.pieceClassification[3]).toBe('wanted')
    })

    it('does not materialize if piece classification is still boundary', async () => {
      // File A, B, C scenario where un-skipping one still leaves boundary
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

      // Skip files A and C
      torrent.setFilePriority(0, 1)
      torrent.setFilePriority(2, 1)

      // Piece 0 spans A and B - boundary
      // Piece 1 spans B and C - boundary
      expect(torrent.pieceClassification[0]).toBe('boundary')

      // Simulate piece 0 in .parts
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(0)
      torrent.bitfield!.set(0, true)

      // Un-skip only file C (piece 0 still touches skipped A)
      torrent.setFilePriority(2, 0)

      await new Promise((resolve) => setTimeout(resolve, 50))

      // Piece 0 should still be in .parts (still touches skipped A)
      expect(torrent.partsFilePieces.has(0)).toBe(true)
    })

    it('returns 0 when no pieces to materialize', async () => {
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

      // No pieces in .parts
      const count = await torrent.materializeEligiblePieces()
      expect(count).toBe(0)
    })
  })

  describe('canServePiece during materialization', () => {
    it('piece in .parts cannot be served', async () => {
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

      // Piece 3 is verified and in .parts
      torrent.bitfield!.set(3, true)
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(3)

      expect(torrent.canServePiece(3)).toBe(false)
    })

    it('piece becomes serveable after materialization', async () => {
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

      // Initially in .parts
      torrent.bitfield!.set(3, true)
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(3)
      expect(torrent.canServePiece(3)).toBe(false)

      // Simulate materialization (remove from partsFilePieces)
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.delete(3)
      expect(torrent.canServePiece(3)).toBe(true)
    })
  })

  describe('advertised bitfield after materialization', () => {
    it('advertised bitfield gains the bit after materialization', async () => {
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

      // Piece 3 verified but in .parts
      torrent.bitfield!.set(3, true)
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(3)

      // Advertised should NOT have piece 3
      let advertised = torrent.getAdvertisedBitfield()
      expect(advertised!.get(3)).toBe(false)

      // Materialize (remove from partsFilePieces)
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.delete(3)

      // Advertised should now have piece 3
      advertised = torrent.getAdvertisedBitfield()
      expect(advertised!.get(3)).toBe(true)
    })
  })

  describe('.parts file cleanup', () => {
    it('piece is removed from .parts tracking after materialization', async () => {
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

      // Setup: piece 3 is boundary and in .parts
      torrent.setFilePriority(0, 1)
      expect(torrent.pieceClassification[3]).toBe('boundary')

      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(3)
      torrent.bitfield!.set(3, true)

      // Setup mock partsFile data
      // @ts-expect-error - accessing private member for testing
      if (torrent._partsFile) {
        // @ts-expect-error - accessing private member for testing
        torrent._partsFile.addPiece(3, new Uint8Array(16384))
      }

      expect(torrent.partsFilePieces.size).toBe(1)

      // Un-skip triggers materialization
      torrent.setFilePriority(0, 0)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(torrent.partsFilePieces.size).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('handles torrent with no partsFile gracefully', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [{ path: 'single.txt', length: 50000 }],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Clear partsFile reference
      // @ts-expect-error - accessing private member for testing
      torrent._partsFile = undefined

      const count = await torrent.materializeEligiblePieces()
      expect(count).toBe(0)
    })

    it('handles empty partsFilePieces set', async () => {
      const buffer = createMultiFileTorrent({
        name: 'test-folder',
        files: [{ path: 'single.txt', length: 50000 }],
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      expect(torrent.partsFilePieces.size).toBe(0)

      const count = await torrent.materializeEligiblePieces()
      expect(count).toBe(0)
    })
  })
})
