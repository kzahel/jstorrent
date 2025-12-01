/**
 * Tracks connection timing statistics and computes adaptive timeouts.
 *
 * Uses 95th percentile of observed connection times with a multiplier,
 * bounded between MIN and MAX to handle edge cases.
 */
export class ConnectionTimingTracker {
  private samples: number[] = []
  private readonly maxSamples: number

  // Bounds
  private readonly MIN_TIMEOUT: number
  private readonly MAX_TIMEOUT: number
  private readonly DEFAULT_TIMEOUT: number
  private readonly MULTIPLIER: number

  // Stats
  private minSeen = Infinity
  private totalConnections = 0
  private totalTimeouts = 0

  constructor(
    options: {
      maxSamples?: number
      minTimeout?: number
      maxTimeout?: number
      defaultTimeout?: number
      multiplier?: number
    } = {},
  ) {
    this.maxSamples = options.maxSamples ?? 50
    this.MIN_TIMEOUT = options.minTimeout ?? 3000 // Never less than 3s
    this.MAX_TIMEOUT = options.maxTimeout ?? 30000 // Never more than 30s
    this.DEFAULT_TIMEOUT = options.defaultTimeout ?? 10000 // Before we have data
    this.MULTIPLIER = options.multiplier ?? 2.5 // Buffer above observed
  }

  /**
   * Record a successful connection and its duration.
   */
  recordSuccess(connectionTimeMs: number): void {
    this.totalConnections++
    this.samples.push(connectionTimeMs)

    if (this.samples.length > this.maxSamples) {
      this.samples.shift()
    }

    if (connectionTimeMs < this.minSeen) {
      this.minSeen = connectionTimeMs
    }
  }

  /**
   * Record a connection timeout (for stats, doesn't affect timeout calculation).
   */
  recordTimeout(): void {
    this.totalTimeouts++
  }

  /**
   * Get the current adaptive timeout value.
   */
  getTimeout(): number {
    if (this.samples.length < 5) {
      // Not enough data yet, use default
      return this.DEFAULT_TIMEOUT
    }

    // Use 95th percentile * multiplier as timeout
    // This allows for variance while catching true hangs
    const sorted = [...this.samples].sort((a, b) => a - b)
    const p95Index = Math.floor(sorted.length * 0.95)
    const p95 = sorted[p95Index]

    const computed = Math.round(p95 * this.MULTIPLIER)

    return Math.max(this.MIN_TIMEOUT, Math.min(this.MAX_TIMEOUT, computed))
  }

  /**
   * Get statistics for logging/debugging.
   */
  getStats(): ConnectionTimingStats {
    if (this.samples.length === 0) {
      return {
        currentTimeout: this.DEFAULT_TIMEOUT,
        sampleCount: 0,
        minSeen: 0,
        average: 0,
        p95: 0,
        totalConnections: this.totalConnections,
        totalTimeouts: this.totalTimeouts,
      }
    }

    const sorted = [...this.samples].sort((a, b) => a - b)
    const sum = this.samples.reduce((a, b) => a + b, 0)
    const avg = sum / this.samples.length
    const p95Index = Math.floor(sorted.length * 0.95)
    const p95 = sorted[p95Index]

    return {
      currentTimeout: this.getTimeout(),
      sampleCount: this.samples.length,
      minSeen: this.minSeen === Infinity ? 0 : this.minSeen,
      average: Math.round(avg),
      p95: p95,
      totalConnections: this.totalConnections,
      totalTimeouts: this.totalTimeouts,
    }
  }

  /**
   * Reset all statistics (e.g., on network change).
   */
  reset(): void {
    this.samples = []
    this.minSeen = Infinity
    this.totalConnections = 0
    this.totalTimeouts = 0
  }
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
