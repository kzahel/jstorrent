import { describe, it, expect, beforeEach } from 'vitest'
import { BitField } from '../../src/utils/bitfield'
import { Torrent } from '../../src/core/torrent'
import { MockEngine } from '../utils/mock-engine'

// Mock socket factory for Torrent constructor
const mockSocketFactory = {
  createTcpSocket: async () => ({}),
  createTcpServer: () => null,
  wrapTcpSocket: () => ({}),
  createUdpSocket: () => ({}),
}

describe('Torrent piece management', () => {
  let engine: MockEngine
  let torrent: Torrent

  beforeEach(() => {
    engine = new MockEngine()
    const infoHash = new Uint8Array(20).fill(1)
    const peerId = new Uint8Array(20).fill(2)

    torrent = new Torrent(
      engine as any,
      infoHash,
      peerId,
      mockSocketFactory as any,
      6881,
      undefined, // contentStorage
      [], // announce
      50, // maxPeers
      () => true, // globalLimitCheck
    )
  })

  it('should initialize correctly with piece info', () => {
    // Create mock piece hashes (10 pieces)
    const pieceHashes = Array.from({ length: 10 }, () => new Uint8Array(20))

    torrent.initBitfield(10)
    torrent.initPieceInfo(pieceHashes, 16384, 16384)

    expect(torrent.isDownloadComplete).toBe(false)
    expect(torrent.progress).toBe(0)
    expect(torrent.getMissingPieces().length).toBe(10)
    expect(torrent.piecesCount).toBe(10)
  })

  it('should track pieces via bitfield', () => {
    const pieceHashes = Array.from({ length: 10 }, () => new Uint8Array(20))

    torrent.initBitfield(10)
    torrent.initPieceInfo(pieceHashes, 16384, 16384)
    torrent.markPieceVerified(0)

    expect(torrent.hasPiece(0)).toBe(true)
    expect(torrent.hasPiece(1)).toBe(false)
    expect(torrent.progress).toBe(0.1)
  })

  it('should detect completion', () => {
    const pieceHashes = Array.from({ length: 2 }, () => new Uint8Array(20))

    torrent.initBitfield(2)
    torrent.initPieceInfo(pieceHashes, 16384, 16384)

    torrent.markPieceVerified(0)
    expect(torrent.isDownloadComplete).toBe(false)

    torrent.markPieceVerified(1)
    expect(torrent.isDownloadComplete).toBe(true)
  })

  it('should return missing pieces', () => {
    const pieceHashes = Array.from({ length: 5 }, () => new Uint8Array(20))

    torrent.initBitfield(5)
    torrent.initPieceInfo(pieceHashes, 16384, 16384)

    torrent.markPieceVerified(0)
    torrent.markPieceVerified(2)
    torrent.markPieceVerified(4)

    expect(torrent.getMissingPieces()).toEqual([1, 3])
  })

  it('should return correct piece length for last piece', () => {
    const pieceHashes = Array.from({ length: 5 }, () => new Uint8Array(20))

    torrent.initBitfield(5)
    torrent.initPieceInfo(pieceHashes, 16384, 8192) // Last piece is smaller

    expect(torrent.getPieceLength(0)).toBe(16384)
    expect(torrent.getPieceLength(3)).toBe(16384)
    expect(torrent.getPieceLength(4)).toBe(8192) // Last piece
  })

  it('should clear piece via bitfield correctly', () => {
    const pieceHashes = Array.from({ length: 5 }, () => new Uint8Array(20))

    torrent.initBitfield(5)
    torrent.initPieceInfo(pieceHashes, 16384, 16384)

    torrent.markPieceVerified(0)
    expect(torrent.hasPiece(0)).toBe(true)

    // Direct bitfield manipulation (used internally for recheck failures)
    torrent.bitfield?.set(0, false)
    expect(torrent.hasPiece(0)).toBe(false)
  })

  it('should report hasMetadata correctly', () => {
    expect(torrent.hasMetadata).toBe(false)

    const pieceHashes = Array.from({ length: 5 }, () => new Uint8Array(20))
    torrent.initBitfield(5)
    torrent.initPieceInfo(pieceHashes, 16384, 16384)

    expect(torrent.hasMetadata).toBe(true)
  })

  it('should restore bitfield from hex', () => {
    const pieceHashes = Array.from({ length: 8 }, () => new Uint8Array(20))

    torrent.initBitfield(8)
    torrent.initPieceInfo(pieceHashes, 16384, 16384)

    // Mark some pieces
    torrent.markPieceVerified(0)
    torrent.markPieceVerified(2)
    torrent.markPieceVerified(4)
    torrent.markPieceVerified(6)

    const hex = torrent.bitfield!.toHex()

    // Reset and restore
    torrent.initBitfield(8)
    expect(torrent.completedPiecesCount).toBe(0)

    torrent.restoreBitfieldFromHex(hex)
    expect(torrent.hasPiece(0)).toBe(true)
    expect(torrent.hasPiece(1)).toBe(false)
    expect(torrent.hasPiece(2)).toBe(true)
    expect(torrent.hasPiece(3)).toBe(false)
    expect(torrent.hasPiece(4)).toBe(true)
    expect(torrent.completedPiecesCount).toBe(4)
  })
})
