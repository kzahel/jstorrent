import { BLOCK_SIZE } from './piece-manager'

export interface BlockInfo {
  begin: number
  data: Uint8Array
  peerId: string
}

/**
 * Buffers blocks for a single piece in memory until complete.
 * Tracks which peers contributed blocks for suspicious peer detection.
 */
export class PieceBuffer {
  private blocks: Map<number, BlockInfo> = new Map()
  private blocksNeeded: number
  public readonly pieceIndex: number
  public readonly pieceLength: number
  public lastActivity: number = Date.now()

  constructor(pieceIndex: number, pieceLength: number) {
    this.pieceIndex = pieceIndex
    this.pieceLength = pieceLength
    this.blocksNeeded = Math.ceil(pieceLength / BLOCK_SIZE)
  }

  /**
   * Add a received block to the buffer.
   * Returns true if this block was new (not a duplicate).
   */
  addBlock(begin: number, data: Uint8Array, peerId: string): boolean {
    const blockIndex = Math.floor(begin / BLOCK_SIZE)

    if (this.blocks.has(blockIndex)) {
      return false // Duplicate
    }

    this.blocks.set(blockIndex, { begin, data, peerId })
    this.lastActivity = Date.now()
    return true
  }

  /**
   * Check if all blocks have been received.
   */
  isComplete(): boolean {
    return this.blocks.size === this.blocksNeeded
  }

  /**
   * Get the number of blocks received so far.
   */
  get blocksReceived(): number {
    return this.blocks.size
  }

  /**
   * Assemble all blocks into a single Uint8Array.
   * Only call this when isComplete() returns true.
   */
  assemble(): Uint8Array {
    const result = new Uint8Array(this.pieceLength)

    for (let i = 0; i < this.blocksNeeded; i++) {
      const block = this.blocks.get(i)
      if (!block) {
        throw new Error(`Missing block ${i} in piece ${this.pieceIndex}`)
      }
      result.set(block.data, block.begin)
    }

    return result
  }

  /**
   * Get set of peer IDs that contributed to this piece.
   * Used for suspicious peer tracking when hash fails.
   */
  getContributingPeers(): Set<string> {
    const peers = new Set<string>()
    for (const block of this.blocks.values()) {
      peers.add(block.peerId)
    }
    return peers
  }

  /**
   * Get list of missing block indices.
   */
  getMissingBlocks(): number[] {
    const missing: number[] = []
    for (let i = 0; i < this.blocksNeeded; i++) {
      if (!this.blocks.has(i)) {
        missing.push(i)
      }
    }
    return missing
  }

  /**
   * Clear all buffered data.
   */
  clear(): void {
    this.blocks.clear()
  }
}
