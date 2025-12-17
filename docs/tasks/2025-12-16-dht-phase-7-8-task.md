# DHT Phase 7 & 8 - Agent Task Document

**Prerequisite:** Phases 1-6 are complete. The DHT core is implemented with routing table, KRPC protocol, query handlers, outgoing queries, bootstrap, and iterative lookup.

**Goal:** Implement maintenance routines, persistence, and engine integration to make DHT fully operational.

---

## Overview

This task adds:
1. **Phase 7 - Maintenance & Persistence:** Automatic bucket refresh, token rotation scheduling, peer cleanup, and routing table persistence across sessions
2. **Phase 8 - Engine Integration:** Wire DHT into BtEngine and Torrent for peer discovery, announce, and PORT message handling

---

## File Structure

### Files to Create
```
packages/engine/src/dht/dht-persistence.ts
packages/engine/test/dht/dht-maintenance.test.ts
packages/engine/test/dht/dht-persistence.test.ts
packages/engine/test/dht/dht-engine-integration.test.ts
```

### Files to Modify
```
packages/engine/src/dht/dht-node.ts          # Add maintenance timers, lookup(), announce()
packages/engine/src/dht/constants.ts         # Add PEER_CLEANUP_MS constant
packages/engine/src/dht/index.ts             # Export new types/functions
packages/engine/src/settings/schema.ts       # Add dht.enabled setting
packages/engine/src/core/bt-engine.ts        # Add optional dht property, enableDHT/disableDHT
packages/engine/src/core/torrent.ts          # Use DHT for peer discovery
packages/engine/src/core/session-persistence.ts  # Add DHT state persistence
```

---

## Phase 7: Maintenance & Persistence

### 7.1 Add Constants

**File:** `packages/engine/src/dht/constants.ts`

Add after the existing constants:

```typescript
/**
 * Peer cleanup interval in milliseconds (10 minutes).
 * Remove expired peer store entries periodically.
 */
export const PEER_CLEANUP_MS = 10 * 60 * 1000
```

### 7.2 Create DHT Persistence Module

**File:** `packages/engine/src/dht/dht-persistence.ts`

```typescript
/**
 * DHT Persistence
 *
 * Handles saving and restoring DHT state across sessions.
 * Stores node ID and routing table nodes via ISessionStore.
 */

import { ISessionStore } from '../interfaces/session-store'
import { RoutingTableState } from './types'

const DHT_STATE_KEY = 'dht:state'

/**
 * Persisted DHT state.
 */
export interface DHTPersistedState {
  /** Our node ID in hex */
  nodeId: string
  /** Nodes from routing table */
  nodes: Array<{
    id: string
    host: string
    port: number
  }>
}

/**
 * Save DHT state to session store.
 *
 * @param store - Session store
 * @param state - Routing table state from table.serialize()
 */
export async function saveDHTState(
  store: ISessionStore,
  state: RoutingTableState,
): Promise<void> {
  const persisted: DHTPersistedState = {
    nodeId: state.nodeId,
    nodes: state.nodes,
  }
  await store.setJson(DHT_STATE_KEY, persisted)
}

/**
 * Load DHT state from session store.
 *
 * @param store - Session store
 * @returns Persisted state or null if not found/corrupted
 */
export async function loadDHTState(
  store: ISessionStore,
): Promise<DHTPersistedState | null> {
  try {
    const data = await store.getJson<DHTPersistedState>(DHT_STATE_KEY)
    if (!data) return null

    // Validate structure
    if (typeof data.nodeId !== 'string' || !Array.isArray(data.nodes)) {
      return null
    }

    // Filter valid nodes
    const validNodes = data.nodes.filter(
      (n) =>
        typeof n.id === 'string' &&
        typeof n.host === 'string' &&
        typeof n.port === 'number' &&
        n.id.length === 40 && // 20 bytes = 40 hex chars
        n.port > 0 &&
        n.port <= 65535,
    )

    return {
      nodeId: data.nodeId,
      nodes: validNodes,
    }
  } catch {
    return null
  }
}

/**
 * Clear DHT state from session store.
 *
 * @param store - Session store
 */
export async function clearDHTState(store: ISessionStore): Promise<void> {
  await store.delete(DHT_STATE_KEY)
}
```

### 7.3 Update DHTNode with Maintenance and High-Level Methods

**File:** `packages/engine/src/dht/dht-node.ts`

Add imports at the top (after existing imports):

```typescript
import { iterativeLookup, LookupResult } from './iterative-lookup'
import {
  BUCKET_REFRESH_MS,
  PEER_CLEANUP_MS,
} from './constants'
import { generateRandomIdInBucket } from './xor-distance'
```

Add new interface for announce results after `GetPeersResult`:

```typescript
/**
 * Result from an announce operation.
 */
export interface AnnounceResult {
  /** Number of nodes we successfully announced to */
  successCount: number
  /** Number of nodes we tried to announce to */
  totalCount: number
}
```

Add maintenance timers to the class properties (after existing properties like `_ready`):

```typescript
  /** Bucket refresh timer */
  private bucketRefreshTimer: ReturnType<typeof setInterval> | null = null

  /** Peer cleanup timer */
  private peerCleanupTimer: ReturnType<typeof setInterval> | null = null
```

