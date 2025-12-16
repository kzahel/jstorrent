# DHT Phase 3: Query Handlers (Server Side) - Agent Task

**Status:** Ready for implementation  
**Depends on:** Phase 1 (XOR Distance & Routing Table) ✅, Phase 2 (KRPC Protocol Layer) ✅  
**Goal:** Respond to incoming DHT queries from other nodes

---

## Overview

This phase implements the "server side" of DHT - responding to queries from other DHT nodes. When another node sends us a ping, find_node, get_peers, or announce_peer query, we need to respond appropriately.

**Key components:**
1. **TokenStore** - Generate and validate tokens for announce_peer authentication
2. **PeerStore** - Store peers by infohash with TTL-based expiration  
3. **QueryHandlers** - Process incoming queries and generate responses

---

## Files to Create

```
packages/engine/src/dht/
├── token-store.ts       # Token generation/validation
├── peer-store.ts        # Infohash → peers storage
└── query-handlers.ts    # Incoming query processing

packages/engine/test/dht/
├── token-store.test.ts
├── peer-store.test.ts
└── query-handlers.test.ts
```

---

## Phase 3.1: TokenStore

The token mechanism prevents malicious nodes from signing up other nodes for torrents they aren't downloading. From BEP 5:

> "The BitTorrent implementation uses the SHA1 hash of the IP address concatenated onto a secret that changes every five minutes and tokens up to ten minutes old are accepted."

### File: `packages/engine/src/dht/token-store.ts`

```typescript
/**
 * Token Store for DHT announce_peer validation.
 *
 * Tokens are generated as SHA1(secret + IP) and are valid for up to 10 minutes.
 * The secret rotates every 5 minutes, keeping the previous secret for validation.
 *
 * Reference: BEP 5 - "tokens up to ten minutes old are accepted"
 */

import { TOKEN_ROTATION_MS, TOKEN_MAX_AGE_MS } from './constants'

/**
 * Options for TokenStore.
 */
export interface TokenStoreOptions {
  /** Token rotation interval in ms (default: 5 minutes) */
  rotationMs?: number
  /** Maximum token age in ms (default: 10 minutes) */
  maxAgeMs?: number
  /** Custom hash function for testing (default: SHA1 via crypto.subtle) */
  hashFn?: (data: Uint8Array) => Promise<Uint8Array>
}

/**
 * Generates and validates tokens for announce_peer requests.
 */
export class TokenStore {
  private currentSecret: Uint8Array
  private previousSecret: Uint8Array | null = null
  private lastRotation: number
  private readonly rotationMs: number
  private readonly maxAgeMs: number
  private readonly hashFn: (data: Uint8Array) => Promise<Uint8Array>
  private rotationTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: TokenStoreOptions = {}) {
    this.rotationMs = options.rotationMs ?? TOKEN_ROTATION_MS
    this.maxAgeMs = options.maxAgeMs ?? TOKEN_MAX_AGE_MS
    this.hashFn = options.hashFn ?? defaultSha1
    this.currentSecret = this.generateSecret()
    this.lastRotation = Date.now()
  }

  /**
   * Start automatic token rotation.
   * Call this when the DHT node starts.
   */
  startRotation(): void {
    if (this.rotationTimer) return

    this.rotationTimer = setInterval(() => {
      this.rotate()
    }, this.rotationMs)
  }

  /**
   * Stop automatic token rotation.
   * Call this when the DHT node stops.
   */
  stopRotation(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer)
      this.rotationTimer = null
    }
  }

  /**
   * Generate a token for an IP address.
   * The token is SHA1(secret + IP).
   *
   * @param ip - IPv4 address string (e.g., "192.168.1.1")
   * @returns Token as Uint8Array
   */
  async generate(ip: string): Promise<Uint8Array> {
    return this.hashWithSecret(ip, this.currentSecret)
  }

  /**
   * Validate a token for an IP address.
   * Accepts tokens generated with current or previous secret.
   *
   * @param ip - IPv4 address string
   * @param token - Token to validate
   * @returns true if token is valid
   */
  async validate(ip: string, token: Uint8Array): Promise<boolean> {
    // Check against current secret
    const currentToken = await this.hashWithSecret(ip, this.currentSecret)
    if (this.tokensEqual(currentToken, token)) {
      return true
    }

    // Check against previous secret (if within max age)
    if (this.previousSecret && Date.now() - this.lastRotation < this.maxAgeMs) {
      const previousToken = await this.hashWithSecret(ip, this.previousSecret)
      if (this.tokensEqual(previousToken, token)) {
        return true
      }
    }

    return false
  }

  /**
   * Manually rotate the secret.
   * Called automatically by startRotation(), but can be called manually for testing.
   */
  rotate(): void {
    this.previousSecret = this.currentSecret
    this.currentSecret = this.generateSecret()
    this.lastRotation = Date.now()
  }

  /**
   * Generate a random 32-byte secret.
   */
  private generateSecret(): Uint8Array {
    const secret = new Uint8Array(32)
    crypto.getRandomValues(secret)
    return secret
  }

  /**
   * Hash IP with secret: SHA1(secret + IP bytes)
   */
  private async hashWithSecret(ip: string, secret: Uint8Array): Promise<Uint8Array> {
    const ipBytes = this.ipToBytes(ip)
    const combined = new Uint8Array(secret.length + ipBytes.length)
    combined.set(secret, 0)
    combined.set(ipBytes, secret.length)
    return this.hashFn(combined)
  }

  /**
   * Convert IPv4 string to 4 bytes.
   */
  private ipToBytes(ip: string): Uint8Array {
    const parts = ip.split('.')
    if (parts.length !== 4) {
      // Invalid IP - use zeros (will still produce consistent token)
      return new Uint8Array(4)
    }
    return new Uint8Array(parts.map((p) => parseInt(p, 10) || 0))
  }

  /**
   * Compare two tokens for equality.
   */
  private tokensEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
}

/**
 * Default SHA1 implementation using Web Crypto API.
 */
async function defaultSha1(data: Uint8Array): Promise<Uint8Array> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer)
    return new Uint8Array(hashBuffer)
  }
  throw new Error('crypto.subtle not available')
}
```

