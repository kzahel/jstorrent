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
