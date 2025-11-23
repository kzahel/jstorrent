import { BitField } from '../utils/bitfield'

export class PieceManager {
  private bitfield: BitField
  private piecesCount: number
  private completedPieces: number = 0

  constructor(piecesCount: number) {
    this.piecesCount = piecesCount
    this.bitfield = new BitField(piecesCount)
  }

  getPieceCount(): number {
    return this.piecesCount
  }

  hasPiece(index: number): boolean {
    return this.bitfield.get(index)
  }

  setPiece(index: number, has: boolean = true) {
    const had = this.hasPiece(index)
    if (had !== has) {
      this.bitfield.set(index, has)
      if (has) {
        this.completedPieces++
      } else {
        this.completedPieces--
      }
    }
  }

  isComplete(): boolean {
    return this.completedPieces === this.piecesCount
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
}
