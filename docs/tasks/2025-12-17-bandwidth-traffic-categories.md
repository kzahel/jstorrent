# Traffic Categories for Bandwidth Tracker

## Overview

Extend BandwidthTracker to record bytes per traffic category rather than just global totals. Categories: peer protocol, peer payload, tracker HTTP, tracker UDP, DHT. The UI can then show total traffic or filter by category, and derive protocol overhead (peer:protocol - peer:payload).

## Traffic Categories

```typescript
type TrafficCategory = 
  | 'peer:protocol'   // all peer TCP bytes (handshake, messages, piece data)
  | 'peer:payload'    // piece block data only (subset of peer:protocol)
  | 'tracker:http'    // HTTP tracker requests/responses
  | 'tracker:udp'     // UDP tracker packets
  | 'dht'             // DHT UDP packets
```

**Derived values:**
- Protocol overhead = `peer:protocol - peer:payload`
- Total = sum of all categories (but don't double-count payload)

## File Changes

### 1. Add TrafficCategory Type

**File:** `packages/engine/src/core/bandwidth-tracker.ts`

Add at top of file:

```typescript
export type TrafficCategory = 
  | 'peer:protocol'
  | 'peer:payload'
  | 'tracker:http'
  | 'tracker:udp'
  | 'dht'

export const ALL_TRAFFIC_CATEGORIES: TrafficCategory[] = [
  'peer:protocol',
  'peer:payload',
  'tracker:http',
  'tracker:udp',
  'dht',
]
```

### 2. Update BandwidthTracker to Use Per-Category Storage

**File:** `packages/engine/src/core/bandwidth-tracker.ts`

Replace the single download/upload RrdHistory with maps:

```typescript
export class BandwidthTracker {
  // Per-category histories
  private downloadByCategory: Map<TrafficCategory, RrdHistory>
  private uploadByCategory: Map<TrafficCategory, RrdHistory>

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

    this.downloadBucket = new TokenBucket(0)
    this.uploadBucket = new TokenBucket(0)
  }

  /**
   * Record bytes for a specific traffic category.
   */
  record(
    category: TrafficCategory,
    bytes: number,
    direction: 'up' | 'down',
    timestamp?: number
  ): void {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory
    map.get(category)?.record(bytes, timestamp)
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
    maxPoints?: number
  ): RrdSample[] {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory

    // Determine which categories to include
    let cats: TrafficCategory[]
    if (categories === 'all') {
      // Exclude peer:payload since it's a subset of peer:protocol
      cats = ALL_TRAFFIC_CATEGORIES.filter(c => c !== 'peer:payload')
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
   * Get samples for a single category.
   */
  getCategorySamples(
    direction: 'up' | 'down',
    category: TrafficCategory,
    fromTime: number,
    toTime: number,
    maxPoints?: number
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
    windowMs?: number
  ): number {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory

    let cats: TrafficCategory[]
    if (categories === 'all') {
      cats = ALL_TRAFFIC_CATEGORIES.filter(c => c !== 'peer:payload')
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
  getCategoryRate(
    direction: 'up' | 'down',
    category: TrafficCategory,
    windowMs?: number
  ): number {
    const map = direction === 'down' ? this.downloadByCategory : this.uploadByCategory
    return map.get(category)?.getCurrentRate(windowMs) ?? 0
  }

  // Keep existing limit methods unchanged
  setDownloadLimit(bytesPerSec: number): void {
    this.downloadBucket.setLimit(bytesPerSec)
  }

  setUploadLimit(bytesPerSec: number): void {
    this.uploadBucket.setLimit(bytesPerSec)
  }

  getDownloadLimit(): number {
    return this.downloadBucket.refillRate
  }

  getUploadLimit(): number {
    return this.uploadBucket.refillRate
  }
}
```

### 3. Update Exports

**File:** `packages/engine/src/index.ts`

Update exports to include new types:

```typescript
export { 
  BandwidthTracker,
  ALL_TRAFFIC_CATEGORIES,
} from './core/bandwidth-tracker'
export type { 
  BandwidthTrackerConfig,
  TrafficCategory,
} from './core/bandwidth-tracker'
```

### 4. Update Peer Byte Recording

**File:** `packages/engine/src/core/torrent.ts`

Find the `bytesDownloaded` and `bytesUploaded` event handlers. Update to use category:

```typescript
peer.on('bytesDownloaded', (bytes) => {
  this.totalDownloaded += bytes
  this.emit('download', bytes)
  this.engine.bandwidthTracker.record('peer:protocol', bytes, 'down')
})

peer.on('bytesUploaded', (bytes) => {
  this.totalUploaded += bytes
  this.emit('upload', bytes)
  this.engine.bandwidthTracker.record('peer:protocol', bytes, 'up')
})
```

### 5. Add Payload Recording in handleBlock

**File:** `packages/engine/src/core/torrent.ts`

Find the `handleBlock` method (handles received piece data). Add payload recording:

Search for where the block data is processed after receiving a PIECE message. It should be in a method that handles the piece/block. Add:

```typescript
// Record payload bytes (piece data only, not protocol overhead)
this.engine.bandwidthTracker.record('peer:payload', data.length, 'down')
```

This goes after the block is validated but before or after writing to disk - the exact location depends on current code structure.

### 6. Add Payload Recording in sendPiece Path

**File:** `packages/engine/src/core/torrent.ts`

In the `drainUploadQueue` method (or wherever `sendPiece` is called), add:

```typescript
// After successful sendPiece
this.engine.bandwidthTracker.record('peer:payload', block.length, 'up')
```

### 7. Update HTTP Tracker

**File:** `packages/engine/src/tracker/http-tracker.ts`

The tracker needs access to BandwidthTracker. Update constructor to accept it:

```typescript
constructor(
  engine: ILoggingEngine,
  private announceUrl: string,
  infoHash: Uint8Array,
  peerId: Uint8Array,
  socketFactory: ISocketFactory,
  private port: number = 6881,
  private bandwidthTracker?: BandwidthTracker,
) {
```

In the `announce` method, after receiving response (around line 50):

```typescript
const responseBody = await this.httpClient.get(url)
this.logger.debug(`HttpTracker: Received ${responseBody.length} bytes response`)

// Record tracker download bytes
this.bandwidthTracker?.record('tracker:http', responseBody.length, 'down')

this.handleBody(responseBody)
```

Also record the request upload. The request URL is built in `buildQuery`. Add after sending:

```typescript
// Estimate request size (URL + headers, approximate)
const requestSize = url.length + 200 // rough estimate for HTTP headers
this.bandwidthTracker?.record('tracker:http', requestSize, 'up')
```

### 8. Update UDP Tracker

**File:** `packages/engine/src/tracker/udp-tracker.ts`

Update constructor to accept BandwidthTracker:

```typescript
constructor(
  engine: ILoggingEngine,
  private announceUrl: string,
  readonly infoHash: Uint8Array,
  readonly peerId: Uint8Array,
  private socketFactory: ISocketFactory,
  private port: number = 6881,
  private bandwidthTracker?: BandwidthTracker,
) {
```

In `connect` method, after `socket.send`:

```typescript
this.socket.send(host, port, buf)
this.bandwidthTracker?.record('tracker:udp', buf.length, 'up')
```

In `sendAnnounce`, after `socket.send`:

```typescript
this.socket.send(host, port, buf)
this.bandwidthTracker?.record('tracker:udp', buf.length, 'up')
```

In `onMessage`, at the start:

```typescript
private onMessage(msg: Uint8Array, _rinfo: any) {
  this.bandwidthTracker?.record('tracker:udp', msg.length, 'down')
  
  if (msg.length < 8) return
  // ... rest of method
}
```

### 9. Update Tracker Creation

**File:** `packages/engine/src/tracker/tracker-manager.ts` (or wherever trackers are created)

Find where HttpTracker and UdpTracker are instantiated. Pass bandwidthTracker:

```typescript
// Example - actual code location may vary
new HttpTracker(
  engine,
  url,
  infoHash,
  peerId,
  socketFactory,
  port,
  engine.bandwidthTracker  // Add this
)

new UdpTracker(
  engine,
  url,
  infoHash,
  peerId,
  socketFactory,
  port,
  engine.bandwidthTracker  // Add this
)
```

### 10. Update DHT (if applicable)

**Note to agent:** DHT implementation location may vary. Find the DHT class and add recording similar to UDP tracker:

```typescript
// On send
this.bandwidthTracker?.record('dht', packet.length, 'up')

// On receive
this.bandwidthTracker?.record('dht', data.length, 'down')
```

If DHT is in a separate file/module, it will need BandwidthTracker passed in via constructor similar to trackers.

### 11. Update SpeedTab UI

**File:** `packages/ui/src/components/SpeedTab.tsx`

Update to support category filtering:

```tsx
import type { BandwidthTracker, TrafficCategory, ALL_TRAFFIC_CATEGORIES } from '@jstorrent/engine'

export interface SpeedTabProps {
  bandwidthTracker: BandwidthTracker
  windowMs?: number
}

export function SpeedTab({ bandwidthTracker, windowMs = 30_000 }: SpeedTabProps) {
  const [selectedCategories, setSelectedCategories] = useState<Set<TrafficCategory> | 'all'>('all')
  
  // ... existing refs ...

  useEffect(() => {
    // ... existing setup ...

    const update = () => {
      const now = Date.now()
      const fromTime = now - windowMs

      const categories = selectedCategories === 'all' 
        ? 'all' 
        : Array.from(selectedCategories)

      const downSamples = bandwidthTracker.getSamples('down', categories, fromTime, now, 300)
      const upSamples = bandwidthTracker.getSamples('up', categories, fromTime, now, 300)

      // ... rest of update logic unchanged ...
    }

    // ... rest unchanged ...
  }, [bandwidthTracker, windowMs, selectedCategories])

  const toggleCategory = (cat: TrafficCategory) => {
    if (selectedCategories === 'all') {
      // Switch to specific selection, excluding clicked one
      const newSet = new Set(ALL_TRAFFIC_CATEGORIES.filter(c => c !== cat && c !== 'peer:payload'))
      setSelectedCategories(newSet)
    } else {
      const newSet = new Set(selectedCategories)
      if (newSet.has(cat)) {
        newSet.delete(cat)
        if (newSet.size === 0) {
          setSelectedCategories('all') // Reset to all if empty
        } else {
          setSelectedCategories(newSet)
        }
      } else {
        newSet.add(cat)
        setSelectedCategories(newSet)
      }
    }
  }

  return (
    <div style={{ padding: '8px' }}>
      {/* Category filter chips */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setSelectedCategories('all')}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            background: selectedCategories === 'all' ? '#e0e0e0' : 'transparent',
            cursor: 'pointer',
          }}
        >
          All
        </button>
        {ALL_TRAFFIC_CATEGORIES.filter(c => c !== 'peer:payload').map(cat => (
          <button
            key={cat}
            onClick={() => toggleCategory(cat)}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: selectedCategories !== 'all' && selectedCategories.has(cat) 
                ? '#e0e0e0' 
                : 'transparent',
              cursor: 'pointer',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Graph */}
      <div ref={containerRef} style={{ width: '100%' }} />

      {/* Current rates */}
      <div style={{ display: 'flex', gap: '24px', marginTop: '8px', fontSize: '13px' }}>
        <div>
          <span style={{ color: '#22c55e' }}>▼</span> Download:{' '}
          {formatSpeed(bandwidthTracker.getRate('down', selectedCategories === 'all' ? 'all' : Array.from(selectedCategories)))}
        </div>
        <div>
          <span style={{ color: '#3b82f6' }}>▲</span> Upload:{' '}
          {formatSpeed(bandwidthTracker.getRate('up', selectedCategories === 'all' ? 'all' : Array.from(selectedCategories)))}
        </div>
      </div>

      {/* Optional: show breakdown */}
      <div style={{ marginTop: '16px', fontSize: '12px', color: '#666' }}>
        <div>Peer data: {formatSpeed(bandwidthTracker.getCategoryRate('down', 'peer:payload'))} ↓ / {formatSpeed(bandwidthTracker.getCategoryRate('up', 'peer:payload'))} ↑</div>
        <div>Peer overhead: {formatSpeed(bandwidthTracker.getCategoryRate('down', 'peer:protocol') - bandwidthTracker.getCategoryRate('down', 'peer:payload'))} ↓</div>
        <div>Tracker HTTP: {formatSpeed(bandwidthTracker.getCategoryRate('down', 'tracker:http'))} ↓ / {formatSpeed(bandwidthTracker.getCategoryRate('up', 'tracker:http'))} ↑</div>
        <div>Tracker UDP: {formatSpeed(bandwidthTracker.getCategoryRate('down', 'tracker:udp'))} ↓ / {formatSpeed(bandwidthTracker.getCategoryRate('up', 'tracker:udp'))} ↑</div>
        <div>DHT: {formatSpeed(bandwidthTracker.getCategoryRate('down', 'dht'))} ↓ / {formatSpeed(bandwidthTracker.getCategoryRate('up', 'dht'))} ↑</div>
      </div>
    </div>
  )
}
```

### 12. Unit Tests

**File:** `packages/engine/test/core/bandwidth-tracker-categories.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { BandwidthTracker, TrafficCategory, ALL_TRAFFIC_CATEGORIES } from '../../src/core/bandwidth-tracker'

describe('BandwidthTracker with categories', () => {
  let tracker: BandwidthTracker

  beforeEach(() => {
    tracker = new BandwidthTracker()
  })

  it('records bytes by category', () => {
    const now = Date.now()
    
    tracker.record('peer:protocol', 1000, 'down', now)
    tracker.record('peer:payload', 800, 'down', now)
    tracker.record('tracker:http', 200, 'down', now)

    // Check individual categories
    const peerSamples = tracker.getCategorySamples('down', 'peer:protocol', now - 1000, now + 1000)
    expect(peerSamples.length).toBeGreaterThan(0)
    expect(peerSamples[0].value).toBe(1000)

    const payloadSamples = tracker.getCategorySamples('down', 'peer:payload', now - 1000, now + 1000)
    expect(payloadSamples[0].value).toBe(800)
  })

  it('aggregates all categories excluding payload', () => {
    const now = Date.now()
    
    tracker.record('peer:protocol', 1000, 'down', now)
    tracker.record('peer:payload', 800, 'down', now)  // subset, should be excluded from 'all'
    tracker.record('tracker:http', 200, 'down', now)
    tracker.record('tracker:udp', 100, 'down', now)
    tracker.record('dht', 50, 'down', now)

    const allSamples = tracker.getSamples('down', 'all', now - 1000, now + 1000)
    // Should be 1000 + 200 + 100 + 50 = 1350 (not including peer:payload)
    expect(allSamples[0].value).toBe(1350)
  })

  it('aggregates selected categories', () => {
    const now = Date.now()
    
    tracker.record('peer:protocol', 1000, 'down', now)
    tracker.record('tracker:http', 200, 'down', now)
    tracker.record('tracker:udp', 100, 'down', now)

    const samples = tracker.getSamples('down', ['tracker:http', 'tracker:udp'], now - 1000, now + 1000)
    expect(samples[0].value).toBe(300)
  })

  it('calculates rate per category', () => {
    const now = Date.now()
    
    // Record 1000 bytes in peer:protocol
    tracker.record('peer:protocol', 1000, 'down', now)
    
    const rate = tracker.getCategoryRate('down', 'peer:protocol')
    expect(rate).toBeGreaterThan(0)
  })

  it('tracks upload and download separately', () => {
    const now = Date.now()
    
    tracker.record('peer:protocol', 1000, 'down', now)
    tracker.record('peer:protocol', 500, 'up', now)

    const downSamples = tracker.getCategorySamples('down', 'peer:protocol', now - 1000, now + 1000)
    const upSamples = tracker.getCategorySamples('up', 'peer:protocol', now - 1000, now + 1000)

    expect(downSamples[0].value).toBe(1000)
    expect(upSamples[0].value).toBe(500)
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
})
```

## Verification

### 1. Type Check

```bash
pnpm typecheck
```

### 2. Run Tests

```bash
pnpm test bandwidth-tracker
```

### 3. Build

```bash
pnpm build
```

### 4. Manual Testing

1. Load extension, start a download
2. Open Speed tab
3. Verify graph shows data
4. Click category buttons to filter
5. Verify breakdown stats update
6. Check that DHT traffic appears (if DHT enabled)
7. Check tracker traffic during announces

### 5. Lint and Format

```bash
pnpm lint
pnpm format:fix
```

## Notes

- `peer:payload` is excluded from "all" total to avoid double-counting (it's a subset of `peer:protocol`)
- Protocol overhead = `peer:protocol - peer:payload`
- HTTP tracker upload size is estimated (request URL + headers)
- DHT recording depends on where DHT is implemented - may need adaptation
- Rate limiting (TokenBucket) stays global, not per-category
- The UI breakdown section is optional but helpful for debugging