### Test File: `packages/engine/test/dht/token-store.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenStore } from '../../src/dht/token-store'

// Simple mock hash function for deterministic testing
function createMockHash(): (data: Uint8Array) => Promise<Uint8Array> {
  return async (data: Uint8Array) => {
    // Simple hash: sum all bytes mod 256, repeated 20 times
    let sum = 0
    for (const byte of data) {
      sum = (sum + byte) % 256
    }
    return new Uint8Array(20).fill(sum)
  }
}

describe('TokenStore', () => {
  let store: TokenStore

  beforeEach(() => {
    vi.useFakeTimers()
    store = new TokenStore({
      rotationMs: 5 * 60 * 1000, // 5 minutes
      maxAgeMs: 10 * 60 * 1000, // 10 minutes
      hashFn: createMockHash(),
    })
  })

  afterEach(() => {
    store.stopRotation()
    vi.useRealTimers()
  })

  describe('generate', () => {
    it('generates consistent token for same IP', async () => {
      const token1 = await store.generate('192.168.1.1')
      const token2 = await store.generate('192.168.1.1')

      expect(token1).toEqual(token2)
    })

    it('generates different tokens for different IPs', async () => {
      const token1 = await store.generate('192.168.1.1')
      const token2 = await store.generate('192.168.1.2')

      expect(token1).not.toEqual(token2)
    })

    it('returns 20-byte token', async () => {
      const token = await store.generate('10.0.0.1')

      expect(token.length).toBe(20)
    })
  })

  describe('validate', () => {
    it('validates token within current secret', async () => {
      const token = await store.generate('192.168.1.1')
      const isValid = await store.validate('192.168.1.1', token)

      expect(isValid).toBe(true)
    })

    it('validates token from previous secret within max age', async () => {
      const token = await store.generate('192.168.1.1')

      // Rotate secret
      store.rotate()

      // Token should still be valid (within 10 minutes)
      const isValid = await store.validate('192.168.1.1', token)
      expect(isValid).toBe(true)
    })

    it('rejects token after two rotations', async () => {
      const token = await store.generate('192.168.1.1')

      // First rotation - token still valid
      store.rotate()
      expect(await store.validate('192.168.1.1', token)).toBe(true)

      // Second rotation - previous secret is now two generations old
      store.rotate()
      expect(await store.validate('192.168.1.1', token)).toBe(false)
    })

    it('rejects token for wrong IP', async () => {
      const token = await store.generate('192.168.1.1')
      const isValid = await store.validate('192.168.1.2', token)

      expect(isValid).toBe(false)
    })

    it('rejects garbage token', async () => {
      const garbage = new Uint8Array(20).fill(0xff)
      const isValid = await store.validate('192.168.1.1', garbage)

      expect(isValid).toBe(false)
    })

    it('rejects empty token', async () => {
      const isValid = await store.validate('192.168.1.1', new Uint8Array(0))

      expect(isValid).toBe(false)
    })
  })

  describe('rotate', () => {
    it('changes current secret', async () => {
      const tokenBefore = await store.generate('192.168.1.1')
      store.rotate()
      const tokenAfter = await store.generate('192.168.1.1')

      // Tokens should be different after rotation
      expect(tokenBefore).not.toEqual(tokenAfter)
    })

    it('preserves previous secret for validation', async () => {
      const oldToken = await store.generate('192.168.1.1')
      store.rotate()

      // Old token still valid
      expect(await store.validate('192.168.1.1', oldToken)).toBe(true)

      // New token also valid
      const newToken = await store.generate('192.168.1.1')
      expect(await store.validate('192.168.1.1', newToken)).toBe(true)
    })
  })

  describe('automatic rotation', () => {
    it('rotates automatically after interval', async () => {
      store.startRotation()

      const tokenBefore = await store.generate('192.168.1.1')

      // Advance time past rotation interval
      vi.advanceTimersByTime(5 * 60 * 1000 + 100)

      const tokenAfter = await store.generate('192.168.1.1')

      expect(tokenBefore).not.toEqual(tokenAfter)
    })

    it('stops rotation when requested', async () => {
      store.startRotation()
      const tokenBefore = await store.generate('192.168.1.1')

      store.stopRotation()

      // Advance time past multiple rotation intervals
      vi.advanceTimersByTime(20 * 60 * 1000)

      const tokenAfter = await store.generate('192.168.1.1')

      // Should be the same since rotation stopped
      expect(tokenBefore).toEqual(tokenAfter)
    })
  })

  describe('edge cases', () => {
    it('handles invalid IP gracefully', async () => {
      // Should not throw, just produce a token
      const token = await store.generate('invalid')
      expect(token.length).toBe(20)
    })

    it('handles IPv6-like strings gracefully', async () => {
      // Should not throw
      const token = await store.generate('::1')
      expect(token.length).toBe(20)
    })
  })
})
```

---

## Phase 3.2: PeerStore

Stores peers for each infohash. When a node announces itself, we store it. When another node asks for peers, we return what we have.

### File: `packages/engine/src/dht/peer-store.ts`

```typescript
/**
 * Peer Store for DHT
 *
 * Stores peer contact information by infohash.
 * Peers expire after a TTL and are capped per infohash to prevent memory exhaustion.
 *
 * Reference: BEP 5 - "the queried node should store the IP address of the querying
 * node and the supplied port number under the infohash in its store of peer contact information"
 */

