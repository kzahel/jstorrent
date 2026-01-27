# Peer Selection Performance Analysis

This document analyzes the performance characteristics of peer selection in jstorrent compared to libtorrent, with recommendations for optimization.

## Problem Statement

`getConnectablePeers()` is called at least every ~5 seconds (and often more frequently—see "Call Frequency" below) to find peers eligible for connection attempts. The current implementation:

1. Iterates the **entire swarm** (can be 1000+ peers)
2. Performs backoff calculations for each peer
3. Computes a fresh score for each eligible peer
4. Sorts all candidates
5. Returns top N

For a swarm of 1000 peers, this is O(n) iteration + O(k log k) sort where k is the number of eligible candidates.

## Call Frequency: Edge-Triggered vs Interval

The problem is compounded by `fillPeerSlots()` being called more often than just the 5-second maintenance interval. `fillPeerSlots()` delegates directly to `runMaintenance()`, which triggers the full `getConnectablePeers()` scan.

### Current Call Sites

| Location | Trigger | Frequency |
|----------|---------|-----------|
| `torrent.ts` | Maintenance interval | Every ~5s |
| `torrent.ts` | Tracker response | Per announce (rare) |
| `torrent.ts` | DHT peer discovery | Per lookup with results |
| `torrent.ts` | Magnet peer hints | Once per magnet |
| ~~`torrent.ts`~~ | ~~Peer disconnect~~ | ~~Removed~~ |
| ~~`torrent-peer-handler.ts`~~ | ~~PEX message~~ | ~~Removed~~ |

### Edge-Triggered Cases by Urgency

**Keep edge-triggered (cold start, user waiting):**
- **Tracker response** - User is watching "connecting...", shouldn't wait 5s after first announce
- **DHT discovery** - Often the only peer source for magnet links, responsiveness matters
- **Magnet hints** - User just clicked a link, immediate action expected

**Can defer to interval (steady state):**
- **PEX** - By definition, we already have connected peers exchanging with us; not a cold start
- **Peer disconnect** - Other peers are active, filling one vacated slot isn't urgent

### ✅ Implemented: Remove Unnecessary Edge Triggers

Removed `fillPeerSlots()` calls from:
1. `torrent-peer-handler.ts` (PEX callback) - now just logs and waits for interval
2. `torrent.ts` (peer disconnect handler) - comment notes slot filled by next maintenance

This preserves responsiveness for user-visible moments (initial connection) while eliminating churn-driven extra scans during steady-state operation.

**Alternative:** Use a heuristic to only edge-trigger during cold start:

```typescript
// Only edge-trigger if we have few connected peers
if (this.numPeers < 3) {
  this.fillPeerSlots()
}
```

However, the simpler removal is preferred—the 5s interval handles steady state adequately, and once candidate caching (Phase 1) is implemented, these extra calls would be cheap anyway.

### Relationship to Tick-Aligned Processing

This optimization supports the [tick-aligned processing](./tick-aligned-processing.md) architecture. The goal there is predictable tick budgets (~50ms). Edge-triggered `fillPeerSlots()` calls add unpredictable `runMaintenance()` work to arbitrary ticks, working against the "all work at known intervals" principle.

By limiting edge triggers to cold-start scenarios (tracker/DHT/magnet), maintenance becomes predictable:
- **Every ~5s**: Full maintenance including peer selection
- **Cold start only**: Immediate slot filling for responsiveness

This aligns with the tick model where periodic tasks (like maintenance) run at their own cadence, not driven by incoming events.

## Current Implementation (jstorrent)

**Location:** `packages/engine/src/core/swarm.ts:542-596`

```typescript
getConnectablePeers(limit: number): SwarmPeer[] {
  const now = Date.now()
  const normalCandidates: SwarmPeer[] = []
  const suspiciousCandidates: SwarmPeer[] = []

  // Full iteration of all peers
  for (const peer of this.peers.values()) {
    // ... eligibility checks, backoff calculations
    // ... push to candidates array
  }

  // Score and sort ALL normal candidates
  const scoredNormal = normalCandidates.map((peer) => ({
    peer,
    score: this.calculatePeerScore(peer, now),
  }))
  scoredNormal.sort((a, b) => b.score - a.score)

  // Return top `limit` peers
  // ...
}
```

