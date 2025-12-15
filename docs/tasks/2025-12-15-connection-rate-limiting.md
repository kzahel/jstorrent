# Task: Fair Connection Queue and Connecting Peer Visibility

## Problem Statement

When multiple torrents start simultaneously, they flood the daemon with TCP connect requests. The daemon has burst limits (semaphore of 30, pending cap of 60), causing one torrent to starve while another hogs all connection slots during the 10s connect timeout window.

Additionally, users have no visibility into connection attempts - peers only appear in the list after successful TCP connection and handshake.

## Solution

1. **Centralized fair connection queue** - Torrents request connection slots from BtEngine, which grants them fairly via round-robin + rate limiting
2. **Show connecting peers** in the active peers list with a "State" column

## Files to Modify

```
packages/engine/src/
├── core/bt-engine.ts           # Add connection queue, drain loop, rate limiter
├── core/torrent.ts             # Request slots instead of connecting directly, add DisplayPeer
├── core/swarm.ts               # Expose getConnectingKeys()
├── index.ts                    # Export new types
packages/ui/src/
├── tables/PeerTable.tsx        # Add State column, combine connected + connecting
```

---

## Phase 1: Centralized Fair Connection Queue

### Design Overview

Instead of torrents connecting directly (racing for daemon resources), they request connection "slots" from BtEngine. BtEngine maintains a queue and grants slots fairly:

```
┌─────────────────┐     requestConnections(5)      ┌─────────────────┐
│   Torrent A     │ ──────────────────────────────►│                 │
└─────────────────┘                                │                 │
                                                   │    BtEngine     │
┌─────────────────┐     requestConnections(5)      │                 │
│   Torrent B     │ ──────────────────────────────►│  connectionReqs │
└─────────────────┘                                │  Map<hash, n>   │
                                                   │                 │
                        ◄────── drain loop ──────  │  round-robin +  │
                        connectOnePeer() granted   │  rate limit     │
                                                   └─────────────────┘
```

**Key properties:**
- Peer selection happens at grant time (freshest candidate, correct state)
- Round-robin ensures fairness across torrents
- Rate limiting prevents daemon flooding
- Torrent stop cancels pending requests

### 1.1 Add Connection Queue to BtEngine

**File:** `packages/engine/src/core/bt-engine.ts`

**Add import:**
```typescript
import { TokenBucket } from '../utils/token-bucket'
```

**Add to class fields (near other private fields):**
```typescript
// === Connection Queue (fair scheduling) ===

/**
 * Pending connection slot requests per torrent.
 * Key: infoHashHex, Value: number of slots requested
 */
private connectionRequests = new Map<string, number>()

/**
 * Round-robin index for fair queue draining.
 */
private connectionDrainIndex = 0

/**
 * Global rate limiter for outgoing connection attempts.
 * Prevents flooding the daemon when multiple torrents start simultaneously.
 */
private connectionRateLimiter = new TokenBucket(10, 20) // 10/sec, burst 20

/**
 * Interval handle for connection queue drain loop.
 */
private connectionDrainInterval: ReturnType<typeof setInterval> | null = null
```

### 1.2 Add Queue Management Methods

**Add to BtEngine class:**

