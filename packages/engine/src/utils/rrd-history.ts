export interface RrdTierConfig {
  bucketMs: number
  count: number
}

export interface RrdSample {
  time: number
  value: number
}

export interface RrdSamplesResult {
  samples: RrdSample[]
  bucketMs: number
  /** The start time of the most recent bucket in the selected tier */
  latestBucketTime: number
}

/**
 * Default tiers: ~10 min of history with decreasing resolution
 * Tier 0: 100ms × 300 = 30 sec (fine detail for live view)
 * Tier 1: 500ms × 240 = 2 min
 * Tier 2: 2000ms × 240 = 8 min
 */
export const DEFAULT_RRD_TIERS: RrdTierConfig[] = [
  { bucketMs: 100, count: 300 },
  { bucketMs: 500, count: 240 },
  { bucketMs: 2000, count: 240 },
]

interface Tier {
  config: RrdTierConfig
  buckets: Float32Array
  index: number
  bucketStartTime: number
  accumulator: number
  accumulatorSamples: number
}

export class RrdHistory {
  private tiers: Tier[]
  private lastRecordTime: number = 0

  constructor(tierConfigs: RrdTierConfig[] = DEFAULT_RRD_TIERS) {
    // Validate tiers are in ascending bucketMs order
    for (let i = 1; i < tierConfigs.length; i++) {
      if (tierConfigs[i].bucketMs <= tierConfigs[i - 1].bucketMs) {
        throw new Error('RRD tiers must have ascending bucketMs')
      }
    }

    this.tiers = tierConfigs.map((config) => ({
      config,
      buckets: new Float32Array(config.count),
      index: 0,
      bucketStartTime: 0,
      accumulator: 0,
      accumulatorSamples: 0,
    }))
  }

  /**
   * Record bytes at current time.
   */
  record(bytes: number, timestamp: number = Date.now()): void {
    if (this.lastRecordTime === 0) {
      // First record - initialize bucket start times
      for (const tier of this.tiers) {
        tier.bucketStartTime = Math.floor(timestamp / tier.config.bucketMs) * tier.config.bucketMs
      }
    }
    this.lastRecordTime = timestamp
    this.recordToTier(0, bytes, timestamp)
  }

  private recordToTier(tierIndex: number, bytes: number, timestamp: number): void {
    const tier = this.tiers[tierIndex]
    if (!tier) return

    const { config, buckets } = tier
    const bucketTime = Math.floor(timestamp / config.bucketMs) * config.bucketMs

    if (tier.bucketStartTime === 0) {
      tier.bucketStartTime = bucketTime
    }

    // How many buckets have elapsed?
    const elapsed = bucketTime - tier.bucketStartTime
    const bucketsElapsed = Math.floor(elapsed / config.bucketMs)

    if (bucketsElapsed > 0) {
      // Finalize current bucket, consolidate to next tier
      this.finalizeBucket(tierIndex)

      // Clear skipped buckets
      const toSkip = Math.min(bucketsElapsed - 1, config.count)
      for (let i = 0; i < toSkip; i++) {
        tier.index = (tier.index + 1) % config.count
        buckets[tier.index] = 0
        // Consolidate zeros too? Skip for now - empty buckets are empty
      }

      // Advance to new bucket
      tier.index = (tier.index + 1) % config.count
      buckets[tier.index] = 0
      tier.bucketStartTime = bucketTime
    }

    // Add to current bucket
    buckets[tier.index] += bytes
  }

  private finalizeBucket(tierIndex: number): void {
    const tier = this.tiers[tierIndex]
    const nextTier = this.tiers[tierIndex + 1]
    if (!nextTier) return

    // Consolidate: pass the finalized bucket value to next tier
    const value = tier.buckets[tier.index]
    this.recordToTier(tierIndex + 1, value, tier.bucketStartTime)
  }

  /**
   * Select the appropriate tier for a time range query.
   */
  private selectTier(duration: number, maxPoints: number): number {
    const desiredBucketMs = duration / maxPoints

    // Find appropriate tier: prefer finest resolution that covers the time range
    let tierIndex = 0
    for (let i = 0; i < this.tiers.length; i++) {
      const tier = this.tiers[i]
      const tierCapacityMs = tier.config.bucketMs * tier.config.count

      if (tier.config.bucketMs <= desiredBucketMs && tierCapacityMs >= duration) {
        tierIndex = i
      }
    }

    // If no tier covers the full range, use the coarsest tier (most history)
    const selectedTier = this.tiers[tierIndex]
    if (selectedTier.config.bucketMs * selectedTier.config.count < duration) {
      tierIndex = this.tiers.length - 1
    }

    return tierIndex
  }

  /**
   * Get samples for a time range at appropriate resolution.
   * Returns samples in chronological order.
   */
  getSamples(fromTime: number, toTime: number, maxPoints: number = 500): RrdSample[] {
    const tierIndex = this.selectTier(toTime - fromTime, maxPoints)
    return this.getSamplesFromTier(tierIndex, fromTime, toTime)
  }

  /**
   * Get samples with metadata about the bucket size used.
   * Use this when you need to align timestamps to the actual resolution.
   */
  getSamplesWithMeta(fromTime: number, toTime: number, maxPoints: number = 500): RrdSamplesResult {
    const tierIndex = this.selectTier(toTime - fromTime, maxPoints)
    const tier = this.tiers[tierIndex]
    return {
      samples: this.getSamplesFromTier(tierIndex, fromTime, toTime),
      bucketMs: tier.config.bucketMs,
      latestBucketTime: tier.bucketStartTime,
    }
  }

  private getSamplesFromTier(tierIndex: number, fromTime: number, toTime: number): RrdSample[] {
    const tier = this.tiers[tierIndex]
    const { config, buckets, index, bucketStartTime } = tier
    const samples: RrdSample[] = []

    // Walk backwards through the circular buffer
    const oldestPossibleTime = bucketStartTime - (config.count - 1) * config.bucketMs

    for (let i = 0; i < config.count; i++) {
      const bucketIndex = (index - i + config.count) % config.count
      const time = bucketStartTime - i * config.bucketMs

      if (time < oldestPossibleTime) break
      if (time > toTime) continue
      if (time < fromTime) break

      samples.push({
        time,
        value: buckets[bucketIndex],
      })
    }

    // Return in chronological order
    return samples.reverse()
  }

  /**
   * Get current rate (bytes/sec) based on recent samples.
   */
  getCurrentRate(windowMs: number = 3000): number {
    const now = Date.now()
    const samples = this.getSamples(now - windowMs, now, 100)
    if (samples.length === 0) return 0

    const totalBytes = samples.reduce((sum, s) => sum + s.value, 0)
    return (totalBytes / windowMs) * 1000
  }
}
