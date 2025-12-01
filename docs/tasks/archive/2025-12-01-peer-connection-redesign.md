# Peer Connection Management Redesign

**Date**: 2025-12-01  
**Status**: Analysis & Design Proposal

## Executive Summary

The current peer connection management has several synchronization issues causing invariant violations like `swarm.connected (12) !== numPeers (11)`. This document analyzes the root causes and proposes a more robust architecture.

## Current Architecture

### Components

1. **Torrent.ts** - Maintains:
   - `peers: PeerConnection[]` - Active peer connections
   - `pendingConnections: Set<string>` - In-flight connection attempts
   - `maxPeers: number` - Connection limit per torrent

2. **Swarm.ts** - Maintains:
   - `peers: Map<string, SwarmPeer>` - All known peer addresses
   - `connectedKeys: Set<string>` - Address keys of connected peers
   - `connectingKeys: Set<string>` - Address keys of connecting peers

### Connection Flow

```
Discovery → Swarm.addPeer → Torrent.connectToPeer
                                    ↓
                          pendingConnections.add
                          swarm.markConnecting
                                    ↓
                          socketFactory.createTcpSocket
                                    ↓
                    ┌───────────────┴───────────────┐
                    ↓                               ↓
                SUCCESS                          FAILURE
                    ↓                               ↓
          pendingConnections.delete        swarm.markConnectFailed
          Torrent.addPeer                  pendingConnections.delete
                    ↓
          peers.push(peer)
          swarm.markConnected
```

## Identified Problems

### 1. Key Format Mismatch (CRITICAL)

**Location**: `torrent.ts` vs `swarm.ts`

**Issue**: Torrent uses simple string concatenation for peer keys, while Swarm uses `addressKey()` with proper IPv6 bracket notation.

```typescript
// torrent.ts (WRONG for IPv6)
const peerKey = `${peerInfo.ip}:${peerInfo.port}`
// Result for IPv6: "2001:db8::1:6881" (ambiguous)

// swarm.ts (CORRECT)
const key = addressKey({ ip, port, family })
// Result for IPv6: "[2001:db8::1]:6881"
```

**Impact**: Swarm state updates fail for IPv6 peers because keys don't match.

### 2. Dual Source of Truth

**Issue**: Peer connection state is tracked in TWO places:
- `Torrent.peers: PeerConnection[]`
- `Swarm.connectedKeys: Set<string>`

These can become desynchronized when:
- A peer disconnects but `removePeer` fails to update swarm
- Connection/disconnection events arrive out of order
- Errors occur during state transitions

### 3. Missing Address Info in removePeer

**Location**: `torrent.ts:964-976`

```typescript
private removePeer(peer: PeerConnection) {
  const index = this.peers.indexOf(peer)
  if (index !== -1) {
    this.peers.splice(index, 1)  // Always removes from array
  }

  // But this only runs if address info exists!
  if (peer.remoteAddress && peer.remotePort) {
    const peerKey = `${peer.remoteAddress}:${peer.remotePort}`
    this._swarm.markDisconnected(peerKey)  // May not run!
  }
}
```

**Impact**: If `PeerConnection` is created without address info (e.g., some test scenarios or edge cases), the peer is removed from `peers[]` but swarm still counts it as connected.

### 4. Race Condition: Incoming + Outgoing

**Scenario**:
1. We initiate outgoing connection to peer A
2. Peer A simultaneously connects to us (incoming)
3. Both connections succeed
4. `addPeer` called twice for same address

**Current "protection"** in `connectToPeer`:
```typescript
const alreadyConnected = this.peers.some(
  (p) => p.remoteAddress === peerInfo.ip && p.remotePort === peerInfo.port,
)
if (alreadyConnected) return
```

But `addPeer` has no such check, so incoming connection bypasses this.

### 5. No Connection Timeouts

**Issue**: Connection attempts can hang indefinitely, consuming slots.

The io-daemon has a 10-second timeout, but:
- It's not configurable per-connection
- Engine has no internal timeout for more aggressive control
- Stuck connections hold slots and block faster peers

### 6. Maintenance Interval Too Long

