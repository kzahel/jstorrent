# Task: Unified Daemon Operation Queue

## Problem Statement

When multiple torrents start simultaneously, they flood the daemon with operations:
- TCP peer connections
- UDP tracker announces  
- HTTP tracker announces
- (Future) uTP peer connections

Each operation type uses different daemon resources, but they all contribute to overwhelming the daemon when fired in parallel. The android-io-daemon in particular struggles with burst loads.

## Solution

A unified operation queue in BtEngine that:
1. Tracks pending operations by type per torrent
2. Rate limits all daemon operations through a single token bucket
3. Grants slots fairly via round-robin across torrents
4. Lets each torrent decide which pending operation to execute when granted a slot

## What Gets Queued (and What Doesn't)

**Queued: Operations that initiate new daemon resources**
- `tcp_connect` - Creating a new TCP socket and calling connect()
- `utp_connect` - Creating a new UDP-based peer connection (future)
- `udp_announce` - Binding a UDP socket and sending tracker announce
- `http_announce` - Opening HTTP connection to tracker

**NOT queued: Operations on existing connections**
- Sending data frames on established WebSocket connections
- Piece request/cancel messages to peers
- Closing sockets (we want rapid cleanup on torrent stop)
- Any activity on already-open connections

The bottleneck is **initiating** connections - each one consumes a daemon socket slot until it completes or fails. Once connected, the WebSocket multiplexes freely.

## Operation Types

| Type | Resource | Lifecycle | Priority |
|------|----------|-----------|----------|
| `tcp_connect` | TCP socket | Long-lived connection | 1 (highest) |
| `utp_connect` | UDP socket | Long-lived connection | 3 |
| `udp_announce` | UDP socket | Fire & forget | 2 |
| `http_announce` | TCP socket | Fire & forget | 2 |

Priority determines which operation a torrent executes when granted a slot (lower = higher priority).

## Files to Modify

```
packages/engine/src/
├── core/bt-engine.ts           # Unified operation queue
├── core/torrent.ts             # Remove pendingConnections, request ops, use slots
├── core/swarm.ts               # Verify connecting state methods exist
├── tracker/tracker-manager.ts  # Queue announces by type
├── index.ts                    # Export types
```

---

## Phase 0: Clean Up Duplicate Connection Tracking

There are currently two parallel systems for tracking pending connections:
1. `Torrent.pendingConnections` - Set<string> - marked "legacy, to be removed"
2. `Swarm.connectingKeys` - Set<string> - supposed to be source of truth

Additionally, `ConnectionManager` has `initiateConnection()` and `fillSlots()` methods that are **never called** - Torrent bypasses them and calls `connectToPeer()` directly.

### 0.1 Remove pendingConnections from Torrent

**File:** `packages/engine/src/core/torrent.ts`

**Delete the field:**
```typescript
// DELETE THIS LINE:
private pendingConnections: Set<string> = new Set() // Track in-flight connection attempts (legacy, to be removed)
```

**Update connectToPeer() - remove pendingConnections references:**

```typescript
async connectToPeer(peerInfo: PeerInfo) {
  if (!this._networkActive) return
  if (this.isKillSwitchEnabled) return

  const key = peerKey(peerInfo.ip, peerInfo.port)

  // Check if already connected or connecting (swarm is source of truth)
  const existingPeer = this._swarm.getPeerByKey(key)
  if (existingPeer?.state === 'connected' || existingPeer?.state === 'connecting') return

  // Mark connecting in swarm FIRST (prevents race condition)
  this._swarm.markConnecting(key)

  // Check limits AFTER marking (so count is accurate)
  const totalConnections = this.numPeers + this._swarm.connectingCount
  if (totalConnections > this.maxPeers) {
    this.logger.debug(
      `Skipping peer ${peerInfo.ip}, max peers reached (${totalConnections}/${this.maxPeers})`,
    )
    this._swarm.markConnectFailed(key, 'limit_exceeded')
    return
  }

  // ... rest of method, replacing pendingConnections.delete(key) with nothing
  // (swarm state is already updated by markConnectFailed or markConnected)
}
```

**Update all usages of pendingConnections.size:**

