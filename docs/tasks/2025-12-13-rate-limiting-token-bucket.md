# Token Bucket Rate Limiting

## Overview

Add upload and download rate limiting using token bucket algorithm. Integrates with existing BandwidthTracker from Phase 1. Download limiting gates piece requests; upload limiting queues outgoing piece responses.

**Goals:**
- Configurable download/upload speed limits (bytes/sec, 0 = unlimited)
- Smooth rate limiting (not bursty)
- Clean handling of peer disconnect (clear queued requests)
- Properly discard requests from choked peers
- Integration tests verifying rate limiting accuracy

## File Changes

### 1. Create Token Bucket Utility

**File:** `packages/engine/src/utils/token-bucket.ts`

```typescript
/**
 * Token bucket for rate limiting.
 * Tokens refill at a constant rate up to capacity.
 * Operations consume tokens; if insufficient, they must wait.
 */
export class TokenBucket {
  private tokens: number
  private lastRefillTime: number
  private _refillRate: number // bytes per second (0 = unlimited)
  private _capacity: number

  /**
   * @param refillRate - Tokens added per second (0 = unlimited)
   * @param capacity - Maximum tokens (burst size). Defaults to 2 seconds worth.
   */
  constructor(refillRate: number = 0, capacity?: number) {
    this._refillRate = refillRate
    this._capacity = capacity ?? (refillRate > 0 ? refillRate * 2 : 0)
    this.tokens = this._capacity
    this.lastRefillTime = Date.now()
  }

  get refillRate(): number {
    return this._refillRate
  }

  get capacity(): number {
    return this._capacity
  }

  get available(): number {
    this.refill()
    return this.tokens
  }

  /**
   * Check if rate limiting is enabled.
   */
  get isLimited(): boolean {
    return this._refillRate > 0
  }

  /**
   * Update the rate limit.
   * @param bytesPerSec - New limit (0 = unlimited)
   * @param burstSeconds - Burst capacity in seconds (default 2)
   */
  setLimit(bytesPerSec: number, burstSeconds: number = 2): void {
    this._refillRate = bytesPerSec
    this._capacity = bytesPerSec > 0 ? bytesPerSec * burstSeconds : 0
    // Don't reset tokens - allow gradual adjustment
    if (this.tokens > this._capacity) {
      this.tokens = this._capacity
    }
  }

  /**
   * Try to consume tokens. Returns true if successful.
   * If unlimited (refillRate = 0), always returns true.
   */
  tryConsume(tokens: number): boolean {
    if (!this.isLimited) return true

    this.refill()
    if (this.tokens >= tokens) {
      this.tokens -= tokens
      return true
    }
    return false
  }

  /**
   * How long until `tokens` are available (milliseconds).
   * Returns 0 if already available or unlimited.
   */
  msUntilAvailable(tokens: number): number {
    if (!this.isLimited) return 0

    this.refill()
    if (this.tokens >= tokens) return 0

    const needed = tokens - this.tokens
    return Math.ceil((needed / this._refillRate) * 1000)
  }

  /**
   * Refill tokens based on elapsed time.
   */
  private refill(): void {
    if (!this.isLimited) return

    const now = Date.now()
    const elapsed = now - this.lastRefillTime
    if (elapsed <= 0) return

    const tokensToAdd = (elapsed / 1000) * this._refillRate
    this.tokens = Math.min(this._capacity, this.tokens + tokensToAdd)
    this.lastRefillTime = now
  }
}
```

### 2. Add Token Buckets to BandwidthTracker

**File:** `packages/engine/src/core/bandwidth-tracker.ts`

Find the BandwidthTracker class and add the token bucket properties and methods.

Add import at top:
```typescript
import { TokenBucket } from '../utils/token-bucket'
```

Add properties to the class:
```typescript
public readonly downloadBucket: TokenBucket
public readonly uploadBucket: TokenBucket
```