**Current**: 5 seconds between maintenance runs

**Issues**:
- Slow to fill slots after disconnections
- No edge-triggering when new peers are discovered
- No burst capability for initial swarm building

## Proposed Design

### Architecture: Swarm as Single Source of Truth

```
┌──────────────────────────────────────────────────────────┐
│                         Swarm                            │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  peers: Map<string, SwarmPeer>                      │ │
│  │    - state: idle | connecting | connected | failed  │ │
│  │    - connection: PeerConnection | null              │ │
│  │    - address, stats, identity                       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  Methods:                                                │
│    getConnectedPeers(): PeerConnection[]  ← replaces    │
│    getConnectingCount(): number            torrent.peers│
│    getConnectedCount(): number                          │
└──────────────────────────────────────────────────────────┘
```

**Key Changes**:
1. Remove `Torrent.peers` array
2. Remove `Torrent.pendingConnections` set
3. All state lives in Swarm
4. Torrent queries Swarm for connection info

### Consistent Key Format

Create a helper function used everywhere:

```typescript
// In swarm.ts - export this
export function peerKey(ip: string, port: number): string {
  const family = detectAddressFamily(ip)
  return addressKey({ ip, port, family })
}

// Usage in torrent.ts
import { peerKey } from './swarm'

const key = peerKey(peerInfo.ip, peerInfo.port)
```

### Connection State Machine

```
       ┌─────────────────────────────────────┐
       │                                     │
       ▼                                     │
    ┌──────┐  connect()  ┌────────────┐     │
    │ IDLE │────────────▶│ CONNECTING │     │
    └──────┘             └────────────┘     │
       ▲                    │      │        │
       │                    │      │        │
       │  timeout/          │      │        │
       │  disconnect        │      │        │
       │         ┌──────────┘      │        │
       │         │                 │        │
       │         ▼                 ▼        │
       │    ┌────────┐        ┌────────┐   │
       │    │ FAILED │        │CONNECTED│───┘
       │    └────────┘        └────────┘   disconnect
       │         │
       │         │ backoff expires
       └─────────┘
```

### Connection Lifecycle Manager

```typescript
export interface ConnectionConfig {
  maxPeersPerTorrent: number
  connectingHeadroom: number      // Extra slots for in-flight connections
  connectTimeout: number          // Internal timeout (ms)
  maintenanceInterval: number     // Base interval
  burstConnections: number        // Max connections per maintenance run
}

export class ConnectionManager {
  private config: ConnectionConfig
  private swarm: Swarm
  private connectTimers: Map<string, NodeJS.Timeout> = new Map()
  
  // Connection budget
  get availableSlots(): number {
    const connected = this.swarm.connectedCount
    const connecting = this.swarm.connectingCount
    const maxWithHeadroom = this.config.maxPeersPerTorrent + this.config.connectingHeadroom
    return Math.max(0, maxWithHeadroom - connected - connecting)
  }
  
  // Called when: new peers discovered, peer disconnected, periodic
  async fillSlots(): Promise<void> {
    const slots = this.availableSlots
    if (slots <= 0) return
    
    const candidates = this.selectCandidates(slots)
    for (const peer of candidates) {
      this.initiateConnection(peer)
    }
  }
  
  private async initiateConnection(peer: SwarmPeer): Promise<void> {
    const key = addressKey(peer)
    
    this.swarm.markConnecting(key)
    
    // Set internal timeout
    const timer = setTimeout(() => {
      this.swarm.markConnectFailed(key, 'timeout')
      this.connectTimers.delete(key)
    }, this.config.connectTimeout)
    this.connectTimers.set(key, timer)
    
    try {
      const socket = await this.socketFactory.createTcpSocket(peer.ip, peer.port)
      clearTimeout(timer)
      this.connectTimers.delete(key)
      
      const connection = new PeerConnection(this.engine, socket, {
        remoteAddress: peer.ip,
        remotePort: peer.port,
      })
      
      this.swarm.markConnected(key, connection)
      this.emit('peerConnected', key, connection)
    } catch (err) {
      clearTimeout(timer)
      this.connectTimers.delete(key)
      this.swarm.markConnectFailed(key, String(err))
    }
  }
}
```

