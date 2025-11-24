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
})