```typescript
// === Connection Queue Methods ===

/**
 * Request connection slots for a torrent.
 * Slots are granted fairly via round-robin across all requesting torrents.
 * @param infoHashHex - Torrent identifier
 * @param count - Number of connection slots requested
 */
requestConnections(infoHashHex: string, count: number): void {
  if (count <= 0) return
  const current = this.connectionRequests.get(infoHashHex) ?? 0
  this.connectionRequests.set(infoHashHex, current + count)
  this.logger.debug(`[ConnectionQueue] ${infoHashHex.slice(0, 8)} requested ${count} slots (total: ${current + count})`)
}

/**
 * Cancel all pending connection requests for a torrent.
 * Called when torrent is stopped or removed.
 * @param infoHashHex - Torrent identifier
 */
cancelConnectionRequests(infoHashHex: string): void {
  const pending = this.connectionRequests.get(infoHashHex) ?? 0
  if (pending > 0) {
    this.connectionRequests.delete(infoHashHex)
    this.logger.debug(`[ConnectionQueue] ${infoHashHex.slice(0, 8)} cancelled ${pending} pending requests`)
  }
}

/**
 * Start the connection queue drain loop.
 * Called when engine starts.
 */
private startConnectionDrainLoop(): void {
  if (this.connectionDrainInterval) return
  
  // Drain at 100ms intervals (up to 10 connections/sec with rate limiter)
  this.connectionDrainInterval = setInterval(() => {
    this.drainConnectionQueue()
  }, 100)
}

/**
 * Stop the connection queue drain loop.
 * Called when engine stops.
 */
private stopConnectionDrainLoop(): void {
  if (this.connectionDrainInterval) {
    clearInterval(this.connectionDrainInterval)
    this.connectionDrainInterval = null
  }
}

/**
 * Drain connection queue with round-robin fairness.
 * Grants one connection slot per call, rate limited.
 */
private drainConnectionQueue(): void {
  // Check global connection limit first
  if (this.numConnections >= this.maxConnections) return
  
  // Check rate limit
  if (!this.connectionRateLimiter.tryConsume(1)) return
  
  const hashes = Array.from(this.connectionRequests.keys())
  if (hashes.length === 0) return
  
  // Round-robin: try each torrent starting from last position
  for (let i = 0; i < hashes.length; i++) {
    const idx = (this.connectionDrainIndex + i) % hashes.length
    const hash = hashes[idx]
    const count = this.connectionRequests.get(hash) ?? 0
    
    if (count <= 0) {
      this.connectionRequests.delete(hash)
      continue
    }
    
    const torrent = this.getTorrent(hash)
    if (!torrent || !torrent.isActive) {
      // Torrent stopped or removed, clear its requests
      this.connectionRequests.delete(hash)
      continue
    }
    
    // Grant one slot to this torrent
    const connected = torrent.connectOnePeer()
    if (connected) {
      this.connectionRequests.set(hash, count - 1)
      if (count - 1 <= 0) {
        this.connectionRequests.delete(hash)
      }
      // Advance round-robin to next torrent
      this.connectionDrainIndex = (idx + 1) % Math.max(1, hashes.length)
      return
    } else {
      // Torrent couldn't connect (no candidates), clear its requests
      this.connectionRequests.delete(hash)
    }
  }
}

/**
 * Get connection queue stats for debugging.
 */
getConnectionQueueStats(): {
  pendingByTorrent: Record<string, number>
  totalPending: number
  rateLimiterAvailable: number
} {
  const pendingByTorrent: Record<string, number> = {}
  let totalPending = 0
  for (const [hash, count] of this.connectionRequests) {
    pendingByTorrent[hash.slice(0, 8)] = count
    totalPending += count
  }
  return {
    pendingByTorrent,
    totalPending,
    rateLimiterAvailable: this.connectionRateLimiter.available,
  }
}
```

### 1.3 Wire Up Drain Loop Lifecycle

**Find `start()` method and add drain loop start:**

```typescript
async start(): Promise<void> {
  // ... existing start code ...
  
  this.startConnectionDrainLoop()
}
```

**Find `stop()` method and add drain loop stop:**

```typescript
async stop(): Promise<void> {
  this.stopConnectionDrainLoop()
  
  // ... existing stop code ...
}
```

### 1.4 Add getTorrent Helper (if not exists)

**Check if this method exists, add if not:**

```typescript
/**
 * Get a torrent by info hash hex string.
 */
getTorrent(infoHashHex: string): Torrent | undefined {
  return this.torrents.find(t => t.infoHashHex === infoHashHex)
}
```

### 1.5 Update Torrent to Request Slots

**File:** `packages/engine/src/core/torrent.ts`

**Remove `globalLimitCheck` from constructor and field** (no longer needed - BtEngine handles this):

Find and remove from constructor parameters:
```typescript
globalLimitCheck: () => boolean = () => true,
```

And from constructor body:
```typescript
this.globalLimitCheck = globalLimitCheck
```

