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
 * Note: consecutiveFailures is intentionally not persisted - nodes start fresh
 * after restore since we don't know if the network has changed.
 */
export interface DHTPersistedState {
  /** Our node ID in hex */
  nodeId: string
  /** Nodes from routing table (id, host, port only - no failure counts) */
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
export async function saveDHTState(store: ISessionStore, state: RoutingTableState): Promise<void> {
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
export async function loadDHTState(store: ISessionStore): Promise<DHTPersistedState | null> {
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