### Peer Selection Heuristics

```typescript
interface PeerScore {
  key: string
  score: number
  peer: SwarmPeer
}

selectCandidates(limit: number): SwarmPeer[] {
  const candidates = this.swarm.getConnectablePeers(limit * 3)
  
  // Score each candidate
  const scored: PeerScore[] = candidates.map(peer => ({
    key: addressKey(peer),
    peer,
    score: this.calculateScore(peer),
  }))
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)
  
  return scored.slice(0, limit).map(s => s.peer)
}

private calculateScore(peer: SwarmPeer): number {
  let score = 100
  
  // Prefer peers with previous success
  if (peer.lastConnectSuccess) {
    score += 50
  }
  
  // Penalize repeated failures
  score -= peer.connectFailures * 20
  
  // Prefer peers with good download history
  if (peer.totalDownloaded > 0) {
    score += Math.min(50, Math.log10(peer.totalDownloaded) * 10)
  }
  
  // Penalize recently failed peers
  if (peer.lastConnectAttempt) {
    const timeSince = Date.now() - peer.lastConnectAttempt
    if (timeSince < 30000) score -= 30  // Recently tried
  }
  
  // Prefer tracker/manual sources over PEX
  if (peer.source === 'manual') score += 20
  if (peer.source === 'tracker') score += 10
  if (peer.source === 'pex') score -= 5
  
  return score
}
```

### Slow Peer Detection

```typescript
interface PeerPerformance {
  downloadSpeed: number      // bytes/sec
  lastPieceTime: number     // ms since last piece received
  requestLatency: number    // avg ms from request to piece
  chokeRatio: number        // % of time choked
}

shouldDropPeer(peer: PeerConnection): boolean {
  const perf = this.getPeerPerformance(peer)
  
  // Always drop if no data for too long
  if (perf.lastPieceTime > 60000 && peer.peerChoking) {
    return true
  }
  
  // Drop slow peers when we have better alternatives
  if (this.swarm.getConnectablePeers(1).length > 0) {
    const avgSpeed = this.getAverageDownloadSpeed()
    if (perf.downloadSpeed < avgSpeed * 0.1 && perf.downloadSpeed < 1000) {
      return true  // Less than 10% of average and < 1KB/s
    }
  }
  
  // Keep peer if it has pieces we need
  if (this.hasUniquePieces(peer)) {
    return false
  }
  
  return false
}
```

### Adaptive Maintenance

```typescript
class AdaptiveMaintenance {
  private lastRun = 0
  private pendingTrigger = false
  
  constructor(
    private config: {
      minInterval: number      // 1000ms
      maxInterval: number      // 10000ms
      baseInterval: number     // 5000ms
    }
  ) {}
  
  // Edge trigger - schedule immediate run
  trigger(): void {
    if (this.pendingTrigger) return
    
    const timeSince = Date.now() - this.lastRun
    if (timeSince >= this.config.minInterval) {
      this.run()
    } else {
      // Schedule for when minInterval is reached
      this.pendingTrigger = true
      setTimeout(() => {
        this.pendingTrigger = false
        this.run()
      }, this.config.minInterval - timeSince)
    }
  }
  
  // Adaptive interval based on state
  getNextInterval(): number {
    const connected = this.swarm.connectedCount
    const target = this.config.maxPeers
    
    if (connected === 0) {
      return this.config.minInterval  // Urgent!
    }
    
    const ratio = connected / target
    if (ratio < 0.5) {
      return this.config.minInterval
    } else if (ratio < 0.8) {
      return this.config.baseInterval
    } else {
      return this.config.maxInterval
    }
  }
}
```

## Test Strategy

### Unit Tests Needed

1. **Key format consistency**
   - IPv4 addresses produce consistent keys
   - IPv6 addresses produce consistent keys with brackets
   - IPv4-mapped IPv6 addresses normalize correctly

2. **Connection state machine**
   - IDLE → CONNECTING transition
   - CONNECTING → CONNECTED transition
   - CONNECTING → FAILED transition
   - CONNECTED → IDLE (disconnect)
   - Failed connections enter backoff