And the field declaration:
```typescript
private globalLimitCheck: () => boolean
```

**Add `connectOnePeer()` method to Torrent:**

```typescript
/**
 * Connect to one peer from the swarm.
 * Called by BtEngine when granting a connection slot.
 * @returns true if a connection was initiated, false if no candidates available
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

**Update `runMaintenance()` to request slots instead of connecting directly:**

Find the slot filling section (around line 939):
```typescript
// === Fill peer slots (existing logic) ===
if (this.isComplete) return // Don't seek peers when complete

const connected = this.numPeers
const connecting = this.pendingConnections.size
const slotsAvailable = this.maxPeers - connected - connecting

if (slotsAvailable <= 0) return
if (this._swarm.size === 0) return

const candidates = this._swarm.getConnectablePeers(slotsAvailable)

if (candidates.length > 0) {
  this.logger.debug(
    `Maintenance: ${connected} connected, ${connecting} connecting, ` +
      `${slotsAvailable} slots available, trying ${candidates.length} candidates`,
  )

  for (const swarmPeer of candidates) {
    if (!this.globalLimitCheck()) break
    if (this.numPeers + this.pendingConnections.size >= this.maxPeers) break

    this.connectToPeer({ ip: swarmPeer.ip, port: swarmPeer.port })
  }
}
```

**Replace with:**
```typescript
// === Request connection slots from engine ===
if (this.isComplete) return // Don't seek peers when complete

const connected = this.numPeers
const connecting = this._swarm.connectingCount
const slotsAvailable = this.maxPeers - connected - connecting

if (slotsAvailable <= 0) return

// Check if we have candidates before requesting slots
const candidateCount = this._swarm.getConnectablePeers(slotsAvailable).length
if (candidateCount === 0) return

// Request slots from engine (will be granted fairly via round-robin)
const slotsToRequest = Math.min(slotsAvailable, candidateCount)
this.btEngine.requestConnections(this.infoHashHex, slotsToRequest)