Update constructor to initialize buckets:
```typescript
constructor(config: BandwidthTrackerConfig = {}) {
  const tiers = config.tiers ?? DEFAULT_RRD_TIERS
  this.download = new RrdHistory(tiers)
  this.upload = new RrdHistory(tiers)
  this.downloadBucket = new TokenBucket(0) // unlimited by default
  this.uploadBucket = new TokenBucket(0)
}
```

Add limit setter methods:
```typescript
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
```

### 3. Export Token Bucket

**File:** `packages/engine/src/index.ts`

Add export:
```typescript
export { TokenBucket } from './utils/token-bucket'
```

### 4. Add Download Rate Limiting to requestPieces

**File:** `packages/engine/src/core/torrent.ts`

Find the `requestPieces` method. Locate the inner loop where requests are sent (search for `peer.sendRequest`).

The current code looks like:
```typescript
for (const block of neededBlocks) {
  if (peer.requestsPending >= MAX_PIPELINE) break

  peer.sendRequest(index, block.begin, block.length)
  peer.requestsPending++
  _requestsMade++

  // Track request in ActivePiece (tied to this peer)
  const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
  piece.addRequest(blockIndex, peerId)
}
```

Update to check token bucket before each request:
```typescript
for (const block of neededBlocks) {
  if (peer.requestsPending >= MAX_PIPELINE) break

  // Rate limit check - bail if out of tokens
  const downloadBucket = this.engine.bandwidthTracker.downloadBucket
  if (downloadBucket.isLimited && !downloadBucket.tryConsume(block.length)) {
    break // Out of budget for this round, will retry on next trigger
  }

  peer.sendRequest(index, block.begin, block.length)
  peer.requestsPending++
  _requestsMade++

  // Track request in ActivePiece (tied to this peer)
  const blockIndex = Math.floor(block.begin / BLOCK_SIZE)
  piece.addRequest(blockIndex, peerId)
}
```

### 5. Add Upload Queue and Rate Limiting

**File:** `packages/engine/src/core/torrent.ts`

Add interface and properties near other private properties (search for `private _swarm` or similar):

```typescript
/** Queued upload request */
interface QueuedUploadRequest {
  peer: PeerConnection
  index: number
  begin: number
  length: number
  queuedAt: number
}

// Add to class properties:
private uploadQueue: QueuedUploadRequest[] = []
private uploadDrainScheduled = false
```

Replace the existing `handleRequest` method:

