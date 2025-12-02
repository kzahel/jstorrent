# Bug: Connection Spam to Failed Peer

## Symptoms
- 28,216 connection attempts to same localhost peer in seconds
- Peer hint from magnet link, localhost not listening
- Backoff logic not being applied

## Files to investigate

### 1. `packages/engine/src/core/swarm.ts`

Check `markConnectFailed()`:
- Does it set `state = 'failed'`?
- Does it set `lastConnectAttempt`?
- Does it increment `connectFailures`?
- Does it remove from `connectingKeys`?

Check `getConnectablePeers()`:
- Does backoff check require `state === 'failed'`? (If peer is 'idle', backoff skipped!)
- What does `calculateBackoff()` return? Should be exponential, not 0.

### 2. `packages/engine/src/core/torrent.ts`

Check `connectToPeer()`:
- On connection failure, does it call `swarm.markConnectFailed()`?
- Is there any code path where failure doesn't update swarm state?

Check maintenance loop / peer discovery:
- Is it edge-triggered on every tick/RAF?
- Is there rate limiting on how often we try to fill slots?

### 3. Magnet peer hints

Search for where magnet `x.pe` peer hints are added:
- Are they re-added on every iteration?
- `addPeer()` should no-op for existing peers, but verify

## Expected behavior

After connection failure:
1. `swarm.markConnectFailed(key, error)` called
2. `peer.state = 'failed'`
3. `peer.connectFailures++`
4. `peer.lastConnectAttempt = Date.now()`
5. `calculateBackoff(1)` returns e.g. 5000ms minimum
6. `getConnectablePeers()` skips this peer for 5+ seconds

## Fix requirements

1. Ensure failure path always calls `markConnectFailed()`
2. Backoff should apply regardless of current state (check `lastConnectAttempt` not just `state`)
3. Minimum backoff of 1000ms even for first failure
4. Consider: maintenance loop should have minimum interval (1000ms) not run every RAF
