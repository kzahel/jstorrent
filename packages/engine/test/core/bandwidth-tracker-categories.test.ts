import { describe, it, expect, beforeEach } from 'vitest'
import {
  BandwidthTracker,
  TrafficCategory,
  ALL_TRAFFIC_CATEGORIES,
} from '../../src/core/bandwidth-tracker'

describe('BandwidthTracker with categories', () => {
  let tracker: BandwidthTracker

  // Use a fixed base time aligned to bucket boundaries (1-second buckets in default tier)
  const baseTime = 1000000

  beforeEach(() => {
    tracker = new BandwidthTracker()
  })

  it('records bytes by category', () => {
    tracker.record('peer:protocol', 1000, 'down', baseTime)
    tracker.record('peer:payload', 800, 'down', baseTime)
    tracker.record('tracker:http', 200, 'down', baseTime)

    // Check individual categories
    const peerSamples = tracker.getCategorySamples(
      'down',
      'peer:protocol',
      baseTime - 1000,
      baseTime + 1000,
    )
    expect(peerSamples.length).toBeGreaterThan(0)
    const peerBucket = peerSamples.find((s) => s.time === baseTime)
    expect(peerBucket?.value).toBe(1000)

    const payloadSamples = tracker.getCategorySamples(
      'down',
      'peer:payload',
      baseTime - 1000,
      baseTime + 1000,
    )
    const payloadBucket = payloadSamples.find((s) => s.time === baseTime)
    expect(payloadBucket?.value).toBe(800)
  })

  it('aggregates all categories excluding payload', () => {
    tracker.record('peer:protocol', 1000, 'down', baseTime)
    tracker.record('peer:payload', 800, 'down', baseTime) // subset, should be excluded from 'all'
    tracker.record('tracker:http', 200, 'down', baseTime)
    tracker.record('tracker:udp', 100, 'down', baseTime)
    tracker.record('dht', 50, 'down', baseTime)

    const allSamples = tracker.getSamples('down', 'all', baseTime - 1000, baseTime + 1000)
    // Should be 1000 + 200 + 100 + 50 = 1350 (not including peer:payload)
    const bucket = allSamples.find((s) => s.time === baseTime)
    expect(bucket?.value).toBe(1350)
  })

  it('aggregates selected categories', () => {
    tracker.record('peer:protocol', 1000, 'down', baseTime)
    tracker.record('tracker:http', 200, 'down', baseTime)
    tracker.record('tracker:udp', 100, 'down', baseTime)

    const samples = tracker.getSamples(
      'down',
      ['tracker:http', 'tracker:udp'],
      baseTime - 1000,
      baseTime + 1000,
    )
    const bucket = samples.find((s) => s.time === baseTime)
    expect(bucket?.value).toBe(300)
  })

  it('calculates rate per category', () => {
    const now = Date.now()

    // Record 1000 bytes in peer:protocol
    tracker.record('peer:protocol', 1000, 'down', now)

    const rate = tracker.getCategoryRate('down', 'peer:protocol')
    expect(rate).toBeGreaterThan(0)
  })

  it('tracks upload and download separately', () => {
    tracker.record('peer:protocol', 1000, 'down', baseTime)
    tracker.record('peer:protocol', 500, 'up', baseTime)

    const downSamples = tracker.getCategorySamples(
      'down',
      'peer:protocol',
      baseTime - 1000,
      baseTime + 1000,
    )
    const upSamples = tracker.getCategorySamples(
      'up',
      'peer:protocol',
      baseTime - 1000,
      baseTime + 1000,
    )

    const downBucket = downSamples.find((s) => s.time === baseTime)
    const upBucket = upSamples.find((s) => s.time === baseTime)
    expect(downBucket?.value).toBe(1000)
    expect(upBucket?.value).toBe(500)
  })

  it('derives protocol overhead correctly', () => {
    const now = Date.now()

    tracker.record('peer:protocol', 1000, 'down', now)
    tracker.record('peer:payload', 950, 'down', now)

    const protocolRate = tracker.getCategoryRate('down', 'peer:protocol')
    const payloadRate = tracker.getCategoryRate('down', 'peer:payload')
    const overhead = protocolRate - payloadRate

    // Overhead should be approximately 50/1000 of the protocol rate
    expect(overhead).toBeLessThan(protocolRate)
    expect(overhead).toBeGreaterThanOrEqual(0)
  })

  it('legacy methods still work', () => {
    // Use legacy methods
    tracker.recordDownload(1000, baseTime)
    tracker.recordUpload(500, baseTime)

    // Should record to peer:protocol category
    const downSamples = tracker.getDownloadSamples(baseTime - 1000, baseTime + 1000)
    const upSamples = tracker.getUploadSamples(baseTime - 1000, baseTime + 1000)

    const downBucket = downSamples.find((s) => s.time === baseTime)
    const upBucket = upSamples.find((s) => s.time === baseTime)
    expect(downBucket?.value).toBe(1000)
    expect(upBucket?.value).toBe(500)
  })

  it('tracks all traffic categories', () => {
    const categories: TrafficCategory[] = [
      'peer:protocol',
      'peer:payload',
      'tracker:http',
      'tracker:udp',
      'dht',
    ]

    // Record bytes for each category
    for (const cat of categories) {
      tracker.record(cat, 100, 'down', baseTime)
      tracker.record(cat, 50, 'up', baseTime)
    }

    // Verify each category has data
    for (const cat of categories) {
      const downSamples = tracker.getCategorySamples('down', cat, baseTime - 1000, baseTime + 1000)
      const upSamples = tracker.getCategorySamples('up', cat, baseTime - 1000, baseTime + 1000)
      const downBucket = downSamples.find((s) => s.time === baseTime)
      const upBucket = upSamples.find((s) => s.time === baseTime)
      expect(downBucket?.value).toBe(100)
      expect(upBucket?.value).toBe(50)
    }
  })

  it('ALL_TRAFFIC_CATEGORIES contains all expected categories', () => {
    expect(ALL_TRAFFIC_CATEGORIES).toContain('peer:protocol')
    expect(ALL_TRAFFIC_CATEGORIES).toContain('peer:payload')
    expect(ALL_TRAFFIC_CATEGORIES).toContain('tracker:http')
    expect(ALL_TRAFFIC_CATEGORIES).toContain('tracker:udp')
    expect(ALL_TRAFFIC_CATEGORIES).toContain('dht')
    expect(ALL_TRAFFIC_CATEGORIES).toContain('disk')
    expect(ALL_TRAFFIC_CATEGORIES.length).toBe(6)
  })

  it('getRate with all categories sums correctly', () => {
    const now = Date.now()

    tracker.record('peer:protocol', 1000, 'down', now)
    tracker.record('tracker:http', 200, 'down', now)
    tracker.record('dht', 100, 'down', now)

    const allRate = tracker.getRate('down', 'all')
    const peerRate = tracker.getCategoryRate('down', 'peer:protocol')
    const httpRate = tracker.getCategoryRate('down', 'tracker:http')
    const dhtRate = tracker.getCategoryRate('down', 'dht')

    // All rate should equal sum of individual rates (peer:payload excluded)
    expect(allRate).toBeCloseTo(peerRate + httpRate + dhtRate, 0)
  })

  it('getSamplesWithMeta returns correct metadata for single category', () => {
    const now = Date.now()
    tracker.record('dht', 100, 'down', now)

    const result = tracker.getSamplesWithMeta('down', ['dht'], now - 10000, now + 1000)
    expect(result.bucketMs).toBeGreaterThan(0)
    expect(result.samples.length).toBeGreaterThan(0)
  })

  it('empty categories array returns empty samples', () => {
    tracker.record('peer:protocol', 1000, 'down', baseTime)

    const samples = tracker.getSamples('down', [], baseTime - 1000, baseTime + 1000)
    expect(samples).toEqual([])
  })

  describe('isDownloadRateLimited', () => {
    it('returns false when no limit is set', () => {
      // Default is unlimited (0)
      expect(tracker.isDownloadRateLimited()).toBe(false)
    })

    it('returns false when limit is set but no traffic recorded', () => {
      tracker.setDownloadLimit(100000) // 100 KB/s
      // No traffic recorded = 0 rate
      expect(tracker.isDownloadRateLimited(0.8)).toBe(false)
    })

    it('returns true when rate is at or above threshold', () => {
      // Set a very low limit so we can easily exceed it
      tracker.setDownloadLimit(100) // 100 bytes/s

      const now = Date.now()
      // Record across multiple seconds to get a realistic rate
      // getCurrentRate uses a 3-second window by default
      tracker.record('peer:protocol', 500, 'down', now - 2000)
      tracker.record('peer:protocol', 500, 'down', now - 1000)
      tracker.record('peer:protocol', 500, 'down', now)

      // With 1500 bytes over 3 seconds = 500 bytes/sec, way above 100 bytes/s limit
      expect(tracker.isDownloadRateLimited(0.8)).toBe(true)
    })

    it('returns false when limit set but traffic is below threshold', () => {
      // Set a limit higher than our traffic
      tracker.setDownloadLimit(10000) // 10 KB/s

      const now = Date.now()
      // Record minimal traffic
      tracker.record('peer:protocol', 100, 'down', now - 1000)
      tracker.record('peer:protocol', 100, 'down', now)

      // Rate is about 67 bytes/sec, way below 10 KB/s limit
      expect(tracker.isDownloadRateLimited(0.8)).toBe(false)
    })

    it('respects custom threshold', () => {
      // Set limit to 1000 bytes/s
      tracker.setDownloadLimit(1000)

      const now = Date.now()
      // Record traffic to get rate around 600 bytes/s (60% of limit)
      tracker.record('peer:protocol', 600, 'down', now - 2000)
      tracker.record('peer:protocol', 600, 'down', now - 1000)
      tracker.record('peer:protocol', 600, 'down', now)

      // Rate is about 600 bytes/sec = 60% of 1000 limit
      // Should be above 50% threshold but below 80%
      expect(tracker.isDownloadRateLimited(0.5)).toBe(true)
      expect(tracker.isDownloadRateLimited(0.8)).toBe(false)
    })
  })
})
