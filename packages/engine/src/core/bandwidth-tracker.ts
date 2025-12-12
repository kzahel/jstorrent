import {
  RrdHistory,
  RrdTierConfig,
  RrdSample,
  RrdSamplesResult,
  DEFAULT_RRD_TIERS,
} from '../utils/rrd-history'

export interface BandwidthTrackerConfig {
  tiers?: RrdTierConfig[]
}

export class BandwidthTracker {
  public readonly download: RrdHistory
  public readonly upload: RrdHistory

  constructor(config: BandwidthTrackerConfig = {}) {
    const tiers = config.tiers ?? DEFAULT_RRD_TIERS
    this.download = new RrdHistory(tiers)
    this.upload = new RrdHistory(tiers)
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
}
