import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TrackerManager } from '../../src/tracker/tracker-manager'
import { ISocketFactory } from '../../src/interfaces/socket'
import { HttpTracker } from '../../src/tracker/http-tracker'
import { UdpTracker } from '../../src/tracker/udp-tracker'

// Mock Trackers
vi.mock('../../src/tracker/http-tracker', () => {
  return {
    HttpTracker: vi.fn().mockImplementation(function () {
      this.announce = vi.fn().mockResolvedValue(undefined)
      this.on = vi.fn()
      this.destroy = vi.fn()
    }),
  }
})

vi.mock('../../src/tracker/udp-tracker', () => {
  return {
    UdpTracker: vi.fn().mockImplementation(function () {
      this.announce = vi.fn().mockResolvedValue(undefined)
      this.on = vi.fn()
      this.destroy = vi.fn()
    }),
  }
})

describe('TrackerManager', () => {
  const announceList = [['http://tracker1.com/announce'], ['udp://tracker2.com:80/announce']]
  const infoHash = new Uint8Array(20).fill(1)
  const peerId = new Uint8Array(20).fill(2)
  const socketFactory = {} as ISocketFactory // Mock
  let manager: TrackerManager

  beforeEach(() => {
    vi.clearAllMocks()
    const mockEngine = {
      scopedLoggerFor: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manager = new TrackerManager(mockEngine as any, announceList, infoHash, peerId, socketFactory)
  })

  it('should initialize trackers from announce list', () => {
    expect(HttpTracker).toHaveBeenCalledTimes(1)
    expect(UdpTracker).toHaveBeenCalledTimes(1)
  })

  it('should aggregate peers and dedup', () => {
    const peersSpy = vi.fn()
    manager.on('peersDiscovered', peersSpy)

    // Get instances
    const httpTracker = vi.mocked(HttpTracker).mock.instances[0]
    const udpTracker = vi.mocked(UdpTracker).mock.instances[0]

    // Check if `on` was called with peersDiscovered
    expect(httpTracker.on).toHaveBeenCalledWith('peersDiscovered', expect.any(Function))
    const httpPeersHandler = vi
      .mocked(httpTracker.on)
      .mock.calls.find((c) => c[0] === 'peersDiscovered')![1]

    // Emit batch of peers from HTTP
    httpPeersHandler([{ ip: '1.1.1.1', port: 1000 }])
    expect(peersSpy).toHaveBeenCalledWith([{ ip: '1.1.1.1', port: 1000 }])

    // Emit same peer from UDP - should be deduped
    expect(udpTracker.on).toHaveBeenCalledWith('peersDiscovered', expect.any(Function))
    const udpPeersHandler = vi
      .mocked(udpTracker.on)
      .mock.calls.find((c) => c[0] === 'peersDiscovered')![1]

    udpPeersHandler([{ ip: '1.1.1.1', port: 1000 }])
    expect(peersSpy).toHaveBeenCalledTimes(1) // Should be deduped (no new peers)

    // Emit new peer
    udpPeersHandler([{ ip: '2.2.2.2', port: 2000 }])
    expect(peersSpy).toHaveBeenCalledTimes(2)
    expect(peersSpy).toHaveBeenCalledWith([{ ip: '2.2.2.2', port: 2000 }])

    // Emit mixed batch - one new, one duplicate
    udpPeersHandler([
      { ip: '2.2.2.2', port: 2000 },
      { ip: '3.3.3.3', port: 3000 },
    ])
    expect(peersSpy).toHaveBeenCalledTimes(3)
    expect(peersSpy).toHaveBeenLastCalledWith([{ ip: '3.3.3.3', port: 3000 }])
  })

  it('should announce to all trackers', async () => {
    const httpTracker = vi.mocked(HttpTracker).mock.instances[0]
    const udpTracker = vi.mocked(UdpTracker).mock.instances[0]

    console.log('HttpTracker instances:', vi.mocked(HttpTracker).mock.instances.length)
    console.log('UdpTracker instances:', vi.mocked(UdpTracker).mock.instances.length)

    await manager.announce('started')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.log('HttpTracker announce calls:', (httpTracker.announce as any).mock.calls.length)

    // Stats is undefined when no statsGetter is set
    expect(httpTracker.announce).toHaveBeenCalledWith('started', undefined)
    expect(udpTracker.announce).toHaveBeenCalledWith('started', undefined)
  })
})