this.logger.debug(
  `Maintenance: ${connected} connected, ${connecting} connecting, ` +
    `requested ${slotsToRequest} slots (${candidateCount} candidates available)`,
)
```

**Update stop methods to cancel pending requests:**

Find `userStop()` method and add cancellation at the start:
```typescript
userStop(): void {
  // Cancel pending connection requests
  this.btEngine.cancelConnectionRequests(this.infoHashHex)
  
  // ... existing stop code ...
}
```

Also update `networkStop()` if it exists separately:
```typescript
private networkStop(): void {
  // Cancel pending connection requests
  this.btEngine.cancelConnectionRequests(this.infoHashHex)
  
  // ... existing stop code ...
}
```

### 1.6 Update BtEngine Torrent Constructor Call

**Find where torrents are created** in `addTorrent` method (around line 278):

**Find:**
```typescript
const torrent = new Torrent(
  this,
  input.infoHash,
  this.peerId,
  this.socketFactory,
  this.port,
  undefined, // contentStorage - initialized later with metadata
  input.announce,
  this.maxPeers,
  () => this.numConnections < this.maxConnections,
  this.maxUploadSlots,
)
```

**Replace with (remove globalLimitCheck parameter):**
```typescript
const torrent = new Torrent(
  this,
  input.infoHash,
  this.peerId,
  this.socketFactory,
  this.port,
  undefined, // contentStorage - initialized later with metadata
  input.announce,
  this.maxPeers,
  this.maxUploadSlots,
)
```

### 1.7 Update Torrent Constructor Signature

**File:** `packages/engine/src/core/torrent.ts`

**Find constructor:**
```typescript
constructor(
  engine: BtEngine,
  infoHash: Uint8Array,
  peerId: Uint8Array,
  socketFactory: ISocketFactory,
  port: number,
  contentStorage?: TorrentContentStorage,
  announce: string[] = [],
  maxPeers: number = 20,
  globalLimitCheck: () => boolean = () => true,
  maxUploadSlots: number = 4,
) {
```

**Replace with:**
```typescript
constructor(
  engine: BtEngine,
  infoHash: Uint8Array,
  peerId: Uint8Array,
  socketFactory: ISocketFactory,
  port: number,
  contentStorage?: TorrentContentStorage,
  announce: string[] = [],
  maxPeers: number = 20,
  maxUploadSlots: number = 4,
) {
```

### 1.8 Configuration Method (Optional)

**Add to BtEngine for future settings UI:**

```typescript
/**
 * Configure global connection rate limit.
 * @param connectionsPerSecond - Rate limit (0 = unlimited)
 * @param burstSize - Maximum burst (default: 2x rate)
 */
setConnectionRateLimit(connectionsPerSecond: number, burstSize?: number): void {
  const burst = burstSize ?? connectionsPerSecond * 2
  this.connectionRateLimiter.setLimit(connectionsPerSecond, burst / connectionsPerSecond)
}
```

---

## Phase 2: Expose Connecting Peers

### 2.1 Add DisplayPeer Type

**File:** `packages/engine/src/core/torrent.ts`

**Add near top of file (after imports):**
```typescript
import { SwarmPeer, peerKey } from './swarm'

/**
 * Unified peer representation for UI display.
 * Can represent either a connected peer (with full PeerConnection) or a connecting peer.
 */
export interface DisplayPeer {
  /** Unique key: "ip:port" or "[ipv6]:port" */
  key: string
  /** Remote IP address */
  ip: string
  /** Remote port */
  port: number
  /** Connection state */
  state: 'connecting' | 'connected'
  /** Full connection (only for connected peers) */
  connection: PeerConnection | null
  /** Swarm peer data (available for both states) */
  swarmPeer: SwarmPeer | null
}
```

### 2.2 Add Method to Get All Displayable Peers

**Add to Torrent class:**
```typescript
/**
 * Get all peers for UI display, including those currently connecting.
 * Returns unified DisplayPeer objects that work for both states.
 */
getDisplayPeers(): DisplayPeer[] {
  const result: DisplayPeer[] = []
  
  // Add connected peers
  for (const conn of this._swarm.getConnectedPeers()) {
    const key = peerKey(conn.remoteAddress ?? '', conn.remotePort ?? 0)
    const swarmPeer = this._swarm.getPeerByKey(key) ?? null
    result.push({
      key,
      ip: conn.remoteAddress ?? '',
      port: conn.remotePort ?? 0,
      state: 'connected',
      connection: conn,
      swarmPeer,
    })
  }
  
  // Add connecting peers
  for (const key of this._swarm.getConnectingKeys()) {
    const swarmPeer = this._swarm.getPeerByKey(key)
    if (swarmPeer) {
      result.push({
        key,
        ip: swarmPeer.ip,
        port: swarmPeer.port,
        state: 'connecting',
        connection: null,
        swarmPeer,
      })
    }
  }
  
  return result
}
```

### 2.3 Expose connectingKeys from Swarm

**File:** `packages/engine/src/core/swarm.ts`

The class already has `connectingCount` getter. Add a getter for the keys:

```typescript
/**
 * Get all keys of peers currently in connecting state.
 * Used by Torrent.getDisplayPeers() for UI.
 */
getConnectingKeys(): ReadonlySet<string> {
  return this.connectingKeys
}
```

### 2.4 Export DisplayPeer Type

**File:** `packages/engine/src/index.ts`

**Add to exports:**
```typescript
export type { DisplayPeer } from './core/torrent'
```

---

## Phase 3: Update PeerTable UI

### 3.1 Update PeerTable to Use DisplayPeer

**File:** `packages/ui/src/tables/PeerTable.tsx`

**Update imports:**
```typescript
import { PeerConnection, Torrent, DisplayPeer } from '@jstorrent/engine'
```

**Update helper functions to handle DisplayPeer:**

```typescript
/**
 * Format peer flags (choking/interested states)
 * Returns '-' for connecting peers (no connection yet)
 */
function formatFlags(peer: DisplayPeer): string {
  if (!peer.connection) return '-'
  
  const flags: string[] = []
  if (peer.connection.amInterested) {
    flags.push(peer.connection.peerChoking ? 'd' : 'D')
  }
  if (peer.connection.peerInterested) {
    flags.push(peer.connection.amChoking ? 'u' : 'U')
  }
  return flags.join(' ') || '-'
}

/**
 * Calculate peer's progress from their bitfield
 * Returns 0 for connecting peers
 */
function getPeerProgress(peer: DisplayPeer, torrent: Torrent): number {
  if (!peer.connection?.bitfield || torrent.piecesCount === 0) return 0
  const have = peer.connection.bitfield.count()
  return have / torrent.piecesCount
}

/**
 * Parse client name from peer ID bytes
 */
function parseClientName(peer: DisplayPeer): string {
  const peerId = peer.connection?.peerId ?? peer.swarmPeer?.peerId
  if (!peerId) return '?'
  
  // Azureus-style: -XX0000-
  if (peerId[0] === 0x2d && peerId[7] === 0x2d) {
    const clientCode = String.fromCharCode(peerId[1], peerId[2])
    const version = String.fromCharCode(peerId[3], peerId[4], peerId[5], peerId[6])

    const clients: Record<string, string> = {
      UT: 'µTorrent',
      TR: 'Transmission',
      DE: 'Deluge',
      qB: 'qBittorrent',
      AZ: 'Azureus',
      LT: 'libtorrent',
      lt: 'libtorrent',
      JS: 'JSTorrent',
    }

    const name = clients[clientCode] || clientCode
    return `${name} ${version.replace(/0/g, '.').replace(/\.+$/, '')}`
  }

  return Array.from(peerId.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Format connection state for display
 */
function formatState(peer: DisplayPeer): string {
  return peer.state === 'connecting' ? 'Connecting...' : 'Connected'
}
```

### 3.2 Update Column Definitions

**Replace `createPeerColumns` function:**

```typescript
/** Column definitions for DisplayPeer */
function createPeerColumns(getTorrent: () => Torrent | null): ColumnDef<DisplayPeer>[] {
  return [
    {
      id: 'state',
      header: 'State',
      getValue: (p) => formatState(p),
      width: 90,
    },
    {
      id: 'address',
      header: 'Address',
      getValue: (p) => `${p.ip}:${p.port}`,
      width: 180,
    },
    {
      id: 'client',
      header: 'Client',
      getValue: (p) => parseClientName(p),
      width: 140,
    },
    {
      id: 'progress',
      header: '%',
      getValue: (p) => {
        const t = getTorrent()
        if (!t) return '-'
        const pct = getPeerProgress(p, t) * 100
        return pct >= 100 ? '100' : pct.toFixed(1)
      },
      width: 50,
      align: 'right',
    },
    {
      id: 'downSpeed',
      header: 'Down',
      getValue: (p) => {
        const speed = p.connection?.downloadSpeed ?? 0
        return speed > 0 ? formatBytes(speed) + '/s' : '-'
      },
      width: 90,
      align: 'right',
    },
    {
      id: 'upSpeed',
      header: 'Up',
      getValue: (p) => {
        const speed = p.connection?.uploadSpeed ?? 0
        return speed > 0 ? formatBytes(speed) + '/s' : '-'
      },
      width: 90,
      align: 'right',
    },
    {
      id: 'downloaded',
      header: 'Downloaded',
      getValue: (p) => {
        const dl = p.connection?.downloaded ?? 0
        return dl > 0 ? formatBytes(dl) : '-'
      },
      width: 90,
      align: 'right',
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      getValue: (p) => {
        const up = p.connection?.uploaded ?? 0
        return up > 0 ? formatBytes(up) : '-'
      },
      width: 90,
      align: 'right',
    },
    {
      id: 'flags',
      header: 'Flags',
      getValue: (p) => formatFlags(p),
      width: 60,
      align: 'center',
    },
    {
      id: 'requests',
      header: 'Reqs',
      getValue: (p) => p.connection?.requestsPending || '-',
      width: 50,
      align: 'right',
    },
  ]
}
```

### 3.3 Update TableMount Usage

**Update `PeerTable` component:**

```typescript
export function PeerTable(props: PeerTableProps) {
  const getTorrent = () => props.source.getTorrent(props.torrentHash) ?? null
  const columns = createPeerColumns(getTorrent)

  return (
    <TableMount<DisplayPeer>
      getRows={() => getTorrent()?.getDisplayPeers() ?? []}
      getRowKey={(p) => p.key}
      columns={columns}
      storageKey="peers"
      rowHeight={24}
      getSelectedKeys={props.getSelectedKeys}
      onSelectionChange={props.onSelectionChange}
    />
  )
}
```

### 3.4 Optional: Style Connecting Rows Differently

If the table supports row styling, connecting peers could be grayed out:

```typescript
// In TableMount or VirtualTable, if supported:
getRowStyle={(p: DisplayPeer) => 
  p.state === 'connecting' ? { opacity: 0.6 } : undefined
}
```

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

1. **Fair Connection Queue:**
   - Add 3+ torrents with many trackers simultaneously
   - Verify connections are distributed fairly across torrents (round-robin)
   - Check `engine.getConnectionQueueStats()` shows requests being processed
   - Verify no single torrent monopolizes connections

2. **Rate Limiting:**
   - Start many torrents at once
   - Verify connection attempts are rate limited (~10/sec)
   - Check that daemon isn't overwhelmed

3. **Cleanup on Stop:**
   - Start a torrent, let it queue connection requests
   - Stop the torrent
   - Verify `connectionRequests` map no longer has entries for that torrent

4. **Connecting Peers Visibility:**
   - Start a torrent with many peers
   - Observe peers appearing in "Connecting..." state before "Connected"
   - Verify connecting peers show address but no speed/downloaded/flags
   - Verify state updates to "Connected" once handshake completes

5. **Edge Cases:**
   - Torrent with no peers: table should be empty
   - Single torrent: gets all granted slots (no fairness needed)
   - Peer that fails to connect: should disappear from connecting state
   - Remove torrent while connections queued: requests should be cleaned up

---

## Summary of Changes

### packages/engine/src/core/bt-engine.ts
- Add `TokenBucket` import
- Add `connectionRequests`, `connectionDrainIndex`, `connectionRateLimiter`, `connectionDrainInterval` fields
- Add `requestConnections()`, `cancelConnectionRequests()` public methods
- Add `startConnectionDrainLoop()`, `stopConnectionDrainLoop()`, `drainConnectionQueue()` private methods
- Add `getConnectionQueueStats()` for debugging
- Add `getTorrent()` helper if not exists
- Wire drain loop to engine lifecycle (start/stop)
- Update torrent creation to remove `globalLimitCheck` parameter

### packages/engine/src/core/torrent.ts
- Remove `globalLimitCheck` constructor parameter and field
- Add `connectOnePeer()` method (called by BtEngine when granting slot)
- Update `runMaintenance()` to request slots via `btEngine.requestConnections()` instead of connecting directly
- Add cancellation in `userStop()` and `networkStop()` via `btEngine.cancelConnectionRequests()`
- Add `DisplayPeer` interface
- Add `getDisplayPeers()` method

### packages/engine/src/core/swarm.ts
- Add `getConnectingKeys()` method

### packages/engine/src/index.ts
- Export `DisplayPeer` type

### packages/ui/src/tables/PeerTable.tsx
- Update to use `DisplayPeer` instead of `PeerConnection`
- Add "State" column
- Update helper functions to handle both states
- Update `getRows` to use `getDisplayPeers()`

---

## Configuration Tuning

The default rate limit values (10/sec, burst 20) are conservative. Can be tuned based on testing:

| Scenario | Rate | Burst | Drain Interval | Notes |
|----------|------|-------|----------------|-------|
| Conservative | 10 | 20 | 100ms | Safe for Android daemon |
| Moderate | 15 | 30 | 100ms | Good for desktop |
| Aggressive | 25 | 50 | 50ms | Fast startup, may overwhelm weak daemons |

The drain interval (100ms default) determines how often we check for queued requests. Lower = more responsive, higher = less CPU.

The burst should generally be 2x the rate to allow quick initial connections while preventing sustained floods.
