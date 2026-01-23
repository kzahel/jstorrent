# DHT Issues on ChromeOS + Android Companion

## Summary

Investigation into why DHT peer discovery doesn't work on ChromeOS with the Android companion app, while it works on Mac.

## Comparison: Mac vs ChromeOS

| Metric | Mac | ChromeOS |
|--------|-----|----------|
| Routing Table | 259 nodes / 124 buckets | 63 nodes / 122 buckets |
| Bytes Sent | 34.2 MB | 62 MB |
| Bytes Received | 21.3 MB | 53 MB |
| **Pings Sent** | 395,216 | **952,710** |
| Timeouts | 5,476 | 607 |
| **Pings Received** | 2,404 | **1** |
| **find_node Received** | 13,158 | **1** |
| **get_peers Received** | 21,128 | **0** |
| DHT Bandwidth | 300-900 B/s | ~30 KB/s |

## Key Issues Identified

### 1. No Incoming DHT Queries (ChromeOS)

**Symptom:** ChromeOS receives almost no incoming DHT queries (1 ping, 1 find_node, 0 get_peers) while Mac receives thousands.

**Root Cause:** Other DHT nodes cannot reach the ChromeOS client. Even though UPnP maps the ports, the Android container's network architecture may prevent inbound UDP from reaching the DHT socket.

**Evidence:**
- ChromeOS network topology: `Internet → Router → wlan0 (192.168.1.118) → arc_wlan0 (100.115.92.21) → Android (100.115.92.22)`
- Android container is behind double-NAT
- UPnP maps TCP port (e.g., 22940) and UDP port (22941), but mappings may not work correctly for the Android container
- `conntrack` shows outbound connections work, but inbound queries don't arrive

**Impact:** Without incoming queries, the node cannot participate fully in the DHT. Other nodes won't add it to their routing tables, reducing peer discovery effectiveness.

### 2. DHT Ping Flood (Both Platforms)

**Symptom:** Excessive ping traffic - 395K pings on Mac, 952K pings on ChromeOS.

**Root Cause:** The routing table's "bucket full" logic triggers a ping every time `addNode()` is called on a full bucket that can't split. Since every DHT response calls `addNode()` for the responding node, this creates a cascade:

1. Any DHT response → `addNode(respondingNode)`
2. Bucket is full → emit 'ping' for LRU node
3. Ping succeeds → `addNode()` for pinged node (updates lastSeen)
4. Meanwhile, other responses keep arriving → more `addNode()` calls → more pings

**Evidence:**
- 952K pings sent but only 607 timeouts (99.94% success rate)
- Responses ARE being processed correctly
- ~30 KB/s steady DHT bandwidth on ChromeOS (mostly ping traffic)

**Impact:** Wasted bandwidth, potential rate limiting by DHT nodes, unnecessary CPU usage.

**Note:** The ping flood appears to be **transient** - it stopped on its own after some time. May be triggered by:
- Bootstrap phase (routing table filling up)
- Network reconnection / sleep-wake cycles
- Specific aggressive nodes responding very quickly (observed: 185.148.0.93)

Once the routing table stabilizes, the flood stops. Still worth adding rate limiting to prevent this during transient states.

### 3. PEX Not Implemented

**Symptom:** Zero peers from PEX on all platforms.

**Root Cause:** `PexHandler` class exists but is **never instantiated** in production code. The architecture doc confirms "PEX - Stub only."

**Location:** `packages/engine/src/extensions/pex-handler.ts`

**Fix Required:** Instantiate `PexHandler` in `PeerConnection` when the peer supports the `ut_pex` extension.

### 4. Tracker Returns Limited Peers (Normal Behavior)

**Symptom:** Tracker reports 1000 seeders but only returns ~10 peers.

**Root Cause:** This is normal tracker behavior. Trackers limit peer responses regardless of swarm size. The HTTP tracker code doesn't send `numwant` parameter, so trackers use their default (typically 10-50).

**Not a bug** - this is expected behavior per BitTorrent protocol.

## Network Architecture (ChromeOS)

```
Internet
    ↓
Router (UPnP: TCP 22940, UDP 22941 → 192.168.1.118)
    ↓
ChromeOS wlan0 (192.168.1.118)
    ↓
arc_wlan0 bridge (100.115.92.21)
    ↓
Android container eth5 (100.115.92.22) ← DHT socket bound here
```

**Observations:**
- Outbound UDP works (queries sent, responses received via conntrack)
- Inbound UDP may not be routed to Android container correctly
- iptables DNAT rule exists but may not apply to all inbound traffic

## Recommended Fixes

### High Priority

1. **Fix Ping Flood**
   - Add rate limiting to ping emissions from routing table
   - Consider debouncing `addNode()` calls for the same node
   - Or: Only emit ping if the LRU node hasn't been pinged recently

2. **Implement PEX**
   - Instantiate `PexHandler` when peer supports `ut_pex`
   - Wire up the `pex_peers` event listener (already exists in `torrent.ts`)

### Medium Priority

3. **Investigate ChromeOS Inbound UDP**
   - Check if UPnP mapping is reaching the correct internal IP
   - Consider using `implied_port=1` in DHT announces (use UDP source port)
   - May need ChromeOS-specific network configuration

4. **Add DHT Diagnostics**
   - Log when incoming queries are received (to detect reachability)
   - Add metric for "time since last incoming query"
   - Consider a reachability check (query self via external service)

### Low Priority

5. **Send `numwant` to HTTP Trackers**
   - Request more peers from trackers (e.g., `numwant=200`)
   - Won't dramatically improve peer count but may help

## Debug Commands

```javascript
// Check DHT stats
JSON.stringify(globalThis.engine._dhtNode?.getStats())

// Check pending transactions
globalThis.engine._dhtNode?.krpcSocket?.pendingCount()

// Check swarm peer sources
const t = globalThis.engine.torrents[0];
JSON.stringify(t?._swarm?.getStats()?.bySource)

// Manual DHT lookup
const t = globalThis.engine.torrents[0];
globalThis.engine._dhtNode.lookup(t.infoHash).then(r =>
  console.log('peers:', r.peers.length, 'nodes:', r.closestNodes.length))
```

## Files Involved

- `packages/engine/src/dht/routing-table.ts` - Ping emission on bucket full
- `packages/engine/src/dht/dht-node.ts` - Ping handler, addNode calls
- `packages/engine/src/extensions/pex-handler.ts` - PEX (not wired up)
- `packages/engine/src/core/peer-connection.ts` - Where PEX should be instantiated
- `packages/engine/src/core/torrent.ts:2237` - PEX event listener (ready)
- `packages/engine/src/tracker/http-tracker.ts` - Missing numwant parameter

## Date

2025-01-23