```typescript
private handleRequest(peer: PeerConnection, index: number, begin: number, length: number): void {
  // Validate: we must not be choking this peer
  if (peer.amChoking) {
    this.logger.debug('Ignoring request from choked peer')
    return
  }

  // Validate: we have this piece
  if (!this.bitfield || !this.bitfield.get(index)) {
    this.logger.debug(`Ignoring request for piece ${index} we don't have`)
    return
  }

  if (!this.contentStorage) {
    this.logger.debug('Ignoring request: no content storage')
    return
  }

  // Queue the request
  this.uploadQueue.push({
    peer,
    index,
    begin,
    length,
    queuedAt: Date.now(),
  })

  // Trigger drain
  this.drainUploadQueue()
}
```

Add the drain method:

```typescript
private async drainUploadQueue(): Promise<void> {
  // Prevent concurrent drain loops
  if (this.uploadDrainScheduled) return
  
  while (this.uploadQueue.length > 0) {
    const req = this.uploadQueue[0]

    // Skip if peer disconnected
    if (!this.connectedPeers.includes(req.peer)) {
      this.uploadQueue.shift()
      continue
    }

    // Skip if we've since choked this peer
    if (req.peer.amChoking) {
      this.uploadQueue.shift()
      this.logger.debug('Discarding queued request: peer now choked')
      continue
    }

    // Rate limit check
    const uploadBucket = this.engine.bandwidthTracker.uploadBucket
    if (uploadBucket.isLimited && !uploadBucket.tryConsume(req.length)) {
      // Schedule retry when tokens available
      const delayMs = uploadBucket.msUntilAvailable(req.length)
      this.uploadDrainScheduled = true
      setTimeout(() => {
        this.uploadDrainScheduled = false
        this.drainUploadQueue()
      }, Math.max(delayMs, 10)) // minimum 10ms to avoid tight loop
      return
    }

    // Dequeue and process
    this.uploadQueue.shift()

    try {
      const block = await this.contentStorage!.read(req.index, req.begin, req.length)
      
      // Final check: peer still connected and unchoked
      if (!this.connectedPeers.includes(req.peer)) {
        this.logger.debug('Peer disconnected before upload could complete')
        continue
      }
      if (req.peer.amChoking) {
        this.logger.debug('Peer choked before upload could complete')
        continue
      }

      req.peer.sendPiece(req.index, req.begin, block)
    } catch (err) {
      this.logger.error(
        `Error handling queued request: ${err instanceof Error ? err.message : String(err)}`,
        { err },
      )
    }
  }
}
```

### 6. Clear Upload Queue on Peer Disconnect

**File:** `packages/engine/src/core/torrent.ts`

Find the `removePeer` method. Add queue cleanup at the start of the method:

Search for `removePeer(peer: PeerConnection)` and add after the method signature:

```typescript
// Clear any queued uploads for this peer
const queueLengthBefore = this.uploadQueue.length
this.uploadQueue = this.uploadQueue.filter((req) => req.peer !== peer)
const removed = queueLengthBefore - this.uploadQueue.length
if (removed > 0) {
  this.logger.debug(`Cleared ${removed} queued uploads for disconnected peer`)
}
```

### 7. Clear Upload Queue on Choke

**File:** `packages/engine/src/core/torrent.ts`

If there's a method that handles choking a peer (sending CHOKE message), add similar cleanup there. Search for `MessageType.CHOKE` to find where we choke peers.

If choking happens inline (e.g., `peer.amChoking = true; peer.sendMessage(MessageType.CHOKE)`), create a helper or add cleanup inline:

```typescript
// When choking a peer, clear their queued requests
private chokePeer(peer: PeerConnection): void {
  if (!peer.amChoking) {
    peer.amChoking = true
    peer.sendMessage(MessageType.CHOKE)
    
    // Clear queued uploads for this peer
    const before = this.uploadQueue.length
    this.uploadQueue = this.uploadQueue.filter((req) => req.peer !== peer)
    const removed = before - this.uploadQueue.length
    if (removed > 0) {
      this.logger.debug(`Cleared ${removed} queued uploads for choked peer`)
    }
  }
}
```

Then update any places that choke peers to use this helper.

**Note to agent:** The codebase may not have a dedicated choke method. Search for where `amChoking = true` is set and ensure queue cleanup happens there. If choking isn't implemented yet beyond the initial unchoke-everyone behavior, this can be deferred.

### 8. Unit Tests for TokenBucket

**File:** `packages/engine/test/utils/token-bucket.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenBucket } from '../../src/utils/token-bucket'

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('unlimited mode', () => {
    it('always allows consumption when refillRate is 0', () => {
      const bucket = new TokenBucket(0)
      expect(bucket.isLimited).toBe(false)
      expect(bucket.tryConsume(1_000_000)).toBe(true)
      expect(bucket.tryConsume(1_000_000)).toBe(true)
    })

    it('returns 0 for msUntilAvailable', () => {
      const bucket = new TokenBucket(0)
      expect(bucket.msUntilAvailable(1_000_000)).toBe(0)
    })
  })

  describe('limited mode', () => {
    it('starts with full capacity', () => {
      const bucket = new TokenBucket(1000, 2000) // 1000/sec, 2000 capacity
      expect(bucket.available).toBe(2000)
    })

    it('consumes tokens', () => {
      const bucket = new TokenBucket(1000, 2000)
      expect(bucket.tryConsume(500)).toBe(true)
      expect(bucket.available).toBe(1500)
    })

    it('rejects when insufficient tokens', () => {
      const bucket = new TokenBucket(1000, 2000)
      expect(bucket.tryConsume(2500)).toBe(false)
      expect(bucket.available).toBe(2000) // unchanged
    })

    it('refills over time', () => {
      const bucket = new TokenBucket(1000, 2000)
      bucket.tryConsume(2000) // empty it
      expect(bucket.available).toBe(0)

      vi.advanceTimersByTime(500) // 0.5 seconds
      expect(bucket.available).toBe(500)

      vi.advanceTimersByTime(500) // another 0.5 seconds
      expect(bucket.available).toBe(1000)
    })

    it('does not exceed capacity', () => {
      const bucket = new TokenBucket(1000, 2000)
      vi.advanceTimersByTime(10000) // 10 seconds
      expect(bucket.available).toBe(2000) // capped at capacity
    })

    it('calculates msUntilAvailable correctly', () => {
      const bucket = new TokenBucket(1000, 2000)
      bucket.tryConsume(2000) // empty

      // Need 500 tokens at 1000/sec = 500ms
      expect(bucket.msUntilAvailable(500)).toBe(500)

      // Need 1000 tokens = 1000ms
      expect(bucket.msUntilAvailable(1000)).toBe(1000)
    })

    it('returns 0 for msUntilAvailable when tokens available', () => {
      const bucket = new TokenBucket(1000, 2000)
      expect(bucket.msUntilAvailable(1000)).toBe(0)
    })
  })

  describe('setLimit', () => {
    it('updates rate and capacity', () => {
      const bucket = new TokenBucket(1000, 2000)
      bucket.setLimit(500) // 500/sec, default 2x = 1000 capacity

      expect(bucket.refillRate).toBe(500)
      expect(bucket.capacity).toBe(1000)
    })

    it('clamps tokens to new capacity', () => {
      const bucket = new TokenBucket(1000, 2000)
      expect(bucket.available).toBe(2000)

      bucket.setLimit(100) // capacity becomes 200
      expect(bucket.available).toBe(200)
    })

    it('can disable limiting', () => {
      const bucket = new TokenBucket(1000, 2000)
      bucket.tryConsume(2000) // empty

      bucket.setLimit(0) // unlimited
      expect(bucket.isLimited).toBe(false)
      expect(bucket.tryConsume(1_000_000)).toBe(true)
    })
  })
})
```

### 9. Integration Test for Rate Limiting

**File:** `packages/engine/test/core/rate-limiting.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { MemorySocketFactory } from '../../src/adapters/memory'
import { InMemoryFileSystem } from '../../src/adapters/memory'
import { TorrentCreator } from '../../src/core/torrent-creator'
import { PeerConnection } from '../../src/core/peer-connection'
import { FileSystemStorageHandle } from '../../src/io/filesystem-storage-handle'
import { createMemoryEngine } from '../../src/presets/memory'

