# Request Pipeline Investigation - 2025-12-12

## Summary

Investigation into sawtooth download patterns and pipeline stalls when downloading from fast local peers. Found multiple issues affecting request pipelining performance.

---

## Issue 1: Pipeline Drains During Piece Finalization (FIXED)

### Symptoms
- Sawtooth download pattern with periodic dips to zero
- Requests hover around 60-80 instead of filling to MAX_PIPELINE

### Root Cause
In `handleBlock()`, `requestPieces(peer)` was called **after** `await finalizePiece()`:

```typescript
// torrent.ts:1416-1422 (BEFORE)
if (piece.haveAllBlocks) {
  await this.finalizePiece(msg.index, piece)  // Blocks 10-50ms for hash+write
}
this.requestPieces(peer)  // Pipeline drains while waiting
```

### Fix Applied
Reordered to refill pipeline before I/O:

```typescript
// torrent.ts:1416-1422 (AFTER)
this.requestPieces(peer)  // Refill immediately

if (piece.haveAllBlocks) {
  await this.finalizePiece(msg.index, piece)
}
```

### Files Modified
- `packages/engine/src/core/torrent.ts` - lines 1416-1422

---

## Issue 2: Hardcoded Config Override (FIXED)

### Symptoms
- Changing `DEFAULT_CONFIG` in `active-piece-manager.ts` had no effect
- `maxActivePieces` stuck at 20 regardless of config changes

### Root Cause
Config was hardcoded in **two places** in `torrent.ts`, overriding `DEFAULT_CONFIG`:

```typescript
// torrent.ts:1283 and 1383
this.activePieces = new ActivePieceManager(
  this.engineInstance,
  (index) => this.getPieceLength(index),
  { requestTimeoutMs: 30000, maxActivePieces: 20, maxBufferedBytes: 16 * 1024 * 1024 },  // HARDCODED!
)
```

### Fix Applied
Removed hardcoded config, now uses `DEFAULT_CONFIG`:

```typescript
this.activePieces = new ActivePieceManager(
  this.engineInstance,
  (index) => this.getPieceLength(index),
)
```

### Files Modified
- `packages/engine/src/core/torrent.ts` - lines 1280-1283 and 1379-1382

---

## Issue 3: Missing Choke Handler (NOT FIXED)

### Symptoms
- Download stalls completely within seconds of starting
- `Reqs: 0` shown for all active pieces despite peer being connected
- Eventually recovers after ~5 minutes (when timeouts clear requests)

### Root Cause
There is **no handler** for the peer 'choke' event in `torrent.ts`.

When peer chokes us (common when overwhelmed by too many requests):
1. We send N requests → `peer.requestsPending = N`
2. Peer sends CHOKE → peer discards our pending requests (standard BitTorrent behavior)
3. `peer.on('choke')` emits but **nothing handles it**
4. Peer unchokes → `requestPieces(peer)` is called
5. Check: `peer.requestsPending (N) >= MAX_PIPELINE` → **NO NEW REQUESTS SENT**
6. **Complete stall** until 30s timeout clears stale requests

### Proposed Fix
Add choke handler in `torrent.ts` (near line 1116 where unchoke is handled):

```typescript
peer.on('choke', () => {
  this.logger.debug('Choke received')
  // Peer discarded our pending requests
  const peerId = peer.peerId ? toHex(peer.peerId) : `${peer.remoteAddress}:${peer.remotePort}`
  const cleared = this.activePieces?.clearRequestsForPeer(peerId) || 0
  peer.requestsPending = 0
  this.logger.debug(`Peer choked, cleared ${cleared} pending requests`)
})
```

### Files to Modify
- `packages/engine/src/core/torrent.ts` - add 'choke' event handler

---

## Issue 4: No Re-request After Timeout Cleanup (NOT FIXED)

### Symptoms
- After requests time out (30s), they're cleared but no new requests sent
- Download stalls until some other event triggers `requestPieces()`

### Root Cause
`ActivePieceManager.checkTimeouts()` clears timed-out requests but doesn't notify the torrent:

```typescript
// active-piece-manager.ts:152-161
checkTimeouts(): number {
  let totalCleared = 0
  for (const piece of this.pieces.values()) {
    totalCleared += piece.checkTimeouts(this.config.requestTimeoutMs)
  }
  if (totalCleared > 0) {
    this.logger.debug(`Cleared ${totalCleared} timed-out requests`)
    // MISSING: notify torrent to call requestPieces()
  }
  return totalCleared
}
```

### Proposed Fix

**Option A: Emit event from ActivePieceManager**

```typescript
// active-piece-manager.ts
if (totalCleared > 0) {
  this.logger.debug(`Cleared ${totalCleared} timed-out requests`)
  this.emit('requestsCleared', totalCleared)
}

// torrent.ts (where activePieces is created)
this.activePieces.on('requestsCleared', (count) => {
  this.logger.debug(`Re-requesting after ${count} timeouts`)
  for (const peer of this.connectedPeers) {
    if (!peer.peerChoking) {
      this.requestPieces(peer)
    }
  }
})
```

**Option B: Move timeout check to torrent maintenance**

Have torrent's `runMaintenance()` call `activePieces.checkTimeouts()` and then `requestPieces()` if any were cleared.

### Files to Modify
- `packages/engine/src/core/active-piece-manager.ts` - emit event
- `packages/engine/src/core/torrent.ts` - subscribe to event

---

## Configuration Recommendations

### MAX_PIPELINE
- Current: Varies (tested with 200, 500, 1000)
- libtorrent default: 500
- **Recommendation**: 500 is safe; higher values risk overwhelming peers

### maxActivePieces
- Must be: `>= MAX_PIPELINE / blocksPerPiece`
- For 64KB pieces (4 blocks): need 125 active pieces for 500 requests
- For 256KB pieces (16 blocks): need 32 active pieces for 500 requests
- **Recommendation**: Set to 150 to support small pieces

### Relationship
```
maxPendingRequests = min(MAX_PIPELINE, maxActivePieces × blocksPerPiece)
```

---

## Future Enhancements

### Dynamic Queue Sizing (like libtorrent)
Instead of fixed MAX_PIPELINE, use:
```
queue_depth = download_rate × request_queue_time
```
- `request_queue_time` default: 3 seconds
- Automatically scales for fast/slow peers
- Still capped by `max_out_request_queue` (500)

### Block Size
- Current: 16KB (standard)
- Some clients use 32KB for faster transfers (fewer messages)
- Would require protocol negotiation

---

## Key Files

| File | Purpose |
|------|---------|
| `packages/engine/src/core/torrent.ts` | Main torrent logic, request management |
| `packages/engine/src/core/active-piece-manager.ts` | Active piece tracking, timeout cleanup |
| `packages/engine/src/core/active-piece.ts` | Per-piece request tracking |
| `packages/engine/src/core/peer-connection.ts` | Wire protocol, choke/unchoke events |

---

## Testing

After fixes, test with:
1. Local peer (fast transfer) - should see smooth bandwidth
2. High MAX_PIPELINE (500+) - should not stall on choke
3. Slow peer - should recover after timeouts