import { CompactPeer } from './types'

/**
 * Default peer TTL: 30 minutes.
 * Peers should re-announce periodically; if they don't, they're probably gone.
 */
export const DEFAULT_PEER_TTL_MS = 30 * 60 * 1000

/**
 * Default max peers per infohash.
 * Prevents memory exhaustion from popular torrents.
 */
export const DEFAULT_MAX_PEERS_PER_INFOHASH = 100

/**
 * Default max infohashes to track.
 * Prevents memory exhaustion from many different torrents.
 */
export const DEFAULT_MAX_INFOHASHES = 10000

/**
 * Options for PeerStore.
 */
export interface PeerStoreOptions {
  /** Peer TTL in ms (default: 30 minutes) */
  peerTtlMs?: number
  /** Max peers per infohash (default: 100) */
  maxPeersPerInfohash?: number
  /** Max infohashes to track (default: 10000) */
  maxInfohashes?: number
}

/**
 * Internal peer entry with timestamp.
 */
interface PeerEntry {
  host: string
  port: number
  addedAt: number
}

/**
 * Stores peers by infohash with TTL expiration.
 */
export class PeerStore {
  /** Map of infohash (hex) → peer entries */
  private store: Map<string, PeerEntry[]> = new Map()

  private readonly peerTtlMs: number
  private readonly maxPeersPerInfohash: number
  private readonly maxInfohashes: number

  constructor(options: PeerStoreOptions = {}) {
    this.peerTtlMs = options.peerTtlMs ?? DEFAULT_PEER_TTL_MS
    this.maxPeersPerInfohash = options.maxPeersPerInfohash ?? DEFAULT_MAX_PEERS_PER_INFOHASH
    this.maxInfohashes = options.maxInfohashes ?? DEFAULT_MAX_INFOHASHES
  }

  /**
   * Add a peer for an infohash.
   * If the peer already exists, updates its timestamp.
   *
   * @param infoHash - 20-byte infohash
   * @param peer - Peer contact info
   */
  addPeer(infoHash: Uint8Array, peer: CompactPeer): void {
    const key = this.hashToKey(infoHash)
    let peers = this.store.get(key)

    if (!peers) {
      // Check if we're at max infohashes
      if (this.store.size >= this.maxInfohashes) {
        // Evict oldest infohash (first entry in map)
        const oldestKey = this.store.keys().next().value
        if (oldestKey) {
          this.store.delete(oldestKey)
        }
      }

      peers = []
      this.store.set(key, peers)
    }

    // Check if peer already exists
    const existing = peers.find((p) => p.host === peer.host && p.port === peer.port)

    if (existing) {
      // Update timestamp
      existing.addedAt = Date.now()
    } else {
      // Add new peer
      if (peers.length >= this.maxPeersPerInfohash) {
        // Remove oldest peer
        peers.shift()
      }

      peers.push({
        host: peer.host,
        port: peer.port,
        addedAt: Date.now(),
      })
    }
  }

  /**
   * Get peers for an infohash.
   * Returns only non-expired peers.
   *
   * @param infoHash - 20-byte infohash
   * @returns Array of peers (may be empty)
   */
  getPeers(infoHash: Uint8Array): CompactPeer[] {
    const key = this.hashToKey(infoHash)
    const peers = this.store.get(key)

    if (!peers) {
      return []
    }

    const now = Date.now()
    const validPeers: CompactPeer[] = []

    for (const peer of peers) {
      if (now - peer.addedAt < this.peerTtlMs) {
        validPeers.push({ host: peer.host, port: peer.port })
      }
    }

    return validPeers
  }

  /**
   * Check if we have any peers for an infohash.
   *
   * @param infoHash - 20-byte infohash
   * @returns true if we have at least one non-expired peer
   */
  hasPeers(infoHash: Uint8Array): boolean {
    return this.getPeers(infoHash).length > 0
  }

  /**
   * Remove expired peers from all infohashes.
   * Call this periodically to free memory.
   */
  cleanup(): void {
    const now = Date.now()

    for (const [key, peers] of this.store.entries()) {
      // Filter out expired peers
      const validPeers = peers.filter((p) => now - p.addedAt < this.peerTtlMs)

      if (validPeers.length === 0) {
        // Remove empty infohash entry
        this.store.delete(key)
      } else if (validPeers.length !== peers.length) {
        // Update with filtered list
        this.store.set(key, validPeers)
      }
    }
  }

  /**
   * Get the number of infohashes being tracked.
   */
  infohashCount(): number {
    return this.store.size
  }

  /**
   * Get the total number of peers stored (including possibly expired).
   */
  totalPeerCount(): number {
    let count = 0
    for (const peers of this.store.values()) {
      count += peers.length
    }
    return count
  }

  /**
   * Clear all stored peers.
   */
  clear(): void {
    this.store.clear()
  }

  /**
   * Convert infohash to map key.
   */
  private hashToKey(infoHash: Uint8Array): string {
    return Array.from(infoHash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
```

### Test File: `packages/engine/test/dht/peer-store.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PeerStore } from '../../src/dht/peer-store'

describe('PeerStore', () => {
  let store: PeerStore
  const infoHash1 = new Uint8Array(20).fill(0x11)
  const infoHash2 = new Uint8Array(20).fill(0x22)

  beforeEach(() => {
    vi.useFakeTimers()
    store = new PeerStore({
      peerTtlMs: 30 * 60 * 1000, // 30 minutes
      maxPeersPerInfohash: 5,
      maxInfohashes: 10,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('addPeer', () => {
    it('stores peer by infohash', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })

      const peers = store.getPeers(infoHash1)
      expect(peers).toHaveLength(1)
      expect(peers[0]).toEqual({ host: '192.168.1.1', port: 6881 })
    })

    it('stores multiple peers for same infohash', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      store.addPeer(infoHash1, { host: '192.168.1.2', port: 6882 })

      const peers = store.getPeers(infoHash1)
      expect(peers).toHaveLength(2)
    })

    it('separates peers by infohash', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      store.addPeer(infoHash2, { host: '192.168.1.2', port: 6882 })

      expect(store.getPeers(infoHash1)).toHaveLength(1)
      expect(store.getPeers(infoHash2)).toHaveLength(1)
      expect(store.getPeers(infoHash1)[0].host).toBe('192.168.1.1')
      expect(store.getPeers(infoHash2)[0].host).toBe('192.168.1.2')
    })

    it('deduplicates identical peers', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })

      const peers = store.getPeers(infoHash1)
      expect(peers).toHaveLength(1)
    })

    it('updates timestamp for existing peer', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })

