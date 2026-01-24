import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Torrent } from '../../src/core/torrent'
import { PeerConnection } from '../../src/core/peer-connection'
import { ISocketFactory, ITcpSocket } from '../../src/interfaces/socket'
import { MockEngine } from '../utils/mock-engine'
import type { BtEngine } from '../../src/core/bt-engine'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InvariantViolation = any

describe('Torrent Connection Limits', () => {
  let mockEngine: MockEngine
  let mockSocketFactory: ISocketFactory

  const createMockSocket = (): ITcpSocket =>
    ({
      onData: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
    }) as unknown as ITcpSocket

  beforeEach(() => {
    mockEngine = new MockEngine()
    mockSocketFactory = {
      createTcpSocket: vi.fn(),
    } as unknown as ISocketFactory
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('addPeer limits', () => {
    it('should not exceed maxPeers when adding many peers rapidly', () => {
      const maxPeers = 5
      const torrent = new Torrent(
        mockEngine as unknown as BtEngine,
        new Uint8Array(20),
        new Uint8Array(20),
        mockSocketFactory,
        6881,
        undefined, // contentStorage
        [], // announce
        maxPeers,
      )

      const violations: InvariantViolation[] = []
      torrent.on('invariant_violation', (v) => violations.push(v))

      // Add 10 peers rapidly
      for (let i = 0; i < 10; i++) {
        const socket = createMockSocket()
        const peer = new PeerConnection(mockEngine, socket, {
          remoteAddress: `10.0.0.${i}`,
          remotePort: 6881,
        })
        torrent.addPeer(peer)
      }

      expect(torrent.numPeers).toBeLessThanOrEqual(maxPeers)
      expect(violations).toHaveLength(0)
    })

    it('should reject peers when total connections (peers + pending) >= maxPeers', async () => {
      const maxPeers = 3
      const torrent = new Torrent(
        mockEngine as unknown as BtEngine,
        new Uint8Array(20),
        new Uint8Array(20),
        mockSocketFactory,
        6881,
        undefined,
        [],
        maxPeers,
      )

      const violations: InvariantViolation[] = []
      torrent.on('invariant_violation', (v) => violations.push(v))

      // Mock socket factory to hang (never resolve) - simulates pending connections
      mockSocketFactory.createTcpSocket = vi.fn(
        () => new Promise<ITcpSocket>(() => {}), // Never resolves
      )

      // Start 2 pending connections
      torrent.connectToPeer({ ip: '1.1.1.1', port: 6881 })
      torrent.connectToPeer({ ip: '1.1.1.2', port: 6881 })

      // Access swarm's connectingCount for testing (swarm is single source of truth)
      const swarm = (torrent as unknown as { _swarm: { connectingCount: number } })._swarm
      expect(swarm.connectingCount).toBe(2)

      // Now try to add 2 incoming peers - should only accept 1 (3 - 2 = 1 slot)
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()
      const peer1 = new PeerConnection(mockEngine, socket1, {
        remoteAddress: '2.2.2.1',
        remotePort: 6881,
      })
      const peer2 = new PeerConnection(mockEngine, socket2, {
        remoteAddress: '2.2.2.2',
        remotePort: 6881,
      })

      torrent.addPeer(peer1)
      torrent.addPeer(peer2)

      // Should have 1 peer (max 3 - 2 pending = 1 slot)
      expect(torrent.numPeers).toBe(1)
      expect(violations).toHaveLength(0)
    })
  })

  describe('connectToPeer limits', () => {
    it('should not double-count when connection succeeds', async () => {
      const maxPeers = 3
      const torrent = new Torrent(
        mockEngine as unknown as BtEngine,
        new Uint8Array(20),
        new Uint8Array(20),
        mockSocketFactory,
        6881,
        undefined,
        [],
        maxPeers,
      )

      const violations: InvariantViolation[] = []
      torrent.on('invariant_violation', (v) => violations.push(v))

      // Mock socket factory to return simple mock sockets (no side effects)
      mockSocketFactory.createTcpSocket = vi.fn(async () => createMockSocket())

      // Start 3 connections (at limit)
      await Promise.all([
        torrent.connectToPeer({ ip: '1.1.1.1', port: 6881 }),
        torrent.connectToPeer({ ip: '1.1.1.2', port: 6881 }),
        torrent.connectToPeer({ ip: '1.1.1.3', port: 6881 }),
      ])

      // After connections complete, connecting should be 0 and peers should be 3
      const swarm = (torrent as unknown as { _swarm: { connectingCount: number } })._swarm
      expect(torrent.numPeers).toBe(3)
      expect(swarm.connectingCount).toBe(0)
      expect(violations).toHaveLength(0)
    })

    it('should respect maxPeers when connectToPeer is called many times', async () => {
      const maxPeers = 5
      const torrent = new Torrent(
        mockEngine as unknown as BtEngine,
        new Uint8Array(20),
        new Uint8Array(20),
        mockSocketFactory,
        6881,
        undefined,
        [],
        maxPeers,
      )

      const violations: InvariantViolation[] = []
      torrent.on('invariant_violation', (v) => violations.push(v))

      // Mock socket factory to return simple mock sockets
      mockSocketFactory.createTcpSocket = vi.fn(async () => createMockSocket())

      // Try to connect to 20 peers
      const connectPromises = []
      for (let i = 0; i < 20; i++) {
        connectPromises.push(torrent.connectToPeer({ ip: `10.0.0.${i}`, port: 6881 }))
      }
      await Promise.all(connectPromises)

      // Should not exceed maxPeers
      expect(torrent.numPeers).toBeLessThanOrEqual(maxPeers)
      expect(violations).toHaveLength(0)
    })

    it('should handle connection failures gracefully', async () => {
      const maxPeers = 5
      const torrent = new Torrent(
        mockEngine as unknown as BtEngine,
        new Uint8Array(20),
        new Uint8Array(20),
        mockSocketFactory,
        6881,
        undefined,
        [],
        maxPeers,
      )

      const violations: InvariantViolation[] = []
      torrent.on('invariant_violation', (v) => violations.push(v))

      // Mock socket factory to return a socket that fails on connect
      mockSocketFactory.createTcpSocket = vi.fn(async () => {
        return {
          connect: async () => {
            throw new Error('Connection refused')
          },
          close: () => {},
          send: () => {},
          onData: () => {},
          onClose: () => {},
          onError: () => {},
        }
      })

      // Try to connect
      await torrent.connectToPeer({ ip: '1.1.1.1', port: 6881 })

      // Should have 0 peers and 0 connecting
      const swarm = (torrent as unknown as { _swarm: { connectingCount: number } })._swarm
      expect(torrent.numPeers).toBe(0)
      expect(swarm.connectingCount).toBe(0)
      expect(violations).toHaveLength(0)
    })
  })

  // Note: globalLimitCheck has been removed in favor of centralized connection queue in BtEngine.
  // Global rate limiting is now handled by BtEngine.requestConnections() and drainConnectionQueue().

  describe('invariant events', () => {
    it('should emit invariant_violation when limits are exceeded', () => {
      const maxPeers = 2
      const torrent = new Torrent(
        mockEngine as unknown as BtEngine,
        new Uint8Array(20),
        new Uint8Array(20),
        mockSocketFactory,
        6881,
        undefined,
        [],
        maxPeers,
      )

      const violations: InvariantViolation[] = []
      torrent.on('invariant_violation', (v) => violations.push(v))

      // Add peers through swarm directly to bypass addPeer limits (simulating a bug)
      // With Phase 3, swarm is the single source of truth, so we access it directly
      // Need to add more than maxPeers + headroom (2 + 10 = 12) to trigger violation
      const swarm = (
        torrent as unknown as {
          _swarm: {
            markConnected: (key: string, conn: PeerConnection) => void
            addPeer: (
              addr: { ip: string; port: number; family: 'ipv4' | 'ipv6' },
              source: string,
            ) => void
          }
        }
      )._swarm
      for (let i = 0; i < 15; i++) {
        const socket = createMockSocket()
        const peer = new PeerConnection(mockEngine, socket, {
          remoteAddress: `10.0.0.${i}`,
          remotePort: 6881,
        })
        const key = `10.0.0.${i}:6881`
        // Add to swarm bypassing normal limits
        swarm.addPeer({ ip: `10.0.0.${i}`, port: 6881, family: 'ipv4' }, 'manual')
        swarm.markConnected(key, peer)
      }

      // Manually trigger invariant check
      const checkInvariants = (
        torrent as unknown as { checkSwarmInvariants: () => void }
      ).checkSwarmInvariants.bind(torrent)
      checkInvariants()

      // Should have emitted violation
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.type === 'limit_exceeded')).toBe(true)
    })
  })
})
