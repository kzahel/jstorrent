import { EngineComponent, ILoggingEngine } from '../logging/logger'
import { BitField } from '../utils/bitfield'

/**
 * Piece classification for file priority system.
 * - 'wanted': All files touched by this piece are non-skipped
 * - 'boundary': Piece touches both skipped and non-skipped files
 * - 'blacklisted': All files touched by this piece are skipped
 */
export type PieceClassification = 'wanted' | 'boundary' | 'blacklisted'

/** File information needed for classification */
export interface FileInfo {
  offset: number
  length: number
}

/** Configuration for FilePriorityManager */
export interface FilePriorityManagerConfig {
  engine: ILoggingEngine
  infoHash: Uint8Array

  // Callbacks to access Torrent state
  getPiecesCount: () => number
  getPieceLength: (index: number) => number
  getFiles: () => FileInfo[]
  hasMetadata: () => boolean
  isFileComplete: (fileIndex: number) => boolean
  getBitfield: () => BitField | undefined

  // Callbacks for side effects
  onPrioritiesChanged: (filePriorities: number[], classification: PieceClassification[]) => void
  onBlacklistPieces: (indices: number[]) => void
}

/**
 * Manages file priorities and piece classification for a torrent.
 *
 * File priorities determine which pieces are downloaded:
 * - Priority 0 = normal (download)
 * - Priority 1 = skip (don't download)
 * - Priority 2 = high (download first) - future use
 *
 * Pieces are classified based on the files they touch:
 * - 'wanted': All files are non-skipped
 * - 'boundary': Some files are skipped, some are not
 * - 'blacklisted': All files are skipped
 */
export class FilePriorityManager extends EngineComponent {
  static override logName = 'fileprio'

  // State
  private _filePriorities: number[] = []
  private _pieceClassification: PieceClassification[] = []
  private _piecePriority: Uint8Array | null = null

  // Callbacks
  private readonly getPiecesCount: () => number
  private readonly getPieceLength: (index: number) => number
  private readonly getFiles: () => FileInfo[]
  private readonly hasMetadata: () => boolean
  private readonly isFileComplete: (fileIndex: number) => boolean
  private readonly getBitfield: () => BitField | undefined
  private readonly onPrioritiesChanged: (
    filePriorities: number[],
    classification: PieceClassification[],
  ) => void
  private readonly onBlacklistPieces: (indices: number[]) => void

  // Cached piece length for optimization
  private standardPieceLength: number = 0

  constructor(config: FilePriorityManagerConfig) {
    super(config.engine)
    this.infoHash = config.infoHash
    this.getPiecesCount = config.getPiecesCount
    this.getPieceLength = config.getPieceLength
    this.getFiles = config.getFiles
    this.hasMetadata = config.hasMetadata
    this.isFileComplete = config.isFileComplete
    this.getBitfield = config.getBitfield
    this.onPrioritiesChanged = config.onPrioritiesChanged
    this.onBlacklistPieces = config.onBlacklistPieces
  }

  // === Public Getters ===

  /** Get file priorities array. Returns empty array if no files. */
  get filePriorities(): number[] {
    return this._filePriorities
  }

  /** Get the piece classification array. */
  get pieceClassification(): PieceClassification[] {
    return this._pieceClassification
  }

  /** Get per-piece priority (0=skip, 1=normal, 2=high). */
  get piecePriority(): Uint8Array | null {
    return this._piecePriority
  }

  // === Public Methods ===

  /**
   * Set the standard piece length (used for optimization).
   * Should be called when metadata becomes available.
   */
  setStandardPieceLength(length: number): void {
    this.standardPieceLength = length
  }

  /**
   * Check if a file is skipped.
   */
  isFileSkipped(fileIndex: number): boolean {
    return this._filePriorities[fileIndex] === 1
  }

  /**
   * Get classification for a piece.
   */
  getClassification(pieceIndex: number): PieceClassification | undefined {
    return this._pieceClassification[pieceIndex]
  }

  /**
   * Number of pieces we actually want (not blacklisted).
   */
  getWantedPiecesCount(): number {
    const piecesCount = this.getPiecesCount()
    if (this._pieceClassification.length === 0) return piecesCount
    return this._pieceClassification.filter((c) => c !== 'blacklisted').length
  }

  /**
   * Number of wanted pieces we have (verified).
   * Counts pieces that are wanted or boundary and have bitfield=1.
   */
  getCompletedWantedCount(): number {
    const bitfield = this.getBitfield()
    if (!bitfield) return 0
    if (this._pieceClassification.length === 0) return bitfield.count()

    const piecesCount = this.getPiecesCount()
    let count = 0
    for (let i = 0; i < piecesCount; i++) {
      if (this._pieceClassification[i] !== 'blacklisted' && bitfield.get(i)) {
        count++
      }
    }
    return count
  }