      // Advance time close to TTL
      vi.advanceTimersByTime(29 * 60 * 1000)

      // Re-add same peer (updates timestamp)
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })

      // Advance time past original TTL
      vi.advanceTimersByTime(5 * 60 * 1000)

      // Peer should still be valid (timestamp was updated)
      const peers = store.getPeers(infoHash1)
      expect(peers).toHaveLength(1)
    })

    it('caps peers per infohash', () => {
      for (let i = 0; i < 10; i++) {
        store.addPeer(infoHash1, { host: `192.168.1.${i}`, port: 6881 + i })
      }

      const peers = store.getPeers(infoHash1)
      expect(peers).toHaveLength(5) // maxPeersPerInfohash
    })

    it('evicts oldest peer when at capacity', () => {
      store.addPeer(infoHash1, { host: '192.168.1.0', port: 6880 }) // Will be evicted

      for (let i = 1; i <= 5; i++) {
        store.addPeer(infoHash1, { host: `192.168.1.${i}`, port: 6881 + i })
      }

      const peers = store.getPeers(infoHash1)
      expect(peers).toHaveLength(5)
      // First peer should have been evicted
      expect(peers.find((p) => p.host === '192.168.1.0')).toBeUndefined()
    })
  })

  describe('getPeers', () => {
    it('returns empty array for unknown infohash', () => {
      const peers = store.getPeers(new Uint8Array(20).fill(0xff))
      expect(peers).toEqual([])
    })

    it('filters out expired peers', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })

      // Advance time past TTL
      vi.advanceTimersByTime(31 * 60 * 1000)

      const peers = store.getPeers(infoHash1)
      expect(peers).toHaveLength(0)
    })

    it('returns mix of valid and filters expired', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 }) // Will expire

      vi.advanceTimersByTime(20 * 60 * 1000)

      store.addPeer(infoHash1, { host: '192.168.1.2', port: 6882 }) // Still valid

      vi.advanceTimersByTime(15 * 60 * 1000) // Total: 35 min

      const peers = store.getPeers(infoHash1)
      expect(peers).toHaveLength(1)
      expect(peers[0].host).toBe('192.168.1.2')
    })
  })

  describe('hasPeers', () => {
    it('returns false for unknown infohash', () => {
      expect(store.hasPeers(infoHash1)).toBe(false)
    })

    it('returns true when peers exist', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      expect(store.hasPeers(infoHash1)).toBe(true)
    })

    it('returns false when all peers expired', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      vi.advanceTimersByTime(31 * 60 * 1000)
      expect(store.hasPeers(infoHash1)).toBe(false)
    })
  })

  describe('cleanup', () => {
    it('removes expired peers', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })

      vi.advanceTimersByTime(31 * 60 * 1000)

      store.cleanup()

      expect(store.totalPeerCount()).toBe(0)
    })

    it('removes empty infohash entries', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })

      vi.advanceTimersByTime(31 * 60 * 1000)

      store.cleanup()

      expect(store.infohashCount()).toBe(0)
    })

    it('preserves valid peers', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      store.addPeer(infoHash1, { host: '192.168.1.2', port: 6882 })

      vi.advanceTimersByTime(10 * 60 * 1000) // Only 10 minutes

      store.cleanup()

      expect(store.getPeers(infoHash1)).toHaveLength(2)
    })
  })

  describe('infohashCount', () => {
    it('returns count of tracked infohashes', () => {
      expect(store.infohashCount()).toBe(0)

      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      expect(store.infohashCount()).toBe(1)

      store.addPeer(infoHash2, { host: '192.168.1.2', port: 6882 })
      expect(store.infohashCount()).toBe(2)
    })

    it('caps infohashes at maxInfohashes', () => {
      for (let i = 0; i < 15; i++) {
        const hash = new Uint8Array(20).fill(i)
        store.addPeer(hash, { host: '192.168.1.1', port: 6881 })
      }

      expect(store.infohashCount()).toBe(10) // maxInfohashes
    })
  })

  describe('totalPeerCount', () => {
    it('returns total peers across all infohashes', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      store.addPeer(infoHash1, { host: '192.168.1.2', port: 6882 })
      store.addPeer(infoHash2, { host: '192.168.1.3', port: 6883 })

      expect(store.totalPeerCount()).toBe(3)
    })
  })

  describe('clear', () => {
    it('removes all peers', () => {
      store.addPeer(infoHash1, { host: '192.168.1.1', port: 6881 })
      store.addPeer(infoHash2, { host: '192.168.1.2', port: 6882 })

      store.clear()

      expect(store.infohashCount()).toBe(0)
      expect(store.totalPeerCount()).toBe(0)
    })
  })
})
```

---

## Phase 3.3: QueryHandlers

Processes incoming KRPC queries and generates appropriate responses.

### File: `packages/engine/src/dht/query-handlers.ts`

```typescript
/**
 * DHT Query Handlers
 *
 * Processes incoming KRPC queries (ping, find_node, get_peers, announce_peer)
 * and generates appropriate responses.
 *
 * Reference: BEP 5 - DHT Queries section
 */

