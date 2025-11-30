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
 * - Block data storage
 * - Request tracking with peer association (the key fix for stalls)
 * - Contributing peer tracking for hash failure analysis
 */
export class ActivePiece {
  readonly index: number
  readonly length: number
  readonly blocksNeeded: number

  // Block data storage - keyed by block index
  private blockData: Map<number, Uint8Array> = new Map()

  // Track which peer sent each block (for suspicious peer detection on hash failure)
  private blockSenders: Map<number, string> = new Map()

  // Request tracking - supports multiple requests per block (for endgame mode)
  // This is THE KEY CHANGE: requests are tied to specific peers
  private blockRequests: Map<number, RequestInfo[]> = new Map()

  // Activity tracking for stale piece cleanup
  private _lastActivity: number = Date.now()

  constructor(index: number, length: number) {
    this.index = index
    this.length = length
    this.blocksNeeded = Math.ceil(length / BLOCK_SIZE)
  }

  // --- State Queries ---

  get haveAllBlocks(): boolean {
    return this.blockData.size === this.blocksNeeded
  }

  get lastActivity(): number {
    return this._lastActivity
  }

  get bufferedBytes(): number {
    let total = 0
    for (const data of this.blockData.values()) {
      total += data.length
    }
    return total
  }

  get blocksReceived(): number {
    return this.blockData.size
  }

  hasBlock(blockIndex: number): boolean {
    return this.blockData.has(blockIndex)
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
    let requests = this.blockRequests.get(blockIndex)
    if (!requests) {
      requests = []
      this.blockRequests.set(blockIndex, requests)
    }
    requests.push({ peerId, timestamp: Date.now() })
    this._lastActivity = Date.now()
  }

  /**
   * Add received block data.
   * Returns true if this was a new block, false if duplicate.
   */
  addBlock(blockIndex: number, data: Uint8Array, peerId: string): boolean {
    if (this.blockData.has(blockIndex)) {
      return false // Duplicate
    }

    this.blockData.set(blockIndex, data)
    this.blockSenders.set(blockIndex, peerId)
    this._lastActivity = Date.now()

    // Clear requests for this block - it's been fulfilled
    this.blockRequests.delete(blockIndex)

    return true
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
        } else {
          this.blockRequests.set(blockIndex, filtered)
        }
      }
    }
    return cleared
  }

  /**
   * Clear requests that have timed out.
   * Returns the number of requests cleared.
   */
  checkTimeouts(timeoutMs: number): number {
    const now = Date.now()
    let cleared = 0

    for (const [blockIndex, requests] of this.blockRequests) {
      const filtered = requests.filter((r) => now - r.timestamp < timeoutMs)
      if (filtered.length !== requests.length) {
        cleared += requests.length - filtered.length
        if (filtered.length === 0) {
          this.blockRequests.delete(blockIndex)
        } else {
          this.blockRequests.set(blockIndex, filtered)
        }
      }
    }
    return cleared
  }

  // --- Block Selection ---

  /**
   * Get blocks that need to be requested (not received, not currently requested).
   */
  getNeededBlocks(maxBlocks: number = Infinity): BlockInfo[] {
    const needed: BlockInfo[] = []

    for (let i = 0; i < this.blocksNeeded && needed.length < maxBlocks; i++) {
      // Skip if we have the data
      if (this.blockData.has(i)) continue

      // Skip if already requested (with valid non-timed-out request)
      if (this.blockRequests.has(i) && this.blockRequests.get(i)!.length > 0) continue

      const begin = i * BLOCK_SIZE
      const length = Math.min(BLOCK_SIZE, this.length - begin)
      needed.push({ begin, length })
    }

    return needed
  }

  /**
   * For endgame mode: get blocks that are requested but not yet received.
   */
  getRequestedButNotReceivedBlocks(): number[] {
    const blocks: number[] = []
    for (let i = 0; i < this.blocksNeeded; i++) {
      if (!this.blockData.has(i)) {
        blocks.push(i)
      }
    }
    return blocks
  }

  // --- Assembly ---

  /**
   * Assemble all blocks into a complete piece.
   * Only call when haveAllBlocks is true.
   */
  assemble(): Uint8Array {
    if (!this.haveAllBlocks) {
      throw new Error(`Cannot assemble piece ${this.index}: missing blocks`)
    }

    const result = new Uint8Array(this.length)
    for (let i = 0; i < this.blocksNeeded; i++) {
      const data = this.blockData.get(i)!
      const offset = i * BLOCK_SIZE
      result.set(data, offset)
    }
    return result
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
    this.blockData.clear()
    this.blockRequests.clear()
    this.blockSenders.clear()
  }
}
