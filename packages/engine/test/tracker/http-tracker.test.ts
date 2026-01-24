import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpTracker } from '../../src/tracker/http-tracker'
import { Bencode } from '../../src/utils/bencode'
import { MinimalHttpClient } from '../../src/utils/minimal-http-client'

// Mock MinimalHttpClient
vi.mock('../../src/utils/minimal-http-client', () => {
  return {
    MinimalHttpClient: vi.fn().mockImplementation(() => {
      return {
        get: vi.fn(),
      }
    }),
  }
})

describe('HttpTracker', () => {
  const announceUrl = 'http://tracker.example.com/announce'
  const infoHash = new Uint8Array(20).fill(1)
  const peerId = new Uint8Array(20).fill(2)
  let tracker: HttpTracker
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockHttpClient: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockEngine: any = {
    listeningPort: 6881,
    scopedLoggerFor: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockSocketFactory: any = {}

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Create tracker (this will instantiate MockMinimalHttpClient)
    tracker = new HttpTracker(mockEngine, announceUrl, infoHash, peerId, mockSocketFactory)

    // Get the mock instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockHttpClient = (MinimalHttpClient as any).mock.results[0].value
  })

  it('should construct correct announce URL', async () => {
    mockHttpClient.get.mockResolvedValue(Buffer.from(Bencode.encode({ interval: 1800, peers: [] })))

    await tracker.announce('started')

    expect(mockHttpClient.get).toHaveBeenCalledTimes(1)
    const url = new URL(mockHttpClient.get.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe(announceUrl)
    expect(url.searchParams.get('port')).toBe('6881')
    expect(url.searchParams.get('compact')).toBe('1')
    expect(url.searchParams.get('event')).toBe('started')

    // Check info_hash encoding manually as URLSearchParams might decode it
    // The query string in the mock call should contain the encoded info_hash
    const fullUrl = mockHttpClient.get.mock.calls[0][0] as string
    expect(fullUrl).toContain(
      'info_hash=%01%01%01%01%01%01%01%01%01%01%01%01%01%01%01%01%01%01%01%01',
    )
  })

  it('should parse compact peers response', async () => {
    // 1.2.3.4:8080 -> 01 02 03 04 1F 90
    const peersCompact = new Uint8Array([1, 2, 3, 4, 0x1f, 0x90])
    const response = {
      interval: 1800,
      peers: peersCompact,
    }

    mockHttpClient.get.mockResolvedValue(Buffer.from(Bencode.encode(response)))

    const peersSpy = vi.fn()
    tracker.on('peersDiscovered', peersSpy)

    await tracker.announce('started')

    expect(peersSpy).toHaveBeenCalledWith([{ ip: '1.2.3.4', port: 8080 }])
  })

  it('should handle tracker errors', async () => {
    mockHttpClient.get.mockResolvedValue(
      Buffer.from(Bencode.encode({ 'failure reason': 'Invalid info_hash' })),
    )

    const errorSpy = vi.fn()
    tracker.on('error', errorSpy)

    await tracker.announce('started')

    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy.mock.calls[0][0].message).toBe('Invalid info_hash')
  })
})
