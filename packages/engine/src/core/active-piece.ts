import { ChunkedBuffer } from './chunked-buffer'

export const BLOCK_SIZE = 16384

export interface RequestInfo {
  peerId: string
  timestamp: number
}

export interface BlockInfo {
  begin: number
  length: number
}

/**
 * Represents a piece actively being downloaded.
 * Consolidates all download state for a single piece:
 * - Pre-allocated buffer for direct block writes (zero-copy optimization)
 * - Request tracking with peer association (the key fix for stalls)
 * - Contributing peer tracking for hash failure analysis
 */
export class ActivePiece {
  readonly index: number
  readonly length: number
  readonly blocksNeeded: number

  // Pre-allocated buffer for the entire piece - blocks are written directly here
  private buffer: Uint8Array

  // Track which blocks have been received (replaces Map<number, Uint8Array>)
  private blockReceived: boolean[]

  // Incremental count of received blocks (avoids O(n) iteration in haveAllBlocks)
  private _blocksReceivedCount = 0

  // === Phase 7: hasUnrequestedBlocks Caching ===
  // Count of blocks that are neither received nor requested.
  // Allows O(1) hasUnrequestedBlocks check instead of O(blocks) scan.
  private _unrequestedCount: number

  // Track which peer sent each block (for suspicious peer detection on hash failure)
  private blockSenders: Map<number, string> = new Map()

  // Request tracking - supports multiple requests per block (for endgame mode)
  // This is THE KEY CHANGE: requests are tied to specific peers
  private blockRequests: Map<number, RequestInfo[]> = new Map()

  // Activity tracking for stale piece cleanup
  private _lastActivity: number = Date.now()

  // === Phase 4: Speed Affinity / Exclusive Piece Ownership ===

  /**
   * The peer ID that "owns" this piece exclusively.
   * When set, only this peer (or slow peers sharing with other slow peers)
   * can request blocks from this piece.
   *
   * This prevents piece fragmentation where fast and slow peers
   * share the same piece, causing the fast peer to wait for slow blocks.
   */
  private _exclusivePeer: string | null = null

  /**
   * Timestamp when this piece became active.
   * Used for piece health management (Phase 5) to detect stuck pieces.
   */
  private _activatedAt: number = Date.now()

  /**
   * Create a new ActivePiece.
   * @param index - Piece index in the torrent
   * @param length - Length of this piece in bytes
   * @param buffer - Optional pre-allocated buffer (for buffer pooling). If not provided, allocates a new buffer.
   */
  constructor(index: number, length: number, buffer?: Uint8Array) {
    this.index = index
    this.length = length
    this.blocksNeeded = Math.ceil(length / BLOCK_SIZE)
    this.buffer = buffer ?? new Uint8Array(length)
    this.blockReceived = new Array<boolean>(this.blocksNeeded).fill(false)
    // Phase 7: Initialize unrequested count - all blocks start unrequested
    this._unrequestedCount = this.blocksNeeded
  }

  // --- State Queries ---

  get haveAllBlocks(): boolean {
    return this._blocksReceivedCount === this.blocksNeeded
  }

  get lastActivity(): number {
    return this._lastActivity
  }

  get bufferedBytes(): number {
    let total = 0
    for (let i = 0; i < this.blocksNeeded; i++) {
      if (this.blockReceived[i]) {
        // Last block may be smaller
        const blockStart = i * BLOCK_SIZE
        total += Math.min(BLOCK_SIZE, this.length - blockStart)
      }
    }
    return total
  }

  get blocksReceived(): number {
    return this._blocksReceivedCount
  }

  get outstandingRequests(): number {
    let count = 0
    for (const requests of this.blockRequests.values()) {
      count += requests.length
    }
    return count
  }

  hasBlock(blockIndex: number): boolean {
    return this.blockReceived[blockIndex] ?? false
  }

  // --- Phase 4: Speed Affinity / Exclusive Ownership ---

  /**
   * Get the peer ID that owns this piece exclusively.
   * Returns null if no exclusive owner.
   */
  get exclusivePeer(): string | null {
    return this._exclusivePeer
  }

  /**
   * Get when this piece became active.
   */
  get activatedAt(): number {
    return this._activatedAt
  }