import { RoutingTable } from './routing-table'
import { TokenStore } from './token-store'
import { PeerStore } from './peer-store'
import { KRPCSocket } from './krpc-socket'
import {
  KRPCQuery,
  KRPCErrorCode,
  encodePingResponse,
  encodeFindNodeResponse,
  encodeGetPeersResponseWithPeers,
  encodeGetPeersResponseWithNodes,
  encodeAnnouncePeerResponse,
  encodeErrorResponse,
  getQueryNodeId,
  getQueryTarget,
  getQueryInfoHash,
  getQueryToken,
  getQueryPort,
  getQueryImpliedPort,
} from './krpc-messages'
import { DHTNode } from './types'
import { K, NODE_ID_BYTES } from './constants'

/**
 * Query handler result.
 */
export interface QueryHandlerResult {
  /** Response data to send */
  response: Uint8Array
  /** Node to add to routing table (if any) */
  node?: DHTNode
}

/**
 * Dependencies for query handlers.
 */
export interface QueryHandlerDeps {
  /** Our node ID */
  nodeId: Uint8Array
  /** Routing table for finding closest nodes */
  routingTable: RoutingTable
  /** Token store for announce validation */
  tokenStore: TokenStore
  /** Peer store for storing/retrieving peers */
  peerStore: PeerStore
}

/**
 * Handle an incoming ping query.
 *
 * @param query - The ping query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function handlePing(
  query: KRPCQuery,
  _rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  const nodeId = getQueryNodeId(query)

  // Validate query
  if (!nodeId) {
    return {
      response: encodeErrorResponse(query.t, KRPCErrorCode.PROTOCOL, 'Invalid ping: missing id'),
    }
  }

  // Build response
  const response = encodePingResponse(query.t, deps.nodeId)

  // Return node for routing table
  return {
    response,
    node: nodeId
      ? {
          id: nodeId,
          host: _rinfo.host,
          port: _rinfo.port,
        }
      : undefined,
  }
}

/**
 * Handle an incoming find_node query.
 *
 * @param query - The find_node query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function handleFindNode(
  query: KRPCQuery,
  rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  const nodeId = getQueryNodeId(query)
  const target = getQueryTarget(query)

  // Validate query
  if (!nodeId || !target) {
    return {
      response: encodeErrorResponse(
        query.t,
        KRPCErrorCode.PROTOCOL,
        'Invalid find_node: missing id or target',
      ),
    }
  }

  // Find closest nodes to target
  const closestNodes = deps.routingTable.closest(target, K)

  // Build response
  const response = encodeFindNodeResponse(query.t, deps.nodeId, closestNodes)

  return {
    response,
    node: {
      id: nodeId,
      host: rinfo.host,
      port: rinfo.port,
    },
  }
}

/**
 * Handle an incoming get_peers query.
 *
 * @param query - The get_peers query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function handleGetPeers(
  query: KRPCQuery,
  rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  const nodeId = getQueryNodeId(query)
  const infoHash = getQueryInfoHash(query)

  // Validate query
  if (!nodeId || !infoHash) {
    return {
      response: encodeErrorResponse(
        query.t,
        KRPCErrorCode.PROTOCOL,
        'Invalid get_peers: missing id or info_hash',
      ),
    }
  }

  // Generate token for this IP
  const token = await deps.tokenStore.generate(rinfo.host)

  // Check if we have peers for this infohash
  const peers = deps.peerStore.getPeers(infoHash)

  let response: Uint8Array
  if (peers.length > 0) {
    // Return peers
    response = encodeGetPeersResponseWithPeers(query.t, deps.nodeId, token, peers)
  } else {
    // Return closest nodes
    const closestNodes = deps.routingTable.closest(infoHash, K)
    response = encodeGetPeersResponseWithNodes(query.t, deps.nodeId, token, closestNodes)
  }

  return {
    response,
    node: {
      id: nodeId,
      host: rinfo.host,
      port: rinfo.port,
    },
  }
}

/**
 * Handle an incoming announce_peer query.
 *
 * @param query - The announce_peer query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function handleAnnouncePeer(
  query: KRPCQuery,
  rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  const nodeId = getQueryNodeId(query)
  const infoHash = getQueryInfoHash(query)
  const token = getQueryToken(query)
  const port = getQueryPort(query)
  const impliedPort = getQueryImpliedPort(query)

  // Validate query
  if (!nodeId || !infoHash || !token) {
    return {
      response: encodeErrorResponse(
        query.t,
        KRPCErrorCode.PROTOCOL,
        'Invalid announce_peer: missing required fields',
      ),
    }
  }

  // Validate token
  const isValidToken = await deps.tokenStore.validate(rinfo.host, token)
  if (!isValidToken) {
    return {
      response: encodeErrorResponse(query.t, KRPCErrorCode.PROTOCOL, 'Invalid token'),
    }
  }

  // Determine peer port
  let peerPort: number
  if (impliedPort) {
    // Use UDP source port
    peerPort = rinfo.port
  } else {
    // Use specified port
    if (!port) {
      return {
        response: encodeErrorResponse(
          query.t,
          KRPCErrorCode.PROTOCOL,
          'Invalid announce_peer: missing port',
        ),
      }
    }
    peerPort = port
  }

  // Store the peer
  deps.peerStore.addPeer(infoHash, { host: rinfo.host, port: peerPort })

  // Build response
  const response = encodeAnnouncePeerResponse(query.t, deps.nodeId)

  return {
    response,
    node: {
      id: nodeId,
      host: rinfo.host,
      port: rinfo.port,
    },
  }
}

/**
 * Handle unknown query method.
 *
 * @param query - The unknown query
 * @returns Error response
 */
