/**
 * Tests for the URL polyfill used in QuickJS environments.
 */
import { describe, it, expect } from 'vitest'
import { PolyfillURL } from '../../../src/adapters/native/polyfills'

describe('URL polyfill', () => {
  describe('basic URL parsing', () => {
    it('parses simple HTTP URL', () => {
      const url = new PolyfillURL('http://example.com/path')
      expect(url.protocol).toBe('http:')
      expect(url.hostname).toBe('example.com')
      expect(url.pathname).toBe('/path')
      expect(url.port).toBe('')
      expect(url.search).toBe('')
    })

    it('parses URL with port', () => {
      const url = new PolyfillURL('https://example.com:8080/path')
      expect(url.protocol).toBe('https:')
      expect(url.hostname).toBe('example.com')
      expect(url.port).toBe('8080')
      expect(url.host).toBe('example.com:8080')
    })

    it('parses URL with query string', () => {
      const url = new PolyfillURL('http://example.com/path?foo=bar&baz=qux')
      expect(url.pathname).toBe('/path')
      expect(url.search).toBe('?foo=bar&baz=qux')
    })

    it('parses URL with hash', () => {
      const url = new PolyfillURL('http://example.com/path#section')
      expect(url.pathname).toBe('/path')
      expect(url.hash).toBe('#section')
    })

    it('preserves raw query string with percent-encoded binary data', () => {
      // This is the key use case: BitTorrent tracker URLs with binary info_hash
      const trackerUrl =
        'http://tracker.example.com:6969/announce?info_hash=%95%c6%1b%00%ff&peer_id=-JS0001-123456789012'
      const url = new PolyfillURL(trackerUrl)

      expect(url.hostname).toBe('tracker.example.com')
      expect(url.port).toBe('6969')
      expect(url.pathname).toBe('/announce')
      // The raw search string should be preserved exactly, not decoded
      expect(url.search).toBe('?info_hash=%95%c6%1b%00%ff&peer_id=-JS0001-123456789012')
    })
  })

  describe('searchParams throws', () => {
    it('throws when accessing searchParams', () => {
      const url = new PolyfillURL('http://example.com/?foo=bar')

      expect(() => url.searchParams).toThrow(/not supported/)
      expect(() => url.searchParams).toThrow(/QuickJS polyfill/)
      expect(() => url.searchParams).toThrow(/UTF-8/)
    })

    it('explains the issue with binary data in error message', () => {
      const url = new PolyfillURL('http://example.com/?info_hash=%95%c6')

      expect(() => url.searchParams).toThrow(/info_hash/)
      expect(() => url.searchParams).toThrow(/url\.search/)
    })
  })

  describe('toString and href', () => {
    it('reconstructs URL correctly', () => {
      const url = new PolyfillURL('http://example.com:8080/path?query=value#hash')
      expect(url.toString()).toBe('http://example.com:8080/path?query=value#hash')
      expect(url.href).toBe('http://example.com:8080/path?query=value#hash')
    })

    it('preserves percent-encoded query in toString', () => {
      const trackerUrl = 'http://tracker.com/announce?info_hash=%95%c6%1b'
      const url = new PolyfillURL(trackerUrl)
      expect(url.toString()).toBe(trackerUrl)
    })
  })

  describe('base URL resolution', () => {
    it('resolves absolute path against base', () => {
      const url = new PolyfillURL('/new/path', 'http://example.com/old/path')
      expect(url.href).toBe('http://example.com/new/path')
    })

    it('resolves relative path against base', () => {
      const url = new PolyfillURL('file.txt', 'http://example.com/dir/')
      expect(url.href).toBe('http://example.com/dir/file.txt')
    })

    it('resolves query against base', () => {
      const url = new PolyfillURL('?newquery', 'http://example.com/path?oldquery')
      expect(url.href).toBe('http://example.com/path?newquery')
    })
  })
})
