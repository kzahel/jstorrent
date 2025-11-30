import { TorrentFile } from './torrent-file'
import type { Torrent } from './torrent'

export class TorrentFileInfo {
  constructor(
    private file: TorrentFile,
    private torrent: Torrent,
  ) {}

  get path(): string {
    return this.file.path
  }

  get length(): number {
    return this.file.length
  }

  get downloaded(): number {
    if (!this.torrent.bitfield) return 0

    let downloaded = 0
    const pieceLength = this.torrent.pieceLength
    const startPiece = Math.floor(this.file.offset / pieceLength)
    const endPiece = Math.floor((this.file.offset + this.file.length - 1) / pieceLength)

    for (let i = startPiece; i <= endPiece; i++) {
      if (this.torrent.hasPiece(i)) {
        // Entire piece is present
        const pieceStart = i * pieceLength
        const pieceEnd = pieceStart + this.torrent.getPieceLength(i)

        const fileStart = this.file.offset
        const fileEnd = this.file.offset + this.file.length

        const overlapStart = Math.max(pieceStart, fileStart)
        const overlapEnd = Math.min(pieceEnd, fileEnd)

        if (overlapEnd > overlapStart) {
          downloaded += overlapEnd - overlapStart
        }
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