export function handleUnknownMethod(query: KRPCQuery): QueryHandlerResult {
  return {
    response: encodeErrorResponse(
      query.t,
      KRPCErrorCode.METHOD_UNKNOWN,
      `Unknown method: ${query.q}`,
    ),
  }
}

/**
 * Route a query to the appropriate handler.
 *
 * @param query - The incoming query
 * @param rinfo - Remote address info
 * @param deps - Handler dependencies
 * @returns Response to send
 */
export async function routeQuery(
  query: KRPCQuery,
  rinfo: { host: string; port: number },
  deps: QueryHandlerDeps,
): Promise<QueryHandlerResult> {
  switch (query.q) {
    case 'ping':
      return handlePing(query, rinfo, deps)
    case 'find_node':
      return handleFindNode(query, rinfo, deps)
    case 'get_peers':
      return handleGetPeers(query, rinfo, deps)
    case 'announce_peer':
      return handleAnnouncePeer(query, rinfo, deps)
    default:
      return handleUnknownMethod(query)
  }
}

/**
 * Create a query handler that can be attached to a KRPCSocket.
 *
 * @param socket - The KRPC socket to send responses on
 * @param deps - Handler dependencies
 * @returns Event handler function for 'query' events
 */
export function createQueryHandler(
  socket: KRPCSocket,
  deps: QueryHandlerDeps,
): (query: KRPCQuery, rinfo: { host: string; port: number }) => void {
  return async (query: KRPCQuery, rinfo: { host: string; port: number }) => {
    try {
      const result = await routeQuery(query, rinfo, deps)

      // Send response
      socket.send(rinfo.host, rinfo.port, result.response)

      // Add node to routing table if valid
      if (result.node && result.node.id.length === NODE_ID_BYTES) {
        deps.routingTable.addNode(result.node)
      }
    } catch (err) {
      // Send generic error on unexpected failure
      const errorResponse = encodeErrorResponse(
        query.t,
        KRPCErrorCode.SERVER,
        'Internal server error',
      )
      socket.send(rinfo.host, rinfo.port, errorResponse)
    }
  }
}
```

### Test File: `packages/engine/test/dht/query-handlers.test.ts`

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  handlePing,
  handleFindNode,
  handleGetPeers,
  handleAnnouncePeer,
  handleUnknownMethod,
  routeQuery,
  createQueryHandler,
  QueryHandlerDeps,
} from '../../src/dht/query-handlers'
import { RoutingTable } from '../../src/dht/routing-table'
import { TokenStore } from '../../src/dht/token-store'
import { PeerStore } from '../../src/dht/peer-store'
import { KRPCSocket } from '../../src/dht/krpc-socket'
import {
  KRPCQuery,
  decodeMessage,
  isResponse,
  isError,
  getResponseNodeId,
  getResponseNodes,
  getResponsePeers,
  getResponseToken,
} from '../../src/dht/krpc-messages'
import { NODE_ID_BYTES } from '../../src/dht/constants'
import { IUdpSocket, ISocketFactory } from '../../src/interfaces/socket'

// Mock hash function
const mockHashFn = async (data: Uint8Array): Promise<Uint8Array> => {
  let sum = 0
  for (const byte of data) {
    sum = (sum + byte) % 256
  }
  return new Uint8Array(20).fill(sum)
}

// Test fixtures
const localNodeId = new Uint8Array(NODE_ID_BYTES).fill(0x11)
const remoteNodeId = new Uint8Array(NODE_ID_BYTES).fill(0x22)
const targetId = new Uint8Array(NODE_ID_BYTES).fill(0x33)
const infoHash = new Uint8Array(NODE_ID_BYTES).fill(0x44)

function createMockQuery(method: string, args: Record<string, unknown>): KRPCQuery {
  return {
    t: new Uint8Array([0xaa, 0xbb]),
    y: 'q',
    q: method,
    a: args,
  }
}

function createDeps(): QueryHandlerDeps {
  return {
    nodeId: localNodeId,
    routingTable: new RoutingTable(localNodeId),
    tokenStore: new TokenStore({ hashFn: mockHashFn }),
    peerStore: new PeerStore(),
  }
}

describe('QueryHandlers', () => {
  let deps: QueryHandlerDeps
  const rinfo = { host: '192.168.1.100', port: 6881 }

  beforeEach(() => {
    deps = createDeps()
  })

  describe('handlePing', () => {
    it('responds with own node ID', async () => {
      const query = createMockQuery('ping', { id: remoteNodeId })

      const result = await handlePing(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(msg).not.toBeNull()
      expect(isResponse(msg!)).toBe(true)
      expect(getResponseNodeId(msg as any)).toEqual(localNodeId)
    })

    it('returns node for routing table', async () => {
      const query = createMockQuery('ping', { id: remoteNodeId })

      const result = await handlePing(query, rinfo, deps)

      expect(result.node).toBeDefined()
      expect(result.node!.id).toEqual(remoteNodeId)
      expect(result.node!.host).toBe(rinfo.host)
      expect(result.node!.port).toBe(rinfo.port)
    })

    it('returns error for missing id', async () => {
      const query = createMockQuery('ping', {})

      const result = await handlePing(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
      expect((msg as any).e[0]).toBe(203) // PROTOCOL error
    })
  })

  describe('handleFindNode', () => {
    it('responds with closest nodes from routing table', async () => {
      // Add some nodes to routing table
      const nodes = [
        { id: new Uint8Array(20).fill(0x30), host: '10.0.0.1', port: 6881 },
        { id: new Uint8Array(20).fill(0x31), host: '10.0.0.2', port: 6882 },
        { id: new Uint8Array(20).fill(0x32), host: '10.0.0.3', port: 6883 },
      ]
      for (const node of nodes) {
        deps.routingTable.addNode(node)
      }

      const query = createMockQuery('find_node', { id: remoteNodeId, target: targetId })

      const result = await handleFindNode(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
      expect(getResponseNodeId(msg as any)).toEqual(localNodeId)

      const responseNodes = getResponseNodes(msg as any)
      expect(responseNodes.length).toBeGreaterThan(0)
    })

    it('returns node for routing table', async () => {
      const query = createMockQuery('find_node', { id: remoteNodeId, target: targetId })

      const result = await handleFindNode(query, rinfo, deps)

      expect(result.node).toBeDefined()
      expect(result.node!.id).toEqual(remoteNodeId)
    })

    it('returns error for missing target', async () => {
      const query = createMockQuery('find_node', { id: remoteNodeId })

      const result = await handleFindNode(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
    })
  })

  describe('handleGetPeers', () => {
    it('responds with token', async () => {
      const query = createMockQuery('get_peers', { id: remoteNodeId, info_hash: infoHash })

      const result = await handleGetPeers(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
      expect(getResponseToken(msg as any)).not.toBeNull()
    })

    it('responds with peers when known', async () => {
      // Add some peers to peer store
      deps.peerStore.addPeer(infoHash, { host: '10.0.0.1', port: 6881 })
      deps.peerStore.addPeer(infoHash, { host: '10.0.0.2', port: 6882 })

      const query = createMockQuery('get_peers', { id: remoteNodeId, info_hash: infoHash })

      const result = await handleGetPeers(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)

      const peers = getResponsePeers(msg as any)
      expect(peers.length).toBe(2)
    })

    it('responds with closest nodes when no peers', async () => {
      // Add nodes to routing table but no peers
      deps.routingTable.addNode({
        id: new Uint8Array(20).fill(0x50),
        host: '10.0.0.1',
        port: 6881,
      })

      const query = createMockQuery('get_peers', { id: remoteNodeId, info_hash: infoHash })

      const result = await handleGetPeers(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)

      const peers = getResponsePeers(msg as any)
      expect(peers.length).toBe(0)

      const nodes = getResponseNodes(msg as any)
      expect(nodes.length).toBeGreaterThan(0)
    })

    it('returns error for missing info_hash', async () => {
      const query = createMockQuery('get_peers', { id: remoteNodeId })

      const result = await handleGetPeers(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
    })
  })

  describe('handleAnnouncePeer', () => {
    it('stores peer on valid announce', async () => {
      // First get a valid token
      const token = await deps.tokenStore.generate(rinfo.host)

      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881,
        token: token,
      })

      const result = await handleAnnouncePeer(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)

      // Verify peer was stored
      const peers = deps.peerStore.getPeers(infoHash)
      expect(peers.length).toBe(1)
      expect(peers[0].host).toBe(rinfo.host)
      expect(peers[0].port).toBe(6881)
    })

    it('uses UDP source port with implied_port', async () => {
      const token = await deps.tokenStore.generate(rinfo.host)

      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881, // Should be ignored
        implied_port: 1,
        token: token,
      })

      const result = await handleAnnouncePeer(query, { host: rinfo.host, port: 12345 }, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)

      // Verify peer was stored with source port
      const peers = deps.peerStore.getPeers(infoHash)
      expect(peers[0].port).toBe(12345)
    })

    it('rejects invalid token with error 203', async () => {
      const invalidToken = new Uint8Array(20).fill(0xff)

      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881,
        token: invalidToken,
      })

      const result = await handleAnnouncePeer(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
      expect((msg as any).e[0]).toBe(203) // PROTOCOL error
    })

    it('rejects missing token', async () => {
      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881,
      })

      const result = await handleAnnouncePeer(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
    })

    it('rejects missing port when implied_port not set', async () => {
      const token = await deps.tokenStore.generate(rinfo.host)

      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        token: token,
        // No port and no implied_port
      })

      const result = await handleAnnouncePeer(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
    })
  })

  describe('handleUnknownMethod', () => {
    it('returns error 204 for unknown method', () => {
      const query = createMockQuery('unknown_method', { id: remoteNodeId })

      const result = handleUnknownMethod(query)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
      expect((msg as any).e[0]).toBe(204) // METHOD_UNKNOWN
    })
  })

  describe('routeQuery', () => {
    it('routes ping to handlePing', async () => {
      const query = createMockQuery('ping', { id: remoteNodeId })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
    })

    it('routes find_node to handleFindNode', async () => {
      const query = createMockQuery('find_node', { id: remoteNodeId, target: targetId })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
    })

    it('routes get_peers to handleGetPeers', async () => {
      const query = createMockQuery('get_peers', { id: remoteNodeId, info_hash: infoHash })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
    })

    it('routes announce_peer to handleAnnouncePeer', async () => {
      const token = await deps.tokenStore.generate(rinfo.host)
      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881,
        token: token,
      })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
    })

    it('routes unknown method to handleUnknownMethod', async () => {
      const query = createMockQuery('foobar', { id: remoteNodeId })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
      expect((msg as any).e[0]).toBe(204)
    })
  })

  describe('createQueryHandler', () => {
    // Mock UDP socket
    class MockUdpSocket implements IUdpSocket {
      public sentData: Array<{ addr: string; port: number; data: Uint8Array }> = []
      private messageCallback:
        | ((rinfo: { addr: string; port: number }, data: Uint8Array) => void)
        | null = null

      send(addr: string, port: number, data: Uint8Array): void {
        this.sentData.push({ addr, port, data: new Uint8Array(data) })
      }

      onMessage(cb: (rinfo: { addr: string; port: number }, data: Uint8Array) => void): void {
        this.messageCallback = cb
      }

      close(): void {}
      async joinMulticast(_group: string): Promise<void> {}
      async leaveMulticast(_group: string): Promise<void> {}

      emitMessage(data: Uint8Array, addr: string = '127.0.0.1', port: number = 6881): void {
        if (this.messageCallback) {
          this.messageCallback({ addr, port }, data)
        }
      }
    }

    class MockSocketFactory implements ISocketFactory {
      public mockSocket = new MockUdpSocket()

      async createTcpSocket(): Promise<any> {
        return {}
      }

      async createUdpSocket(): Promise<IUdpSocket> {
        return this.mockSocket
      }

      createTcpServer(): any {
        return { on: vi.fn(), listen: vi.fn(), address: vi.fn().mockReturnValue({ port: 0 }), close: vi.fn() }
      }

      wrapTcpSocket(_socket: any): any {
        return {}
      }
    }

    it('sends response back to sender', async () => {
      const factory = new MockSocketFactory()
      const socket = new KRPCSocket(factory)
      await socket.bind()

      const handler = createQueryHandler(socket, deps)
      const query = createMockQuery('ping', { id: remoteNodeId })

      await handler(query, rinfo)

      // Allow async operations to complete
      await new Promise((r) => setTimeout(r, 0))

      expect(factory.mockSocket.sentData.length).toBe(1)
      expect(factory.mockSocket.sentData[0].addr).toBe(rinfo.host)
      expect(factory.mockSocket.sentData[0].port).toBe(rinfo.port)

      socket.close()
    })

    it('adds valid node to routing table', async () => {
      const factory = new MockSocketFactory()
      const socket = new KRPCSocket(factory)
      await socket.bind()

      const handler = createQueryHandler(socket, deps)
      const query = createMockQuery('ping', { id: remoteNodeId })

      await handler(query, rinfo)

      // Allow async operations to complete
      await new Promise((r) => setTimeout(r, 0))

      const nodes = deps.routingTable.getAllNodes()
      expect(nodes.find((n) => n.host === rinfo.host)).toBeDefined()

      socket.close()
    })
  })
})
```

