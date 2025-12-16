import { BitField } from '../utils/bitfield'

/**
 * Input data for piece selection.
 * All fields are read-only views - PiecePicker has no side effects.
 */
export interface PiecePickerInput {
  /** Peer's bitfield - which pieces they have */
  peerBitfield: BitField
  /** Our bitfield - which pieces we have */
  ownBitfield: BitField
  /** Per-piece priority (0=skip, 1=normal, 2=high) */
  piecePriority: Uint8Array
  /** Per-piece availability (peer count) */
  pieceAvailability: Uint16Array
  /** Set of piece indices with partial downloads */
  startedPieces: Set<number>
  /** Maximum pieces to return */
  maxPieces: number
}

/**
 * Result of piece selection.
 * Includes stats for debugging/logging.
 */
export interface PiecePickerResult {
  /** Selected piece indices in priority order */
  pieces: number[]
  /** Stats */
  stats: {
    considered: number
    skippedOwned: number
    skippedPeerLacks: number
    skippedLowPriority: number
  }
}

/**
 * Internal candidate representation for sorting.
 */
interface PieceCandidate {
  index: number
  priority: number // 2=high, 1=normal
  availability: number // lower = rarer
  started: boolean // has partial data
}

/**
 * Piece selection algorithm.
 *
 * Selection order:
 * 1. High priority pieces first
 * 2. Started (partial) pieces before new ones (complete what we started)
 * 3. Rarest pieces first (lowest availability)
 *
 * This is a pure function - no side effects, easy to test.
 */
export class PiecePicker {
  /**
   * Select pieces to request from a peer.
   *
   * @param input - Read-only input data
   * @returns Ordered piece indices and stats
   */
  selectPieces(input: PiecePickerInput): PiecePickerResult {
    const {
      peerBitfield,
      ownBitfield,
      piecePriority,
      pieceAvailability,
      startedPieces,
      maxPieces,
    } = input

    const candidates: PieceCandidate[] = []
    let skippedOwned = 0
    let skippedPeerLacks = 0
    let skippedLowPriority = 0

    const pieceCount = piecePriority.length

    for (let i = 0; i < pieceCount; i++) {
      // Skip if we already have it
      if (ownBitfield.get(i)) {
        skippedOwned++
        continue
      }

      // Skip if peer doesn't have it
      if (!peerBitfield.get(i)) {
        skippedPeerLacks++
        continue
      }

      // Skip if priority is 0 (skip)
      const priority = piecePriority[i]
      if (priority === 0) {
        skippedLowPriority++
        continue
      }

      candidates.push({
        index: i,
        priority,
        availability: pieceAvailability[i],
        started: startedPieces.has(i),
      })
    }

    // Sort: priority DESC, started DESC, availability ASC
    candidates.sort((a, b) => {
      // Higher priority first
      if (a.priority !== b.priority) return b.priority - a.priority
      // Started pieces first
      if (a.started !== b.started) return a.started ? -1 : 1
      // Rarer pieces first (lower availability)
      return a.availability - b.availability
    })

    return {
      pieces: candidates.slice(0, maxPieces).map((c) => c.index),
      stats: {
        considered: candidates.length,
        skippedOwned,
        skippedPeerLacks,
        skippedLowPriority,
      },
    }
  }
}