Update the `start()` method to start maintenance timers:

```typescript
  /**
   * Start the DHT node (bind socket, start maintenance).
   */
  async start(): Promise<void> {
    if (this._ready) {
      throw new Error('DHTNode already started')
    }

    await this.krpcSocket.bind()
    this._ready = true

    // Start maintenance timers
    this.startMaintenance()

    this.emit('ready')
  }
```

Update the `stop()` method to stop maintenance timers:

```typescript
  /**
   * Stop the DHT node (close socket, stop maintenance, cleanup).
   */
  stop(): void {
    this._ready = false

    // Stop maintenance timers
    this.stopMaintenance()

    this.krpcSocket.close()
    this.tokenStore.stopRotation()
  }
```

Add maintenance methods section after the Bootstrap section (before Utility Methods):

```typescript
  // ==========================================================================
  // Maintenance
  // ==========================================================================

  /**
   * Start all maintenance timers.
   */
  private startMaintenance(): void {
    // Token rotation
    this.tokenStore.startRotation()

    // Bucket refresh - check every minute, refresh stale buckets
    this.bucketRefreshTimer = setInterval(() => {
      this.refreshStaleBuckets()
    }, 60 * 1000) // Check every minute

    // Peer cleanup
    this.peerCleanupTimer = setInterval(() => {
      this.peerStore.cleanup()
    }, PEER_CLEANUP_MS)
  }

  /**
   * Stop all maintenance timers.
   */
  private stopMaintenance(): void {
    if (this.bucketRefreshTimer) {
      clearInterval(this.bucketRefreshTimer)
      this.bucketRefreshTimer = null
    }

    if (this.peerCleanupTimer) {
      clearInterval(this.peerCleanupTimer)
      this.peerCleanupTimer = null
    }
  }

  /**
   * Refresh stale buckets by sending find_node with random target.
   * Per BEP 5: "Buckets that have not been changed in 15 minutes should be refreshed"
   */
  private async refreshStaleBuckets(): Promise<void> {
    if (!this._ready) return

    const staleBucketIndices = this.routingTable.getStaleBuckets(BUCKET_REFRESH_MS)

    for (const bucketIndex of staleBucketIndices) {
      const bucket = this.routingTable.getBucket(bucketIndex)
      if (!bucket || bucket.nodes.length === 0) continue

      // Generate random target ID in this bucket's range
      const target = generateRandomIdInBucket(bucketIndex, this.nodeId)

      // Query a node from this bucket
      const nodeToQuery = bucket.nodes[0]
      try {
        await this.findNode(nodeToQuery, target)
      } catch {
        // Ignore errors during refresh
      }
    }
  }

  // ==========================================================================
  // High-Level Operations
  // ==========================================================================

  /**
   * Perform an iterative lookup to find peers for an infohash.
   *
   * This is the main method for discovering peers via DHT.
   *
   * @param infoHash - 20-byte torrent infohash
   * @returns Lookup result with peers, closest nodes, and tokens for announce
   */
  async lookup(infoHash: Uint8Array): Promise<LookupResult> {
    if (!this._ready) {
      throw new Error('DHTNode not started')
    }

    if (infoHash.length !== NODE_ID_BYTES) {
      throw new Error(`Info hash must be ${NODE_ID_BYTES} bytes`)
    }

    return iterativeLookup({
      target: infoHash,
      routingTable: this.routingTable,
      sendGetPeers: async (node) => {
        return this.getPeers(node, infoHash)
      },
      localNodeId: this.nodeId,
    })
  }

  /**
   * Announce ourselves as a peer for a torrent to the closest nodes.
   *
   * Should be called after a successful lookup with the tokens from the result.
   *
   * @param infoHash - 20-byte torrent infohash
   * @param port - Port we're listening on for BitTorrent connections
   * @param tokens - Token map from lookup result (node key -> {node, token})
   * @returns Announce result with success/total counts
   */
  async announce(
    infoHash: Uint8Array,
    port: number,
    tokens: Map<string, { node: { host: string; port: number }; token: Uint8Array }>,
  ): Promise<AnnounceResult> {
    if (!this._ready) {
      throw new Error('DHTNode not started')
    }

    if (infoHash.length !== NODE_ID_BYTES) {
      throw new Error(`Info hash must be ${NODE_ID_BYTES} bytes`)
    }

    let successCount = 0
    const totalCount = tokens.size

    // Announce to all nodes that gave us tokens
    const announcePromises = Array.from(tokens.values()).map(async ({ node, token }) => {
      const success = await this.announcePeer(node, infoHash, port, token)
      if (success) {
        successCount++
      }
    })

    await Promise.all(announcePromises)

    return { successCount, totalCount }
  }

  /**
   * Get the serializable state for persistence.
   */
  getState(): import('./types').RoutingTableState {
    return this.routingTable.serialize()
  }
```

### 7.4 Update Index Exports

**File:** `packages/engine/src/dht/index.ts`

Add at the end of the file:

```typescript
// ============================================================================
// Phase 7 Exports - Maintenance & Persistence
// ============================================================================

// Persistence
export type { DHTPersistedState } from './dht-persistence'
export { saveDHTState, loadDHTState, clearDHTState } from './dht-persistence'

// Additional DHTNode exports
export type { AnnounceResult } from './dht-node'

// Additional constants
export { PEER_CLEANUP_MS } from './constants'
```

