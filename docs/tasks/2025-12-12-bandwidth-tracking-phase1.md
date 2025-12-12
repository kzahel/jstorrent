# Bandwidth Tracking & Speed Graph - Phase 1

## Overview

Add global bandwidth tracking with RRD-style history storage and a Speed tab in the detail pane showing upload/download over time via uPlot.

**Scope:** Global only (not per-torrent), no rate limiting yet, no persistence, no traffic categories. Just record total bytes up/down and visualize.

## File Changes

### 1. Create RRD History Utility

**File:** `packages/engine/src/utils/rrd-history.ts`

Round-robin database style time-series storage. Multiple tiers with configurable resolution. Old data consolidates into coarser buckets.

```typescript
export interface RrdTierConfig {
  bucketMs: number
  count: number
}

export interface RrdSample {
  time: number
  value: number
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
   * Get samples for a time range at appropriate resolution.
   * Returns samples in chronological order.
   */
  getSamples(fromTime: number, toTime: number, maxPoints: number = 500): RrdSample[] {
    const duration = toTime - fromTime
    const desiredBucketMs = duration / maxPoints

    // Find the finest tier that's coarser than our desired resolution
    let tierIndex = 0
    for (let i = 0; i < this.tiers.length; i++) {
      if (this.tiers[i].config.bucketMs <= desiredBucketMs) {
        tierIndex = i
      } else {
        break
      }
    }

    return this.getSamplesFromTier(tierIndex, fromTime, toTime)
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
```

### 2. Create Bandwidth Tracker

**File:** `packages/engine/src/core/bandwidth-tracker.ts`

Owns the global up/down RRD instances. Lives on BtEngine.

```typescript
import { RrdHistory, RrdTierConfig, RrdSample, DEFAULT_RRD_TIERS } from '../utils/rrd-history'

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

  getDownloadRate(windowMs?: number): number {
    return this.download.getCurrentRate(windowMs)
  }

  getUploadRate(windowMs?: number): number {
    return this.upload.getCurrentRate(windowMs)
  }
}
```

### 3. Export from Engine Package

**File:** `packages/engine/src/index.ts`

Find the exports section and add:

```typescript
export { RrdHistory, DEFAULT_RRD_TIERS } from './utils/rrd-history'
export type { RrdTierConfig, RrdSample } from './utils/rrd-history'
export { BandwidthTracker } from './core/bandwidth-tracker'
export type { BandwidthTrackerConfig } from './core/bandwidth-tracker'
```

### 4. Add BandwidthTracker to BtEngine

**File:** `packages/engine/src/core/bt-engine.ts`

Add import at top:

```typescript
import { BandwidthTracker } from './bandwidth-tracker'
```

Add property to BtEngine class (find where other properties are defined):

```typescript
public readonly bandwidthTracker = new BandwidthTracker()
```

### 5. Wire PeerConnection to BandwidthTracker

**File:** `packages/engine/src/core/torrent.ts`

Find where `bytesDownloaded` and `bytesUploaded` events are handled (search for `peer.on('bytesDownloaded'`). It should look like:

```typescript
peer.on('bytesDownloaded', (bytes) => {
  this.totalDownloaded += bytes
  this.emit('download', bytes)
})

peer.on('bytesUploaded', (bytes) => {
  this.totalUploaded += bytes
  this.emit('upload', bytes)
})
```

Update to also record to bandwidth tracker:

```typescript
peer.on('bytesDownloaded', (bytes) => {
  this.totalDownloaded += bytes
  this.emit('download', bytes)
  this.engine.bandwidthTracker.recordDownload(bytes)
})

peer.on('bytesUploaded', (bytes) => {
  this.totalUploaded += bytes
  this.emit('upload', bytes)
  this.engine.bandwidthTracker.recordUpload(bytes)
})
```

Note: `this.engine` is already available in Torrent class - verify by searching for existing `this.engine` usage.

### 6. Install uPlot

From monorepo root:

```bash
cd packages/ui
pnpm add uplot
```

### 7. Create SpeedTab Component

**File:** `packages/ui/src/components/SpeedTab.tsx`

