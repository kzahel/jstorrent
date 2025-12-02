/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  Swarm,
  addressKey,
  parseAddressKey,
  detectAddressFamily,
  normalizeAddress,
  compressIPv6,
  parseCompactPeers,
  PeerAddress,
} from '../../src/core/swarm'
import { Logger } from '../../src/logging/logger'

// Create a mock logger
function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe('Address Utilities', () => {
  describe('addressKey', () => {
    it('should format IPv4 address correctly', () => {
      expect(addressKey({ ip: '192.168.1.1', port: 6881, family: 'ipv4' })).toBe('192.168.1.1:6881')
    })

    it('should format IPv6 address with brackets', () => {
      expect(addressKey({ ip: '2001:db8::1', port: 6881, family: 'ipv6' })).toBe(
        '[2001:db8::1]:6881',
      )
    })
  })

  describe('parseAddressKey', () => {
    it('should parse IPv4 key', () => {
      const result = parseAddressKey('192.168.1.1:6881')
      expect(result).toEqual({ ip: '192.168.1.1', port: 6881, family: 'ipv4' })
    })

    it('should parse IPv6 key', () => {
      const result = parseAddressKey('[2001:db8::1]:6881')
      expect(result).toEqual({ ip: '2001:db8::1', port: 6881, family: 'ipv6' })
    })

    it('should throw on invalid key', () => {
      expect(() => parseAddressKey('[invalid')).toThrow('Invalid address key')
    })
  })

  describe('detectAddressFamily', () => {
    it('should detect IPv4', () => {
      expect(detectAddressFamily('192.168.1.1')).toBe('ipv4')
    })

    it('should detect IPv6', () => {
      expect(detectAddressFamily('2001:db8::1')).toBe('ipv6')
      expect(detectAddressFamily('::1')).toBe('ipv6')
    })
  })

  describe('normalizeAddress', () => {
    it('should pass through IPv4 addresses', () => {
      expect(normalizeAddress('192.168.1.1')).toEqual({ ip: '192.168.1.1', family: 'ipv4' })
    })

    it('should lowercase IPv6 addresses', () => {
      // Note: normalizeAddress only lowercases, doesn't fully compress
      // (compressIPv6 is a separate function used during compact parsing)
      expect(normalizeAddress('2001:DB8:0:1::')).toEqual({ ip: '2001:db8:0:1::', family: 'ipv6' })
    })

    it('should extract IPv4 from IPv4-mapped IPv6', () => {
      expect(normalizeAddress('::ffff:192.168.1.1')).toEqual({ ip: '192.168.1.1', family: 'ipv4' })
    })

    it('should keep IPv4-mapped when extraction disabled', () => {
      const result = normalizeAddress('::ffff:192.168.1.1', false)
      expect(result.family).toBe('ipv6')
    })
  })

  describe('compressIPv6', () => {
    it('should remove leading zeros', () => {
      expect(compressIPv6('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
    })

    it('should compress longest run of zeros', () => {
      expect(compressIPv6('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1')
    })

    it('should handle all zeros', () => {
      expect(compressIPv6('0:0:0:0:0:0:0:0')).toBe('::')
    })

    it('should handle leading zeros', () => {
      expect(compressIPv6('0:0:0:0:0:0:0:1')).toBe('::1')
    })
  })

  describe('parseCompactPeers', () => {
    it('should parse IPv4 compact peers', () => {
      // 192.168.1.1:8080 = [192, 168, 1, 1, 31, 144]
      const data = new Uint8Array([192, 168, 1, 1, 0x1f, 0x90])
      const peers = parseCompactPeers(data, 'ipv4')
      expect(peers).toEqual([{ ip: '192.168.1.1', port: 8080, family: 'ipv4' }])
    })

    it('should parse multiple IPv4 peers', () => {
      const data = new Uint8Array([
        192,
        168,
        1,
        1,
        0x1f,
        0x90, // 192.168.1.1:8080
        10,
        0,
        0,
        1,
        0x1a,
        0xe1, // 10.0.0.1:6881
      ])
      const peers = parseCompactPeers(data, 'ipv4')
      expect(peers).toHaveLength(2)
      expect(peers[0]).toEqual({ ip: '192.168.1.1', port: 8080, family: 'ipv4' })
      expect(peers[1]).toEqual({ ip: '10.0.0.1', port: 6881, family: 'ipv4' })
    })

    it('should parse IPv6 compact peers', () => {
      // ::1:8080 = 16 bytes of address + 2 bytes port
      const data = new Uint8Array([
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1, // ::1
        0x1f,
        0x90, // port 8080
      ])
      const peers = parseCompactPeers(data, 'ipv6')
      expect(peers).toHaveLength(1)
      expect(peers[0].port).toBe(8080)
      expect(peers[0].family).toBe('ipv6')
    })

    it('should skip zero ports', () => {
      const data = new Uint8Array([192, 168, 1, 1, 0, 0]) // port 0
      const peers = parseCompactPeers(data, 'ipv4')
      expect(peers).toHaveLength(0)
    })
  })
})

describe('Swarm', () => {
  let swarm: Swarm
  let logger: Logger

  beforeEach(() => {
    logger = createMockLogger()
    swarm = new Swarm(logger)
  })

  describe('addPeer', () => {
    it('should add a new peer', () => {
      const addr: PeerAddress = { ip: '192.168.1.1', port: 6881, family: 'ipv4' }
      const peer = swarm.addPeer(addr, 'tracker')

      expect(peer.ip).toBe('192.168.1.1')
      expect(peer.port).toBe(6881)
      expect(peer.source).toBe('tracker')
      expect(peer.state).toBe('idle')
      expect(swarm.size).toBe(1)
    })

    it('should not duplicate existing peer', () => {
      const addr: PeerAddress = { ip: '192.168.1.1', port: 6881, family: 'ipv4' }
      swarm.addPeer(addr, 'tracker')
      swarm.addPeer(addr, 'pex') // Same address, different source

      expect(swarm.size).toBe(1)
      // First source wins
      expect(swarm.getPeer('192.168.1.1', 6881, 'ipv4')?.source).toBe('tracker')
    })
  })

  describe('addPeers', () => {
    it('should add multiple peers and emit event', () => {
      const spy = vi.fn()
      swarm.on('peersAdded', spy)

      const addrs: PeerAddress[] = [
        { ip: '192.168.1.1', port: 6881, family: 'ipv4' },
        { ip: '192.168.1.2', port: 6881, family: 'ipv4' },
      ]
      const added = swarm.addPeers(addrs, 'tracker')

      expect(added).toBe(2)
      expect(swarm.size).toBe(2)
      expect(spy).toHaveBeenCalledWith(2)
    })

    it('should count only new peers', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')

      const addrs: PeerAddress[] = [
        { ip: '192.168.1.1', port: 6881, family: 'ipv4' }, // Duplicate
        { ip: '192.168.1.2', port: 6881, family: 'ipv4' }, // New
      ]
      const added = swarm.addPeers(addrs, 'pex')

      expect(added).toBe(1)
      expect(swarm.size).toBe(2)
    })
  })

  describe('connection state management', () => {
    it('should track connecting state', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '192.168.1.1:6881'

      swarm.markConnecting(key)

      const peer = swarm.getPeerByKey(key)
      expect(peer?.state).toBe('connecting')
      expect(peer?.connectAttempts).toBe(1)
      expect(swarm.connectingCount).toBe(1)
    })

    it('should track connected state', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '192.168.1.1:6881'
      const mockConnection = { downloaded: 0, uploaded: 0 } as any

      swarm.markConnecting(key)
      swarm.markConnected(key, mockConnection)

      const peer = swarm.getPeerByKey(key)
      expect(peer?.state).toBe('connected')
      expect(peer?.connection).toBe(mockConnection)
      expect(swarm.connectedCount).toBe(1)
      expect(swarm.connectingCount).toBe(0)
    })

    it('should track failed state with error', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '192.168.1.1:6881'

      swarm.markConnecting(key)
      swarm.markConnectFailed(key, 'Connection refused')

      const peer = swarm.getPeerByKey(key)
      expect(peer?.state).toBe('failed')
      expect(peer?.connectFailures).toBe(1)
      expect(peer?.lastConnectError).toBe('Connection refused')
    })

    it('should reset to idle on disconnect', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '192.168.1.1:6881'
      const mockConnection = { downloaded: 100, uploaded: 50 } as any

      swarm.markConnecting(key)
      swarm.markConnected(key, mockConnection)
      swarm.markDisconnected(key)

      const peer = swarm.getPeerByKey(key)
      expect(peer?.state).toBe('idle')
      expect(peer?.connection).toBeNull()
      expect(peer?.totalDownloaded).toBe(100)
      expect(peer?.totalUploaded).toBe(50)
    })
  })

  describe('getConnectablePeers', () => {
    beforeEach(() => {
      // Add several peers
      for (let i = 0; i < 10; i++) {
        swarm.addPeer({ ip: `192.168.1.${i}`, port: 6881, family: 'ipv4' }, 'tracker')
      }
    })

    it('should return idle peers', () => {
      const candidates = swarm.getConnectablePeers(5)
      expect(candidates.length).toBe(5)
      candidates.forEach((p) => expect(p.state).toBe('idle'))
    })

    it('should exclude connected peers', () => {
      const key = '192.168.1.0:6881'
      swarm.markConnecting(key)
      swarm.markConnected(key, {} as any)

      const candidates = swarm.getConnectablePeers(10)
      expect(candidates.every((p) => addressKey(p) !== key)).toBe(true)
    })

    it('should exclude connecting peers', () => {
      const key = '192.168.1.0:6881'
      swarm.markConnecting(key)

      const candidates = swarm.getConnectablePeers(10)
      expect(candidates.every((p) => addressKey(p) !== key)).toBe(true)
    })

    it('should exclude banned peers', () => {
      const key = '192.168.1.0:6881'
      swarm.ban(key, 'corrupt data')

      const candidates = swarm.getConnectablePeers(10)
      expect(candidates.every((p) => addressKey(p) !== key)).toBe(true)
    })

    it('should exclude peers in backoff', () => {
      const key = '192.168.1.0:6881'
      swarm.markConnecting(key)
      swarm.markConnectFailed(key, 'timeout')

      // Peer just failed, should be in backoff
      const candidates = swarm.getConnectablePeers(10)
      expect(candidates.every((p) => addressKey(p) !== key)).toBe(true)
    })
  })

  describe('ban/unban', () => {
    it('should ban a peer', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '192.168.1.1:6881'

      swarm.ban(key, 'corrupt data')

      const peer = swarm.getPeerByKey(key)
      expect(peer?.state).toBe('banned')
      expect(peer?.banReason).toBe('corrupt data')
      expect(swarm.bannedCount).toBe(1)
    })

    it('should unban a peer', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '192.168.1.1:6881'

      swarm.ban(key, 'test')
      swarm.unban(key)

      const peer = swarm.getPeerByKey(key)
      expect(peer?.state).toBe('idle')
      expect(peer?.banReason).toBeNull()
    })

    it('should unban recoverable peers but not corrupt', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      swarm.addPeer({ ip: '192.168.1.2', port: 6881, family: 'ipv4' }, 'tracker')

      swarm.ban('192.168.1.1:6881', 'corrupt data')
      swarm.ban('192.168.1.2:6881', 'timeout')

      const unbanned = swarm.unbanRecoverable()

      expect(unbanned).toBe(1)
      expect(swarm.getPeerByKey('192.168.1.1:6881')?.state).toBe('banned')
      expect(swarm.getPeerByKey('192.168.1.2:6881')?.state).toBe('idle')
    })
  })

  describe('peer identity', () => {
    it('should track peer identity', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '192.168.1.1:6881'
      const peerId = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      ])

      swarm.setIdentity(key, peerId, 'uTorrent 3.5.5')

      const peer = swarm.getPeerByKey(key)
      expect(peer?.peerId).toEqual(peerId)
      expect(peer?.clientName).toBe('uTorrent 3.5.5')
    })

    it('should group peers by peerId', () => {
      const peerId = new Uint8Array(20).fill(1)

      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      swarm.addPeer({ ip: '2001:db8::1', port: 6881, family: 'ipv6' }, 'tracker')

      swarm.setIdentity('192.168.1.1:6881', peerId, 'uTorrent')
      swarm.setIdentity('[2001:db8::1]:6881', peerId, 'uTorrent')

      const peerIdHex = Array.from(peerId)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      const peers = swarm.getPeersByPeerId(peerIdHex)

      expect(peers).toHaveLength(2)
    })
  })

  describe('getStats', () => {
    it('should return accurate stats', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      swarm.addPeer({ ip: '192.168.1.2', port: 6881, family: 'ipv4' }, 'pex')
      swarm.addPeer({ ip: '2001:db8::1', port: 6881, family: 'ipv6' }, 'tracker')

      swarm.markConnecting('192.168.1.1:6881')
      swarm.markConnected('192.168.1.1:6881', {} as any)
      swarm.ban('192.168.1.2:6881', 'test')

      const stats = swarm.getStats()

      expect(stats.total).toBe(3)
      expect(stats.byState.connected).toBe(1)
      expect(stats.byState.banned).toBe(1)
      expect(stats.byState.idle).toBe(1)
      expect(stats.byFamily.ipv4).toBe(2)
      expect(stats.byFamily.ipv6).toBe(1)
      expect(stats.bySource.tracker).toBe(2)
      expect(stats.bySource.pex).toBe(1)
    })
  })

  describe('clear', () => {
    it('should clear all peers', () => {
      swarm.addPeer({ ip: '192.168.1.1', port: 6881, family: 'ipv4' }, 'tracker')
      swarm.addPeer({ ip: '192.168.1.2', port: 6881, family: 'ipv4' }, 'tracker')

      swarm.clear()

      expect(swarm.size).toBe(0)
      expect(swarm.connectedCount).toBe(0)
      expect(swarm.connectingCount).toBe(0)
    })
  })

  describe('quick disconnect backoff', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should track quickDisconnects for short-lived connections', () => {
      const peer = swarm.addPeer({ ip: '1.2.3.4', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '1.2.3.4:6881'
      const mockConnection = { downloaded: 0, uploaded: 0 } as any

      // Simulate connect/disconnect cycle (quick disconnect < 30s)
      swarm.markConnecting(key)
      swarm.markConnected(key, mockConnection)
      vi.advanceTimersByTime(1000) // 1 second - short connection
      swarm.markDisconnected(key)

      expect(peer.quickDisconnects).toBe(1)
      expect(peer.lastDisconnect).toBeDefined()
    })

    it('should apply backoff after quick disconnects', () => {
      swarm.addPeer({ ip: '1.2.3.4', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '1.2.3.4:6881'
      const mockConnection = { downloaded: 0, uploaded: 0 } as any

      // Simulate quick connect/disconnect cycle
      swarm.markConnecting(key)
      swarm.markConnected(key, mockConnection)
      swarm.markDisconnected(key) // Quick disconnect (<30s)

      // Peer should NOT be returned immediately (in backoff)
      // quickDisconnects=1, backoff = 2^1 = 2000ms
      const candidates = swarm.getConnectablePeers(10)
      expect(candidates.find((p) => addressKey(p) === key)).toBeUndefined()

      // After backoff expires (2s + margin), should be returned
      vi.advanceTimersByTime(2500)
      const laterCandidates = swarm.getConnectablePeers(10)
      expect(laterCandidates.find((p) => addressKey(p) === key)).toBeDefined()
    })

    it('should increase backoff exponentially with repeated quick disconnects', () => {
      const peer = swarm.addPeer({ ip: '1.2.3.4', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '1.2.3.4:6881'
      const mockConnection = { downloaded: 0, uploaded: 0 } as any

      // First quick disconnect cycle
      swarm.markConnecting(key)
      swarm.markConnected(key, mockConnection)
      swarm.markDisconnected(key)
      expect(peer.quickDisconnects).toBe(1)

      // Wait for backoff to expire (2^1 = 2s)
      vi.advanceTimersByTime(3000)

      // Second quick disconnect cycle
      swarm.markConnecting(key)
      swarm.markConnected(key, mockConnection)
      swarm.markDisconnected(key)
      expect(peer.quickDisconnects).toBe(2)

      // Backoff should now be 2^2 = 4s
      // After 3s, should still be in backoff
      vi.advanceTimersByTime(3000)
      let candidates = swarm.getConnectablePeers(10)
      expect(candidates.find((p) => addressKey(p) === key)).toBeUndefined()

      // After another 2s (total 5s > 4s backoff), should be available
      vi.advanceTimersByTime(2000)
      candidates = swarm.getConnectablePeers(10)
      expect(candidates.find((p) => addressKey(p) === key)).toBeDefined()
    })

    it('should reset quickDisconnects after long-lived connection', () => {
      const peer = swarm.addPeer({ ip: '1.2.3.4', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '1.2.3.4:6881'
      const mockConnection = { downloaded: 0, uploaded: 0 } as any

      // First: simulate a quick disconnect to set quickDisconnects > 0
      swarm.markConnecting(key)
      swarm.markConnected(key, mockConnection)
      swarm.markDisconnected(key)
      expect(peer.quickDisconnects).toBe(1)

      // Wait for backoff
      vi.advanceTimersByTime(3000)

      // Now: simulate a long-lived connection (> 30 seconds)
      swarm.markConnecting(key)
      swarm.markConnected(key, mockConnection)
      vi.advanceTimersByTime(35000) // 35 seconds
      swarm.markDisconnected(key)

      // quickDisconnects should be reset to 0
      expect(peer.quickDisconnects).toBe(0)

      // Peer should be immediately available (no backoff)
      const candidates = swarm.getConnectablePeers(10)
      expect(candidates.find((p) => addressKey(p) === key)).toBeDefined()
    })

    it('should not apply quick disconnect backoff to failed connection attempts', () => {
      swarm.addPeer({ ip: '1.2.3.4', port: 6881, family: 'ipv4' }, 'tracker')
      const key = '1.2.3.4:6881'

      // Connection fails (never connected successfully)
      swarm.markConnecting(key)
      swarm.markConnectFailed(key, 'Connection refused')

      // This should use connectFailures backoff, not quickDisconnects
      const peer = swarm.getPeerByKey(key)
      expect(peer?.connectFailures).toBe(1)
      expect(peer?.quickDisconnects).toBe(0) // Should not increment
    })
  })
})