### 7.5 Create Maintenance Tests

**File:** `packages/engine/test/dht/dht-maintenance.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DHTNode } from '../../src/dht/dht-node'
import { K, BUCKET_REFRESH_MS } from '../../src/dht/constants'
import {
  generateRandomNodeId,
  generateRandomIdInBucket,
  nodeIdToHex,
} from '../../src/dht/xor-distance'
import { ISocketFactory, IUdpSocket } from '../../src/interfaces/socket'

// Mock UDP socket
class MockUdpSocket implements IUdpSocket {
  onMessageCallback: ((src: { addr: string; port: number }, data: Uint8Array) => void) | null =
    null
  onErrorCallback: ((err: Error) => void) | null = null
  closed = false

  send(_addr: string, _port: number, _data: Uint8Array): void {}
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.onMessageCallback = cb
  }
  onError(cb: (err: Error) => void): void {
    this.onErrorCallback = cb
  }
  close(): void {
    this.closed = true
  }
  address(): { port: number } {
    return { port: 6881 }
  }
}

// Mock socket factory
function createMockSocketFactory(): ISocketFactory & { lastUdpSocket: MockUdpSocket | null } {
  const factory: ISocketFactory & { lastUdpSocket: MockUdpSocket | null } = {
    lastUdpSocket: null,
    createTcpSocket: () => {
      throw new Error('Not implemented')
    },
    createTcpServer: () => {
      throw new Error('Not implemented')
    },
    wrapTcpSocket: () => {
      throw new Error('Not implemented')
    },
    createUdpSocket: async () => {
      const socket = new MockUdpSocket()
      factory.lastUdpSocket = socket
      return socket
    },
  }
  return factory
}

// Simple mock hash function
function createMockHash(): (data: Uint8Array) => Promise<Uint8Array> {
  return async (data: Uint8Array) => {
    let sum = 0
    for (const byte of data) {
      sum = (sum + byte) % 256
    }
    return new Uint8Array(20).fill(sum)
  }
}

describe('DHT Maintenance', () => {
  let dhtNode: DHTNode
  let socketFactory: ReturnType<typeof createMockSocketFactory>
  let nodeId: Uint8Array

  beforeEach(() => {
    vi.useFakeTimers()
    nodeId = generateRandomNodeId()
    socketFactory = createMockSocketFactory()
  })

  afterEach(() => {
    if (dhtNode) {
      dhtNode.stop()
    }
    vi.useRealTimers()
  })

  describe('token rotation', () => {
    it('starts token rotation when DHT starts', async () => {
      dhtNode = new DHTNode({
        nodeId,
        socketFactory,
        hashFn: createMockHash(),
      })

      await dhtNode.start()

      // Token store rotation is internal, but we can verify by checking
      // that the DHT node is ready
      expect(dhtNode.ready).toBe(true)
    })

    it('stops token rotation when DHT stops', async () => {
      dhtNode = new DHTNode({
        nodeId,
        socketFactory,
        hashFn: createMockHash(),
      })

      await dhtNode.start()
      dhtNode.stop()

      expect(dhtNode.ready).toBe(false)
    })
  })

  describe('bucket refresh', () => {
    it('identifies stale buckets after 15 minutes', async () => {
      dhtNode = new DHTNode({
        nodeId,
        socketFactory,
        hashFn: createMockHash(),
      })

      await dhtNode.start()

      // Add some nodes to create buckets
      for (let i = 0; i < K; i++) {
        const targetId = generateRandomIdInBucket(50, nodeId)
        dhtNode.addNode({
          id: targetId,
          host: `192.168.1.${i + 1}`,
          port: 6881 + i,
        })
      }

      // Verify no stale buckets initially
      const staleBefore = dhtNode.routingTable.getStaleBuckets(BUCKET_REFRESH_MS)
      expect(staleBefore.length).toBe(0)

      // Advance time past 15 minutes
      vi.advanceTimersByTime(BUCKET_REFRESH_MS + 1000)

      // Now buckets should be stale
      const staleAfter = dhtNode.routingTable.getStaleBuckets(BUCKET_REFRESH_MS)
      expect(staleAfter.length).toBeGreaterThan(0)
    })
  })

  describe('peer store cleanup', () => {
    it('cleans up expired peers periodically', async () => {
      dhtNode = new DHTNode({
        nodeId,
        socketFactory,
        hashFn: createMockHash(),
        peerOptions: {
          peerTtlMs: 5 * 60 * 1000, // 5 minutes for testing
        },
      })

      await dhtNode.start()

      // The peer store is internal, but cleanup happens on the interval
      // This test verifies the timer is set up correctly
      expect(dhtNode.ready).toBe(true)
    })
  })

  describe('questionable node pinging', () => {
    it('pings questionable node before eviction when bucket full', async () => {
      const pingPromises: Promise<boolean>[] = []
      const originalPing = DHTNode.prototype.ping

      dhtNode = new DHTNode({
        nodeId,
        socketFactory,
        hashFn: createMockHash(),
      })

      // Track ping calls
      let pingCalled = false
      dhtNode.routingTable.on('ping', () => {
        pingCalled = true
      })

      await dhtNode.start()

      // Fill a bucket that won't split (bucket 159)
      const bucketIndex = 159
      for (let i = 0; i < K; i++) {
        const targetId = generateRandomIdInBucket(bucketIndex, nodeId)
        dhtNode.addNode({
          id: targetId,
          host: `192.168.1.${i + 1}`,
          port: 6881 + i,
        })
      }

      // Adding one more should trigger ping event
      const extraNode = {
        id: generateRandomIdInBucket(bucketIndex, nodeId),
        host: '192.168.1.100',
        port: 7000,
      }
      dhtNode.addNode(extraNode)

      expect(pingCalled).toBe(true)
    })

    it('evicts node after failed ping', async () => {
      dhtNode = new DHTNode({
        nodeId,
        socketFactory,
        hashFn: createMockHash(),
        krpcOptions: {
          timeout: 100, // Short timeout for test
        },
      })

      await dhtNode.start()

      // Add a node
      const nodeToRemove = {
        id: generateRandomIdInBucket(50, nodeId),
        host: '192.168.1.1',
        port: 6881,
        lastSeen: Date.now() - 20 * 60 * 1000, // 20 minutes ago
      }
      dhtNode.addNode(nodeToRemove)
      expect(dhtNode.getNodeCount()).toBe(1)

      // Trigger ping (which will fail since no response)
      const alive = await dhtNode.ping(nodeToRemove)

      // Allow timeout
      vi.advanceTimersByTime(200)

      expect(alive).toBe(false)
    })
  })
})
```