```typescript
// BEFORE:
const connecting = this.pendingConnections.size

// AFTER:
const connecting = this._swarm.connectingCount
```

**Update invariant check (or remove it since there's now one source of truth):**

```typescript
// DELETE OR SIMPLIFY THIS:
// connectingKeys should match pendingConnections (until we remove pendingConnections)
if (swarmStats.byState.connecting !== this.pendingConnections.size) {
```

**Update networkStop():**

```typescript
// BEFORE:
this.pendingConnections.clear()

// AFTER:
// Nothing needed - swarm handles state, connections will fail/timeout naturally
// Or explicitly: this._swarm.clearConnecting() if such method exists
```

### 0.2 Verify Swarm Has Required Methods

**File:** `packages/engine/src/core/swarm.ts`

Ensure these methods exist (they should from Phase 3 work):
- `markConnecting(key)` - sets state to 'connecting', adds to connectingKeys
- `markConnected(key, connection)` - sets state to 'connected', moves from connectingKeys to connectedKeys
- `markConnectFailed(key, reason)` - sets state to 'failed', removes from connectingKeys
- `connectingCount` getter - returns connectingKeys.size

### 0.3 Remove Dead Code from ConnectionManager (Optional)

`ConnectionManager.initiateConnection()` and `fillSlots()` are never called. Options:
1. Delete them entirely
2. Keep for potential future use, but mark as unused
3. Refactor Torrent to use ConnectionManager properly (bigger change)

For now, just leave ConnectionManager as-is but be aware it's mostly dead code. The config management (`updateConfig()`) is still used.

---

### 1.1 Define Operation Types

**File:** `packages/engine/src/core/bt-engine.ts`

**Add types:**
```typescript
/**
 * Types of operations that consume daemon resources.
 */
export type DaemonOpType = 
  | 'tcp_connect'    // TCP peer connection (long-lived)
  | 'utp_connect'    // UDP peer connection via uTP (long-lived, future)
  | 'udp_announce'   // UDP tracker announce (fire & forget)
  | 'http_announce'  // HTTP tracker announce (fire & forget)

/**
 * Pending operation counts per type.
 */
export type PendingOpCounts = Record<DaemonOpType, number>

/**
 * Create empty pending op counts.
 */
function emptyOpCounts(): PendingOpCounts {
  return {
    tcp_connect: 0,
    utp_connect: 0,
    udp_announce: 0,
    http_announce: 0,
  }
}
```

### 1.2 Add Queue Fields

**Add to class fields:**
```typescript
import { TokenBucket } from '../utils/token-bucket'

// === Unified Daemon Operation Queue ===

/**
 * Pending operation counts per torrent.
 * Key: infoHashHex, Value: counts by operation type
 */
private pendingOps = new Map<string, PendingOpCounts>()

/**
 * Round-robin index for fair queue draining.
 */
private opDrainIndex = 0

/**
 * Single rate limiter for all daemon operations.
 * Prevents overwhelming the daemon regardless of operation type.
 */
private daemonRateLimiter = new TokenBucket(20, 40) // 20 ops/sec, burst 40

/**
 * Interval handle for operation queue drain loop.
 */
private opDrainInterval: ReturnType<typeof setInterval> | null = null
```

### 1.3 Add Queue Methods

**Add to BtEngine class:**

```typescript
// === Daemon Operation Queue Methods ===

/**
 * Request daemon operation slots for a torrent.
 * @param infoHashHex - Torrent identifier
 * @param type - Type of operation
 * @param count - Number of slots requested
 */
requestDaemonOps(infoHashHex: string, type: DaemonOpType, count: number): void {
  if (count <= 0) return
  
  let ops = this.pendingOps.get(infoHashHex)
  if (!ops) {
    ops = emptyOpCounts()
    this.pendingOps.set(infoHashHex, ops)
  }
  
  ops[type] += count
  this.logger.debug(
    `[OpQueue] ${infoHashHex.slice(0, 8)} +${count} ${type} (pending: ${JSON.stringify(ops)})`
  )
}

/**
 * Cancel all pending operations for a torrent.
 * Called when torrent is stopped or removed.
 * @param infoHashHex - Torrent identifier
 */
cancelDaemonOps(infoHashHex: string): void {
  const ops = this.pendingOps.get(infoHashHex)
  if (ops) {
    const total = Object.values(ops).reduce((a, b) => a + b, 0)
    if (total > 0) {
      this.pendingOps.delete(infoHashHex)
      this.logger.debug(`[OpQueue] ${infoHashHex.slice(0, 8)} cancelled ${total} pending ops`)
    }
  }
}

/**
 * Cancel pending operations of a specific type for a torrent.
 * @param infoHashHex - Torrent identifier  
 * @param type - Type of operation to cancel
 */
cancelDaemonOpsByType(infoHashHex: string, type: DaemonOpType): void {
  const ops = this.pendingOps.get(infoHashHex)
  if (ops && ops[type] > 0) {
    this.logger.debug(`[OpQueue] ${infoHashHex.slice(0, 8)} cancelled ${ops[type]} ${type} ops`)
    ops[type] = 0
    
    // Clean up if all zeros
    if (Object.values(ops).every(c => c === 0)) {
      this.pendingOps.delete(infoHashHex)
    }
  }
}

/**
 * Start the operation queue drain loop.
 */
private startOpDrainLoop(): void {
  if (this.opDrainInterval) return
  
  // Drain at 50ms intervals (up to 20 ops/sec with rate limiter)
  this.opDrainInterval = setInterval(() => {
    this.drainOpQueue()
  }, 50)
}

/**
 * Stop the operation queue drain loop.
 */
private stopOpDrainLoop(): void {
  if (this.opDrainInterval) {
    clearInterval(this.opDrainInterval)
    this.opDrainInterval = null
  }
}

/**
 * Drain operation queue with round-robin fairness.
 * Grants one operation slot per call, rate limited.
 */
private drainOpQueue(): void {
  // Check rate limit
  if (!this.daemonRateLimiter.tryConsume(1)) return
  
  const hashes = Array.from(this.pendingOps.keys())
  if (hashes.length === 0) return
  
  // Round-robin: try each torrent starting from last position
  for (let i = 0; i < hashes.length; i++) {
    const idx = (this.opDrainIndex + i) % hashes.length
    const hash = hashes[idx]
    const ops = this.pendingOps.get(hash)
    
    if (!ops) continue
    
    const total = Object.values(ops).reduce((a, b) => a + b, 0)
    if (total <= 0) {
      this.pendingOps.delete(hash)
      continue
    }
    
    const torrent = this.getTorrent(hash)
    if (!torrent || !torrent.isActive) {
      this.pendingOps.delete(hash)
      continue
    }
    
    // Grant slot - torrent decides which operation to execute
    const usedType = torrent.useDaemonSlot(ops)
    if (usedType) {
      ops[usedType]--
      if (ops[usedType] < 0) ops[usedType] = 0
      
      // Clean up if all zeros
      if (Object.values(ops).every(c => c === 0)) {
        this.pendingOps.delete(hash)
      }
      
      // Advance round-robin
      this.opDrainIndex = (idx + 1) % Math.max(1, hashes.length)
      return
    } else {
      // Torrent couldn't use any slot, clear its pending ops
      this.pendingOps.delete(hash)
    }
  }
}

/**
 * Get operation queue stats for debugging.
 */
getOpQueueStats(): {
  pendingByTorrent: Record<string, PendingOpCounts>
  totalByType: PendingOpCounts
  rateLimiterAvailable: number
} {
  const pendingByTorrent: Record<string, PendingOpCounts> = {}
  const totalByType = emptyOpCounts()
  
  for (const [hash, ops] of this.pendingOps) {
    pendingByTorrent[hash.slice(0, 8)] = { ...ops }
    for (const type of Object.keys(ops) as DaemonOpType[]) {
      totalByType[type] += ops[type]
    }
  }
  
  return {
    pendingByTorrent,
    totalByType,
    rateLimiterAvailable: this.daemonRateLimiter.available,
  }
}
```

### 1.4 Wire Up Lifecycle

**Update start/stop methods:**

```typescript
async start(): Promise<void> {
  // ... existing code ...
  this.startOpDrainLoop()
}

async stop(): Promise<void> {
  this.stopOpDrainLoop()
  this.pendingOps.clear()
  // ... existing code ...
}
```

### 1.5 Export Types

**File:** `packages/engine/src/index.ts`

```typescript
export type { DaemonOpType, PendingOpCounts } from './core/bt-engine'
```

---

## Phase 2: Update Torrent to Use Unified Queue

**Prerequisites:** Complete Phase 0 (remove pendingConnections) first.

### 2.1 Remove globalLimitCheck

The unified queue handles rate limiting, so remove `globalLimitCheck` parameter:

**Remove from constructor:**
```typescript
// DELETE from constructor parameters:
globalLimitCheck: () => boolean = () => true,

// DELETE from constructor body:
this.globalLimitCheck = globalLimitCheck

// DELETE field:
private globalLimitCheck: () => boolean
```

**Update BtEngine torrent creation:**
```typescript
// Remove the globalLimitCheck parameter from new Torrent(...) call
```

### 2.2 Add connectOnePeer Method

```typescript
/**
 * Connect to one peer from the swarm.
 * Called by useDaemonSlot() when granted a tcp_connect slot.
 * @returns true if a connection was initiated, false if no candidates
 */
connectOnePeer(): boolean {
  if (!this._networkActive) return false
  if (this.isKillSwitchEnabled) return false
  
  // Check we still have room
  const connected = this.numPeers
  const connecting = this._swarm.connectingCount
  if (connected + connecting >= this.maxPeers) return false
  
  // Get best candidate right now
  const candidates = this._swarm.getConnectablePeers(1)
  if (candidates.length === 0) return false
  
  const peer = candidates[0]
  this.connectToPeer({ ip: peer.ip, port: peer.port })
  return true
}
```

### 2.3 Add useDaemonSlot Method

**File:** `packages/engine/src/core/torrent.ts`

```typescript
/**
 * Use a granted daemon operation slot.
 * Called by BtEngine when granting a slot.
 * Executes the highest priority pending operation.
 * 
 * Priority order:
 * 1. tcp_connect - peer connections for download speed
 * 2. udp_announce / http_announce - peer discovery
 * 3. utp_connect - future
 * 
 * @param pending - Current pending counts (for reference)
 * @returns The operation type that was executed, or null if nothing pending
 */
useDaemonSlot(pending: PendingOpCounts): DaemonOpType | null {
  if (!this._networkActive) return null
  
  // Priority 1: TCP peer connections
  if (pending.tcp_connect > 0) {
    if (this.connectOnePeer()) {
      return 'tcp_connect'
    }
  }
  
  // Priority 2: Tracker announces (UDP and HTTP)
  if (pending.udp_announce > 0 || pending.http_announce > 0) {
    const announcedType = this.trackerManager?.announceOne()
    if (announcedType) {
      return announcedType // 'udp_announce' or 'http_announce'
    }
  }
  
  // Priority 3: uTP connections (future)
  if (pending.utp_connect > 0) {
    // TODO: implement when uTP is added
    // if (this.connectOneUtpPeer()) return 'utp_connect'
  }
  
  return null
}
```

### 2.4 Update runMaintenance to Request Slots

**Replace old `requestConnections` calls with:**

```typescript
// In runMaintenance(), instead of:
// this.btEngine.requestConnections(this.infoHashHex, slotsToRequest)

// Use:
this.btEngine.requestDaemonOps(this.infoHashHex, 'tcp_connect', slotsToRequest)
```

### 2.5 Update Tracker Announce Requests

**In networkStart() or similar:**

```typescript
if (this.trackerManager) {
  this.logger.info('Queueing tracker announces')
  const { udp, http } = this.trackerManager.queueAnnounces('started')
  
  if (udp > 0) {
    this.btEngine.requestDaemonOps(this.infoHashHex, 'udp_announce', udp)
  }
  if (http > 0) {
    this.btEngine.requestDaemonOps(this.infoHashHex, 'http_announce', http)
  }
}
```

### 2.6 Update Stop Methods

```typescript
userStop(): void {
  // Cancel all pending daemon operations
  this.btEngine.cancelDaemonOps(this.infoHashHex)
  
  // Clear tracker pending queue
  this.trackerManager?.clearPendingAnnounces()
  
  // ... existing stop code (no 'stopped' announce - tab closes too fast) ...
}
```

---

## Phase 3: Update TrackerManager

### 3.1 Track Pending by Protocol Type

**File:** `packages/engine/src/tracker/tracker-manager.ts`

**Add fields:**
```typescript
/**
 * Queue of trackers waiting to announce, grouped by protocol.
 */
private pendingUdpAnnounces: Array<{ tracker: ITracker; event: TrackerAnnounceEvent }> = []
private pendingHttpAnnounces: Array<{ tracker: ITracker; event: TrackerAnnounceEvent }> = []
```

### 3.2 Update queueAnnounces to Return Counts by Type

```typescript
/**
 * Queue announces for all trackers.
 * Returns counts by protocol type.
 * @param event - The announce event type
 */
queueAnnounces(event: TrackerAnnounceEvent = 'started'): { udp: number; http: number } {
  this.logger.info(`TrackerManager: Queueing '${event}' announces for ${this.trackers.length} trackers`)
  
  // Clear existing pending for this event type
  this.pendingUdpAnnounces = this.pendingUdpAnnounces.filter(p => p.event !== event)
  this.pendingHttpAnnounces = this.pendingHttpAnnounces.filter(p => p.event !== event)
  
  let udp = 0
  let http = 0
  
  for (const tracker of this.trackers) {
    if (tracker.url.startsWith('udp')) {
      this.pendingUdpAnnounces.push({ tracker, event })
      udp++
    } else if (tracker.url.startsWith('http')) {
      this.pendingHttpAnnounces.push({ tracker, event })
      http++
    }
  }
  
  this.logger.debug(`TrackerManager: Queued ${udp} UDP, ${http} HTTP announces`)
  return { udp, http }
}
```

### 3.3 Update announceOne to Return Protocol Type

```typescript
/**
 * Process one pending announce.
 * Prefers UDP (typically faster response).
 * @returns The protocol type announced, or null if queue empty
 */
announceOne(): 'udp_announce' | 'http_announce' | null {
  // Try UDP first (typically faster)
  const udpPending = this.pendingUdpAnnounces.shift()
  if (udpPending) {
    const { tracker, event } = udpPending
    this.logger.debug(`TrackerManager: Announcing '${event}' to UDP ${tracker.url}`)
    tracker.announce(event).catch((err) => {
      this.logger.warn(`TrackerManager: UDP announce failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    return 'udp_announce'
  }
  
  // Then HTTP
  const httpPending = this.pendingHttpAnnounces.shift()
  if (httpPending) {
    const { tracker, event } = httpPending
    this.logger.debug(`TrackerManager: Announcing '${event}' to HTTP ${tracker.url}`)
    tracker.announce(event).catch((err) => {
      this.logger.warn(`TrackerManager: HTTP announce failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    return 'http_announce'
  }
  
  return null
}
```

### 3.4 Add Clear Method

```typescript
/**
 * Clear all pending announces.
 * Called when torrent stops.
 */
clearPendingAnnounces(): void {
  const total = this.pendingUdpAnnounces.length + this.pendingHttpAnnounces.length
  this.pendingUdpAnnounces = []
  this.pendingHttpAnnounces = []
  if (total > 0) {
    this.logger.debug(`TrackerManager: Cleared ${total} pending announces`)
  }
}
```

### 3.5 Remove Legacy announce() for Non-Stop Events

```typescript
/**
 * @deprecated Use queueAnnounces() + requestDaemonOps() instead.
 * Kept only for potential future 'stopped' handling.
 */
async announce(event: TrackerAnnounceEvent = 'started'): Promise<void> {
  this.logger.warn(`TrackerManager: Legacy announce() called for '${event}' - use queueAnnounces()`)
  // ... existing implementation for backwards compatibility ...
}
```

### 3.6 Update destroy()

```typescript
destroy() {
  this.clearPendingAnnounces()
  
  for (const tracker of this.trackers) {
    tracker.destroy()
  }
  this.trackers = []
}
```

---

## Phase 4: N/A (Superseded Tasks)

The original separate queue tasks (connection-rate-limiting.md, tracker-slot-queue.md) were superseded by this unified approach before implementation. No old infrastructure to remove.

---

## Verification

### Build & Typecheck

```bash
pnpm typecheck
pnpm build
```

### Unit Tests

```bash
pnpm test
```

### Manual Testing

1. **Unified Rate Limiting:**
   - Start 5+ torrents simultaneously
   - Verify total daemon operations are rate limited (~20/sec)
   - Check that mix of TCP connects and tracker announces are interleaved

2. **Fair Round-Robin:**
   - Start multiple torrents with different tracker counts
   - Verify operations are distributed fairly across torrents
   - No single torrent should monopolize the queue

3. **Operation Type Tracking:**
   - Check `engine.getOpQueueStats()` shows correct breakdown by type
   - Verify UDP and HTTP announces tracked separately

4. **Priority Order:**
   - Torrent with pending TCP connects should use those first
   - Tracker announces come after peer connections

5. **Cleanup on Stop:**
   - Start torrent, let it queue operations
   - Stop before all complete
   - Verify `pendingOps` cleared for that torrent

---

## Summary of Changes

### packages/engine/src/core/torrent.ts (Phase 0 + Phase 2)
- **Remove `pendingConnections` Set** - use `_swarm.connectingCount` instead
- **Remove `globalLimitCheck` parameter and field**
- Update `connectToPeer()` to only use swarm for state tracking
- Remove invariant check that compared pendingConnections to swarm
- Add `connectOnePeer()` method
- Add `useDaemonSlot()` method
- Update `runMaintenance()` to use `requestDaemonOps()` for connections
- Update tracker start to request by protocol type
- Remove stop announce (tab closes too fast)

### packages/engine/src/core/bt-engine.ts (Phase 1)
- Add `DaemonOpType`, `PendingOpCounts` types
- Add `pendingOps` Map, `opDrainIndex`, `daemonRateLimiter`
- Add `requestDaemonOps()`, `cancelDaemonOps()`, `cancelDaemonOpsByType()`
- Add `drainOpQueue()`, `startOpDrainLoop()`, `stopOpDrainLoop()`
- Add `getOpQueueStats()`
- Remove `globalLimitCheck` parameter from Torrent constructor call

### packages/engine/src/core/torrent.ts
- Add `useDaemonSlot()` method
- Update to use `requestDaemonOps()` for connections
- Update tracker start to request by protocol type
- Remove stop announce (tab closes too fast)

### packages/engine/src/tracker/tracker-manager.ts
- Split pending announces by protocol type
- Update `queueAnnounces()` to return `{ udp, http }` counts
- Update `announceOne()` to return protocol type
- Add `clearPendingAnnounces()`
- Deprecate legacy `announce()` method

### packages/engine/src/index.ts
- Export `DaemonOpType`, `PendingOpCounts`

---

## Configuration

| Setting | Default | Notes |
|---------|---------|-------|
| Rate limit | 20/sec | Total daemon operations per second |
| Burst | 40 | Maximum burst of operations |
| Drain interval | 50ms | How often to check queue |

These can be tuned based on daemon capability. Android daemon may need lower limits than Rust desktop daemon.

---

## Future: uTP Support

When implementing uTP, add handling in `useDaemonSlot()`:

```typescript
// Priority 3: uTP connections
if (pending.utp_connect > 0) {
  const candidates = this._swarm.getConnectablePeers(1, { preferUtp: true })
  if (candidates.length > 0 && this.connectViaUtp(candidates[0])) {
    return 'utp_connect'
  }
}
```

The queue infrastructure is ready - just add the connection logic.

---

## Future: Tracker Tiers (BEP 12)

The queue infrastructure enables proper tier support:

```typescript
// In TrackerManager:
queueAnnounces(event: TrackerAnnounceEvent): { udp: number; http: number } {
  // Only queue tier 1 initially
  // If all tier 1 fail, queue tier 2, etc.
  
  const tier1 = this.trackersByTier[0] ?? []
  // Shuffle within tier per BEP 12
  shuffle(tier1)
  
  for (const tracker of tier1) {
    // ... queue logic
  }
  
  return counts
}

// On tracker failure, promote to next tier
onTrackerFailed(tracker: ITracker): void {
  if (this.allTierFailed(currentTier)) {
    this.queueNextTier()
  }
}
```