---

## Phase 3.4: Update Exports

### Update File: `packages/engine/src/dht/index.ts`

Add the following exports at the end of the file:

```typescript
// ============================================================================
// Phase 3 Exports - Query Handlers (Server Side)
// ============================================================================

// Token Store
export type { TokenStoreOptions } from './token-store'
export { TokenStore } from './token-store'

// Peer Store
export type { PeerStoreOptions } from './peer-store'
export {
  PeerStore,
  DEFAULT_PEER_TTL_MS,
  DEFAULT_MAX_PEERS_PER_INFOHASH,
  DEFAULT_MAX_INFOHASHES,
} from './peer-store'

// Query Handlers
export type { QueryHandlerResult, QueryHandlerDeps } from './query-handlers'
export {
  handlePing,
  handleFindNode,
  handleGetPeers,
  handleAnnouncePeer,
  handleUnknownMethod,
  routeQuery,
  createQueryHandler,
} from './query-handlers'
```

---

## Verification

After implementing all files, run these commands to verify:

```bash
# 1. Type check
cd packages/engine
pnpm typecheck

# 2. Run tests
pnpm test

# 3. Run only DHT tests
pnpm test -- --grep "TokenStore|PeerStore|QueryHandler"

# 4. Lint
pnpm lint

# 5. Format (run last)
pnpm format:fix
```