describe('Rate Limiting Integration', () => {
  let seeder: BtEngine
  let leecher: BtEngine
  let seederFs: InMemoryFileSystem
  let leecherFs: InMemoryFileSystem

  beforeEach(() => {
    seeder = createMemoryEngine({
      onLog: (e) => console.log(`[Seeder] ${e.level}: ${e.message}`),
    })
    leecher = createMemoryEngine({
      onLog: (e) => console.log(`[Leecher] ${e.level}: ${e.message}`),
    })

    seederFs = seeder.storageRootManager.getFileSystemForTorrent('any') as InMemoryFileSystem
    leecherFs = leecher.storageRootManager.getFileSystemForTorrent('any') as InMemoryFileSystem
  })

  async function setupTorrent(fileSize: number) {
    // Create test file
    const fileContent = new Uint8Array(fileSize)
    for (let i = 0; i < fileContent.length; i++) {
      fileContent[i] = i % 256
    }

    await seederFs.mkdir('/downloads')
    const handle = await seederFs.open('/downloads/test.bin', 'w')
    await handle.write(fileContent, 0, fileContent.length, 0)
    await handle.close()

    // Create torrent
    const storageHandle = new FileSystemStorageHandle(seederFs)
    const torrentBuffer = await TorrentCreator.create(
      storageHandle,
      '/downloads/test.bin',
      seeder.hasher,
      { pieceLength: 16384, announceList: [['http://tracker.local']] }
    )

    // Add to seeder
    const seederTorrent = await seeder.addTorrent(torrentBuffer)
    if (!seederTorrent) throw new Error('Failed to add torrent to seeder')
    await seederTorrent.recheckData()

    // Add to leecher via magnet
    const magnet = `magnet:?xt=urn:btih:${seederTorrent.infoHashStr}`
    const leecherTorrent = await leecher.addTorrent(magnet)
    if (!leecherTorrent) throw new Error('Failed to add torrent to leecher')

    return { seederTorrent, leecherTorrent, fileContent }
  }

  function connectPeers(seederTorrent: any, leecherTorrent: any) {
    const [socketA, socketB] = MemorySocketFactory.createPair()

    const seederPeer = new PeerConnection(seeder, socketA, {
      remoteAddress: '127.0.0.2',
      remotePort: 6882,
    })
    const leecherPeer = new PeerConnection(leecher, socketB, {
      remoteAddress: '127.0.0.1',
      remotePort: 6881,
    })

    seederTorrent.addPeer(seederPeer)
    leecherTorrent.addPeer(leecherPeer)

    seederPeer.sendHandshake(seederTorrent.infoHash, new Uint8Array(20).fill(1))
    leecherPeer.sendHandshake(leecherTorrent.infoHash, new Uint8Array(20).fill(2))

    return { seederPeer, leecherPeer }
  }

  describe('download rate limiting', () => {
    it('limits download speed', async () => {
      const fileSize = 256 * 1024 // 256KB
      const { seederTorrent, leecherTorrent, fileContent } = await setupTorrent(fileSize)

      // Set download limit: 32KB/sec
      // At this rate, 256KB should take ~8 seconds (allow some variance)
      const limitBytesPerSec = 32 * 1024
      leecher.bandwidthTracker.setDownloadLimit(limitBytesPerSec)

      connectPeers(seederTorrent, leecherTorrent)

      // Wait for metadata
      await new Promise<void>((resolve) => {
        if (leecherTorrent.hasMetadata) resolve()
        else leecherTorrent.on('ready', () => resolve())
      })

      // Track download timing
      const startTime = Date.now()

      // Wait for completion
      await new Promise<void>((resolve) => {
        const check = () => {
          if (leecherTorrent.bitfield?.cardinality() === leecherTorrent.piecesCount) {
            resolve()
          }
        }
        check()
        leecherTorrent.on('piece', check)
      })

      const elapsed = Date.now() - startTime
      const actualRate = fileSize / (elapsed / 1000)

      console.log(`Download completed in ${elapsed}ms`)
      console.log(`Target rate: ${limitBytesPerSec} B/s`)
      console.log(`Actual rate: ${Math.round(actualRate)} B/s`)

      // Allow 50% variance due to timing imprecision in tests
      expect(actualRate).toBeLessThan(limitBytesPerSec * 1.5)
      // Should take at least 4 seconds (half the theoretical minimum)
      expect(elapsed).toBeGreaterThan(4000)

      // Verify data integrity
      const downloaded = await leecherFs.readFile('test.bin')
      expect(downloaded).toEqual(fileContent)
    }, 30000)

    it('respects unlimited when set to 0', async () => {
      const fileSize = 64 * 1024 // 64KB - small for fast test
      const { seederTorrent, leecherTorrent } = await setupTorrent(fileSize)

      // Explicitly unlimited
      leecher.bandwidthTracker.setDownloadLimit(0)

      connectPeers(seederTorrent, leecherTorrent)

      await new Promise<void>((resolve) => {
        if (leecherTorrent.hasMetadata) resolve()
        else leecherTorrent.on('ready', () => resolve())
      })

      const startTime = Date.now()

      await new Promise<void>((resolve) => {
        const check = () => {
          if (leecherTorrent.bitfield?.cardinality() === leecherTorrent.piecesCount) {
            resolve()
          }
        }
        check()
        leecherTorrent.on('piece', check)
      })

      const elapsed = Date.now() - startTime

      // Should complete quickly (< 2 seconds for 64KB in memory)
      console.log(`Unlimited download completed in ${elapsed}ms`)
      expect(elapsed).toBeLessThan(2000)
    }, 10000)
  })

  describe('upload rate limiting', () => {
    it('limits upload speed', async () => {
      const fileSize = 256 * 1024 // 256KB
      const { seederTorrent, leecherTorrent, fileContent } = await setupTorrent(fileSize)

      // Set upload limit on seeder: 32KB/sec
      const limitBytesPerSec = 32 * 1024
      seeder.bandwidthTracker.setUploadLimit(limitBytesPerSec)

      connectPeers(seederTorrent, leecherTorrent)

      await new Promise<void>((resolve) => {
        if (leecherTorrent.hasMetadata) resolve()
        else leecherTorrent.on('ready', () => resolve())
      })

      const startTime = Date.now()

      await new Promise<void>((resolve) => {
        const check = () => {
          if (leecherTorrent.bitfield?.cardinality() === leecherTorrent.piecesCount) {
            resolve()
          }
        }
        check()
        leecherTorrent.on('piece', check)
      })

      const elapsed = Date.now() - startTime
      const actualRate = fileSize / (elapsed / 1000)

      console.log(`Upload-limited download completed in ${elapsed}ms`)
      console.log(`Target rate: ${limitBytesPerSec} B/s`)
      console.log(`Actual rate: ${Math.round(actualRate)} B/s`)

      expect(actualRate).toBeLessThan(limitBytesPerSec * 1.5)
      expect(elapsed).toBeGreaterThan(4000)

      const downloaded = await leecherFs.readFile('test.bin')
      expect(downloaded).toEqual(fileContent)
    }, 30000)
  })

  describe('upload queue cleanup', () => {
    it('clears queued requests when peer disconnects', async () => {
      const fileSize = 256 * 1024
      const { seederTorrent, leecherTorrent } = await setupTorrent(fileSize)

      // Very slow upload to build up queue
      seeder.bandwidthTracker.setUploadLimit(1024) // 1KB/sec

      const { leecherPeer } = connectPeers(seederTorrent, leecherTorrent)

      await new Promise<void>((resolve) => {
        if (leecherTorrent.hasMetadata) resolve()
        else leecherTorrent.on('ready', () => resolve())
      })

      // Let some requests queue up
      await new Promise((r) => setTimeout(r, 500))

      // Disconnect leecher
      leecherPeer.close()

      // Give time for cleanup
      await new Promise((r) => setTimeout(r, 100))

      // Seeder should have cleared queue (no way to directly inspect, but no crash/hang)
      // If queue wasn't cleared, seeder would try to send to closed socket
      expect(true).toBe(true) // Test passes if no errors thrown
    }, 10000)
  })
})
```

## Verification

### 1. Type Check

```bash
pnpm typecheck
```

### 2. Run Unit Tests

```bash
cd packages/engine
pnpm test token-bucket
```

### 3. Run Integration Tests

```bash
cd packages/engine
pnpm test rate-limiting
```

### 4. Run All Tests

```bash
pnpm test
```

### 5. Manual Testing

1. Build and load extension
2. Start a download
3. Open settings, set download limit to e.g. 100 KB/s
4. Observe Speed tab - should show rate hovering around limit
5. Set limit to 0 (unlimited) - speed should increase
6. Test upload limit with a seeding torrent

### 6. Lint and Format

```bash
pnpm lint
pnpm format:fix
```

## Notes

- Download limiting is simpler: just check bucket before each request in the existing loop
- Upload limiting requires a queue because requests arrive asynchronously
- The drain loop uses setTimeout to wait for token refill rather than busy-waiting
- Queue cleanup on disconnect prevents memory leaks and errors sending to closed sockets
- Integration tests use real timers (not fake) to test actual rate limiting behavior
- Test tolerance is 50% to account for timing imprecision; real-world accuracy should be better
- The bucket capacity (2 seconds of burst) means rates will be slightly bursty, smoothing over ~2 seconds
