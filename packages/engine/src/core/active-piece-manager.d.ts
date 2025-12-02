import { ActivePiece } from './active-piece'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
export interface ActivePieceConfig {
  requestTimeoutMs: number
  maxActivePieces: number
  maxBufferedBytes: number
  cleanupIntervalMs: number
}
/**
 * Manages ActivePiece objects for pieces being downloaded.
 *
 * Uses lazy instantiation pattern:
 * - Objects created on first access via getOrCreate()
 * - Objects removed explicitly via remove() when piece is verified or abandoned
 *
 * Key responsibility: clearRequestsForPeer() - when a peer disconnects,
 * remove all pending requests from that peer so blocks can be re-requested
 * from other peers. This fixes the "stall on peer disconnect" bug.
 */
export declare class ActivePieceManager extends EngineComponent {
  static logName: string
  private pieces
  private config
  private cleanupInterval?
  private pieceLengthFn
  constructor(
    engine: ILoggingEngine,
    pieceLengthFn: (index: number) => number,
    config?: Partial<ActivePieceConfig>,
  )
  /**
   * Get or create an ActivePiece for the given index.
   * Returns null if at capacity limits.
   */
  getOrCreate(index: number): ActivePiece | null
  /**
   * Get existing ActivePiece without creating.
   */
  get(index: number): ActivePiece | undefined
  has(index: number): boolean
  /**
   * Remove an ActivePiece (after verification or abandonment).
   */
  remove(index: number): void
  get activeIndices(): number[]
  get activePieces(): ActivePiece[]
  get activeCount(): number
  get totalBufferedBytes(): number
  /**
   * Clear all requests from a specific peer across all active pieces.
   * Called when a peer disconnects to allow re-requesting blocks.
   * Returns the total number of requests cleared.
   */
  clearRequestsForPeer(peerId: string): number
  /**
   * Check for and clear timed-out requests across all active pieces.
   * Called periodically by the cleanup interval.
   */
  checkTimeouts(): number
  /**
   * Remove stale pieces that have no activity and no data.
   */
  private cleanupStale
  /**
   * Cleanup on destroy.
   */
  destroy(): void
}
//# sourceMappingURL=active-piece-manager.d.ts.map
