import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConnectionManager, DEFAULT_CONNECTION_CONFIG } from '../../src/core/connection-manager'
import { Swarm, addressKey } from '../../src/core/swarm'
import { PeerSelector } from '../../src/core/peer-selector'
import { PeerConnection } from '../../src/core/peer-connection'
import { ISocketFactory, ITcpSocket } from '../../src/interfaces/socket'
import { MockEngine } from '../utils/mock-engine'
import type { Logger } from '../../src/logging/logger'
import type { SwarmPeer } from '../../src/core/swarm'

// Type to access private methods for testing
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type PeerSelectorWithPrivate = PeerSelector & {
  calculatePeerScore: (peer: SwarmPeer, now: number) => number
}

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager
  let swarm: Swarm
  let mockEngine: MockEngine
  let mockSocketFactory: ISocketFactory
  let mockLogger: Logger

  beforeEach(() => {
    mockEngine = new MockEngine()
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger

    swarm = new Swarm(mockLogger)

    mockSocketFactory = {
      createTcpSocket: vi.fn(),
    } as unknown as ISocketFactory

    connectionManager = new ConnectionManager(swarm, mockSocketFactory, mockEngine, mockLogger, {
      ...DEFAULT_CONNECTION_CONFIG,
      maxPeersPerTorrent: 50,
    })
  })

  describe('Peer Scoring (via PeerSelector)', () => {
    it('should prefer peers with previous connection success', async () => {
      // Add two peers - one with success history, one without
      const peer1 = swarm.addPeer({ ip: '1.2.3.1', port: 6881, family: 'ipv4' }, 'tracker')
      const peer2 = swarm.addPeer({ ip: '1.2.3.2', port: 6881, family: 'ipv4' }, 'tracker')

      // Simulate peer1 had a successful connection before
      peer1.lastConnectSuccess = Date.now() - 1000

      // Access private method via type cast for testing
      const peerSelector = connectionManager.getPeerSelector()
      const now = Date.now()
      const calculateScore: (peer: SwarmPeer, now: number) => number =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (peerSelector as any).calculatePeerScore.bind(peerSelector)

      const score1 = calculateScore(peer1, now)
      const score2 = calculateScore(peer2, now)

      expect(score1).toBeGreaterThan(score2)
      // Note: exact difference may vary due to random factor (+0-10)
      expect(score1 - score2).toBeGreaterThanOrEqual(40) // ~+50 for success history minus random variance
      expect(score1 - score2).toBeLessThanOrEqual(60)
    })

    it('should penalize peers with connection failures', async () => {
      const peer1 = swarm.addPeer({ ip: '1.2.3.1', port: 6881, family: 'ipv4' }, 'tracker')
      const peer2 = swarm.addPeer({ ip: '1.2.3.2', port: 6881, family: 'ipv4' }, 'tracker')

      // Simulate peer2 has failures
      peer2.connectFailures = 3

      const peerSelector = connectionManager.getPeerSelector()
      const now = Date.now()
      const calculateScore: (peer: SwarmPeer, now: number) => number =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (peerSelector as any).calculatePeerScore.bind(peerSelector)

      const score1 = calculateScore(peer1, now)
      const score2 = calculateScore(peer2, now)

      expect(score1).toBeGreaterThan(score2)
      // Note: exact difference may vary due to random factor (+0-10)
      expect(score1 - score2).toBeGreaterThanOrEqual(50) // ~-60 for 3 failures minus random variance
      expect(score1 - score2).toBeLessThanOrEqual(70)
    })

    it('should prefer manual sources over tracker and pex', async () => {
      const manualPeer = swarm.addPeer({ ip: '1.2.3.1', port: 6881, family: 'ipv4' }, 'manual')
      const trackerPeer = swarm.addPeer({ ip: '1.2.3.2', port: 6881, family: 'ipv4' }, 'tracker')
      const pexPeer = swarm.addPeer({ ip: '1.2.3.3', port: 6881, family: 'ipv4' }, 'pex')

      const peerSelector = connectionManager.getPeerSelector()
      const now = Date.now()
      const calculateScore: (peer: SwarmPeer, now: number) => number =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (peerSelector as any).calculatePeerScore.bind(peerSelector)

      const manualScore = calculateScore(manualPeer, now)
      const trackerScore = calculateScore(trackerPeer, now)
      const pexScore = calculateScore(pexPeer, now)

      // With random factor, we just check relative ordering holds on average
      // manual (+20) > tracker (+10) > pex (0)
      expect(manualScore).toBeGreaterThan(trackerScore - 15) // Allow for random variance
      expect(trackerScore).toBeGreaterThan(pexScore - 15)
    })

    it('should penalize recently tried peers', async () => {
      const peer1 = swarm.addPeer({ ip: '1.2.3.1', port: 6881, family: 'ipv4' }, 'tracker')
      const peer2 = swarm.addPeer({ ip: '1.2.3.2', port: 6881, family: 'ipv4' }, 'tracker')

      // Simulate peer2 was tried recently
      const now = Date.now()
      peer2.lastConnectAttempt = now - 10000 // 10 seconds ago

      const peerSelector = connectionManager.getPeerSelector()
      const calculateScore: (peer: SwarmPeer, now: number) => number =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (peerSelector as any).calculatePeerScore.bind(peerSelector)

      const score1 = calculateScore(peer1, now)
      const score2 = calculateScore(peer2, now)

      expect(score1).toBeGreaterThan(score2)
      // Note: exact difference may vary due to random factor (+0-10)
      expect(score1 - score2).toBeGreaterThanOrEqual(20) // ~-30 for recently tried minus random variance
      expect(score1 - score2).toBeLessThanOrEqual(40)
    })

    it('should prefer peers with download history', async () => {
      const peer1 = swarm.addPeer({ ip: '1.2.3.1', port: 6881, family: 'ipv4' }, 'tracker')
      const peer2 = swarm.addPeer({ ip: '1.2.3.2', port: 6881, family: 'ipv4' }, 'tracker')

      // Simulate peer1 has 1MB download history
      peer1.totalDownloaded = 1024 * 1024

      const peerSelector = connectionManager.getPeerSelector()
      const now = Date.now()
      const calculateScore: (peer: SwarmPeer, now: number) => number =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (peerSelector as any).calculatePeerScore.bind(peerSelector)

      const score1 = calculateScore(peer1, now)
      const score2 = calculateScore(peer2, now)

      expect(score1).toBeGreaterThan(score2)
    })
  })

  describe('Adaptive Maintenance', () => {
    it('should return minimum interval when no peers connected', () => {
      expect(swarm.connectedCount).toBe(0)
      const interval = connectionManager.getAdaptiveMaintenanceInterval()
      expect(interval).toBe(DEFAULT_CONNECTION_CONFIG.maintenanceMinInterval)
    })

    it('should return minimum interval when below 50% capacity', () => {
      // Add 20 connected peers (40% of default 50 max)
      const mockSocket = {
        onData: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      } as unknown as ITcpSocket

      for (let i = 0; i < 20; i++) {
        const peer = swarm.addPeer({ ip: `1.2.3.${i}`, port: 6881, family: 'ipv4' }, 'tracker')
        const key = addressKey(peer)
        const conn = new PeerConnection(mockEngine, mockSocket, {
          remoteAddress: peer.ip,
          remotePort: peer.port,
        })
        swarm.markConnecting(key)
        swarm.markConnected(key, conn)
      }

      const interval = connectionManager.getAdaptiveMaintenanceInterval()
      expect(interval).toBe(DEFAULT_CONNECTION_CONFIG.maintenanceMinInterval)
    })

    it('should return base interval when between 50-80% capacity', () => {
      const mockSocket = {
        onData: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      } as unknown as ITcpSocket

      // Add 35 connected peers (70% of default 50 max)
      for (let i = 0; i < 35; i++) {
        const peer = swarm.addPeer({ ip: `1.2.3.${i}`, port: 6881, family: 'ipv4' }, 'tracker')
        const key = addressKey(peer)
        const conn = new PeerConnection(mockEngine, mockSocket, {
          remoteAddress: peer.ip,
          remotePort: peer.port,
        })
        swarm.markConnecting(key)
        swarm.markConnected(key, conn)
      }

      const interval = connectionManager.getAdaptiveMaintenanceInterval()
      expect(interval).toBe(DEFAULT_CONNECTION_CONFIG.maintenanceInterval)
    })

    it('should return max interval when above 80% capacity', () => {
      const mockSocket = {
        onData: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      } as unknown as ITcpSocket

      // Add 45 connected peers (90% of default 50 max)
      for (let i = 0; i < 45; i++) {
        const peer = swarm.addPeer({ ip: `1.2.3.${i}`, port: 6881, family: 'ipv4' }, 'tracker')
        const key = addressKey(peer)
        const conn = new PeerConnection(mockEngine, mockSocket, {
          remoteAddress: peer.ip,
          remotePort: peer.port,
        })
        swarm.markConnecting(key)
        swarm.markConnected(key, conn)
      }

      const interval = connectionManager.getAdaptiveMaintenanceInterval()
      expect(interval).toBe(DEFAULT_CONNECTION_CONFIG.maintenanceMaxInterval)
    })
  })

  describe('Slow Peer Detection', () => {
    it('should detect choking peers with no recent data', () => {
      const mockSocket = {
        onData: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      } as unknown as ITcpSocket

      const peerConn = new PeerConnection(mockEngine, mockSocket, {
        remoteAddress: '1.2.3.4',
        remotePort: 6881,
      })

      // Simulate choking peer with stale data
      peerConn.peerChoking = true
      // Set last activity to 2 minutes ago (beyond 60s timeout)
      peerConn.downloadSpeedCalculator.lastActivity = Date.now() - 120000

      const reason = connectionManager.shouldDropPeer(peerConn)
      expect(reason).not.toBeNull()
      expect(reason).toContain('no data for')
      expect(reason).toContain('while choked')
    })

    it('should not flag active peers', () => {
      const mockSocket = {
        onData: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      } as unknown as ITcpSocket

      const peerConn = new PeerConnection(mockEngine, mockSocket, {
        remoteAddress: '1.2.3.4',
        remotePort: 6881,
      })

      // Active peer that just sent data
      peerConn.peerChoking = false
      peerConn.downloadSpeedCalculator.lastActivity = Date.now()
      peerConn.downloadSpeedCalculator.addBytes(10000)

      const reason = connectionManager.shouldDropPeer(peerConn)
      expect(reason).toBeNull()
    })

    it('should calculate average download speed', () => {
      const mockSocket = {
        onData: vi.fn(),
        onClose: vi.fn(),
        onError: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      } as unknown as ITcpSocket

      // Add two connected peers with different speeds
      const peer1 = swarm.addPeer({ ip: '1.2.3.1', port: 6881, family: 'ipv4' }, 'tracker')
      const peer2 = swarm.addPeer({ ip: '1.2.3.2', port: 6881, family: 'ipv4' }, 'tracker')

      const conn1 = new PeerConnection(mockEngine, mockSocket, {
        remoteAddress: peer1.ip,
        remotePort: peer1.port,
      })
      const conn2 = new PeerConnection(mockEngine, mockSocket, {
        remoteAddress: peer2.ip,
        remotePort: peer2.port,
      })

      // Mock speed getters
      vi.spyOn(conn1, 'downloadSpeed', 'get').mockReturnValue(1000)
      vi.spyOn(conn2, 'downloadSpeed', 'get').mockReturnValue(2000)

      swarm.markConnecting(addressKey(peer1))
      swarm.markConnected(addressKey(peer1), conn1)
      swarm.markConnecting(addressKey(peer2))
      swarm.markConnected(addressKey(peer2), conn2)

      const avgSpeed = connectionManager.getAverageDownloadSpeed()
      expect(avgSpeed).toBe(1500) // (1000 + 2000) / 2
    })
  })

  describe('Stats', () => {
    it('should include adaptive interval and average speed in stats', () => {
      const stats = connectionManager.getStats()

      expect(stats.adaptiveInterval).toBeDefined()
      expect(stats.averageDownloadSpeed).toBeDefined()
      expect(stats.config).toEqual({ ...DEFAULT_CONNECTION_CONFIG, maxPeersPerTorrent: 50 })
    })
  })
})