3. **Invariant preservation**
   - `connectedCount` always equals connected peers
   - `connectingCount` always equals in-flight connections
   - Total never exceeds maxPeers + headroom

4. **Race conditions**
   - Simultaneous incoming/outgoing to same peer
   - Multiple disconnects for same peer
   - Connect during disconnect

5. **Timeout handling**
   - Connections timeout after configured duration
   - Timeout clears pending state
   - Timeout doesn't affect already-connected peers

### Integration Tests with Real Sockets

```typescript
describe('Real Socket Connection Tests', () => {
  let server: net.Server
  let serverPort: number
  
  beforeEach(async () => {
    server = net.createServer()
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as net.AddressInfo).port
        resolve()
      })
    })
  })
  
  it('should connect and disconnect cleanly', async () => {
    // Use real TCP connection
    const swarm = new Swarm(logger)
    const manager = new ConnectionManager(swarm, realSocketFactory, config)
    
    swarm.addPeer({ ip: '127.0.0.1', port: serverPort, family: 'ipv4' }, 'manual')
    
    await manager.fillSlots()
    
    expect(swarm.connectedCount).toBe(1)
    expect(swarm.connectingCount).toBe(0)
    
    // Close connection
    const peer = swarm.getConnectedPeers()[0]
    peer.close()
    
    await waitFor(() => swarm.connectedCount === 0)
    
    expect(swarm.connectedCount).toBe(0)
    // Invariant should hold
    expect(swarm.getStats().byState.connected).toBe(swarm.connectedCount)
  })
  
  it('should handle connection refused', async () => {
    server.close()  // Close server before connecting
    
    const swarm = new Swarm(logger)
    swarm.addPeer({ ip: '127.0.0.1', port: serverPort, family: 'ipv4' }, 'manual')
    
    const manager = new ConnectionManager(swarm, realSocketFactory, config)
    await manager.fillSlots()
    
    expect(swarm.connectedCount).toBe(0)
    expect(swarm.connectingCount).toBe(0)
    
    const peer = swarm.getPeerByKey(`127.0.0.1:${serverPort}`)
    expect(peer?.state).toBe('failed')
    expect(peer?.connectFailures).toBe(1)
  })
})
```

## Migration Path

### Phase 1: Fix Immediate Issues (Low Risk)
1. Replace all `${ip}:${port}` with `peerKey(ip, port)` call
2. Add address validation in `addPeer`/`removePeer`
3. Add more detailed logging for state transitions

### Phase 2: Add Connection Manager (Medium Risk)
1. Create `ConnectionManager` class
2. Move connection logic from Torrent to ConnectionManager
3. Add internal connection timeout

### Phase 3: Unify State (Higher Risk)
1. Remove `Torrent.peers` array
2. Remove `Torrent.pendingConnections` set
3. All queries go through Swarm/ConnectionManager

### Phase 4: Advanced Features
1. Peer scoring and selection
2. Slow peer detection
3. Adaptive maintenance

## Configuration Recommendations

```typescript
const RECOMMENDED_CONFIG = {
  maxPeersPerTorrent: 50,         // Up from 20
  connectingHeadroom: 10,         // Allow 10 extra in-flight
  connectTimeout: 5000,           // 5 seconds internal timeout
  maintenanceMinInterval: 1000,   // Min 1 second between runs
  maintenanceBaseInterval: 3000,  // Base 3 seconds (down from 5)
  maintenanceMaxInterval: 10000,  // Max 10 seconds when full
  burstConnections: 5,            // Connect up to 5 at once
}
```

## Immediate Action Items

1. **Fix key format bug** - Use `addressKey()` or new `peerKey()` helper everywhere
2. **Add invariant logging** - Log full state when invariant fails to diagnose
3. **Guard removePeer** - Always update swarm even if address info missing
4. **Add duplicate check in addPeer** - Check swarm state before adding

## Conclusion

The current issues stem from having two sources of truth and inconsistent key formats. The proposed redesign unifies state management in the Swarm class and adds proper connection lifecycle management. This will make the system more robust and enable advanced features like peer scoring and adaptive maintenance.