### Expected Test Output

All tests should pass:
- `token-store.test.ts` - 12+ tests
- `peer-store.test.ts` - 16+ tests
- `query-handlers.test.ts` - 20+ tests

---

## Implementation Notes

### Token Generation (from BEP 5)

> "The BitTorrent implementation uses the SHA1 hash of the IP address concatenated onto a secret that changes every five minutes and tokens up to ten minutes old are accepted."

Implementation approach:
1. Keep two secrets: `currentSecret` and `previousSecret`
2. `generate(ip)` uses `currentSecret`
3. `validate(ip, token)` checks against both secrets
4. `rotate()` moves `currentSecret` → `previousSecret`, generates new `currentSecret`

### Error Codes (from BEP 5)

| Code | Description | When to use |
|------|-------------|-------------|
| 201 | Generic Error | Catch-all for unexpected errors |
| 202 | Server Error | Internal failures |
| 203 | Protocol Error | Invalid arguments, bad token |
| 204 | Method Unknown | Unrecognized query method |

### Peer Storage Strategy

- Peers are stored by infohash
- Duplicates are detected by `(host, port)` tuple
- TTL of 30 minutes (configurable)
- Cap of 100 peers per infohash (configurable)
- Cap of 10,000 infohashes total (configurable)

---

## Files Summary

| File | Purpose | Tests |
|------|---------|-------|
| `src/dht/token-store.ts` | Token generation/validation | `token-store.test.ts` |
| `src/dht/peer-store.ts` | Infohash → peers storage | `peer-store.test.ts` |
| `src/dht/query-handlers.ts` | Incoming query processing | `query-handlers.test.ts` |
| `src/dht/index.ts` | Updated exports | N/A |

---

## Checklist

- [ ] Create `packages/engine/src/dht/token-store.ts`
- [ ] Create `packages/engine/test/dht/token-store.test.ts`
- [ ] Create `packages/engine/src/dht/peer-store.ts`
- [ ] Create `packages/engine/test/dht/peer-store.test.ts`
- [ ] Create `packages/engine/src/dht/query-handlers.ts`
- [ ] Create `packages/engine/test/dht/query-handlers.test.ts`
- [ ] Update `packages/engine/src/dht/index.ts` with Phase 3 exports
- [ ] Run `pnpm typecheck` - passes
- [ ] Run `pnpm test` - all tests pass
- [ ] Run `pnpm lint` - no errors
- [ ] Run `pnpm format:fix` - formatting applied
