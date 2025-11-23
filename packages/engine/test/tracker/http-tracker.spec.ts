import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpTracker } from '../../src/tracker/http-tracker'
import { Bencode } from '../../src/utils/bencode'

// Mock fetch
const fetchMock = vi.fn()
global.fetch = fetchMock

describe('HttpTracker', () => {
  const announceUrl = 'http://tracker.example.com/announce'
  const infoHash = new Uint8Array(20).fill(1)
  const peerId = new Uint8Array(20).fill(2)
  let tracker: HttpTracker

  beforeEach(() => {
    tracker = new HttpTracker(announceUrl, infoHash, peerId)
    fetchMock.mockReset()
  })

  it('should construct correct announce URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Bencode.encode({ interval: 1800, peers: [] }),
    })

    await tracker.announce('started')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe(announceUrl)
    expect(url.searchParams.get('port')).toBe('6881')
    expect(url.searchParams.get('compact')).toBe('1')
    expect(url.searchParams.get('event')).toBe('started')

    // Check info_hash encoding manually as URLSearchParams might decode it
    // The query string in the mock call should contain the encoded info_hash
    const fullUrl = fetchMock.mock.calls[0][0] as string
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

    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Bencode.encode(response),
    })

    const peerSpy = vi.fn()
    tracker.on('peer', peerSpy)

    await tracker.announce('started')

    expect(peerSpy).toHaveBeenCalledWith({ ip: '1.2.3.4', port: 8080 })
  })

  it('should handle tracker errors', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Bencode.encode({ 'failure reason': 'Invalid info_hash' }),
    })

    const errorSpy = vi.fn()
    tracker.on('error', errorSpy)

    await tracker.announce('started')

    expect(errorSpy).toHaveBeenCalled()
    expect(errorSpy.mock.calls[0][0].message).toBe('Invalid info_hash')
  })
})
