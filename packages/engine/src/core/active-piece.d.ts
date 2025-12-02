export declare const BLOCK_SIZE = 16384
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
export declare class ActivePiece {
  readonly index: number
  readonly length: number
  readonly blocksNeeded: number
  private blockData
  private blockSenders
  private blockRequests
  private _lastActivity
  constructor(index: number, length: number)
  get haveAllBlocks(): boolean
  get lastActivity(): number
  get bufferedBytes(): number
  get blocksReceived(): number
  hasBlock(blockIndex: number): boolean
  /**
   * Check if a block has an active (non-timed-out) request.
   */
  isBlockRequested(blockIndex: number, timeoutMs?: number): boolean
  /**
   * Record that a request was sent to a peer for this block.
   */
  addRequest(blockIndex: number, peerId: string): void
  /**
   * Add received block data.
   * Returns true if this was a new block, false if duplicate.
   */
  addBlock(blockIndex: number, data: Uint8Array, peerId: string): boolean
  /**
   * Clear all requests made by a specific peer.
   * Called when a peer disconnects to allow re-requesting those blocks.
   * Returns the number of requests cleared.
   */
  clearRequestsForPeer(peerId: string): number
  /**
   * Clear requests that have timed out.
   * Returns the number of requests cleared.
   */
  checkTimeouts(timeoutMs: number): number
  /**
   * Get blocks that need to be requested (not received, not currently requested).
   */
  getNeededBlocks(maxBlocks?: number): BlockInfo[]
  /**
   * For endgame mode: get blocks that are requested but not yet received.
   */
  getRequestedButNotReceivedBlocks(): number[]
  /**
   * Assemble all blocks into a complete piece.
   * Only call when haveAllBlocks is true.
   */
  assemble(): Uint8Array
  /**
   * Get peers that contributed blocks to this piece.
   * Used for suspicious peer tracking on hash verification failure.
   */
  getContributingPeers(): Set<string>
  clear(): void
}
//# sourceMappingURL=active-piece.d.ts.map
