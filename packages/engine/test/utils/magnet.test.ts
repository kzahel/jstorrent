import { describe, it, expect } from 'vitest'
import { parseMagnet } from '../../src/utils/magnet'

describe('Magnet Parser', () => {
  it('should parse a valid magnet link', () => {
    const uri =
      'magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=Test+Torrent&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce'
    const parsed = parseMagnet(uri)

    expect(parsed.infoHash).toBe('c12fe1c06bba254a9dc9f519b335aa7c1367a88a')
    expect(parsed.name).toBe('Test Torrent')
    expect(parsed.announce).toEqual(['udp://tracker.opentrackr.org:1337/announce'])
  })

  it('should parse magnet link with multiple trackers', () => {
    const uri =
      'magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&tr=http://tracker1.com&tr=http://tracker2.com'
    const parsed = parseMagnet(uri)

    expect(parsed.infoHash).toBe('1234567890abcdef1234567890abcdef12345678')
    expect(parsed.announce).toEqual(['http://tracker1.com', 'http://tracker2.com'])
  })

  it('should throw on invalid protocol', () => {
    expect(() => parseMagnet('http://example.com')).toThrow('Invalid magnet URI')
  })

  it('should throw on missing xt', () => {
    expect(() => parseMagnet('magnet:?dn=Test')).toThrow('Invalid magnet URI: missing xt')
  })

  it('should parse magnet link with IPv4 peer hints', () => {
    const uri =
      'magnet:?xt=urn:btih:a4e71df0553e6c565df4958a817b1f1a780503da&dn=test&x.pe=127.0.0.1:8998&x.pe=192.168.1.1:6881'
    const parsed = parseMagnet(uri)

    expect(parsed.peers).toHaveLength(2)
    expect(parsed.peers![0]).toEqual({ ip: '127.0.0.1', port: 8998, family: 'ipv4' })
    expect(parsed.peers![1]).toEqual({ ip: '192.168.1.1', port: 6881, family: 'ipv4' })
  })

  it('should parse magnet link with IPv6 peer hints', () => {
    const uri = 'magnet:?xt=urn:btih:a4e71df0553e6c565df4958a817b1f1a780503da&x.pe=[::1]:8998'
    const parsed = parseMagnet(uri)

    expect(parsed.peers).toHaveLength(1)
    expect(parsed.peers![0]).toEqual({ ip: '::1', port: 8998, family: 'ipv6' })
  })

  it('should ignore invalid peer hints', () => {
    const uri =
      'magnet:?xt=urn:btih:a4e71df0553e6c565df4958a817b1f1a780503da&x.pe=invalid&x.pe=127.0.0.1:8998&x.pe=noport'
    const parsed = parseMagnet(uri)

    // Only the valid one should be parsed
    expect(parsed.peers).toHaveLength(1)
    expect(parsed.peers![0]).toEqual({ ip: '127.0.0.1', port: 8998, family: 'ipv4' })
  })

  it('should return undefined peers when no x.pe params', () => {
    const uri = 'magnet:?xt=urn:btih:a4e71df0553e6c565df4958a817b1f1a780503da'
    const parsed = parseMagnet(uri)

    expect(parsed.peers).toBeUndefined()
  })

  it('should parse URL-encoded display name with special characters', () => {
    const uri =
      'magnet:?xt=urn:btih:a4e71df0553e6c565df4958a817b1f1a780503da&dn=%5BTest%5D%20File%20%26%20More%20%2B%20Stuff'
    const parsed = parseMagnet(uri)

    expect(parsed.name).toBe('[Test] File & More + Stuff')
  })

  it('should parse web seeds (ws parameter)', () => {
    const uri =
      'magnet:?xt=urn:btih:a4e71df0553e6c565df4958a817b1f1a780503da&ws=http%3A%2F%2Fexample.com%2Ffile.bin&ws=http%3A%2F%2Fmirror.com%2Ffile.bin'
    const parsed = parseMagnet(uri)

    expect(parsed.urlList).toEqual(['http://example.com/file.bin', 'http://mirror.com/file.bin'])
  })

  it('should handle parameters with empty values', () => {
    const uri = 'magnet:?xt=urn:btih:a4e71df0553e6c565df4958a817b1f1a780503da&dn='
    const parsed = parseMagnet(uri)

    // Empty string becomes undefined via `|| undefined` in parseMagnet
    expect(parsed.name).toBeUndefined()
  })

  it('should skip parameters without equals sign', () => {
    const uri = 'magnet:?xt=urn:btih:a4e71df0553e6c565df4958a817b1f1a780503da&invalidparam&dn=test'
    const parsed = parseMagnet(uri)

    expect(parsed.name).toBe('test')
  })

  it('should handle uppercase info hash', () => {
    const uri = 'magnet:?xt=urn:btih:A4E71DF0553E6C565DF4958A817B1F1A780503DA'
    const parsed = parseMagnet(uri)

    // Should normalize to lowercase
    expect(parsed.infoHash).toBe('a4e71df0553e6c565df4958a817b1f1a780503da')
  })

  it('should parse magnet link used in real test scenario', () => {
    // The exact magnet link from the user's test
    const uri =
      'magnet:?xt=urn:btih:18a7aacab6d2bc518e336921ccd4b6cc32a9624b&dn=testdata_1gb.bin&x.pe=192.168.1.131:6881'
    const parsed = parseMagnet(uri)

    expect(parsed.infoHash).toBe('18a7aacab6d2bc518e336921ccd4b6cc32a9624b')
    expect(parsed.name).toBe('testdata_1gb.bin')
    expect(parsed.peers).toHaveLength(1)
    expect(parsed.peers![0]).toEqual({ ip: '192.168.1.131', port: 6881, family: 'ipv4' })
  })
})