### Scoring Criteria

From `calculatePeerScore()` at line 602:

| Factor | Score Impact |
|--------|-------------|
| Base score | 100 |
| Suspicious port | -500 to -1000 |
| Previous successful connection | +50 |
| Each connection failure | -20 |
| Download history | +0 to +50 (log scale) |
| Recent failure (<30s) | -30 |
| Recent failure (<60s) | -15 |
| Source: manual | +20 |
| Source: lpd | +15 |
| Source: tracker | +10 |
| Source: incoming | +5 |
| Source: pex | 0 |
| Source: dht | -5 |
| Random factor | +0 to +10 |

### Backoff Strategy

Exponential backoff: `min(1000 * 2^failures, 5 minutes)`

- 1 failure: 2s
- 2 failures: 4s
- 3 failures: 8s
- 5 failures: 32s
- 8 failures: ~4.3 min (capped at 5 min)

Additional "quick disconnect" tracking penalizes peers that connect but disconnect within 30 seconds.

## libtorrent Implementation

**Location:** `src/peer_list.cpp`

libtorrent uses a fundamentally different architecture optimized for large swarms.

### Key Design: Candidate Caching

```cpp
// peer_list.cpp:1229-1271
torrent_peer* peer_list::connect_one_peer(int session_time, torrent_state* state)
{
    // Prune stale candidates from cache
    for (auto i = m_candidate_cache.begin(); i != m_candidate_cache.end();)
    {
        if (!is_connect_candidate(**i))
            i = m_candidate_cache.erase(i);
        else
            ++i;
    }

    // Only scan if cache is empty
    if (m_candidate_cache.empty())
    {
        find_connect_candidates(m_candidate_cache, session_time, state);
        if (m_candidate_cache.empty()) return nullptr;
    }

    // Pop one peer from cache
    torrent_peer* p = m_candidate_cache.front();
    m_candidate_cache.erase(m_candidate_cache.begin());
    return p;
}
```

### Limited Scanning with Round-Robin

```cpp
// peer_list.cpp:518-606
void peer_list::find_connect_candidates(std::vector<torrent_peer*>& peers,
    int session_time, torrent_state* state)
{
    const int candidate_count = 10;  // Only keep top 10
    peers.reserve(candidate_count);

    // Scan at most 300 peers, starting from round-robin position
    for (int iterations = std::min(int(m_peers.size()), 300);
        iterations > 0; --iterations)
    {
        if (m_round_robin >= int(m_peers.size())) m_round_robin = 0;
        torrent_peer& pe = *m_peers[m_round_robin];
        ++m_round_robin;

        if (!is_connect_candidate(pe)) continue;

        // Check reconnect timing
        if (pe.last_connected &&
            session_time - pe.last_connected <
            (int(pe.failcount) + 1) * state->min_reconnect_time)
            continue;

        // Insertion sort into bounded list (keeps top 10)
        if (peers.size() == candidate_count &&
            compare_peer(peers.back(), &pe, external, external_port, m_finished))
            continue;

        if (peers.size() >= candidate_count)
            peers.resize(candidate_count - 1);

        auto const i = std::lower_bound(peers.begin(), peers.end(), &pe,
            std::bind(&compare_peer, _1, _2, ...));
        peers.insert(i, &pe);
    }
}
```

### Scoring Criteria

From `compare_peer()` at line 111:

```cpp
bool compare_peer(torrent_peer const* lhs, torrent_peer const* rhs,
    external_ip const& external, int external_port, bool finished)
{
    // 1. Failcount (lower is better)
    if (lhs->failcount != rhs->failcount)
        return lhs->failcount < rhs->failcount;

    // 2. Local network peers prioritized
    bool lhs_local = aux::is_local(lhs->address());
    bool rhs_local = aux::is_local(rhs->address());
    if (lhs_local != rhs_local) return int(lhs_local) > int(rhs_local);

    // 3. Longer time since last connected is better
    if (lhs->last_connected != rhs->last_connected)
        return lhs->last_connected < rhs->last_connected;

    // 4. When finished, deprioritize potential seeds
    if (finished && lhs->maybe_upload_only != rhs->maybe_upload_only)
        return rhs->maybe_upload_only;

    // 5. Source rank
    int lhs_rank = source_rank(lhs->peer_source());
    int rhs_rank = source_rank(rhs->peer_source());
    if (lhs_rank != rhs_rank) return lhs_rank > rhs_rank;

    // 6. Cached peer priority (hash-based)
    return lhs->rank(external, external_port) > rhs->rank(external, external_port);
}
```

### Source Ranking

From `src/request_blocks.cpp:48`:

```cpp
int source_rank(peer_source_flags_t source_bitmask)
{
    int ret = 0;
    if (source_bitmask & peer_info::tracker) ret |= 1 << 5;  // 32
    if (source_bitmask & peer_info::lsd)     ret |= 1 << 4;  // 16
    if (source_bitmask & peer_info::dht)     ret |= 1 << 3;  // 8
    if (source_bitmask & peer_info::pex)     ret |= 1 << 2;  // 4
    return ret;
}
```

Note: Sources are **additive** in libtorrent (a peer from both tracker and DHT gets 32+8=40).

### Peer Priority (rank)

libtorrent computes and **caches** a peer priority based on a hash of both endpoints:

```cpp
// torrent_peer.cpp:189-198
std::uint32_t torrent_peer::rank(external_ip const& external, int external_port) const
{
    if (peer_rank == 0)
        peer_rank = peer_priority(
            tcp::endpoint(external.external_address(this->address()), external_port),
            tcp::endpoint(this->address(), this->port));
    return peer_rank;
}
```

This ensures all clients in the swarm agree on which peers should connect to each other, reducing duplicate connections.

### Backoff Strategy

Linear backoff: `(failcount + 1) * min_reconnect_time`

Default `min_reconnect_time` is typically 60 seconds:
- 0 failures: 60s
- 1 failure: 120s
- 2 failures: 180s
- etc.

## Comparison Summary

| Aspect | jstorrent | libtorrent |
|--------|-----------|------------|
| **Peers scanned per call** | All (1000+) | Max 300 |
| **Scan frequency** | Every call | Only when cache empty |
| **Candidate caching** | None | Yes (top 10) |
| **Round-robin fairness** | No | Yes (`m_round_robin`) |
| **Score computation** | Every call, all peers | Cached `peer_rank` |
| **Sorting algorithm** | Full sort | Bounded insertion sort |
| **Return value** | Batch of N | Single peer |
| **Backoff strategy** | Exponential (aggressive) | Linear (conservative) |
| **Source ranking** | Subtractive (dht=-5) | Additive (combinable) |
| **Local peer priority** | Via LPD source | Explicit `is_local()` check |
| **Seed avoidance** | None | `maybe_upload_only` flag |

### Complexity Analysis

**jstorrent (current):**
- Per call: O(n) iteration + O(k log k) sort
- With n=1000, k=500 eligible: ~1000 iterations + ~4500 comparisons

**libtorrent:**
- Per call (cache hit): O(c) where c is cache size (~10)
- Per call (cache miss): O(min(n, 300)) iteration + O(c log c) insertion
- With n=1000: ~300 iterations + ~40 comparisons

## Recommendations

### Phase 1: Candidate Caching

Add a candidate cache to avoid rescanning every call:

```typescript
class Swarm {
  private candidateCache: SwarmPeer[] = []
  private cacheVersion = 0

  getNextConnectPeer(): SwarmPeer | null {
    // Prune invalid candidates
    this.candidateCache = this.candidateCache.filter(p =>
      p.state === 'idle' || p.state === 'failed'
    )

    if (this.candidateCache.length === 0) {
      this.rebuildCandidateCache()
    }

    return this.candidateCache.shift() ?? null
  }

  // Invalidate cache on relevant state changes
  invalidateCandidateCache(): void {
    this.candidateCache = []
  }
}
```

