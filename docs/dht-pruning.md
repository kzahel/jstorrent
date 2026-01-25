# DHT Node Pruning - Recommendations

## Problem

When changing networks (e.g., home → library), the DHT routing table retains stale nodes that are no longer reachable. This causes:

1. **Slow lookups** - Each query to a stale node waits 5 seconds for timeout
2. **Wasted bandwidth** - Sending queries that will never succeed
3. **Delayed peer discovery** - With alpha=3 parallelism, stale nodes slow convergence

## Current Behavior

### What We Have

1. **Bucket refresh** (`refreshStaleBuckets`) - Runs every minute, sends `find_node` to one node per stale bucket. **Does NOT remove failed nodes** - errors are caught and ignored.

2. **Wake refresh** (`refreshAfterShortSleep`) - Pings 8 nodes after short sleep. **Does NOT remove failed nodes** - just updates `lastSeen` on success.

3. **Eviction on full bucket** - When adding a node to a full bucket, pings the LRU node. If it fails, removes it. **Only reactive, not proactive.**

4. **Staleness detection** (newly added) - Tracks last 20 query results. If >90% fail, triggers re-bootstrap with public nodes. **Doesn't remove stale nodes, just adds good ones.**

### What's Missing

- No proactive removal of unresponsive nodes
- No tracking of per-node failure counts
- No age-based expiration

## BEP 5 Guidance

> "Nodes in the routing table should only be replaced when they fail to respond"

This is somewhat vague - it doesn't specify a schedule for verification. The current implementation only verifies when buckets are full.

## Recommendations

### Option 1: Remove Failed Nodes During Refresh (Simple)

Modify `refreshAfterShortSleep()` to remove nodes that fail to respond:

```typescript
private async refreshAfterShortSleep(): Promise<void> {
  const allNodes = this.routingTable.getAllNodes()
  const nodesToPing = allNodes.slice(0, Math.min(8, allNodes.length))

  if (nodesToPing.length === 0) return

  this.logger?.debug(`Pinging ${nodesToPing.length} nodes after wake`)

  const results = await Promise.all(
    nodesToPing.map(async (node) => {
      const alive = await this.ping(node)
      return { node, alive }
    }),
  )

  let removed = 0
  for (const { node, alive } of results) {
    if (!alive) {
      this.routingTable.removeNode(node.id)
      removed++
    }
  }

  if (removed > 0) {
    this.logger?.info(`DHT: Removed ${removed} unresponsive nodes after wake`)
  }
}
```

Also modify `refreshStaleBuckets()` similarly - remove nodes that fail `find_node`.

**Pros:** Simple, fits BEP 5 guidance
**Cons:** Aggressive - one timeout = removal (network blip could cause false positives)

### Option 2: Track Per-Node Failure Count (More Forgiving)

Add failure tracking to `DHTNodeInfo`:

```typescript
interface DHTNodeInfo {
  id: Uint8Array
  host: string
  port: number
  lastSeen?: number
  consecutiveFailures?: number  // NEW
}
```

Increment on timeout, reset on success. Remove after N consecutive failures (e.g., 3).

**Pros:** Tolerates temporary network issues
**Cons:** More complex, needs routing table changes

### Option 3: Periodic Liveness Check (Background)

Add a maintenance timer that periodically pings random nodes:

```typescript
// Every 5 minutes, ping 10 random nodes and remove failures
private startLivenessCheck(): void {
  this.livenessTimer = setInterval(() => {
    const nodes = this.routingTable.getAllNodes()
    const sample = shuffle(nodes).slice(0, 10)

    for (const node of sample) {
      this.ping(node).then(alive => {
        if (!alive) this.routingTable.removeNode(node.id)
      })
    }
  }, 5 * 60 * 1000)
}
```

**Pros:** Continuous health monitoring
**Cons:** Extra traffic, may not be needed if Option 1 works

### Option 4: Age-Based Expiration

Remove nodes not seen in X hours (e.g., 24 hours):

```typescript
private pruneOldNodes(): void {
  const maxAge = 24 * 60 * 60 * 1000 // 24 hours
  const now = Date.now()

  for (const node of this.routingTable.getAllNodes()) {
    if (node.lastSeen && now - node.lastSeen > maxAge) {
      this.routingTable.removeNode(node.id)
    }
  }
}
```

**Pros:** Simple, handles long-term staleness
**Cons:** `lastSeen` is set to `Date.now()` when restored from persistence, so this doesn't help with network changes

## Recommended Approach

**Start with Option 1** - it's simple and directly addresses the problem:

1. Modify `refreshAfterShortSleep()` to remove failed pings
2. Modify `refreshStaleBuckets()` to remove failed queries
3. Modify `refreshAfterLongSleep()` to clear all nodes before re-bootstrapping (since we're on a new network anyway)

If Option 1 proves too aggressive (good nodes being removed due to temporary issues), upgrade to Option 2 with failure counting.

## Changes Already Made (2026-01-25)

1. **`refreshAfterLongSleep()`** - Now includes public bootstrap nodes, not just existing nodes
2. **Staleness detection** - Triggers re-bootstrap when >90% of queries fail
3. **Success tracking** - Added `*Succeeded` counters for UI visibility
4. **Race condition fix** - Torrents now get notified when DHT becomes ready

## Implemented (2026-01-25) - Option 2 with Failure Counting

Implemented Option 2 (failure counting) with threshold of 2 consecutive failures:

- [x] Added `consecutiveFailures` field to `DHTNodeInfo`
- [x] Added `incrementFailures()` / `resetFailures()` helpers to `RoutingTable`
- [x] `addNode()` now resets `consecutiveFailures` on successful contact
- [x] `refreshAfterShortSleep()` tracks failures, removes nodes at ≥2 consecutive failures
- [x] `refreshStaleBuckets()` tracks failures, removes nodes at ≥2 consecutive failures
- [x] `refreshAfterLongSleep()` is more aggressive: pings existing nodes first, removes any that fail on first attempt (since we've likely changed networks), then bootstraps with public + remaining nodes
- [x] Persistence intentionally doesn't save failure counts (nodes start fresh on restore)