  /**
   * Check if a peer can request blocks from this piece.
   *
   * Rules (matching libtorrent behavior for speed affinity):
   * 1. No owner yet - anyone can request
   * 2. Owner can always request
   * 3. Fast peers CAN share with other fast peers (no fragmentation concern)
   * 4. Slow peers CANNOT join fast-owned pieces (prevents fragmentation)
   *
   * The fragmentation problem: if a fast peer (1MB/s) and slow peer (10KB/s)
   * share a piece, the fast peer finishes its blocks quickly but waits for
   * the slow peer's blocks. By preventing slow peers from joining fast-owned
   * pieces, we ensure fast peers can complete pieces quickly.
   *
   * Fast+fast sharing is fine because both peers complete blocks quickly.
   *
   * @param peerId - The requesting peer's ID
   * @param peerIsFast - Whether the requesting peer is considered "fast"
   */
  canRequestFrom(peerId: string, peerIsFast: boolean): boolean {
    // No owner yet - anyone can request
    if (this._exclusivePeer === null) {
      return true
    }

    // Owner can always request
    if (this._exclusivePeer === peerId) {
      return true
    }

    // Piece has a fast owner (only fast peers claim exclusive ownership)
    // Fast peers CAN join: fast+fast sharing doesn't cause fragmentation
    // Slow peers CANNOT join: prevents fragmentation (slow peer would delay piece completion)
    return peerIsFast
  }

  /**
   * Claim exclusive ownership of this piece.
   * Used by fast peers to prevent fragmentation.
   */
  claimExclusive(peerId: string): void {
    this._exclusivePeer = peerId
  }

  /**
   * Clear exclusive ownership. Called when the owner disconnects
   * or times out, allowing other peers to take over.
   */
  clearExclusivePeer(): void {
    this._exclusivePeer = null
  }

  /**
   * Fast O(1) check if piece has any blocks that are neither received nor requested.
   * Use this before getNeededBlocks() to avoid array allocation when no work available.
   *
   * Phase 7 optimization: Uses cached count instead of O(blocks) scan.
   */
  get hasUnrequestedBlocks(): boolean {
    return this._unrequestedCount > 0
  }

  /**
   * Get the count of unrequested blocks.
   * Useful for debugging and testing.
   */
  get unrequestedCount(): number {
    return this._unrequestedCount
  }

  /**
   * Check if a block has an active (non-timed-out) request.
   */
  isBlockRequested(blockIndex: number, timeoutMs?: number): boolean {
    const requests = this.blockRequests.get(blockIndex)
    if (!requests || requests.length === 0) return false

    if (timeoutMs !== undefined) {
      const now = Date.now()
      // Check if any non-timed-out request exists
      return requests.some((r) => now - r.timestamp < timeoutMs)
    }
    return true
  }

  // --- Mutations ---

  /**
   * Record that a request was sent to a peer for this block.
   */
  addRequest(blockIndex: number, peerId: string): void {
    // Phase 7: Check if this block was unrequested before adding request
    const wasUnrequested =
      !this.blockReceived[blockIndex] &&
      (!this.blockRequests.has(blockIndex) || this.blockRequests.get(blockIndex)!.length === 0)

    let requests = this.blockRequests.get(blockIndex)
    if (!requests) {
      requests = []
      this.blockRequests.set(blockIndex, requests)
    }
    requests.push({ peerId, timestamp: Date.now() })
    this._lastActivity = Date.now()

    // Phase 7: Decrement unrequested count if this was the first request
    if (wasUnrequested) {
      this._unrequestedCount--
    }
  }

  /**
   * Add received block data.
   * Writes directly to the pre-allocated piece buffer (zero-copy to final destination).
   * Returns true if this was a new block, false if duplicate.
   */
  addBlock(blockIndex: number, data: Uint8Array, peerId: string): boolean {
    if (this.blockReceived[blockIndex]) {
      return false // Duplicate
    }

    // Phase 7: Check if block was unrequested before receiving
    // If no pending requests, the block was counted as unrequested
    const hadNoRequests =
      !this.blockRequests.has(blockIndex) || this.blockRequests.get(blockIndex)!.length === 0

    // Write directly to the pre-allocated buffer at the correct offset
    const offset = blockIndex * BLOCK_SIZE
    this.buffer.set(data, offset)
    this.blockReceived[blockIndex] = true
    this._blocksReceivedCount++
    this.blockSenders.set(blockIndex, peerId)
    this._lastActivity = Date.now()

    // Clear requests for this block - it's been fulfilled
    this.blockRequests.delete(blockIndex)

    // Phase 7: Decrement unrequested count if block was unrequested
    // (if it had requests, the count was already decremented when requests were added)
    if (hadNoRequests) {
      this._unrequestedCount--
    }

    return true
  }