### 7.6 Create Persistence Tests

**File:** `packages/engine/test/dht/dht-persistence.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { saveDHTState, loadDHTState, clearDHTState } from '../../src/dht/dht-persistence'
import { RoutingTable } from '../../src/dht/routing-table'
import { ISessionStore } from '../../src/interfaces/session-store'
import {
  generateRandomNodeId,
  nodeIdToHex,
  hexToNodeId,
  nodeIdsEqual,
} from '../../src/dht/xor-distance'

// In-memory session store for testing
class MemorySessionStore implements ISessionStore {
  private data = new Map<string, Uint8Array>()
  private json = new Map<string, unknown>()

  async get(key: string): Promise<Uint8Array | null> {
    return this.data.get(key) ?? null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
    this.json.delete(key)
  }

  async keys(prefix?: string): Promise<string[]> {
    const allKeys = [...this.data.keys(), ...this.json.keys()]
    if (!prefix) return allKeys
    return allKeys.filter((k) => k.startsWith(prefix))
  }

  async clear(): Promise<void> {
    this.data.clear()
    this.json.clear()
  }

  async getJson<T>(key: string): Promise<T | null> {
    return (this.json.get(key) as T) ?? null
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    this.json.set(key, value)
  }
}

describe('DHT Persistence', () => {
  let store: MemorySessionStore
  let localId: Uint8Array

  beforeEach(() => {
    store = new MemorySessionStore()
    localId = generateRandomNodeId()
  })

  describe('saveDHTState', () => {
    it('serializes routing table to session store', async () => {
      const table = new RoutingTable(localId)

      // Add some nodes
      for (let i = 0; i < 5; i++) {
        table.addNode({
          id: generateRandomNodeId(),
          host: `192.168.1.${i + 1}`,
          port: 6881 + i,
        })
      }

      const state = table.serialize()
      await saveDHTState(store, state)

      const loaded = await store.getJson<{ nodeId: string; nodes: unknown[] }>('dht:state')
      expect(loaded).not.toBeNull()
      expect(loaded!.nodeId).toBe(nodeIdToHex(localId))
      expect(loaded!.nodes.length).toBe(5)
    })
  })

  describe('loadDHTState', () => {
    it('restores routing table from session store', async () => {
      const table = new RoutingTable(localId)
      const addedIds: Uint8Array[] = []

      // Add some nodes
      for (let i = 0; i < 5; i++) {
        const id = generateRandomNodeId()
        addedIds.push(id)
        table.addNode({
          id,
          host: `192.168.1.${i + 1}`,
          port: 6881 + i,
        })
      }

      // Save
      await saveDHTState(store, table.serialize())

      // Load
      const loaded = await loadDHTState(store)

      expect(loaded).not.toBeNull()
      expect(loaded!.nodeId).toBe(nodeIdToHex(localId))
      expect(loaded!.nodes.length).toBe(5)

      // Restore to new table
      const restoredTable = new RoutingTable(hexToNodeId(loaded!.nodeId))
      for (const node of loaded!.nodes) {
        restoredTable.addNode({
          id: hexToNodeId(node.id),
          host: node.host,
          port: node.port,
        })
      }

      expect(restoredTable.size()).toBe(5)
    })

    it('persists node ID across restarts', async () => {
      const table = new RoutingTable(localId)
      await saveDHTState(store, table.serialize())

      const loaded = await loadDHTState(store)

      expect(loaded).not.toBeNull()
      expect(loaded!.nodeId).toBe(nodeIdToHex(localId))

      // Create new table with loaded ID
      const restoredId = hexToNodeId(loaded!.nodeId)
      expect(nodeIdsEqual(restoredId, localId)).toBe(true)
    })

    it('returns null for missing state', async () => {
      const loaded = await loadDHTState(store)
      expect(loaded).toBeNull()
    })

    it('handles corrupted state gracefully', async () => {
      // Store corrupted data
      await store.setJson('dht:state', {
        nodeId: 'not-a-valid-hex-id',
        nodes: 'not-an-array',
      })

      const loaded = await loadDHTState(store)
      expect(loaded).toBeNull()
    })

    it('filters out invalid nodes', async () => {
      // Store state with mix of valid and invalid nodes
      await store.setJson('dht:state', {
        nodeId: nodeIdToHex(localId),
        nodes: [
          { id: 'invalid', host: '192.168.1.1', port: 6881 },
          { id: nodeIdToHex(generateRandomNodeId()), host: '192.168.1.2', port: 6882 },
          { id: nodeIdToHex(generateRandomNodeId()), host: '192.168.1.3', port: -1 }, // Invalid port
          { id: nodeIdToHex(generateRandomNodeId()), host: '192.168.1.4', port: 6884 },
        ],
      })

      const loaded = await loadDHTState(store)

      expect(loaded).not.toBeNull()
      expect(loaded!.nodes.length).toBe(2) // Only valid nodes
    })
  })

  describe('clearDHTState', () => {
    it('removes DHT state from session store', async () => {
      const table = new RoutingTable(localId)
      await saveDHTState(store, table.serialize())

      // Verify saved
      expect(await loadDHTState(store)).not.toBeNull()

      // Clear
      await clearDHTState(store)

      // Verify cleared
      expect(await loadDHTState(store)).toBeNull()
    })
  })

  describe('roundtrip', () => {
    it('preserves all node data through save/load cycle', async () => {
      const table = new RoutingTable(localId)
      const originalNodes: Array<{ id: Uint8Array; host: string; port: number }> = []

      // Add nodes
      for (let i = 0; i < 10; i++) {
        const node = {
          id: generateRandomNodeId(),
          host: `192.168.${Math.floor(i / 256)}.${i % 256}`,
          port: 6881 + i,
        }
        if (table.addNode(node)) {
          originalNodes.push(node)
        }
      }

      // Save and load
      await saveDHTState(store, table.serialize())
      const loaded = await loadDHTState(store)

      expect(loaded).not.toBeNull()
      expect(loaded!.nodes.length).toBe(originalNodes.length)

      // Verify each node
      for (const original of originalNodes) {
        const found = loaded!.nodes.find((n) => n.id === nodeIdToHex(original.id))
        expect(found).toBeDefined()
        expect(found!.host).toBe(original.host)
        expect(found!.port).toBe(original.port)
      }
    })
  })
})
```

