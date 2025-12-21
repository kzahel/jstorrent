import {
  RrdHistory,
  RrdTierConfig,
  RrdSample,
  RrdSamplesResult,
  DEFAULT_RRD_TIERS,
} from '../utils/rrd-history'
import { TokenBucket } from '../utils/token-bucket'

/**
 * Traffic category for bandwidth tracking.
 * Each category represents a different type of network traffic.
 */
export type TrafficCategory =
  | 'peer:protocol' // all peer TCP bytes (handshake, messages, piece data)
  | 'peer:payload' // piece block data only (subset of peer:protocol)
  | 'tracker:http' // HTTP tracker requests/responses
  | 'tracker:udp' // UDP tracker packets
  | 'dht' // DHT UDP packets

/**
 * All traffic categories for iteration.
 */
export const ALL_TRAFFIC_CATEGORIES: TrafficCategory[] = [
  'peer:protocol',
  'peer:payload',
  'tracker:http',
  'tracker:udp',
  'dht',
]

export interface BandwidthTrackerConfig {
  tiers?: RrdTierConfig[]
}

export class BandwidthTracker {
  // Per-category histories
  private downloadByCategory: Map<TrafficCategory, RrdHistory>
  private uploadByCategory: Map<TrafficCategory, RrdHistory>

  // Legacy accessors for backward compatibility (peer:protocol category)
  public readonly download: RrdHistory
  public readonly upload: RrdHistory

  // Rate limiting stays global
  public readonly downloadBucket: TokenBucket
  public readonly uploadBucket: TokenBucket

  constructor(config: BandwidthTrackerConfig = {}) {
    const tiers = config.tiers ?? DEFAULT_RRD_TIERS

    // Initialize history for each category
    this.downloadByCategory = new Map()
    this.uploadByCategory = new Map()
    for (const category of ALL_TRAFFIC_CATEGORIES) {
      this.downloadByCategory.set(category, new RrdHistory(tiers))
      this.uploadByCategory.set(category, new RrdHistory(tiers))
    }

    // Legacy accessors point to peer:protocol category
    this.download = this.downloadByCategory.get('peer:protocol')!
    this.upload = this.uploadByCategory.get('peer:protocol')!

    this.downloadBucket = new TokenBucket(0) // unlimited by default
    this.uploadBucket = new TokenBucket(0)
  }

  /**
   * Record bytes for a specific traffic category.
   */
  record(
    category: TrafficCategory,
    bytes: number,
    direction: 'up' | 'down',
    timestamp?: number,
  ): void {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory
    map.get(category)?.record(bytes, timestamp)
  }

  /**
   * Legacy method - records to peer:protocol category.
   */
  recordDownload(bytes: number, timestamp?: number): void {
    this.record('peer:protocol', bytes, 'down', timestamp)
  }

  /**
   * Legacy method - records to peer:protocol category.
   */
  recordUpload(bytes: number, timestamp?: number): void {
    this.record('peer:protocol', bytes, 'up', timestamp)
  }

  /**
   * Get samples for specified categories.
   * If categories is 'all', sums all categories (excluding peer:payload to avoid double-counting).
   * If categories is an array, sums those categories.
   */
  getSamples(
    direction: 'up' | 'down',
    categories: TrafficCategory[] | 'all',
    fromTime: number,
    toTime: number,
    maxPoints?: number,
  ): RrdSample[] {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory

    // Determine which categories to include
    let cats: TrafficCategory[]
    if (categories === 'all') {
      // Exclude peer:payload since it's a subset of peer:protocol
      cats = ALL_TRAFFIC_CATEGORIES.filter((c) => c !== 'peer:payload')
    } else {
      cats = categories
    }

    if (cats.length === 0) return []

    if (cats.length === 1) {
      // Single category - return directly
      return map.get(cats[0])?.getSamples(fromTime, toTime, maxPoints) ?? []
    }

    // Multiple categories - need to aggregate
    // Get samples from each, then merge by timestamp
    const allSamples: Map<number, number> = new Map()

    for (const cat of cats) {
      const samples = map.get(cat)?.getSamples(fromTime, toTime, maxPoints) ?? []
      for (const s of samples) {
        allSamples.set(s.time, (allSamples.get(s.time) ?? 0) + s.value)
      }
    }

    // Convert to array and sort
    return Array.from(allSamples.entries())
      .map(([time, value]) => ({ time, value }))
      .sort((a, b) => a.time - b.time)
  }

