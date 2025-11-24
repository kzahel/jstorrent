import { BitField } from '../utils/bitfield'

export const BLOCK_SIZE = 16384

class Piece {
  public blocks: BitField
  public requested: BitField
  public blocksCount: number
  public isComplete: boolean = false

  constructor(
    public index: number,
    public length: number,
  ) {
    this.blocksCount = Math.ceil(length / BLOCK_SIZE)
    this.blocks = new BitField(this.blocksCount)
    this.requested = new BitField(this.blocksCount)
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

  isRequested(blockIndex: number): boolean {
    return this.requested.get(blockIndex)
  }

  setRequested(blockIndex: number, requested: boolean = true) {
    this.requested.set(blockIndex, requested)
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

export class PieceManager {
  private pieces: Piece[] = []
  private bitfield: BitField
  private piecesCount: number
  private completedPieces: number = 0
  private pieceHashes: Uint8Array[] = []

  constructor(
    piecesCount: number,
    pieceLength: number,
    lastPieceLength: number,
    pieceHashes: Uint8Array[] = [],
    bitfield?: BitField,
  ) {
    this.piecesCount = piecesCount
    this.pieceHashes = pieceHashes
    this.bitfield = bitfield || new BitField(piecesCount)

    for (let i = 0; i < piecesCount; i++) {
      const length = i === piecesCount - 1 ? lastPieceLength : pieceLength
      this.pieces.push(new Piece(i, length))
    }
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
      // Reset requested?
      piece.requested = new BitField(piece.blocksCount)
      // Ensure bitfield is false
      this.setPiece(index, false)
    }
  }

  addRequested(index: number, begin: number) {
    const blockIndex = Math.floor(begin / BLOCK_SIZE)
    const piece = this.pieces[index]
    if (piece) {
      piece.setRequested(blockIndex, true)
    }
  }

  isBlockRequested(index: number, begin: number): boolean {
    const blockIndex = Math.floor(begin / BLOCK_SIZE)
    const piece = this.pieces[index]
    if (piece) {
      return piece.isRequested(blockIndex)
    }
    return false
  }

  isPieceComplete(index: number): boolean {
    return this.pieces[index].isComplete
  }

  getNeededBlocks(index: number): { begin: number; length: number }[] {
    const piece = this.pieces[index]
    if (!piece) return []

    const needed: { begin: number; length: number }[] = []
    const missingBlocks = piece.getMissingBlocks()

    for (const blockIndex of missingBlocks) {
      if (!piece.isRequested(blockIndex)) {
        const begin = blockIndex * BLOCK_SIZE
        const length = blockIndex === piece.blocksCount - 1 ? piece.length - begin : BLOCK_SIZE
        needed.push({ begin, length })
      }
    }
    return needed
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
  isComplete(): boolean {
    return this.completedPieces === this.piecesCount
  }
}
