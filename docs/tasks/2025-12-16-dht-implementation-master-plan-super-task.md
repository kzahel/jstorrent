# DHT Implementation - Super-Task

**Status:** Planning  
**Target:** Full BEP 5 DHT support for trackerless torrents

---

## Overview

Implement the BitTorrent DHT (BEP 5) to enable peer discovery for trackerless torrents. The DHT is a Kademlia-based distributed hash table running over UDP, where each node maintains a routing table and can query/respond to other nodes.

### Goals

1. Find peers for any infohash without trackers
2. Announce ourselves as a peer for torrents we're downloading
3. Respond to queries from other DHT nodes
4. Persist routing table across sessions

### Non-Goals (Future Work)

- BEP 44 (DHT storage for arbitrary data)
- BEP 51 (DHT infohash indexing)
- DHT security extensions (BEP 42)

---

## Architecture

```
packages/engine/src/dht/
├── index.ts                 # Public exports
├── types.ts                 # Interfaces and type definitions
├── constants.ts             # Protocol constants (K=8, timeouts, etc.)
├── xor-distance.ts          # XOR distance math utilities
├── routing-table.ts         # K-bucket routing table
├── krpc-socket.ts           # KRPC protocol over UDP
├── transaction-manager.ts   # Pending query tracking with timeouts
├── token-store.ts           # Token generation/validation for announces
├── peer-store.ts            # Infohash → peers storage with TTL
├── iterative-lookup.ts      # Parallel node/peer lookup algorithm
└── dht-node.ts              # Main coordinator class

packages/engine/test/dht/
├── xor-distance.test.ts
├── routing-table.test.ts
├── krpc-socket.test.ts
├── transaction-manager.test.ts
├── token-store.test.ts
├── peer-store.test.ts
├── iterative-lookup.test.ts
├── dht-node.test.ts
└── helpers/
    └── mock-udp-network.ts  # Multi-node mock for integration tests
```

---

## Protocol Reference

**Specification:** `beps_md/accepted/bep_0005.md`

### Key Constants

| Constant | Value | Description |
|----------|-------|-------------|
| K | 8 | Bucket size, replication factor |
| α (alpha) | 3 | Parallel queries in lookup |
| Node ID | 160 bits | Same space as infohashes |
| Query timeout | 5000 ms | Time to wait for response |
| Bucket refresh | 15 min | Refresh idle buckets |
| Token rotation | 5 min | Generate new token secret |
| Token validity | 10 min | Accept tokens up to this age |

### KRPC Messages

All messages are bencoded dictionaries over UDP.

**Common fields:**
- `t`: Transaction ID (2-byte string)
- `y`: Message type (`q`=query, `r`=response, `e`=error)
- `v`: Client version (optional, e.g., `JS01`)

**Queries:**

| Query | Arguments | Response |
|-------|-----------|----------|
| `ping` | `{id}` | `{id}` |
| `find_node` | `{id, target}` | `{id, nodes}` |
| `get_peers` | `{id, info_hash}` | `{id, token, values/nodes}` |
| `announce_peer` | `{id, info_hash, port, token, implied_port?}` | `{id}` |

**Compact encodings:**
- Peer: 6 bytes (4 IP + 2 port)
- Node: 26 bytes (20 ID + 6 peer)

---

## Phase 1: XOR Distance & Routing Table

**Goal:** Core data structures for node organization.

### Files

```
src/dht/
├── types.ts
├── constants.ts
├── xor-distance.ts
└── routing-table.ts

test/dht/
├── xor-distance.test.ts
└── routing-table.test.ts
```

### Key Interfaces

```typescript
// types.ts
interface DHTNode {
  id: Uint8Array         // 20 bytes
  host: string
  port: number
  lastSeen?: number
  lastQueried?: number
}

interface Bucket {
  min: bigint
  max: bigint
  nodes: DHTNode[]
  lastChanged: number
}
```

### Test Specifications

**xor-distance.test.ts:**
- `xorDistance(a, b)` returns zero for identical IDs
- `xorDistance` is commutative
- `compareDistance(a, b, target)` correctly orders by closeness
- `getBucketIndex(localId, nodeId)` returns 159 for 1-bit MSB difference
- `getBucketIndex` returns 0 for 1-bit LSB difference

**routing-table.test.ts:**
- Adds node to correct bucket based on XOR distance
- Moves existing node to tail on update (LRU)
- Emits `ping` event when bucket is full (8 nodes)
- `closest(target, k)` returns nodes sorted by XOR distance
- Splits bucket containing local ID when full
- Does not split far buckets (prevents unbounded growth)
- `getStaleBuckets(maxAge)` identifies buckets needing refresh
- Serializes/deserializes for persistence