  /**
   * Get samples with metadata for specified categories.
   * Only works for single category. For 'all', falls back to getSamples.
   */
  getSamplesWithMeta(
    direction: 'up' | 'down',
    categories: TrafficCategory[] | 'all',
    fromTime: number,
    toTime: number,
    maxPoints?: number,
  ): RrdSamplesResult {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory

    // Determine which categories to include
    let cats: TrafficCategory[]
    if (categories === 'all') {
      cats = ALL_TRAFFIC_CATEGORIES.filter((c) => c !== 'peer:payload')
    } else {
      cats = categories
    }

    if (cats.length === 1) {
      // Single category - return with full metadata
      return (
        map.get(cats[0])?.getSamplesWithMeta(fromTime, toTime, maxPoints) ?? {
          samples: [],
          bucketMs: 1000,
          latestBucketTime: 0,
        }
      )
    }

    // Multiple categories - aggregate samples, use first category's metadata
    const samples = this.getSamples(direction, categories, fromTime, toTime, maxPoints)
    const firstHistory = map.get(cats[0])
    const meta = firstHistory?.getSamplesWithMeta(fromTime, toTime, maxPoints)

    return {
      samples,
      bucketMs: meta?.bucketMs ?? 1000,
      latestBucketTime: meta?.latestBucketTime ?? 0,
    }
  }

  /**
   * Get samples for a single category.
   */
  getCategorySamples(
    direction: 'up' | 'down',
    category: TrafficCategory,
    fromTime: number,
    toTime: number,
    maxPoints?: number,
  ): RrdSample[] {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory
    return map.get(category)?.getSamples(fromTime, toTime, maxPoints) ?? []
  }

  /**
   * Get current rate for specified categories.
   */
  getRate(
    direction: 'up' | 'down',
    categories: TrafficCategory[] | 'all',
    windowMs?: number,
  ): number {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory

    let cats: TrafficCategory[]
    if (categories === 'all') {
      cats = ALL_TRAFFIC_CATEGORIES.filter((c) => c !== 'peer:payload')
    } else {
      cats = categories
    }

    let total = 0
    for (const cat of cats) {
      total += map.get(cat)?.getCurrentRate(windowMs) ?? 0
    }
    return total
  }

  /**
   * Get current rate for a single category.
   */
  getCategoryRate(direction: 'up' | 'down', category: TrafficCategory, windowMs?: number): number {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory
    return map.get(category)?.getCurrentRate(windowMs) ?? 0
  }

  /**
   * Legacy method - returns samples for peer:protocol category.
   */
  getDownloadSamples(fromTime: number, toTime: number, maxPoints?: number): RrdSample[] {
    return this.getCategorySamples('down', 'peer:protocol', fromTime, toTime, maxPoints)
  }

  /**
   * Legacy method - returns samples for peer:protocol category.
   */
  getUploadSamples(fromTime: number, toTime: number, maxPoints?: number): RrdSample[] {
    return this.getCategorySamples('up', 'peer:protocol', fromTime, toTime, maxPoints)
  }

  /**
   * Legacy method - returns samples with metadata for peer:protocol category.
   */
  getDownloadSamplesWithMeta(
    fromTime: number,
    toTime: number,
    maxPoints?: number,
  ): RrdSamplesResult {
    return this.getSamplesWithMeta('down', ['peer:protocol'], fromTime, toTime, maxPoints)
  }

  /**
   * Legacy method - returns samples with metadata for peer:protocol category.
   */
  getUploadSamplesWithMeta(fromTime: number, toTime: number, maxPoints?: number): RrdSamplesResult {
    return this.getSamplesWithMeta('up', ['peer:protocol'], fromTime, toTime, maxPoints)
  }

  /**
   * Legacy method - returns rate for peer:protocol category.
   */
  getDownloadRate(windowMs?: number): number {
    return this.getCategoryRate('down', 'peer:protocol', windowMs)
  }

  /**
   * Legacy method - returns rate for peer:protocol category.
   */
  getUploadRate(windowMs?: number): number {
    return this.getCategoryRate('up', 'peer:protocol', windowMs)
  }

  /**
   * Set download rate limit.
   * @param bytesPerSec - Limit in bytes/sec (0 = unlimited)
   */
  setDownloadLimit(bytesPerSec: number): void {
    this.downloadBucket.setLimit(bytesPerSec)
  }

  /**
   * Set upload rate limit.
   * @param bytesPerSec - Limit in bytes/sec (0 = unlimited)
   */
  setUploadLimit(bytesPerSec: number): void {
    this.uploadBucket.setLimit(bytesPerSec)
  }

  /**
   * Get current download limit (0 = unlimited).
   */
  getDownloadLimit(): number {
    return this.downloadBucket.refillRate
  }

  /**
   * Get current upload limit (0 = unlimited).
   */
  getUploadLimit(): number {
    return this.uploadBucket.refillRate
  }

  /**
   * Check if download is heavily rate-limited.
   * Returns true if current rate is >= threshold * limit.
   * Returns false if no limit is set.
   *
   * @param threshold - Fraction of limit to consider "heavily limited" (default 0.8)
   */
  isDownloadRateLimited(threshold: number = 0.8): boolean {
    const limit = this.getDownloadLimit()
    if (limit === 0) return false // No limit set
    const rate = this.getDownloadRate()
    return rate >= limit * threshold
  }
}
