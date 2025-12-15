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

describe('Advertised Bitfield', () => {
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

  describe('no .parts pieces', () => {
    it('advertised equals internal when partsFilePieces empty', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000, // 5 pieces
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Set some pieces as complete in internal bitfield
      torrent.bitfield!.set(0, true)
      torrent.bitfield!.set(2, true)
      torrent.bitfield!.set(4, true)

      // partsFilePieces is empty by default
      expect(torrent.partsFilePieces.size).toBe(0)

      // Advertised should equal internal
      const advertised = torrent.getAdvertisedBitfield()
      expect(advertised).toBeDefined()
      expect(advertised!.get(0)).toBe(true)
      expect(advertised!.get(1)).toBe(false)
      expect(advertised!.get(2)).toBe(true)
      expect(advertised!.get(3)).toBe(false)
      expect(advertised!.get(4)).toBe(true)
    })
  })

  describe('with .parts pieces', () => {
    it('masks off pieces in .parts', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000, // 5 pieces
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Set all pieces as complete in internal bitfield
      for (let i = 0; i < torrent.piecesCount; i++) {
        torrent.bitfield!.set(i, true)
      }

      // Simulate pieces 1 and 3 being in .parts
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(1)
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(3)

      // Advertised should mask off pieces 1 and 3
      const advertised = torrent.getAdvertisedBitfield()
      expect(advertised).toBeDefined()
      expect(advertised!.get(0)).toBe(true)
      expect(advertised!.get(1)).toBe(false) // In .parts, masked off
      expect(advertised!.get(2)).toBe(true)
      expect(advertised!.get(3)).toBe(false) // In .parts, masked off
      expect(advertised!.get(4)).toBe(true)
    })

    it('piece not in internal stays 0 in advertised', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000, // 5 pieces
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Internal: only pieces 0 and 2 are set
      torrent.bitfield!.set(0, true)
      torrent.bitfield!.set(2, true)

      // Even if we mark piece 1 in .parts (which shouldn't happen normally
      // since you can't have a piece in .parts that isn't in internal bitfield)
      // the advertised should still be 0
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(1)

      const advertised = torrent.getAdvertisedBitfield()
      expect(advertised).toBeDefined()
      expect(advertised!.get(0)).toBe(true)
      expect(advertised!.get(1)).toBe(false) // Wasn't in internal anyway
      expect(advertised!.get(2)).toBe(true)
    })

    it('internal bitfield is not modified when getting advertised', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000, // 5 pieces
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Set all pieces in internal
      for (let i = 0; i < torrent.piecesCount; i++) {
        torrent.bitfield!.set(i, true)
      }

      // Add piece 2 to .parts
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(2)

      // Get advertised (which masks piece 2)
      const advertised = torrent.getAdvertisedBitfield()
      expect(advertised!.get(2)).toBe(false)

      // Internal should NOT be modified
      expect(torrent.bitfield!.get(2)).toBe(true)
    })
  })

  describe('canServePiece()', () => {
    it('returns true for piece in internal bitfield not in .parts', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      torrent.bitfield!.set(0, true)

      expect(torrent.canServePiece(0)).toBe(true)
    })

    it('returns false for piece in .parts', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      torrent.bitfield!.set(0, true)
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(0)

      expect(torrent.canServePiece(0)).toBe(false)
    })

    it('returns false for piece not in internal bitfield', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Piece 0 not set in bitfield
      expect(torrent.canServePiece(0)).toBe(false)
    })
  })

  describe('getAdvertisedBitfield returns clone', () => {
    it('returns new BitField instance', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      torrent.bitfield!.set(0, true)

      // Add piece to .parts to force clone path
      // @ts-expect-error - accessing private member for testing
      torrent._partsFilePieces.add(1)

      const advertised1 = torrent.getAdvertisedBitfield()
      const advertised2 = torrent.getAdvertisedBitfield()

      // Should be different instances
      expect(advertised1).not.toBe(advertised2)
    })

    it('when no .parts pieces, returns internal bitfield reference', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      torrent.bitfield!.set(0, true)

      // No .parts pieces
      const advertised1 = torrent.getAdvertisedBitfield()
      const advertised2 = torrent.getAdvertisedBitfield()

      // With no .parts pieces, implementation returns same reference
      // (optimization to avoid cloning when not needed)
      expect(advertised1).toBe(torrent.bitfield)
      expect(advertised2).toBe(torrent.bitfield)
    })
  })

  describe('edge cases', () => {
    it('handles empty bitfield', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000,
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // No pieces set
      const advertised = torrent.getAdvertisedBitfield()
      expect(advertised).toBeDefined()
      expect(advertised!.hasNone()).toBe(true)
    })

    it('handles all pieces in .parts', async () => {
      const buffer = createSingleFileTorrent({
        name: 'test.txt',
        fileSize: 80000, // 5 pieces
        pieceLength: 16384,
      })

      const torrent = await engine.addTorrent(buffer)
      if (!torrent) throw new Error('Torrent is null')

      // Set all pieces complete
      for (let i = 0; i < torrent.piecesCount; i++) {
        torrent.bitfield!.set(i, true)
        // @ts-expect-error - accessing private member for testing
        torrent._partsFilePieces.add(i)
      }

      // All should be masked off
      const advertised = torrent.getAdvertisedBitfield()
      expect(advertised).toBeDefined()
      expect(advertised!.hasNone()).toBe(true)
    })
  })
})