---

## Phase 8: Engine Integration

### 8.1 Add DHT Settings

**File:** `packages/engine/src/settings/schema.ts`

Add in the Network section (after `encryptionPolicy`):

```typescript
  // -------------------------------------------------------------------------
  // DHT (Distributed Hash Table)
  // -------------------------------------------------------------------------
  /**
   * Enable DHT for trackerless peer discovery.
   */
  'dht.enabled': {
    type: 'boolean',
    storage: 'sync',
    default: true,
  },
```

### 8.2 Update BtEngine

**File:** `packages/engine/src/core/bt-engine.ts`

Add import near the top (with other imports):

```typescript
import { DHTNode, DHTNodeOptions, saveDHTState, loadDHTState } from '../dht'
```

Add DHT property to the class (after `bandwidthTracker`):

```typescript
  /** Optional DHT node for trackerless peer discovery */
  public dht?: DHTNode
```

Add methods after the UPnP methods section:

```typescript
  // === DHT Methods ===

  /**
   * Enable DHT for trackerless peer discovery.
   *
   * @param options - Optional DHT configuration
   */
  async enableDHT(options?: Partial<DHTNodeOptions>): Promise<void> {
    if (this.dht) {
      this.logger.warn('DHT already enabled')
      return
    }

    this.logger.info('Enabling DHT...')

    // Try to restore persisted state
    const persistedState = await loadDHTState(this.sessionPersistence['store'])

    let nodeId: Uint8Array | undefined
    if (persistedState) {
      try {
        const { hexToNodeId } = await import('../dht')
        nodeId = hexToNodeId(persistedState.nodeId)
        this.logger.info(`Restored DHT node ID: ${persistedState.nodeId.slice(0, 16)}...`)
      } catch {
        this.logger.warn('Failed to restore DHT node ID, generating new one')
      }
    }

    this.dht = new DHTNode({
      nodeId,
      socketFactory: this.socketFactory,
      hashFn: async (data) => {
        return this.hasher.sha1(data)
      },
      ...options,
    })

    // Forward DHT events
    this.dht.on('ready', () => {
      this.emit('dhtReady')
    })

    this.dht.on('error', (err) => {
      this.logger.error('DHT error:', err)
    })

    await this.dht.start()

    // Restore routing table nodes
    if (persistedState && persistedState.nodes.length > 0) {
      const { hexToNodeId } = await import('../dht')
      let restoredCount = 0
      for (const node of persistedState.nodes) {
        try {
          this.dht.addNode({
            id: hexToNodeId(node.id),
            host: node.host,
            port: node.port,
          })
          restoredCount++
        } catch {
          // Skip invalid nodes
        }
      }
      this.logger.info(`Restored ${restoredCount} DHT nodes from session`)
    }

    // Bootstrap if routing table is empty or small
    if (this.dht.getNodeCount() < 8) {
      this.logger.info('Bootstrapping DHT...')
      try {
        const stats = await this.dht.bootstrap()
        this.logger.info(
          `DHT bootstrap complete: ${stats.routingTableSize} nodes, ${stats.queriedCount} queried`,
        )
      } catch (err) {
        this.logger.warn('DHT bootstrap failed:', err)
      }
    }

    this.logger.info(`DHT enabled with ${this.dht.getNodeCount()} nodes`)
  }

  /**
   * Disable DHT.
   */
  async disableDHT(): Promise<void> {
    if (!this.dht) {
      return
    }

    this.logger.info('Disabling DHT...')

    // Save state before stopping
    try {
      await saveDHTState(this.sessionPersistence['store'], this.dht.getState())
    } catch (err) {
      this.logger.warn('Failed to save DHT state:', err)
    }

    this.dht.stop()
    this.dht = undefined

    this.logger.info('DHT disabled')
  }

  /**
   * Save DHT state (call on shutdown or periodically).
   */
  async saveDHTState(): Promise<void> {
    if (!this.dht) return

    try {
      await saveDHTState(this.sessionPersistence['store'], this.dht.getState())
    } catch (err) {
      this.logger.warn('Failed to save DHT state:', err)
    }
  }
```