```tsx
import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { BandwidthTracker } from '@jstorrent/engine'
import { formatSpeed } from '../utils/format'

export interface SpeedTabProps {
  bandwidthTracker: BandwidthTracker
  /** Visible time window in milliseconds */
  windowMs?: number
}

export function SpeedTab({ bandwidthTracker, windowMs = 30_000 }: SpeedTabProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!containerRef.current) return

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height: 200,
      series: [
        {}, // x-axis (time)
        {
          label: 'Download',
          stroke: '#22c55e', // green
          width: 2,
          fill: 'rgba(34, 197, 94, 0.1)',
        },
        {
          label: 'Upload',
          stroke: '#3b82f6', // blue
          width: 2,
          fill: 'rgba(59, 130, 246, 0.1)',
        },
      ],
      axes: [
        {
          // x-axis: time
          values: (_, ticks) =>
            ticks.map((t) => {
              const secAgo = Math.round((Date.now() - t) / 1000)
              return secAgo === 0 ? 'now' : `-${secAgo}s`
            }),
        },
        {
          // y-axis: bytes/sec
          values: (_, ticks) => ticks.map((v) => formatSpeed(v)),
          size: 70,
        },
      ],
      scales: {
        x: { time: false }, // We'll handle time labels ourselves
        y: { min: 0 },
      },
      legend: { show: true },
      cursor: { show: true },
    }

    // Initial empty data
    const data: uPlot.AlignedData = [[], [], []]
    plotRef.current = new uPlot(opts, data, containerRef.current)

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry && plotRef.current) {
        plotRef.current.setSize({
          width: entry.contentRect.width,
          height: 200,
        })
      }
    })
    resizeObserver.observe(containerRef.current)

    // Animation loop
    const update = () => {
      const now = Date.now()
      const fromTime = now - windowMs

      const downSamples = bandwidthTracker.getDownloadSamples(fromTime, now, 300)
      const upSamples = bandwidthTracker.getUploadSamples(fromTime, now, 300)

      // Build aligned data for uPlot
      // Use download samples as time base, find matching upload values
      const times: number[] = []
      const downRates: number[] = []
      const upRates: number[] = []

      // Merge samples - get all unique timestamps
      const allTimes = new Set<number>()
      for (const s of downSamples) allTimes.add(s.time)
      for (const s of upSamples) allTimes.add(s.time)

      const sortedTimes = Array.from(allTimes).sort((a, b) => a - b)

      // Create maps for lookup
      const downMap = new Map(downSamples.map((s) => [s.time, s.value]))
      const upMap = new Map(upSamples.map((s) => [s.time, s.value]))

      // Get bucket size for rate calculation (assume tier 0 = 100ms)
      const bucketMs = 100

      for (const t of sortedTimes) {
        times.push(t)
        // Convert bucket bytes to bytes/sec
        const downBytes = downMap.get(t) ?? 0
        const upBytes = upMap.get(t) ?? 0
        downRates.push((downBytes / bucketMs) * 1000)
        upRates.push((upBytes / bucketMs) * 1000)
      }

      if (plotRef.current && times.length > 0) {
        plotRef.current.setData([times, downRates, upRates])
      }

      rafRef.current = requestAnimationFrame(update)
    }

    rafRef.current = requestAnimationFrame(update)

    return () => {
      cancelAnimationFrame(rafRef.current)
      resizeObserver.disconnect()
      plotRef.current?.destroy()
    }
  }, [bandwidthTracker, windowMs])

  return (
    <div style={{ padding: '8px' }}>
      <div ref={containerRef} style={{ width: '100%' }} />
      <div style={{ display: 'flex', gap: '24px', marginTop: '8px', fontSize: '13px' }}>
        <div>
          <span style={{ color: '#22c55e' }}>▼</span> Download:{' '}
          {formatSpeed(bandwidthTracker.getDownloadRate())}
        </div>
        <div>
          <span style={{ color: '#3b82f6' }}>▲</span> Upload:{' '}
          {formatSpeed(bandwidthTracker.getUploadRate())}
        </div>
      </div>
    </div>
  )
}
```

### 8. Export SpeedTab from UI Package

**File:** `packages/ui/src/index.ts`

Add export:

```typescript
export { SpeedTab } from './components/SpeedTab'
export type { SpeedTabProps } from './components/SpeedTab'
```

### 9. Add Speed Tab to DetailPane

**File:** `packages/ui/src/components/DetailPane.tsx`

First, find the imports and add:

```typescript
import { SpeedTab } from './SpeedTab'
```

Find where the tabs are defined. Look for the tab list/definitions (likely an array or switch statement handling tab content). Add a new "Speed" tab.

The exact change depends on current DetailPane structure. Search for existing tab names like "Peers", "Pieces", "General" to find the pattern. Add "Speed" tab following the same pattern.

The SpeedTab needs `bandwidthTracker` prop. This will need to come from the engine. Look at how other tabs get engine access - likely via props or context. Pass `bandwidthTracker={engine.bandwidthTracker}` following the existing pattern.

**Note to agent:** The DetailPane structure may vary. Search for tab-related code and adapt accordingly. The key is adding a "Speed" tab that renders `<SpeedTab bandwidthTracker={...} />`.

### 10. Add Basic Unit Test for RrdHistory

**File:** `packages/engine/test/utils/rrd-history.test.ts`

```typescript
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
```

## Verification

### 1. Type Check

```bash
pnpm typecheck
```

### 2. Run Tests

```bash
pnpm test
```

### 3. Build

```bash
pnpm build
```

### 4. Manual Testing

1. Load extension in Chrome
2. Add a torrent and start downloading
3. Open detail pane, click "Speed" tab
4. Verify graph shows download activity (green line)
5. Verify upload shows when seeding (blue line)
6. Verify current rate numbers update below graph

### 5. Lint and Format

```bash
pnpm lint
pnpm format:fix
```

## Notes

- The RRD tier config is exposed via `DEFAULT_RRD_TIERS` export if we want to make it user-configurable later
- uPlot CSS is imported in the component - may need adjustment depending on bundler setup
- The SpeedTab uses RAF for updates which should give smooth scrolling
- Bucket-to-rate conversion assumes tier 0 is 100ms - this is a simplification that works for the default config
