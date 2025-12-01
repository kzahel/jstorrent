# Refactor: Batch Peer Events from Trackers

## Problem

When a tracker returns peers (typically 50-200 at once), we emit individual `'peer'` events for each one:

```typescript
// http-tracker.ts line 97-101
for (let i = 0; i < peers.length; i += 6) {
  const ip = `${peers[i]}.${peers[i + 1]}.${peers[i + 2]}.${peers[i + 3]}`
  const port = (peers[i + 4] << 8) | peers[i + 5]
  this.emit('peer', { ip, port })  // 50-200 emissions per announce!
}
```

This causes:
- Excessive event emissions (50-200 per tracker response)
- TrackerManager re-emits each one after deduping
- Torrent calls `connectToPeer()` 50-200 times, each doing limit checks
- No opportunity for smart batch decisions (shuffle, prioritize, rate limit)

## Solution

Change to batch events: `'peersDiscovered'` with array of peers.

## Changes

### 1. http-tracker.ts

```typescript
// Before:
private handleResponse(data: any) {
  // ...
  if (data['peers']) {
    const peers = data['peers']
    if (peers instanceof Uint8Array) {
      for (let i = 0; i < peers.length; i += 6) {
        const ip = `${peers[i]}.${peers[i + 1]}.${peers[i + 2]}.${peers[i + 3]}`
        const port = (peers[i + 4] << 8) | peers[i + 5]
        this.emit('peer', { ip, port })
      }
    }
  }
}

// After:
private handleResponse(data: any) {
  // ...
  if (data['peers']) {
    const peers = this.parsePeers(data['peers'])
    if (peers.length > 0) {
      this.emit('peersDiscovered', peers)
    }
  }
}

private parsePeers(peersData: unknown): PeerInfo[] {
  const peers: PeerInfo[] = []
  if (peersData instanceof Uint8Array) {
    // Compact format: 6 bytes per peer (4 IP + 2 port)
    for (let i = 0; i + 6 <= peersData.length; i += 6) {
      const ip = `${peersData[i]}.${peersData[i + 1]}.${peersData[i + 2]}.${peersData[i + 3]}`
      const port = (peersData[i + 4] << 8) | peersData[i + 5]
      peers.push({ ip, port })
    }
  } else if (Array.isArray(peersData)) {
    // Dictionary format (rare)
    for (const p of peersData) {
      if (p.ip && p.port) {
        peers.push({ ip: String(p.ip), port: Number(p.port) })
      }
    }
  }
  return peers
}
```

### 2. udp-tracker.ts

Find similar individual `emit('peer', ...)` calls and batch them the same way.

### 3. tracker-manager.ts

```typescript
// Before:
tracker.on('peer', (peer) => this.handlePeer(peer))

private handlePeer(peer: PeerInfo) {
  const key = `${peer.ip}:${peer.port}`
  if (!this.knownPeers.has(key)) {
    this.knownPeers.add(key)
    this.emit('peer', peer)
  }
}

// After:
tracker.on('peersDiscovered', (peers) => this.handlePeersDiscovered(peers))

private handlePeersDiscovered(peers: PeerInfo[]) {
  const newPeers: PeerInfo[] = []
  for (const peer of peers) {
    const key = `${peer.ip}:${peer.port}`
    if (!this.knownPeers.has(key)) {
      this.knownPeers.add(key)
      newPeers.push(peer)
    }
  }
  if (newPeers.length > 0) {
    this.logger.debug(`Discovered ${newPeers.length} new peers (${peers.length - newPeers.length} duplicates)`)
    this.emit('peersDiscovered', newPeers)
  }
}
```

### 4. torrent.ts

```typescript
// Before (appears twice - constructor and initTrackerManager):
this.trackerManager.on('peer', (peer: PeerInfo) => {
  this.connectToPeer(peer)
})

// After:
this.trackerManager.on('peersDiscovered', (peers: PeerInfo[]) => {
  this.handlePeersDiscovered(peers)
})

// Add new method:
private handlePeersDiscovered(peers: PeerInfo[]) {
  // Don't seek peers if complete (seeding)
  if (this.isComplete) return
  
  // Shuffle for fairness (don't always connect to first N)
  const shuffled = this.shuffleArray(peers)
  
  // Connect until we hit limits
  for (const peer of shuffled) {
    // connectToPeer already checks limits, but we can break early
    if (this.numPeers + this.pendingConnections.size >= this.maxPeers) break
    if (!this.globalLimitCheck()) break
    
    this.connectToPeer(peer)
  }
}

private shuffleArray<T>(array: T[]): T[] {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
```

### 5. interfaces/tracker.ts

Update the ITracker interface if it specifies event types.

## Consolidate Duplicate Event Handlers

While refactoring, also fix the duplicate tracker event setup. TrackerManager events are registered in both:
- Torrent constructor (lines ~162-177)
- `initTrackerManager()` method (lines ~494-504)

Consolidate to only `initTrackerManager()`.

## Testing

1. Run existing tracker tests: `pnpm test -- tracker`
2. Manual test: Add a torrent with a real tracker, verify peers are discovered
3. Check logs show batch counts like "Discovered 47 new peers (3 duplicates)"

## Files to Modify

1. `packages/engine/src/tracker/http-tracker.ts`
2. `packages/engine/src/tracker/udp-tracker.ts`  
3. `packages/engine/src/tracker/tracker-manager.ts`
4. `packages/engine/src/core/torrent.ts`
5. `packages/engine/src/interfaces/tracker.ts` (if needed)
6. `packages/engine/test/tracker/*.spec.ts` (update event names in tests)