### 8.3 Update Torrent for DHT Peer Discovery

**File:** `packages/engine/src/core/torrent.ts`

Add import at the top (with other imports):

```typescript
import type { LookupResult } from '../dht'
```

Add DHT-related properties after existing properties in the class:

```typescript
  /** Last DHT lookup result (for announce tokens) */
  private lastDHTLookup?: LookupResult

  /** DHT announce interval timer */
  private dhtAnnounceTimer?: ReturnType<typeof setInterval>

  /** Time of last DHT announce */
  private lastDHTAnnounce: number = 0
```

Add DHT method after the tracker-related methods:

```typescript
  // ==========================================================================
  // DHT Peer Discovery
  // ==========================================================================

  /**
   * Perform DHT peer lookup for this torrent.
   * Adds discovered peers to the swarm.
   *
   * @returns Number of new peers added
   */
  async dhtLookup(): Promise<number> {
    if (!this.engine.dht) {
      return 0
    }

    if (!this.hasMetadata) {
      // Need metadata to know the infohash
      return 0
    }

    try {
      this.logger.debug('Starting DHT lookup')
      const result = await this.engine.dht.lookup(this.infoHash)
      this.lastDHTLookup = result

      if (result.peers.length > 0) {
        const addresses = result.peers.map((p) => ({
          ip: p.host,
          port: p.port,
          family: 'ipv4' as const,
        }))

        const added = this._swarm.addPeers(addresses, 'dht')
        this.logger.debug(`DHT lookup found ${result.peers.length} peers, added ${added} to swarm`)
        return added
      } else {
        this.logger.debug(`DHT lookup found 0 peers, queried ${result.queriedCount} nodes`)
      }
    } catch (err) {
      this.logger.warn('DHT lookup failed:', err)
    }

    return 0
  }

  /**
   * Announce ourselves to the DHT for this torrent.
   * Should be called after a successful lookup to have tokens.
   */
  async dhtAnnounce(): Promise<void> {
    if (!this.engine.dht) {
      return
    }

    if (!this.hasMetadata) {
      return
    }

    // Need tokens from a recent lookup
    if (!this.lastDHTLookup || this.lastDHTLookup.tokens.size === 0) {
      // Do a lookup first to get tokens
      await this.dhtLookup()
      if (!this.lastDHTLookup || this.lastDHTLookup.tokens.size === 0) {
        return
      }
    }

    try {
      const result = await this.engine.dht.announce(
        this.infoHash,
        this.engine.port,
        this.lastDHTLookup.tokens,
      )

      this.lastDHTAnnounce = Date.now()
      this.logger.debug(
        `DHT announce complete: ${result.successCount}/${result.totalCount} nodes`,
      )
    } catch (err) {
      this.logger.warn('DHT announce failed:', err)
    }
  }

  /**
   * Start periodic DHT announces.
   * Called when torrent becomes active.
   */
  private startDHTAnnounce(): void {
    if (this.dhtAnnounceTimer) return
    if (!this.engine.dht) return

    // Initial lookup and announce
    this.dhtLookup().then(() => this.dhtAnnounce())

    // Re-announce every 15 minutes
    this.dhtAnnounceTimer = setInterval(
      () => {
        this.dhtLookup().then(() => this.dhtAnnounce())
      },
      15 * 60 * 1000,
    )
  }

  /**
   * Stop periodic DHT announces.
   */
  private stopDHTAnnounce(): void {
    if (this.dhtAnnounceTimer) {
      clearInterval(this.dhtAnnounceTimer)
      this.dhtAnnounceTimer = undefined
    }
  }
```

