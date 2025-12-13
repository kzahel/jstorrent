import {
  RrdHistory,
  RrdTierConfig,
  RrdSample,
  RrdSamplesResult,
  DEFAULT_RRD_TIERS,
} from '../utils/rrd-history'
import { TokenBucket } from '../utils/token-bucket'

export interface BandwidthTrackerConfig {
  tiers?: RrdTierConfig[]
}

export class BandwidthTracker {
  public readonly download: RrdHistory
  public readonly upload: RrdHistory
  public readonly downloadBucket: TokenBucket
  public readonly uploadBucket: TokenBucket

  constructor(config: BandwidthTrackerConfig = {}) {
    const tiers = config.tiers ?? DEFAULT_RRD_TIERS
    this.download = new RrdHistory(tiers)
    this.upload = new RrdHistory(tiers)
    this.downloadBucket = new TokenBucket(0) // unlimited by default
    this.uploadBucket = new TokenBucket(0)
  }

  recordDownload(bytes: number, timestamp?: number): void {
    this.download.record(bytes, timestamp)
  }

  recordUpload(bytes: number, timestamp?: number): void {
    this.upload.record(bytes, timestamp)
  }

  getDownloadSamples(fromTime: number, toTime: number, maxPoints?: number): RrdSample[] {
    return this.download.getSamples(fromTime, toTime, maxPoints)
  }

  getUploadSamples(fromTime: number, toTime: number, maxPoints?: number): RrdSample[] {
    return this.upload.getSamples(fromTime, toTime, maxPoints)
  }

  getDownloadSamplesWithMeta(
    fromTime: number,
    toTime: number,
    maxPoints?: number,
  ): RrdSamplesResult {
    return this.download.getSamplesWithMeta(fromTime, toTime, maxPoints)
  }

  getUploadSamplesWithMeta(fromTime: number, toTime: number, maxPoints?: number): RrdSamplesResult {
    return this.upload.getSamplesWithMeta(fromTime, toTime, maxPoints)
  }

  getDownloadRate(windowMs?: number): number {
    return this.download.getCurrentRate(windowMs)
  }

  getUploadRate(windowMs?: number): number {
    return this.upload.getCurrentRate(windowMs)
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
}