  /**
   * Check if a piece should be requested based on priority.
   */
  shouldRequestPiece(index: number, bitfield?: BitField): boolean {
    const bf = bitfield ?? this.getBitfield()

    // Already have it
    if (bf?.get(index)) return false

    // Check piece priority (0 = skip)
    if (this._piecePriority && this._piecePriority[index] === 0) return false

    // Fallback to classification for backwards compatibility
    if (this._pieceClassification.length > 0) {
      if (this._pieceClassification[index] === 'blacklisted') return false
    }

    return true // Wanted or boundary - both get requested
  }

  /**
   * Set file priority for a single file.
   * @param fileIndex - Index of the file
   * @param priority - 0 = normal, 1 = skip
   * @returns true if priority was changed, false if ignored (e.g., file already complete)
   */
  setFilePriority(fileIndex: number, priority: number): boolean {
    if (!this.hasMetadata()) return false
    const fileCount = this.getFiles().length
    if (fileIndex < 0 || fileIndex >= fileCount) return false

    // Prevent skipping completed files
    if (priority === 1 && this.isFileComplete(fileIndex)) {
      this.logger.debug(`Ignoring skip request for completed file ${fileIndex}`)
      return false
    }

    // Ensure array is initialized
    if (this._filePriorities.length !== fileCount) {
      this._filePriorities = new Array(fileCount).fill(0)
    }

    if (this._filePriorities[fileIndex] === priority) return false

    this._filePriorities[fileIndex] = priority
    this.recomputePieceClassification()

    this.logger.info(`File ${fileIndex} priority set to ${priority === 1 ? 'skip' : 'normal'}`)

    return true
  }

  /**
   * Set priorities for multiple files at once.
   * @param priorities - Map of fileIndex -> priority
   * @returns Number of files whose priority was changed
   */
  setFilePriorities(priorities: Map<number, number>): number {
    if (!this.hasMetadata()) return 0
    const fileCount = this.getFiles().length

    // Ensure array is initialized
    if (this._filePriorities.length !== fileCount) {
      this._filePriorities = new Array(fileCount).fill(0)
    }

    let changed = 0
    for (const [fileIndex, priority] of priorities) {
      if (fileIndex < 0 || fileIndex >= fileCount) continue

      // Prevent skipping completed files
      if (priority === 1 && this.isFileComplete(fileIndex)) {
        this.logger.debug(`Ignoring skip request for completed file ${fileIndex}`)
        continue
      }

      if (this._filePriorities[fileIndex] !== priority) {
        this._filePriorities[fileIndex] = priority
        changed++
      }
    }

    if (changed > 0) {
      this.recomputePieceClassification()
      this.logger.info(`Updated ${changed} file priorities`)
    }

    return changed
  }

  /**
   * Initialize file priorities array (called when metadata becomes available).
   */
  initFilePriorities(): void {
    const fileCount = this.getFiles().length
    if (fileCount === 0) return

    // Initialize all to normal (0) if not already set
    if (this._filePriorities.length !== fileCount) {
      this._filePriorities = new Array(fileCount).fill(0)
    }

    this.recomputePieceClassification()
  }

  /**
   * Restore file priorities from persisted state.
   * Bypasses validation since we're restoring saved state.
   * Called during session restore after metadata is available.
   */
  restoreFilePriorities(priorities: number[]): void {
    if (!this.hasMetadata()) return

    const fileCount = this.getFiles().length
    if (priorities.length !== fileCount) {
      this.logger.warn(
        `File priorities length mismatch: ${priorities.length} vs ${fileCount} files, ignoring`,
      )
      return
    }

    this._filePriorities = [...priorities]
    this.recomputePieceClassification()
    this.logger.debug(`Restored file priorities for ${fileCount} files`)
  }

  /**
   * Check if any file was un-skipped in the last operation.
   * Used by Torrent to trigger materialization.
   * @param oldPriorities - Previous priorities
   * @param newPriorities - New priorities
   */
  checkForUnskipped(oldPriorities: number[], newPriorities: number[]): boolean {
    for (let i = 0; i < oldPriorities.length && i < newPriorities.length; i++) {
      if (oldPriorities[i] === 1 && newPriorities[i] === 0) {
        return true
      }
    }
    return false
  }

  // === Private Methods ===