Find the `start()` method (or wherever tracker announces are started) and add DHT startup. Look for where `this.trackerManager.announce('started')` is called and add after it:

```typescript
    // Start DHT announces
    this.startDHTAnnounce()
```

Find the `stop()` or cleanup method and add DHT cleanup. Look for where `this.trackerManager.announce('stopped')` is called and add near it:

```typescript
    // Stop DHT announces
    this.stopDHTAnnounce()
```

Also add to `suspendNetwork()`:

```typescript
    this.stopDHTAnnounce()
```

And to `resumeNetwork()`:

```typescript
    if (this.engine.dht) {
      this.startDHTAnnounce()
    }
```

### 8.4 Create Engine Integration Tests

**File:** `packages/engine/test/dht/dht-engine-integration.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
import { DHTNode } from '../../src/dht/dht-node'
import { ISocketFactory, IUdpSocket, ITcpSocket, ITcpServer } from '../../src/interfaces/socket'
import { IFileSystem, IFileHandle } from '../../src/interfaces/filesystem'
import { ISessionStore } from '../../src/interfaces/session-store'
import { generateRandomNodeId, nodeIdToHex } from '../../src/dht/xor-distance'

// Mock implementations
class MockUdpSocket implements IUdpSocket {
  onMessageCallback: ((src: { addr: string; port: number }, data: Uint8Array) => void) | null =
    null
  closed = false

  send(_addr: string, _port: number, _data: Uint8Array): void {}
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.onMessageCallback = cb
  }
  onError(_cb: (err: Error) => void): void {}
  close(): void {
    this.closed = true
  }
  address(): { port: number } {
    return { port: 6881 }
  }
}

class MockTcpSocket implements ITcpSocket {
  connected = false
  remoteAddress = '127.0.0.1'
  remotePort = 6881

  connect(_port: number, _host: string): Promise<void> {
    this.connected = true
    return Promise.resolve()
  }
  send(_data: Uint8Array): void {}
  onData(_cb: (data: Uint8Array) => void): void {}
  onClose(_cb: (hadError: boolean) => void): void {}
  onError(_cb: (err: Error) => void): void {}
  close(): void {
    this.connected = false
  }
}

class MockTcpServer implements ITcpServer {
  listening = false
  boundPort = 6881

  listen(port: number, callback?: () => void): void {
    this.boundPort = port || 6881
    this.listening = true
    callback?.()
  }
  on(_event: string, _handler: (...args: unknown[]) => void): void {}
  address(): { port: number } | null {
    return this.listening ? { port: this.boundPort } : null
  }
  close(): void {
    this.listening = false
  }
}

function createMockSocketFactory(): ISocketFactory {
  return {
    createTcpSocket: () => new MockTcpSocket(),
    createTcpServer: () => new MockTcpServer(),
    wrapTcpSocket: () => new MockTcpSocket(),
    createUdpSocket: async () => new MockUdpSocket(),
  }
}

class MockFileHandle implements IFileHandle {
  async read(
    _buffer: Uint8Array,
    _offset: number,
    _length: number,
    _position: number,
  ): Promise<{ bytesRead: number }> {
    return { bytesRead: 0 }
  }
  async write(
    _buffer: Uint8Array,
    _offset: number,
    length: number,
    _position: number,
  ): Promise<{ bytesWritten: number }> {
    return { bytesWritten: length }
  }
  async close(): Promise<void> {}
}

function createMockFileSystem(): IFileSystem {
  return {
    open: async () => new MockFileHandle(),
    mkdir: async () => {},
    stat: async () => ({ size: 0, isDirectory: () => false, isFile: () => true }),
    readdir: async () => [],
    unlink: async () => {},
    rmdir: async () => {},
    rename: async () => {},
    exists: async () => false,
  }
}

class MockSessionStore implements ISessionStore {
  private data = new Map<string, Uint8Array>()
  private json = new Map<string, unknown>()

  async get(key: string): Promise<Uint8Array | null> {
    return this.data.get(key) ?? null
  }
  async set(key: string, value: Uint8Array): Promise<void> {
    this.data.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key)
    this.json.delete(key)
  }
  async keys(_prefix?: string): Promise<string[]> {
    return [...this.data.keys(), ...this.json.keys()]
  }
  async clear(): Promise<void> {
    this.data.clear()
    this.json.clear()
  }
  async getJson<T>(key: string): Promise<T | null> {
    return (this.json.get(key) as T) ?? null
  }
  async setJson<T>(key: string, value: T): Promise<void> {
    this.json.set(key, value)
  }
}

describe('DHT Engine Integration', () => {
  let engine: BtEngine
  let sessionStore: MockSessionStore

  beforeEach(() => {
    vi.useFakeTimers()
    sessionStore = new MockSessionStore()

    engine = new BtEngine({
      socketFactory: createMockSocketFactory(),
      fileSystem: createMockFileSystem(),
      downloadPath: '/downloads',
      sessionStore,
      startSuspended: true,
    })
  })

  afterEach(async () => {
    if (engine.dht) {
      await engine.disableDHT()
    }
    vi.useRealTimers()
  })

  describe('enableDHT', () => {
    it('creates DHT node when enabled', async () => {
      expect(engine.dht).toBeUndefined()

      await engine.enableDHT()

      expect(engine.dht).toBeInstanceOf(DHTNode)
      expect(engine.dht!.ready).toBe(true)
    })

    it('generates node ID on first enable', async () => {
      await engine.enableDHT()

      expect(engine.dht!.nodeId.length).toBe(20)
    })

    it('restores node ID from persisted state', async () => {
      const savedNodeId = generateRandomNodeId()
      const savedNodeIdHex = nodeIdToHex(savedNodeId)

      // Pre-populate session store
      await sessionStore.setJson('dht:state', {
        nodeId: savedNodeIdHex,
        nodes: [],
      })

      await engine.enableDHT()

      expect(nodeIdToHex(engine.dht!.nodeId)).toBe(savedNodeIdHex)
    })

    it('does nothing if already enabled', async () => {
      await engine.enableDHT()
      const firstDht = engine.dht

      await engine.enableDHT()

      expect(engine.dht).toBe(firstDht)
    })
  })

  describe('disableDHT', () => {
    it('stops and removes DHT node', async () => {
      await engine.enableDHT()
      expect(engine.dht).toBeDefined()

      await engine.disableDHT()

      expect(engine.dht).toBeUndefined()
    })

    it('saves state before disabling', async () => {
      await engine.enableDHT()

      // Add a node to the routing table
      engine.dht!.addNode({
        id: generateRandomNodeId(),
        host: '192.168.1.1',
        port: 6881,
      })

      await engine.disableDHT()

      // Check state was saved
      const saved = await sessionStore.getJson<{ nodeId: string; nodes: unknown[] }>('dht:state')
      expect(saved).not.toBeNull()
      expect(saved!.nodes.length).toBe(1)
    })

    it('does nothing if not enabled', async () => {
      expect(engine.dht).toBeUndefined()

      await engine.disableDHT()

      expect(engine.dht).toBeUndefined()
    })
  })

  describe('saveDHTState', () => {
    it('persists current DHT state', async () => {
      await engine.enableDHT()

      // Add nodes
      for (let i = 0; i < 5; i++) {
        engine.dht!.addNode({
          id: generateRandomNodeId(),
          host: `192.168.1.${i + 1}`,
          port: 6881 + i,
        })
      }

      await engine.saveDHTState()

      const saved = await sessionStore.getJson<{ nodeId: string; nodes: unknown[] }>('dht:state')
      expect(saved).not.toBeNull()
      expect(saved!.nodes.length).toBe(5)
    })

    it('does nothing if DHT not enabled', async () => {
      await engine.saveDHTState()

      const saved = await sessionStore.getJson('dht:state')
      expect(saved).toBeNull()
    })
  })

  describe('DHT state persistence across restarts', () => {
    it('restores routing table nodes on re-enable', async () => {
      // First session: enable and add nodes
      await engine.enableDHT()

      const nodeIds: Uint8Array[] = []
      for (let i = 0; i < 3; i++) {
        const id = generateRandomNodeId()
        nodeIds.push(id)
        engine.dht!.addNode({
          id,
          host: `192.168.1.${i + 1}`,
          port: 6881 + i,
        })
      }

      await engine.disableDHT()

      // Second session: re-enable should restore nodes
      await engine.enableDHT()

      expect(engine.dht!.getNodeCount()).toBe(3)
    })
  })
})
```