  /**
   * Add block data directly from a ChunkedBuffer (full zero-copy path).
   * Copies from the ChunkedBuffer directly to this piece's buffer.
   * Returns true if this was a new block, false if duplicate.
   */
  addBlockFromChunked(
    blockIndex: number,
    source: ChunkedBuffer,
    sourceOffset: number,
    length: number,
    peerId: string,
  ): boolean {
    if (this.blockReceived[blockIndex]) {
      return false // Duplicate
    }

    // Phase 7: Check if block was unrequested before receiving
    const hadNoRequests =
      !this.blockRequests.has(blockIndex) || this.blockRequests.get(blockIndex)!.length === 0

    // Copy directly from ChunkedBuffer to piece buffer
    const destOffset = blockIndex * BLOCK_SIZE
    source.copyTo(this.buffer, destOffset, sourceOffset, length)
    this.blockReceived[blockIndex] = true
    this._blocksReceivedCount++
    this.blockSenders.set(blockIndex, peerId)
    this._lastActivity = Date.now()

    // Clear requests for this block - it's been fulfilled
    this.blockRequests.delete(blockIndex)

    // Phase 7: Decrement unrequested count if block was unrequested
    if (hadNoRequests) {
      this._unrequestedCount--
    }

    return true
  }

  // --- Phase 5: Piece Health Management ---

  /**
   * Get stale requests that have exceeded the timeout threshold.
   * Returns details needed to send CANCEL messages and clear ownership.
   *
   * Unlike checkTimeouts() which clears requests, this just returns them
   * so the caller can send CANCEL messages first.
   *
   * @param timeoutMs - Timeout threshold in milliseconds
   * @returns Array of stale requests with blockIndex and peerId
   */
  getStaleRequests(timeoutMs: number): Array<{ blockIndex: number; peerId: string }> {
    const now = Date.now()
    const stale: Array<{ blockIndex: number; peerId: string }> = []

    for (const [blockIndex, requests] of this.blockRequests) {
      for (const req of requests) {
        if (now - req.timestamp > timeoutMs) {
          stale.push({ blockIndex, peerId: req.peerId })
        }
      }
    }

    return stale
  }

  /**
   * Check if this piece should be abandoned due to lack of progress.
   *
   * A piece is abandoned if:
   * 1. It has been active longer than the timeout threshold
   * 2. It has made less than minProgress (e.g., 50%) progress
   *
   * This prevents pieces from lingering indefinitely when peers are slow
   * or have disconnected, allowing the piece to be restarted fresh.
   *
   * @param timeoutMs - Time since activation to consider abandonment
   * @param minProgress - Minimum progress ratio (0-1) to keep the piece
   */
  shouldAbandon(timeoutMs: number, minProgress: number): boolean {
    const age = Date.now() - this._activatedAt
    if (age < timeoutMs) return false

    const progress = this._blocksReceivedCount / this.blocksNeeded
    return progress < minProgress
  }

  /**
   * Cancel a specific request from a peer.
   * Called after sending a CANCEL message to clean up internal state.
   *
   * Also clears exclusive ownership if the cancelled peer was the owner.
   *
   * @param blockIndex - The block index to cancel
   * @param peerId - The peer ID to cancel from
   */
  cancelRequest(blockIndex: number, peerId: string): void {
    const requests = this.blockRequests.get(blockIndex)
    if (!requests) return

    const idx = requests.findIndex((r) => r.peerId === peerId)
    if (idx !== -1) {
      requests.splice(idx, 1)
      if (requests.length === 0) {
        this.blockRequests.delete(blockIndex)
        // Phase 7: Block becomes unrequested again (if not received)
        if (!this.blockReceived[blockIndex]) {
          this._unrequestedCount++
        }
      }
    }

    // Clear exclusive owner if they timed out
    if (this._exclusivePeer === peerId) {
      this._exclusivePeer = null
    }
  }

  // --- Request Management (THE KEY FIX) ---

  /**
   * Clear all requests made by a specific peer.
   * Called when a peer disconnects to allow re-requesting those blocks.
   * Returns the number of requests cleared.
   */
  clearRequestsForPeer(peerId: string): number {
    let cleared = 0
    for (const [blockIndex, requests] of this.blockRequests) {
      const filtered = requests.filter((r) => r.peerId !== peerId)
      if (filtered.length !== requests.length) {
        cleared += requests.length - filtered.length
        if (filtered.length === 0) {
          this.blockRequests.delete(blockIndex)
          // Phase 7: Block becomes unrequested again (if not received)
          if (!this.blockReceived[blockIndex]) {
            this._unrequestedCount++
          }
        } else {
          this.blockRequests.set(blockIndex, filtered)
        }
      }
    }
    return cleared
  }