---

## Phase 2: KRPC Protocol Layer

**Goal:** Encode/decode messages, manage transactions.

### Files

```
src/dht/
├── krpc-messages.ts       # Encode/decode functions
├── transaction-manager.ts # Pending query tracking
└── krpc-socket.ts         # Wraps IUdpSocket with KRPC

test/dht/
├── krpc-messages.test.ts
├── transaction-manager.test.ts
└── krpc-socket.test.ts
```

### Key Interfaces

```typescript
// krpc-messages.ts
interface KRPCQuery {
  t: Uint8Array    // transaction ID
  y: 'q'
  q: string        // method name
  a: Record<string, unknown>
  v?: Uint8Array   // client version
}

interface KRPCResponse {
  t: Uint8Array
  y: 'r'
  r: Record<string, unknown>
}

interface KRPCError {
  t: Uint8Array
  y: 'e'
  e: [number, string]
}

// transaction-manager.ts
interface PendingQuery {
  transactionId: Uint8Array
  method: string
  target: { host: string; port: number }
  sentAt: number
  callback: (err: Error | null, response: KRPCResponse | null) => void
}
```

### Test Specifications

**krpc-messages.test.ts:**
- Encodes ping query correctly (verify with reference bencode)
- Encodes find_node with target
- Encodes get_peers with info_hash
- Encodes announce_peer with token and implied_port
- Decodes response extracting `r` dict
- Decodes error extracting code and message
- Decodes compact node info (26 bytes → DHTNode)
- Decodes compact peer info (6 bytes → {host, port})
- Encodes compact node/peer info for responses
- Handles malformed input gracefully (returns null, doesn't throw)

**transaction-manager.test.ts:**
- Generates unique 2-byte transaction IDs
- Tracks pending query with callback
- Resolves correct callback on response
- Times out after configured duration
- Cleans up on timeout (calls callback with error)
- Ignores responses with unknown transaction ID

**krpc-socket.test.ts:**
- Sends encoded query via IUdpSocket
- Receives and decodes incoming messages
- Routes responses to transaction manager
- Emits `query` event for incoming queries
- Respects query timeout configuration

---

## Phase 3: Query Handlers (Server Side)

**Goal:** Respond to incoming DHT queries.

### Files

```
src/dht/
├── token-store.ts
├── peer-store.ts
└── query-handlers.ts

test/dht/
├── token-store.test.ts
├── peer-store.test.ts
└── query-handlers.test.ts
```

### Key Interfaces

```typescript
// token-store.ts
interface TokenStore {
  generate(ip: string): Uint8Array
  validate(ip: string, token: Uint8Array): boolean
  rotate(): void  // Called every 5 minutes
}

// peer-store.ts
interface PeerStore {
  addPeer(infoHash: Uint8Array, peer: { host: string; port: number }): void
  getPeers(infoHash: Uint8Array): Array<{ host: string; port: number }>
  cleanup(): void  // Remove expired entries
}
```

### Test Specifications

**token-store.test.ts:**
- Generates consistent token for same IP
- Validates token within current secret
- Validates token from previous secret (within 10 min)
- Rejects token after two rotations
- Different IPs get different tokens

**peer-store.test.ts:**
- Stores and retrieves peers by infohash
- Deduplicates identical peers
- Expires peers after TTL
- Caps peers per infohash (e.g., 100)
- Tracks total peer count

**query-handlers.test.ts:**
- Responds to ping with own node ID
- Responds to find_node with closest nodes from routing table
- Responds to get_peers with token + peers (if known)
- Responds to get_peers with token + closest nodes (if unknown)
- Validates token on announce_peer
- Rejects announce_peer with invalid token (error 203)
- Stores peer on valid announce_peer

---

## Phase 4: Outgoing Queries (Client Side)

**Goal:** Send queries and process responses.

### Files

```
src/dht/
└── dht-node.ts  # Add query methods

test/dht/
└── dht-node-queries.test.ts
```

### Key Methods

```typescript
// dht-node.ts
class DHTNode {
  async ping(node: DHTNode): Promise<boolean>
  async findNode(node: DHTNode, target: Uint8Array): Promise<DHTNode[]>
  async getPeers(node: DHTNode, infoHash: Uint8Array): Promise<GetPeersResult>
  async announcePeer(node: DHTNode, infoHash: Uint8Array, port: number, token: Uint8Array): Promise<boolean>
}

interface GetPeersResult {
  token: Uint8Array
  peers?: Array<{ host: string; port: number }>
  nodes?: DHTNode[]
}
```

### Test Specifications

**dht-node-queries.test.ts:**
- `ping()` returns true on response, false on timeout
- `ping()` updates routing table on success
- `findNode()` decodes compact node info from response
- `findNode()` adds responding node to routing table
- `getPeers()` returns peers when `values` present
- `getPeers()` returns nodes when `nodes` present
- `getPeers()` always returns token
- `announcePeer()` returns true on success
- `announcePeer()` returns false on error response

---

## Phase 5: Bootstrap

**Goal:** Initial routing table population.

### Files

```
src/dht/
├── constants.ts  # Add BOOTSTRAP_NODES
└── dht-node.ts   # Add bootstrap() method

test/dht/
└── dht-node-bootstrap.test.ts
```

### Bootstrap Nodes

```typescript
const BOOTSTRAP_NODES = [
  { host: 'router.bittorrent.com', port: 6881 },
  { host: 'router.utorrent.com', port: 6881 },
  { host: 'dht.transmissionbt.com', port: 6881 },
]
```

### Test Specifications

**dht-node-bootstrap.test.ts:**
- Sends find_node(self) to bootstrap nodes
- Populates routing table from responses
- Iterates until no closer nodes found
- Works with empty initial routing table
- Tolerates unresponsive bootstrap nodes
- Emits `ready` event when bootstrap complete

---

## Phase 6: Iterative Lookup

**Goal:** The core DHT algorithm - parallel search toward target.

### Files

```
src/dht/
└── iterative-lookup.ts

test/dht/
├── iterative-lookup.test.ts
└── helpers/
    └── mock-udp-network.ts
```

### Key Interface

```typescript
interface IterativeLookupOptions {
  target: Uint8Array
  routingTable: RoutingTable
  sendGetPeers: (node: DHTNode, target: Uint8Array) => Promise<GetPeersResult>
  alpha?: number        // Parallel queries, default 3
  k?: number            // Result size, default 8
  timeout?: number      // Per-query timeout
}

interface LookupResult {
  peers: Array<{ host: string; port: number }>
  closestNodes: DHTNode[]
  queriedCount: number
  tokens: Map<string, Uint8Array>  // nodeId hex → token (for announce)
}
```

### Algorithm

1. Seed candidate set with K closest nodes from routing table
2. Send α parallel get_peers queries to closest unqueried candidates
3. On response: collect peers, add new nodes to candidates
4. Repeat until no closer nodes found or K nodes queried
5. Return collected peers and tokens for announce

### Test Specifications

**iterative-lookup.test.ts:**
- Converges to target in O(log n) queries
- Collects peers from nodes that have them
- Continues past nodes without peers
- Handles unresponsive nodes (doesn't block)
- Respects α parallelism limit
- Stops when no closer nodes available
- Returns tokens from queried nodes (for announce)
- Works with MockUDPNetwork of 100 nodes

**mock-udp-network.ts:**
- Simulates N DHT nodes with proper routing
- Each mock node has consistent routing table
- `plantPeers(infoHash, peers)` - seed peers at closest nodes
- `setDropRate(0.3)` - simulate packet loss
- Query routing follows XOR distance

---

## Phase 7: Maintenance & Persistence

**Goal:** Keep routing table healthy, survive restarts.

### Files

```
src/dht/
├── dht-node.ts       # Add maintenance timers
└── dht-persistence.ts

test/dht/
├── dht-maintenance.test.ts
└── dht-persistence.test.ts
```

### Maintenance Tasks

| Task | Interval | Action |
|------|----------|--------|
| Bucket refresh | 15 min | find_node on random ID in bucket range |
| Token rotation | 5 min | Generate new secret, keep previous |
| Peer cleanup | 10 min | Remove expired peer store entries |
| Node ping | On query | Ping questionable nodes before eviction |

### Persistence Schema

```typescript
interface DHTPersistedState {
  nodeId: string  // hex
  nodes: Array<{
    id: string
    host: string
    port: number
  }>
}
```

Store in session alongside torrents via `ISessionStore`.

### Test Specifications

**dht-maintenance.test.ts:**
- Refreshes stale buckets after 15 minutes
- Rotates tokens every 5 minutes
- Pings questionable node before eviction
- Evicts node after failed ping
- Cleans up expired peers

**dht-persistence.test.ts:**
- Serializes routing table to JSON
- Restores routing table from JSON
- Persists node ID across restarts
- Handles corrupted/missing state gracefully

---

## Phase 8: Engine Integration

**Goal:** Wire DHT into BtEngine and Torrent.

### Files to Modify

```
src/dht/
└── index.ts              # Export DHTNode, types

src/core/
├── bt-engine.ts          # Add optional dht property
└── torrent.ts            # Use DHT in peer discovery

src/settings/
└── schema.ts             # Add dht.enabled setting

src/protocol/
└── wire-protocol.ts      # Handle PORT message
```

### Integration Points

**BtEngine:**
```typescript
class BtEngine {
  public dht?: DHTNode
  
  async enableDHT(options?: DHTOptions): Promise<void>
  async disableDHT(): Promise<void>
}
```

**Torrent peer discovery:**
```typescript
// In Torrent.findPeers() or similar
if (this.engine.dht) {
  const result = await this.engine.dht.lookup(this.infoHash)
  for (const peer of result.peers) {
    this.swarm.addPeer(peer.host, peer.port, 'dht')
  }
  // Announce ourselves
  await this.engine.dht.announce(this.infoHash, this.engine.port, result.tokens)
}
```

**Wire protocol PORT message:**
```typescript
// When receiving PORT message (0x09)
if (this.engine.dht && extensions.dht) {
  const dhtPort = (data[0] << 8) | data[1]
  this.engine.dht.addNode({
    id: unknownId,  // Will learn on first query
    host: this.remoteAddress,
    port: dhtPort
  })
}
```

**Settings:**
```typescript
// schema.ts additions
'dht.enabled': {
  type: 'boolean',
  storage: 'sync',
  default: true,
},
'dht.port': {
  type: 'number',
  storage: 'sync',
  default: 0,  // 0 = same as listening port
  min: 0,
  max: 65535,
},
```

### Test Specifications

**Integration tests (may be manual or E2E):**
- Engine creates DHT node when enabled
- Torrent uses DHT for peer discovery
- DHT announced port matches engine listening port
- PORT message adds node to routing table
- DHT state persists across session restore
- Disabling DHT cleans up resources

---

## Phase 9: Stats & Observability

**Goal:** Expose DHT state for debugging and UI.

### Files

```
src/dht/
├── types.ts        # Add DHTStats interface
└── dht-node.ts     # Add getStats() method
```

### Stats Interface

```typescript
interface DHTStats {
  // Identity
  nodeId: string              // hex
  
  // Routing table
  routingTableSize: number    // total nodes
  bucketCount: number         // non-empty buckets
  
  // Traffic
  bytesReceived: number
  bytesSent: number
  
  // Activity counts
  queriesSent: {
    ping: number
    find_node: number
    get_peers: number
    announce_peer: number
  }
  queriesReceived: {
    ping: number
    find_node: number
    get_peers: number
    announce_peer: number
  }
  
  // Health
  responsesReceived: number
  errors: number
  timeouts: number
  
  // Peer store
  infohashesTracked: number
  peersStored: number
}
```

### Test Specifications

- `getStats()` returns current counts
- Queries increment appropriate counters
- Traffic bytes accumulated correctly
- Stats reset on DHT restart

---

## Verification Checklist

Each phase is complete when:

1. ✅ All specified tests pass
2. ✅ `pnpm typecheck` passes
3. ✅ `pnpm lint` passes
4. ✅ Code follows existing patterns in codebase

### Final Integration Test

After all phases, verify end-to-end:

```bash
# Python integration test with libtorrent
cd packages/engine/integration/python
python test_dht.py
```

Test should:
1. Start JSTorrent with DHT enabled
2. Bootstrap from public DHT
3. Find peers for well-known torrent (Ubuntu ISO)
4. Verify peers returned

---

## Reference Material

- **BEP 5:** `beps_md/accepted/bep_0005.md` (primary spec)
- **Existing UDP pattern:** `src/tracker/udp-tracker.ts`
- **Socket interface:** `src/interfaces/socket.ts` (IUdpSocket)
- **Test patterns:** `test/tracker/udp-tracker.test.ts`
- **Settings pattern:** `src/settings/schema.ts`

---

## Notes for Sub-Task Agents

1. **Reference BEP 5** in `beps_md/accepted/bep_0005.md` for protocol details
2. **Follow existing patterns** in the codebase (see UDP tracker, settings schema)
3. **Use Vitest** for unit tests, follow existing test file structure
4. **Mock IUdpSocket** - see `test/tracker/udp-tracker.test.ts` for pattern
5. **Don't use external DHT libraries** - implement from spec
6. **Bencode utility exists** at `src/utils/bencode.ts`
7. **Run full test suite** after each phase: `pnpm test`
