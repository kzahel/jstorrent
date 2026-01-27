import { BitField } from '../utils/bitfield'

/**
 * Tracks piece availability across connected peers for rarest-first selection.
 *
 * Maintains two complementary data structures:
 * 1. Per-piece availability count (Uint16Array) - how many non-seed peers have each piece
 * 2. Seed count - number of connected seeds (peers with all pieces)
 *
 * For true availability of piece i: availability[i] + seedCount
 *
 * Also maintains a per-peer piece index for efficient candidate selection:
 * - Maps peerId -> Set of pieces they have that we need
 * - Enables O(pieces peer has) instead of O(all pieces) for non-seeds
 */
export class PieceAvailability {
  private _availability: Uint16Array | null = null
  private _seedCount: number = 0
  private _peerPieceIndex: Map<string, Set<number>> = new Map()

  /**
   * Initialize availability tracking for a torrent with the given piece count.
   * Call after metadata is available.
   */
  initialize(pieceCount: number): void {
    this._availability = new Uint16Array(pieceCount) // All zeros
  }

  /**
   * Whether availability tracking has been initialized.
   */
  get isInitialized(): boolean {
    return this._availability !== null
  }

  /**
   * Raw availability array (for external iteration).
   * Use getAvailability(index) for true availability including seeds.
   */
  get rawAvailability(): Uint16Array | null {
    return this._availability
  }

  /**
   * Number of connected seed peers.
   */
  get seedCount(): number {
    return this._seedCount
  }

  /**
   * Get true availability for a piece (non-seed count + seed count).
   */
  getAvailability(index: number): number {
    if (!this._availability || index >= this._availability.length) {
      return this._seedCount // If no tracking, seeds are the only known availability
    }
    return this._availability[index] + this._seedCount
  }

  /**
   * Get the piece index for a specific peer (for candidate selection).
   */
  getPeerPieceSet(peerId: string): Set<number> | undefined {
    return this._peerPieceIndex.get(peerId)
  }

  /**
   * Handle BITFIELD message from peer.
   * Updates availability counts and detects if peer is a seed.
   *
   * @returns Object with isSeed flag and haveCount
   */
  onBitfield(bitfield: BitField, piecesCount: number): { isSeed: boolean; haveCount: number } {
    const haveCount = bitfield.count()
    const isSeed = haveCount === piecesCount && piecesCount > 0

    if (isSeed) {
      // Seeds are tracked separately - don't add to per-piece availability
      this._seedCount++
    } else if (this._availability) {
      // Non-seeds: update per-piece availability
      for (let i = 0; i < piecesCount; i++) {
        if (bitfield.get(i)) {
          this._availability[i]++
        }
      }
    }

    return { isSeed, haveCount }
  }

  /**
   * Handle HAVE_ALL message from peer (Fast Extension).
   * Peer is a seeder.
   */
  onHaveAll(): void {
    this._seedCount++
  }

  /**
   * Handle HAVE message from peer.
   * Updates availability and detects if peer just became a seed.
   *
   * @param currentHaveCount - Peer's haveCount BEFORE this HAVE message
   * @returns Object indicating if peer became a seed
   */
  onHave(
    peerId: string,
    index: number,
    piecesCount: number,
    currentHaveCount: number,
    peerBitfield: BitField | null,
  ): { becameSeed: boolean } {
    const newHaveCount = currentHaveCount + 1

    // Check if peer just became a seed
    if (newHaveCount === piecesCount && piecesCount > 0) {
      // Convert to seed: remove from per-piece availability, add to seed count
      this.convertToSeed(peerBitfield)
      // Remove from peer index (seeds don't use it)
      this._peerPieceIndex.delete(peerId)
      return { becameSeed: true }
    }

    // Non-seed: update per-piece availability
    if (this._availability && index < this._availability.length) {
      this._availability[index]++
    }

    return { becameSeed: false }
  }

  /**
   * Convert a peer from non-seed to seed status.
   * Removes their contribution from per-piece availability and increments seed count.
   */
  private convertToSeed(peerBitfield: BitField | null): void {
    // Remove from per-piece availability
    if (this._availability && peerBitfield) {
      for (let i = 0; i < this._availability.length; i++) {
        if (peerBitfield.get(i) && this._availability[i] > 0) {
          this._availability[i]--
        }
      }
    }
    this._seedCount++
  }

  /**
   * Handle peer disconnect.
   * Decrements availability counts based on what the peer had.
   */
  onPeerDisconnected(peerId: string, peerBitfield: BitField | null, wasSeed: boolean): void {
    // Clean up peer piece index
    this._peerPieceIndex.delete(peerId)

    if (wasSeed) {
      // Seeds are tracked separately - just decrement the count
      if (this._seedCount > 0) {
        this._seedCount--
      }
    } else if (this._availability && peerBitfield) {
      // Non-seeds: decrement per-piece availability
      for (let i = 0; i < this._availability.length; i++) {
        if (peerBitfield.get(i) && this._availability[i] > 0) {
          this._availability[i]--
        }
      }
    }
  }

  /**
   * Handle deferred HAVE_ALL (when metadata wasn't available at time of message).
   */
  onDeferredHaveAll(): void {
    this._seedCount++
  }

  // --- Peer Piece Index Methods ---

  /**
   * Build the piece index for a peer.
   * Called after receiving bitfield when we know what pieces we need.
   *
   * @param shouldIncludePiece - Callback to determine if a piece should be in the index
   */
  buildPeerIndex(
    peerId: string,
    peerBitfield: BitField,
    piecesCount: number,
    shouldIncludePiece: (index: number) => boolean,
  ): number {
    const pieceSet = new Set<number>()

    for (let i = 0; i < piecesCount; i++) {
      if (peerBitfield.get(i) && shouldIncludePiece(i)) {
        pieceSet.add(i)
      }
    }

    this._peerPieceIndex.set(peerId, pieceSet)
    return pieceSet.size
  }

  /**
   * Add a single piece to a peer's index (called on HAVE message).
   */
  addPieceToIndex(peerId: string, pieceIndex: number): void {
    const pieceSet = this._peerPieceIndex.get(peerId)
    if (pieceSet) {
      pieceSet.add(pieceIndex)
    }
    // If no index for this peer (they're a seed), ignore
  }

  /**
   * Remove a piece from all peer indices.
   * Called when we complete a piece or activate it for download.
   */
  removePieceFromAllIndices(pieceIndex: number): void {
    for (const pieceSet of this._peerPieceIndex.values()) {
      pieceSet.delete(pieceIndex)
    }
  }

  /**
   * Remove a peer's index entirely.
   * Called when peer disconnects or becomes a seed.
   */
  removePeerFromIndex(peerId: string): void {
    this._peerPieceIndex.delete(peerId)
  }
}
