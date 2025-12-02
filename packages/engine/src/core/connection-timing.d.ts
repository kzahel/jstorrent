/**
 * Tracks connection timing statistics and computes adaptive timeouts.
 *
 * Uses 95th percentile of observed connection times with a multiplier,
 * bounded between MIN and MAX to handle edge cases.
 */
export declare class ConnectionTimingTracker {
  private samples
  private readonly maxSamples
  private readonly MIN_TIMEOUT
  private readonly MAX_TIMEOUT
  private readonly DEFAULT_TIMEOUT
  private readonly MULTIPLIER
  private minSeen
  private totalConnections
  private totalTimeouts
  constructor(options?: {
    maxSamples?: number
    minTimeout?: number
    maxTimeout?: number
    defaultTimeout?: number
    multiplier?: number
  })
  /**
   * Record a successful connection and its duration.
   */
  recordSuccess(connectionTimeMs: number): void
  /**
   * Record a connection timeout (for stats, doesn't affect timeout calculation).
   */
  recordTimeout(): void
  /**
   * Get the current adaptive timeout value.
   */
  getTimeout(): number
  /**
   * Get statistics for logging/debugging.
   */
  getStats(): ConnectionTimingStats
  /**
   * Reset all statistics (e.g., on network change).
   */
  reset(): void
}
export interface ConnectionTimingStats {
  currentTimeout: number
  sampleCount: number
  minSeen: number
  average: number
  p95: number
  totalConnections: number
  totalTimeouts: number
}
//# sourceMappingURL=connection-timing.d.ts.map
