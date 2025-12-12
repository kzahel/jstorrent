import { describe, it, expect } from 'vitest'
import { RrdHistory } from '../../src/utils/rrd-history'

describe('RrdHistory', () => {
  it('records and retrieves samples', () => {
    const rrd = new RrdHistory([{ bucketMs: 100, count: 10 }])

    const baseTime = 1000000
    rrd.record(100, baseTime)
    rrd.record(200, baseTime + 50) // Same bucket
    rrd.record(150, baseTime + 100) // Next bucket

    const samples = rrd.getSamples(baseTime - 1000, baseTime + 1000, 100)

    expect(samples.length).toBeGreaterThan(0)
    // First bucket should have 300 (100 + 200)
    const firstBucket = samples.find((s) => s.time === baseTime)
    expect(firstBucket?.value).toBe(300)
  })

  it('consolidates to higher tiers', () => {
    const rrd = new RrdHistory([
      { bucketMs: 100, count: 5 },
      { bucketMs: 500, count: 5 },
    ])

    const baseTime = 1000000
    // Fill more than tier 0 capacity
    for (let i = 0; i < 10; i++) {
      rrd.record(100, baseTime + i * 100)
    }

    // Should still be able to get samples from tier 1
    const samples = rrd.getSamples(baseTime - 1000, baseTime + 2000, 10)
    expect(samples.length).toBeGreaterThan(0)
  })

  it('calculates current rate', () => {
    const rrd = new RrdHistory([{ bucketMs: 100, count: 100 }])

    const now = Date.now()
    // Record 1000 bytes over 1 second (10 buckets × 100 bytes)
    for (let i = 0; i < 10; i++) {
      rrd.record(100, now - 1000 + i * 100)
    }

    const rate = rrd.getCurrentRate(1000)
    // Should be approximately 1000 bytes/sec
    expect(rate).toBeGreaterThan(800)
    expect(rate).toBeLessThan(1200)
  })
})