**Expected impact:** Reduces scan frequency by ~10x (cache holds 10-20 candidates).

### Phase 2: Limited Scanning with Round-Robin

Cap iteration and use round-robin for fairness:

```typescript
private roundRobin = 0

private rebuildCandidateCache(): void {
  const maxIterations = Math.min(this.peers.size, 300)
  const candidates: Array<{peer: SwarmPeer, score: number}> = []
  const peersArray = this.getAllPeersArray()
  const now = Date.now()

  for (let i = 0; i < maxIterations; i++) {
    const idx = (this.roundRobin + i) % peersArray.length
    const peer = peersArray[idx]

    if (!this.isConnectCandidate(peer, now)) continue

    // Bounded insertion (keep top 20)
    const score = this.calculatePeerScore(peer, now)
    this.insertBounded(candidates, {peer, score}, 20)
  }

  this.roundRobin = (this.roundRobin + maxIterations) % peersArray.length
  this.candidateCache = candidates.map(c => c.peer)
}
```

**Expected impact:** Reduces per-scan work by ~70% for large swarms.

### Phase 3: Score Caching

Cache scores on peer objects, invalidate on state changes:

```typescript
interface SwarmPeer {
  // ... existing fields
  cachedScore: number | null
  scoreVersion: number
}

private globalScoreVersion = 0

calculatePeerScore(peer: SwarmPeer, now: number): number {
  // Return cached if valid
  if (peer.cachedScore !== null && peer.scoreVersion === this.globalScoreVersion) {
    return peer.cachedScore
  }

  // Compute fresh
  let score = 100
  // ... scoring logic (without random factor for caching)

  peer.cachedScore = score
  peer.scoreVersion = this.globalScoreVersion

  // Add random factor after caching
  return score + Math.random() * 10
}

// Call when scoring factors change (e.g., torrent completes)
invalidateScores(): void {
  this.globalScoreVersion++
}
```

**Expected impact:** Reduces scoring overhead by ~90% for cache hits.

### Phase 4: Bounded Insertion Sort

Replace full sort with bounded insertion:

```typescript
private insertBounded(
  arr: Array<{peer: SwarmPeer, score: number}>,
  item: {peer: SwarmPeer, score: number},
  maxSize: number
): void {
  // Binary search for insertion point
  let lo = 0, hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid].score > item.score) lo = mid + 1
    else hi = mid
  }

  // Only insert if better than worst or list not full
  if (lo < maxSize) {
    arr.splice(lo, 0, item)
    if (arr.length > maxSize) arr.pop()
  }
}
```

**Expected impact:** Reduces sorting from O(k log k) to O(k log c) where c is cache size.

### Additional Considerations

1. **Additive source ranking:** Consider making sources additive like libtorrent, so a peer discovered via both tracker and DHT ranks higher than either alone.

2. **Seed avoidance:** Add `maybe_upload_only` flag from PEX/DHT to avoid connecting seeds when we're also a seed.

3. **Local peer detection:** Add explicit local network detection (`192.168.x.x`, `10.x.x.x`, etc.) rather than relying solely on LPD source.

4. **Backoff tuning:** Exponential backoff is more aggressive; consider whether this matches desired behavior for mobile/battery scenarios.

## Metrics to Track

Before and after optimization, measure:

1. **Time spent in `getConnectablePeers()`** - target: <1ms for 1000 peers
2. **Allocations per call** - target: zero allocations on cache hit
3. **Cache hit rate** - target: >80%
4. **Connection success rate** - ensure quality not degraded
5. **Time to first peer** - ensure no regression for small swarms

## References

- [tick-aligned-processing.md](./tick-aligned-processing.md) - Predictable tick budgets, complements edge-trigger removal
- libtorrent source: `~/code/libtorrent/src/peer_list.cpp`
- jstorrent swarm: `packages/engine/src/core/swarm.ts`
- libtorrent peer scoring: `~/code/libtorrent/src/request_blocks.cpp` (source_rank)
- libtorrent peer priority: `~/code/libtorrent/src/torrent_peer.cpp` (rank function)