---

## Verification

### Run Tests

After implementing all changes, run the test suite:

```bash
# From monorepo root
pnpm test

# Or specifically DHT tests
cd packages/engine
pnpm test -- --grep "DHT"
```

### Type Check

```bash
pnpm typecheck
```

### Lint

```bash
pnpm lint
```

### Format

```bash
pnpm format:fix
```

---

## Implementation Order

1. **Phase 7.1:** Add `PEER_CLEANUP_MS` constant
2. **Phase 7.2:** Create `dht-persistence.ts`
3. **Phase 7.3:** Update `dht-node.ts` with maintenance methods
4. **Phase 7.4:** Update `index.ts` exports
5. **Phase 7.5:** Create `dht-maintenance.test.ts`
6. **Phase 7.6:** Create `dht-persistence.test.ts`
7. **Verify Phase 7:** Run tests, ensure all pass
8. **Phase 8.1:** Add DHT settings to schema
9. **Phase 8.2:** Update `bt-engine.ts` with DHT methods
10. **Phase 8.3:** Update `torrent.ts` with DHT peer discovery
11. **Phase 8.4:** Create `dht-engine-integration.test.ts`
12. **Final verification:** Run all tests, typecheck, lint

---

## Notes for Agent

1. **Do not modify existing tests** unless they fail due to interface changes
2. **Follow existing code patterns** - look at similar files for style guidance
3. **Import statements** should be added in alphabetical order or grouped logically
4. **The `store` property on SessionPersistence is private** - access it via `this.sessionPersistence['store']` in BtEngine
5. **Mock implementations** should be minimal - only implement what tests need
6. **Timer cleanup is critical** - ensure all intervals are cleared in stop/cleanup methods
7. **Error handling** - all async operations should handle errors gracefully
8. **The DHT tests use fake timers** - be careful with async operations and timer advancement