  /**
   * Recompute piece classification based on current file priorities.
   * Called whenever file priorities change.
   */
  private recomputePieceClassification(): void {
    if (!this.hasMetadata()) {
      this._pieceClassification = []
      return
    }

    const files = this.getFiles()
    if (files.length === 0) {
      this._pieceClassification = []
      return
    }

    const piecesCount = this.getPiecesCount()
    const pieceLength = this.standardPieceLength
    const classification: PieceClassification[] = new Array(piecesCount)

    for (let pieceIndex = 0; pieceIndex < piecesCount; pieceIndex++) {
      const pieceStart = pieceIndex * pieceLength
      const pieceEnd = pieceStart + this.getPieceLength(pieceIndex)

      let touchesSkipped = false
      let touchesNonSkipped = false

      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex]
        const fileEnd = file.offset + file.length

        // Check if piece overlaps with this file
        if (pieceStart < fileEnd && pieceEnd > file.offset) {
          if (this._filePriorities[fileIndex] === 1) {
            touchesSkipped = true
          } else {
            touchesNonSkipped = true
          }
        }

        // Early exit if we've found both
        if (touchesSkipped && touchesNonSkipped) break
      }

      if (touchesSkipped && touchesNonSkipped) {
        classification[pieceIndex] = 'boundary'
      } else if (touchesSkipped) {
        classification[pieceIndex] = 'blacklisted'
      } else {
        classification[pieceIndex] = 'wanted'
      }
    }

    this._pieceClassification = classification

    // Notify callback (updates contentStorage)
    this.onPrioritiesChanged(this._filePriorities, classification)

    // Log summary
    const wanted = classification.filter((c) => c === 'wanted').length
    const boundary = classification.filter((c) => c === 'boundary').length
    const blacklisted = classification.filter((c) => c === 'blacklisted').length
    this.logger.debug(
      `Piece classification: ${wanted} wanted, ${boundary} boundary, ${blacklisted} blacklisted`,
    )

    // Clear any active pieces that are now blacklisted
    this.clearBlacklistedActivePieces()

    // Recompute piece priorities
    this.recomputePiecePriority()
  }

  /**
   * Recompute piece priorities from file priorities.
   * Piece priority = max(priority of files it touches), mapped as:
   *   - File priority 0 (normal) -> contributes piece priority 1
   *   - File priority 1 (skip) -> contributes piece priority 0
   *   - File priority 2 (high) -> contributes piece priority 2
   */
  private recomputePiecePriority(): void {
    if (!this.hasMetadata()) {
      this._piecePriority = null
      return
    }

    const piecesCount = this.getPiecesCount()
    if (piecesCount === 0) {
      this._piecePriority = null
      return
    }

    if (!this._piecePriority || this._piecePriority.length !== piecesCount) {
      this._piecePriority = new Uint8Array(piecesCount)
    }

    const files = this.getFiles()
    const pieceLength = this.standardPieceLength

    for (let pieceIndex = 0; pieceIndex < piecesCount; pieceIndex++) {
      const pieceStart = pieceIndex * pieceLength
      const pieceEnd = pieceStart + this.getPieceLength(pieceIndex)

      let maxPriority = 0 // Start as skip

      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const file = files[fileIndex]
        const fileEnd = file.offset + file.length

        // Check if piece overlaps with this file
        if (pieceStart < fileEnd && pieceEnd > file.offset) {
          const filePriority = this._filePriorities[fileIndex] ?? 0

          // Map file priority to piece priority contribution
          let contribution = 0
          if (filePriority === 2) {
            contribution = 2 // High priority
          } else if (filePriority === 0) {
            contribution = 1 // Normal priority
          }
          // filePriority === 1 (skip) contributes 0

          maxPriority = Math.max(maxPriority, contribution)

          // Early exit if we hit high priority (can't go higher)
          if (maxPriority === 2) break
        }
      }

      this._piecePriority[pieceIndex] = maxPriority
    }

    // Log summary
    let skip = 0,
      normal = 0,
      high = 0
    for (let i = 0; i < piecesCount; i++) {
      const p = this._piecePriority[i]
      if (p === 0) skip++
      else if (p === 1) normal++
      else high++
    }
    if (high > 0) {
      this.logger.debug(`Piece priority: ${high} high, ${normal} normal, ${skip} skip`)
    }
  }

  /**
   * Clear any active pieces that are blacklisted.
   * Notifies Torrent via callback so it can update ActivePieceManager.
   */
  private clearBlacklistedActivePieces(): void {
    if (this._pieceClassification.length === 0) return

    const blacklistedIndices: number[] = []
    for (let i = 0; i < this._pieceClassification.length; i++) {
      if (this._pieceClassification[i] === 'blacklisted') {
        blacklistedIndices.push(i)
      }
    }

    if (blacklistedIndices.length > 0) {
      this.onBlacklistPieces(blacklistedIndices)
    }
  }
}
