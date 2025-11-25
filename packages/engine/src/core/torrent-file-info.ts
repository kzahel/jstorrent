import { TorrentFile } from './torrent-file'
import { PieceManager } from './piece-manager'

export class TorrentFileInfo {
  constructor(
    private file: TorrentFile,
    private pieceManager: PieceManager,
    private pieceLength: number,
  ) {}

  get path(): string {
    return this.file.path
  }

  get length(): number {
    return this.file.length
  }

  get downloaded(): number {
    if (!this.pieceManager) return 0

    let downloaded = 0
    const startPiece = Math.floor(this.file.offset / this.pieceLength)
    const endPiece = Math.floor((this.file.offset + this.file.length - 1) / this.pieceLength)

    for (let i = startPiece; i <= endPiece; i++) {
      if (this.pieceManager.hasPiece(i)) {
        // Entire piece is present
        const pieceStart = i * this.pieceLength
        const pieceEnd = pieceStart + this.pieceManager.getPieceLength(i)

        const fileStart = this.file.offset
        const fileEnd = this.file.offset + this.file.length

        const overlapStart = Math.max(pieceStart, fileStart)
        const overlapEnd = Math.min(pieceEnd, fileEnd)

        if (overlapEnd > overlapStart) {
          downloaded += overlapEnd - overlapStart
        }
      } else {
        // Check blocks if we want more precision?
        // For now, just counting full pieces is safer/faster unless we expose block-level info publicly.
        // PieceManager doesn't easily expose block-level info for external query without iterating everything.
        // We can improve this later.
      }
    }
    return downloaded
  }

  get progress(): number {
    if (this.length === 0) return 1
    return this.downloaded / this.length
  }

  get isComplete(): boolean {
    return this.downloaded === this.length
  }

  get priority(): number {
    return 0 // TODO: Implement priority
  }
}
