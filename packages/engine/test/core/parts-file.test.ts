import { describe, it, expect, beforeEach } from 'vitest'
import { PartsFile } from '../../src/core/parts-file'
import { InMemoryFileSystem } from '../../src/adapters/memory'
import { IStorageHandle } from '../../src/io/storage-handle'
import { MockEngine } from '../utils/mock-engine'
import { Bencode } from '../../src/utils/bencode'

function createMockStorageHandle(fs: InMemoryFileSystem): IStorageHandle {
  return {
    id: 'test-storage',
    name: 'Test Storage',
    getFileSystem: () => fs,
  }
}

describe('PartsFile', () => {
  let fs: InMemoryFileSystem
  let storageHandle: IStorageHandle
  let engine: MockEngine
  const testInfoHash = 'abcdef1234567890abcd'

  beforeEach(() => {
    fs = new InMemoryFileSystem()
    storageHandle = createMockStorageHandle(fs)
    engine = new MockEngine()
  })

  describe('read/write roundtrip', () => {
    it('write single piece, read back identical', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      const pieceData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

      partsFile.addPiece(42, pieceData)
      await partsFile.flush()

      // Create new instance to read from disk
      const partsFile2 = new PartsFile(engine, storageHandle, testInfoHash)
      await partsFile2.load()

      expect(partsFile2.hasPiece(42)).toBe(true)
      expect(partsFile2.getPiece(42)).toEqual(pieceData)
    })

    it('write multiple pieces, read back all', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      const piece10 = new Uint8Array([10, 10, 10])
      const piece20 = new Uint8Array([20, 20, 20, 20])
      const piece30 = new Uint8Array([30, 30])

      partsFile.addPiece(10, piece10)
      partsFile.addPiece(20, piece20)
      partsFile.addPiece(30, piece30)
      await partsFile.flush()

      // Read back
      const partsFile2 = new PartsFile(engine, storageHandle, testInfoHash)
      await partsFile2.load()

      expect(partsFile2.hasPiece(10)).toBe(true)
      expect(partsFile2.hasPiece(20)).toBe(true)
      expect(partsFile2.hasPiece(30)).toBe(true)
      expect(partsFile2.getPiece(10)).toEqual(piece10)
      expect(partsFile2.getPiece(20)).toEqual(piece20)
      expect(partsFile2.getPiece(30)).toEqual(piece30)
    })

    it('empty file returns empty pieces set', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      await partsFile.load()

      expect(partsFile.pieces.size).toBe(0)
      expect(partsFile.isEmpty).toBe(true)
      expect(partsFile.count).toBe(0)
    })
  })

  describe('addPiece', () => {
    it('add to empty file', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      const pieceData = new Uint8Array([1, 2, 3])

      partsFile.addPiece(5, pieceData)
      await partsFile.flush()

      // Verify file was created
      const filename = `${testInfoHash}.parts`
      expect(await fs.exists(filename)).toBe(true)

      // Verify content
      expect(partsFile.hasPiece(5)).toBe(true)
      expect(partsFile.count).toBe(1)
    })

    it('add to existing file preserves other pieces', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)

      partsFile.addPiece(1, new Uint8Array([1]))
      partsFile.addPiece(2, new Uint8Array([2]))
      partsFile.addPiece(3, new Uint8Array([3]))
      await partsFile.flush()

      partsFile.addPiece(4, new Uint8Array([4]))
      await partsFile.flush()

      expect(partsFile.count).toBe(4)
      expect(partsFile.hasPiece(1)).toBe(true)
      expect(partsFile.hasPiece(2)).toBe(true)
      expect(partsFile.hasPiece(3)).toBe(true)
      expect(partsFile.hasPiece(4)).toBe(true)
    })

    it('overwrite existing piece', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      const dataA = new Uint8Array([1, 1, 1])
      const dataB = new Uint8Array([2, 2, 2, 2, 2])

      partsFile.addPiece(5, dataA)
      await partsFile.flush()

      partsFile.addPiece(5, dataB)
      await partsFile.flush()

      expect(partsFile.count).toBe(1)
      expect(partsFile.getPiece(5)).toEqual(dataB)
    })
  })

  describe('removePiece', () => {
    it('remove existing piece', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      partsFile.addPiece(1, new Uint8Array([1]))
      partsFile.addPiece(2, new Uint8Array([2]))
      partsFile.addPiece(3, new Uint8Array([3]))
      await partsFile.flush()

      const removed = partsFile.removePiece(2)
      await partsFile.flush()

      expect(removed).toBe(true)
      expect(partsFile.count).toBe(2)
      expect(partsFile.hasPiece(1)).toBe(true)
      expect(partsFile.hasPiece(2)).toBe(false)
      expect(partsFile.hasPiece(3)).toBe(true)
    })

    it('remove non-existent piece is no-op', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      partsFile.addPiece(1, new Uint8Array([1]))
      partsFile.addPiece(2, new Uint8Array([2]))
      await partsFile.flush()

      const removed = partsFile.removePiece(99)

      expect(removed).toBe(false)
      expect(partsFile.count).toBe(2)
      expect(partsFile.hasPiece(1)).toBe(true)
      expect(partsFile.hasPiece(2)).toBe(true)
    })

    it('remove last piece results in empty file deletion', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      partsFile.addPiece(1, new Uint8Array([1]))
      await partsFile.flush()

      const filename = `${testInfoHash}.parts`
      expect(await fs.exists(filename)).toBe(true)

      partsFile.removePiece(1)
      await partsFile.flush()

      expect(partsFile.isEmpty).toBe(true)
      expect(await fs.exists(filename)).toBe(false)
    })
  })

  describe('hasPiece()', () => {
    it('returns true for present piece', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      partsFile.addPiece(42, new Uint8Array([42]))

      expect(partsFile.hasPiece(42)).toBe(true)
    })

    it('returns false for absent piece', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      partsFile.addPiece(42, new Uint8Array([42]))

      expect(partsFile.hasPiece(99)).toBe(false)
    })
  })

  describe('pieces getter', () => {
    it('returns set of all piece indices', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      partsFile.addPiece(5, new Uint8Array([5]))
      partsFile.addPiece(10, new Uint8Array([10]))
      partsFile.addPiece(15, new Uint8Array([15]))

      const pieces = partsFile.pieces
      expect(pieces.size).toBe(3)
      expect(pieces.has(5)).toBe(true)
      expect(pieces.has(10)).toBe(true)
      expect(pieces.has(15)).toBe(true)
    })

    it('returns new Set instance (not internal reference)', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      partsFile.addPiece(1, new Uint8Array([1]))

      const pieces1 = partsFile.pieces
      const pieces2 = partsFile.pieces

      expect(pieces1).not.toBe(pieces2)
    })
  })

  describe('addPieceAndFlush / removePieceAndFlush', () => {
    it('addPieceAndFlush writes immediately', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      const filename = `${testInfoHash}.parts`

      await partsFile.addPieceAndFlush(7, new Uint8Array([7, 7, 7]))

      expect(await fs.exists(filename)).toBe(true)
      expect(partsFile.hasPiece(7)).toBe(true)
    })

    it('removePieceAndFlush removes and flushes', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      await partsFile.addPieceAndFlush(7, new Uint8Array([7]))
      await partsFile.addPieceAndFlush(8, new Uint8Array([8]))

      const removed = await partsFile.removePieceAndFlush(7)

      expect(removed).toBe(true)
      expect(partsFile.hasPiece(7)).toBe(false)
      expect(partsFile.hasPiece(8)).toBe(true)

      // Verify persisted
      const partsFile2 = new PartsFile(engine, storageHandle, testInfoHash)
      await partsFile2.load()
      expect(partsFile2.hasPiece(7)).toBe(false)
      expect(partsFile2.hasPiece(8)).toBe(true)
    })
  })

  describe('error handling', () => {
    it('corrupt bencode loads as empty (graceful degradation)', async () => {
      // Write garbage bytes directly to file
      const filename = `${testInfoHash}.parts`
      const handle = await fs.open(filename, 'w')
      await handle.write(new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]), 0, 4, 0)
      await handle.close()

      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      // Should not throw - graceful degradation
      await partsFile.load()

      // Implementation logs warning and starts fresh
      expect(partsFile.isEmpty).toBe(true)
    })

    it('wrong bencode type (list instead of dict) starts fresh', async () => {
      // Write a valid bencode list instead of dict
      const filename = `${testInfoHash}.parts`
      const encoded = Bencode.encode([1, 2, 3])
      const handle = await fs.open(filename, 'w')
      await handle.write(encoded, 0, encoded.length, 0)
      await handle.close()

      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      await partsFile.load()

      // Implementation checks typeof decoded === 'object', array passes but entries loop handles it
      expect(partsFile.isEmpty).toBe(true)
    })

    it('load non-existent file starts fresh', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      await partsFile.load()

      expect(partsFile.isEmpty).toBe(true)
      expect(partsFile.count).toBe(0)
    })
  })

  describe('dirty flag optimization', () => {
    it('flush without changes is no-op', async () => {
      const partsFile = new PartsFile(engine, storageHandle, testInfoHash)
      await partsFile.addPieceAndFlush(1, new Uint8Array([1]))

      // Flush again without changes - should be no-op
      await partsFile.flush()

      // File should still exist and be valid
      const partsFile2 = new PartsFile(engine, storageHandle, testInfoHash)
      await partsFile2.load()
      expect(partsFile2.hasPiece(1)).toBe(true)
    })
  })

  describe('filename format', () => {
    it('uses infoHash.parts filename', async () => {
      const customHash = 'deadbeef12345678'
      const partsFile = new PartsFile(engine, storageHandle, customHash)
      await partsFile.addPieceAndFlush(0, new Uint8Array([0]))

      expect(await fs.exists(`${customHash}.parts`)).toBe(true)
    })
  })
})