  /**
   * Clear requests that have timed out.
   * Returns a map of peerId -> number of requests cleared for that peer.
   */
  checkTimeouts(timeoutMs: number): Map<string, number> {
    const now = Date.now()
    const clearedByPeer = new Map<string, number>()

    for (const [blockIndex, requests] of this.blockRequests) {
      const remaining: RequestInfo[] = []
      for (const req of requests) {
        if (now - req.timestamp >= timeoutMs) {
          // This request timed out - track it by peer
          clearedByPeer.set(req.peerId, (clearedByPeer.get(req.peerId) || 0) + 1)
        } else {
          remaining.push(req)
        }
      }
      if (remaining.length === 0) {
        this.blockRequests.delete(blockIndex)
        // Phase 7: Block becomes unrequested again (if not received)
        if (!this.blockReceived[blockIndex]) {
          this._unrequestedCount++
        }
      } else if (remaining.length !== requests.length) {
        this.blockRequests.set(blockIndex, remaining)
      }
    }
    return clearedByPeer
  }

  // --- Block Selection ---

  /**
   * Get blocks that need to be requested (not received, not currently requested).
   */
  getNeededBlocks(maxBlocks: number = Infinity): BlockInfo[] {
    const needed: BlockInfo[] = []

    for (let i = 0; i < this.blocksNeeded && needed.length < maxBlocks; i++) {
      // Skip if we have the data
      if (this.blockReceived[i]) continue

      // Skip if already requested (with valid non-timed-out request)
      if (this.blockRequests.has(i) && this.blockRequests.get(i)!.length > 0) continue

      const begin = i * BLOCK_SIZE
      const length = Math.min(BLOCK_SIZE, this.length - begin)
      needed.push({ begin, length })
    }

    return needed
  }

  // --- Endgame Mode Support ---

  /**
   * Get blocks needed from a specific peer in endgame mode.
   * Returns blocks this peer hasn't requested yet, even if other peers have.
   */
  getNeededBlocksEndgame(peerId: string, maxBlocks: number = Infinity): BlockInfo[] {
    const needed: BlockInfo[] = []

    for (let i = 0; i < this.blocksNeeded && needed.length < maxBlocks; i++) {
      // Skip if we have the data
      if (this.blockReceived[i]) continue

      // In endgame: skip only if THIS PEER already requested it
      const requests = this.blockRequests.get(i)
      if (requests?.some((r) => r.peerId === peerId)) continue

      const begin = i * BLOCK_SIZE
      const length = Math.min(BLOCK_SIZE, this.length - begin)
      needed.push({ begin, length })
    }

    return needed
  }

  /**
   * Get peer IDs that have outstanding requests for a block (excluding one peer).
   * Used in endgame to send CANCEL messages when a block arrives.
   */
  getOtherRequesters(blockIndex: number, excludePeerId: string): string[] {
    const requests = this.blockRequests.get(blockIndex) ?? []
    return requests.filter((r) => r.peerId !== excludePeerId).map((r) => r.peerId)
  }

  // --- Assembly ---

  /**
   * Get the assembled piece buffer.
   * With pre-allocated buffers, blocks are written directly to their final positions,
   * so this just returns the buffer - no copy needed!
   * Only call when haveAllBlocks is true.
   */
  assemble(): Uint8Array {
    if (!this.haveAllBlocks) {
      throw new Error(`Cannot assemble piece ${this.index}: missing blocks`)
    }

    // With pre-allocated buffer, blocks are already in place - no assembly needed!
    return this.buffer
  }

  /**
   * Get direct access to the internal buffer.
   * Use with caution - primarily for buffer pooling.
   */
  getBuffer(): Uint8Array {
    return this.buffer
  }

  /**
   * Get peers that contributed blocks to this piece.
   * Used for suspicious peer tracking on hash verification failure.
   */
  getContributingPeers(): Set<string> {
    return new Set(this.blockSenders.values())
  }

  // --- Cleanup ---

  clear(): void {
    this.blockReceived.fill(false)
    this._blocksReceivedCount = 0
    this.blockRequests.clear()
    this.blockSenders.clear()
    // Phase 4: Reset ownership tracking
    this._exclusivePeer = null
    this._activatedAt = Date.now()
    // Phase 7: Reset unrequested count - all blocks become unrequested again
    this._unrequestedCount = this.blocksNeeded
    // Note: buffer is NOT cleared - for pooling, the caller can reuse it
  }
}
