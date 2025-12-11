import { TorrentFile } from './torrent-file'
import type { Torrent } from './torrent'

export class TorrentFileInfo {
  /** Filename without path */
  readonly filename: string
  /** Directory path without filename */
  readonly folder: string
  /** File extension (e.g., ".mkv") */
  readonly extension: string

  /** Cached downloaded bytes - updated via updateForPiece() */
  private _downloaded: number = 0

  constructor(
    private file: TorrentFile,
    private torrent: Torrent,
    private _index: number,
  ) {
    // Parse path components once
    const path = file.path
    const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    this.filename = lastSlash >= 0 ? path.substring(lastSlash + 1) : path
    this.folder = lastSlash >= 0 ? path.substring(0, lastSlash) : ''
    const lastDot = this.filename.lastIndexOf('.')
    this.extension = lastDot > 0 ? this.filename.substring(lastDot) : ''

    // Compute initial downloaded bytes
    this._downloaded = this.computeDownloaded()
  }

  get index(): number {
    return this._index
  }

  get path(): string {
    return this.file.path
  }

  get length(): number {
    return this.file.length
  }

  get downloaded(): number {
    return this._downloaded
  }

  get progress(): number {
    if (this.length === 0) return 1
    return this._downloaded / this.length
  }

  get isComplete(): boolean {
    return this._downloaded === this.length
  }

  get priority(): number {
    return 0 // TODO: Implement priority
  }

  /**
   * Called by Torrent when a piece completes.
   * Updates cached downloaded bytes if the piece overlaps this file.
   */
  updateForPiece(pieceIndex: number): void {
    const pieceLength = this.torrent.pieceLength
    const startPiece = Math.floor(this.file.offset / pieceLength)
    const endPiece = Math.floor((this.file.offset + this.file.length - 1) / pieceLength)

    if (pieceIndex >= startPiece && pieceIndex <= endPiece) {
      this._downloaded += this.computePieceOverlap(pieceIndex)
    }
  }

  /** Compute total downloaded bytes by iterating all pieces (used for initialization) */
  private computeDownloaded(): number {
    if (!this.torrent.bitfield) return 0

    let downloaded = 0
    const pieceLength = this.torrent.pieceLength
    const startPiece = Math.floor(this.file.offset / pieceLength)
    const endPiece = Math.floor((this.file.offset + this.file.length - 1) / pieceLength)

    for (let i = startPiece; i <= endPiece; i++) {
      if (this.torrent.hasPiece(i)) {
        downloaded += this.computePieceOverlap(i)
      }
    }
    return downloaded
  }

  /** Compute how many bytes of a piece overlap with this file */
  private computePieceOverlap(pieceIndex: number): number {
    const pieceLength = this.torrent.pieceLength
    const pieceStart = pieceIndex * pieceLength
    const pieceEnd = pieceStart + this.torrent.getPieceLength(pieceIndex)

    const fileStart = this.file.offset
    const fileEnd = this.file.offset + this.file.length

    const overlapStart = Math.max(pieceStart, fileStart)
    const overlapEnd = Math.min(pieceEnd, fileEnd)

    return overlapEnd > overlapStart ? overlapEnd - overlapStart : 0
  }
}
