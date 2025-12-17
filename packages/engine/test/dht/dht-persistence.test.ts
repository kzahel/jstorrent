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
