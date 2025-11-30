import { BitField } from '../utils/bitfield'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import type { Torrent } from './torrent'

export const BLOCK_SIZE = 16384

class Piece {
  public blocks: BitField
  public blocksCount: number
  public isComplete: boolean = false

  constructor(
    public index: number,
    public length: number,
  ) {
    this.blocksCount = Math.ceil(length / BLOCK_SIZE)
    this.blocks = new BitField(this.blocksCount)
  }

  hasBlock(blockIndex: number): boolean {
    return this.blocks.get(blockIndex)
  }

  setBlock(blockIndex: number, has: boolean = true) {
    this.blocks.set(blockIndex, has)
    if (this.blocks.count() === this.blocksCount) {
      this.isComplete = true
    }
  }

  getMissingBlocks(): number[] {
    const missing: number[] = []
    for (let i = 0; i < this.blocksCount; i++) {
      if (!this.blocks.get(i)) {
        missing.push(i)
      }
    }
    return missing
  }
}

export class PieceManager extends EngineComponent {
  static logName = 'piece-manager'

  private pieces: Piece[] = []
  private torrent: Torrent
  private piecesCount: number
  private completedPieces: number = 0
  private pieceHashes: Uint8Array[] = []

  constructor(
    engine: ILoggingEngine,
    torrent: Torrent,
    piecesCount: number,
    pieceLength: number,
    lastPieceLength: number,
    pieceHashes: Uint8Array[] = [],
  ) {
    super(engine)
    this.torrent = torrent
    this.piecesCount = piecesCount
    this.pieceHashes = pieceHashes

    for (let i = 0; i < piecesCount; i++) {
      const length = i === piecesCount - 1 ? lastPieceLength : pieceLength
      this.pieces.push(new Piece(i, length))
    }
  }

  /**
   * Get the bitfield from the owning torrent.
   */
  private get bitfield(): BitField {
    return this.torrent.bitfield!
  }

  getPieceHash(index: number): Uint8Array | undefined {
    return this.pieceHashes[index]
  }

  getPieceCount(): number {
    return this.piecesCount
  }

  getPieceLength(index: number): number {
    return this.pieces[index].length
  }

  hasPiece(index: number): boolean {
    return this.bitfield.get(index)
  }

  setPiece(index: number, has: boolean = true) {
    // This is mainly for initialization from bitfield or full piece verification
    const had = this.hasPiece(index)
    if (had !== has) {
      this.bitfield.set(index, has)
      if (has) {
        this.completedPieces++
        // Mark all blocks as received
        const piece = this.pieces[index]
        for (let i = 0; i < piece.blocksCount; i++) {
          piece.setBlock(i, true)
        }
      } else {
        this.completedPieces--
        // Reset blocks?
      }
    }
  }

  addReceived(index: number, begin: number) {
    const blockIndex = Math.floor(begin / BLOCK_SIZE)
    const piece = this.pieces[index]
    if (piece) {
      piece.setBlock(blockIndex, true)
      // We don't set global bitfield here anymore.
      // We wait for verification.
    }
  }

  markVerified(index: number) {
    this.setPiece(index, true)
  }

  resetPiece(index: number) {
    const piece = this.pieces[index]
    if (piece) {
      // Reset blocks
      piece.blocks = new BitField(piece.blocksCount)
      piece.isComplete = false
      // Ensure bitfield is false
      this.setPiece(index, false)
    }
  }

  isPieceComplete(index: number): boolean {
    return this.pieces[index].isComplete
  }

  getBitField(): BitField {
    return this.bitfield
  }

  getMissingPieces(): number[] {
    const missing: number[] = []
    for (let i = 0; i < this.piecesCount; i++) {
      if (!this.bitfield.get(i)) {
        missing.push(i)
      }
    }
    return missing
  }

  getProgress(): number {
    if (this.piecesCount === 0) return 0
    return this.completedPieces / this.piecesCount
  }

  getCompletedCount(): number {
    return this.completedPieces
  }

  isComplete(): boolean {
    return this.completedPieces === this.piecesCount
  }

  /**
   * Restore bitfield from hex string (for session restore).
   * Restores data into the torrent's bitfield in-place.
   */
  restoreFromHex(hex: string): void {
    this.bitfield.restoreFromHex(hex)

    // Update completed count and piece states
    this.completedPieces = 0
    for (let i = 0; i < this.piecesCount; i++) {
      if (this.bitfield.get(i)) {
        this.completedPieces++
        // Mark all blocks as received for this piece
        const piece = this.pieces[i]
        piece.isComplete = true
        for (let j = 0; j < piece.blocksCount; j++) {
          piece.setBlock(j, true)
        }
      }
    }
  }
}
