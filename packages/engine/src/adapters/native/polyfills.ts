/**
 * Polyfills for QuickJS and JavaScriptCore
 *
 * QuickJS and JSC lack some standard Web APIs that the engine relies on.
 * This file provides polyfills that delegate to native bindings.
 */

import './bindings.d.ts'

// ============================================================
// TextEncoder / TextDecoder
// ============================================================

if (typeof TextEncoder === 'undefined') {
  ;(globalThis as Record<string, unknown>).TextEncoder = class TextEncoder {
    readonly encoding = 'utf-8'

    encode(str: string): Uint8Array {
      return new Uint8Array(__jstorrent_text_encode(str))
    }

    encodeInto(str: string, dest: Uint8Array): { read: number; written: number } {
      const encoded = this.encode(str)
      const written = Math.min(encoded.length, dest.length)
      dest.set(encoded.subarray(0, written))
      return { read: str.length, written }
    }
  }
}

if (typeof TextDecoder === 'undefined') {
  ;(globalThis as Record<string, unknown>).TextDecoder = class TextDecoder {
    readonly encoding = 'utf-8'
    readonly fatal = false
    readonly ignoreBOM = false

    decode(data?: BufferSource): string {
      if (!data) return ''
      let buffer: ArrayBuffer
      if (data instanceof ArrayBuffer) {
        buffer = data
      } else if (ArrayBuffer.isView(data)) {
        buffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer
      } else {
        throw new TypeError('Expected ArrayBuffer or ArrayBufferView')
      }
      return __jstorrent_text_decode(buffer)
    }
  }
}

// ============================================================
// setTimeout / clearTimeout / setInterval / clearInterval
// ============================================================

if (typeof setTimeout === 'undefined') {
  ;(globalThis as Record<string, unknown>).setTimeout = (
    callback: () => void,
    ms?: number,
  ): number => {
    return __jstorrent_set_timeout(callback, ms ?? 0)
  }
}

if (typeof clearTimeout === 'undefined') {
  ;(globalThis as Record<string, unknown>).clearTimeout = (id?: number): void => {
    if (id !== undefined) {
      __jstorrent_clear_timeout(id)
    }
  }
}

if (typeof setInterval === 'undefined') {
  ;(globalThis as Record<string, unknown>).setInterval = (
    callback: () => void,
    ms?: number,
  ): number => {
    return __jstorrent_set_interval(callback, ms ?? 0)
  }
}

if (typeof clearInterval === 'undefined') {
  ;(globalThis as Record<string, unknown>).clearInterval = (id?: number): void => {
    if (id !== undefined) {
      __jstorrent_clear_interval(id)
    }
  }
}

// ============================================================
// crypto.getRandomValues
// ============================================================

if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
  const cryptoPolyfill = {
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (!array) return array
      const view = array as unknown as Uint8Array
      const randomBytes = new Uint8Array(__jstorrent_random_bytes(view.length))
      view.set(randomBytes)
      return array
    },
    // Provide a minimal subtle object to satisfy type checks
    subtle: {} as SubtleCrypto,
    randomUUID: (): `${string}-${string}-${string}-${string}-${string}` => {
      const bytes = new Uint8Array(__jstorrent_random_bytes(16))
      // Set version (4) and variant (RFC4122)
      bytes[6] = (bytes[6] & 0x0f) | 0x40
      bytes[8] = (bytes[8] & 0x3f) | 0x80
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`
    },
  }

  if (typeof crypto === 'undefined') {
    ;(globalThis as Record<string, unknown>).crypto = cryptoPolyfill
  } else {
    ;(crypto as unknown as Record<string, unknown>).getRandomValues = cryptoPolyfill.getRandomValues
    if (!crypto.randomUUID) {
      ;(crypto as unknown as Record<string, unknown>).randomUUID = cryptoPolyfill.randomUUID
    }
  }
}

// ============================================================
// btoa / atob (Base64)
// ============================================================

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

if (typeof btoa === 'undefined') {
  ;(globalThis as Record<string, unknown>).btoa = (str: string): string => {
    // Convert string to bytes (Latin-1 encoding)
    const bytes = new Uint8Array(str.length)
    for (let i = 0; i < str.length; i++) {
      const charCode = str.charCodeAt(i)
      if (charCode > 255) {
        throw new Error('btoa: Character out of range. Use encodeURIComponent for Unicode.')
      }
      bytes[i] = charCode
    }

    let result = ''
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i]
      const b = i + 1 < bytes.length ? bytes[i + 1] : 0
      const c = i + 2 < bytes.length ? bytes[i + 2] : 0

      result += BASE64_CHARS[a >> 2]
      result += BASE64_CHARS[((a & 3) << 4) | (b >> 4)]
      result += i + 1 < bytes.length ? BASE64_CHARS[((b & 15) << 2) | (c >> 6)] : '='
      result += i + 2 < bytes.length ? BASE64_CHARS[c & 63] : '='
    }
    return result
  }
}

if (typeof atob === 'undefined') {
  ;(globalThis as Record<string, unknown>).atob = (base64: string): string => {
    // Remove padding and validate
    const clean = base64.replace(/=+$/, '')
    let result = ''

    for (let i = 0; i < clean.length; i += 4) {
      const a = BASE64_CHARS.indexOf(clean[i])
      const b = i + 1 < clean.length ? BASE64_CHARS.indexOf(clean[i + 1]) : 0
      const c = i + 2 < clean.length ? BASE64_CHARS.indexOf(clean[i + 2]) : 0
      const d = i + 3 < clean.length ? BASE64_CHARS.indexOf(clean[i + 3]) : 0

      if (a === -1 || b === -1 || c === -1 || d === -1) {
        throw new Error('atob: Invalid base64 character')
      }

      result += String.fromCharCode((a << 2) | (b >> 4))
      if (i + 2 < clean.length) {
        result += String.fromCharCode(((b & 15) << 4) | (c >> 2))
      }
      if (i + 3 < clean.length) {
        result += String.fromCharCode(((c & 3) << 6) | d)
      }
    }
    return result
  }
}

// ============================================================
// URL
// ============================================================
//
// IMPORTANT: This is a LIMITED polyfill for QuickJS which lacks a native URL class.
//
// Limitation: `searchParams` is NOT supported and will throw if accessed.
//
// Why? The WHATWG URL standard requires URLSearchParams to decode percent-encoded
// query parameters as UTF-8. When decoding fails (invalid UTF-8), browsers like
// Chrome silently replace invalid bytes with U+FFFD (�) replacement characters.
//
// This is problematic for BitTorrent tracker URLs which contain binary data
// (info_hash) as percent-encoded bytes that are NOT valid UTF-8. For example:
//   ?info_hash=%95%c6%1b... (20-byte SHA1 hash, arbitrary binary)
//
// If we implemented the full spec, accessing searchParams.get('info_hash') would
// return garbled data like '��\x1B' instead of the original bytes - a silent
// data corruption footgun.
//
// JavaScript's decodeURIComponent() throws on invalid UTF-8, which is actually
// safer than silent corruption, but it would break URL construction entirely.
//
// Solution: This polyfill supports extracting URL components (hostname, port,
// pathname, search) without decoding. The raw `search` string can be used
// directly for HTTP requests. If you need parsed query params, use a custom
// parser that handles your specific encoding requirements.
//
// See also: packages/engine/src/utils/minimal-http-client.ts parseUrl()
// ============================================================

/**
 * Limited URL polyfill for QuickJS.
 * Exported for testing - use globalThis.URL at runtime.
 */
export class PolyfillURL {
  href: string
  origin: string
  protocol: string
  username: string
  password: string
  host: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string

  constructor(url: string, base?: string | PolyfillURL) {
    // Handle base URL
    let fullUrl = url
    if (base) {
      const baseStr = typeof base === 'string' ? base : base.href
      // Simple base URL handling
      if (!url.includes('://')) {
        if (url.startsWith('/')) {
          // Absolute path
          const baseMatch = baseStr.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]+)/i)
          fullUrl = baseMatch ? baseMatch[1] + url : url
        } else if (url.startsWith('?') || url.startsWith('#')) {
          // Query or hash only
          fullUrl = baseStr.split(/[?#]/)[0] + url
        } else {
          // Relative path
          const lastSlash = baseStr.lastIndexOf('/')
          fullUrl = baseStr.substring(0, lastSlash + 1) + url
        }
      }
    }

    // Parse the URL
    // Format: protocol://[username:password@]hostname[:port]/pathname[?search][#hash]
    const protocolMatch = fullUrl.match(/^([a-z][a-z0-9+.-]*):(?:\/\/)?/i)
    if (!protocolMatch) {
      throw new TypeError(`Invalid URL: ${url}`)
    }

    this.protocol = protocolMatch[1].toLowerCase() + ':'
    let rest = fullUrl.substring(protocolMatch[0].length)

    // Extract hash
    const hashIndex = rest.indexOf('#')
    if (hashIndex !== -1) {
      this.hash = rest.substring(hashIndex)
      rest = rest.substring(0, hashIndex)
    } else {
      this.hash = ''
    }

    // Extract search
    const searchIndex = rest.indexOf('?')
    if (searchIndex !== -1) {
      this.search = rest.substring(searchIndex)
      rest = rest.substring(0, searchIndex)
    } else {
      this.search = ''
    }

    // Extract pathname
    const pathIndex = rest.indexOf('/')
    if (pathIndex !== -1) {
      this.pathname = rest.substring(pathIndex)
      rest = rest.substring(0, pathIndex)
    } else {
      this.pathname = '/'
    }

    // Extract username/password
    const atIndex = rest.indexOf('@')
    if (atIndex !== -1) {
      const userInfo = rest.substring(0, atIndex)
      rest = rest.substring(atIndex + 1)
      const colonIndex = userInfo.indexOf(':')
      if (colonIndex !== -1) {
        this.username = decodeURIComponent(userInfo.substring(0, colonIndex))
        this.password = decodeURIComponent(userInfo.substring(colonIndex + 1))
      } else {
        this.username = decodeURIComponent(userInfo)
        this.password = ''
      }
    } else {
      this.username = ''
      this.password = ''
    }

    // Extract port
    const portMatch = rest.match(/:(\d+)$/)
    if (portMatch) {
      this.port = portMatch[1]
      this.hostname = rest.substring(0, rest.length - portMatch[0].length)
    } else {
      this.port = ''
      this.hostname = rest
    }

    this.host = this.port ? `${this.hostname}:${this.port}` : this.hostname
    this.origin = `${this.protocol}//${this.host}`
    this.href = this.toString()
  }

  /**
   * NOT SUPPORTED - throws an error.
   *
   * This polyfill intentionally does not support searchParams because:
   * 1. URLSearchParams decodes percent-encoded values as UTF-8
   * 2. Invalid UTF-8 (like binary info_hash in tracker URLs) would either
   *    throw (with decodeURIComponent) or silently corrupt data (Chrome's
   *    replacement character behavior)
   *
   * Use the raw `search` property instead and parse it yourself if needed.
   */
  get searchParams(): never {
    throw new Error(
      'URL.searchParams is not supported in this QuickJS polyfill. ' +
        'URLSearchParams decodes query values as UTF-8, which corrupts binary data ' +
        '(e.g., BitTorrent info_hash). Use the raw `url.search` property instead ' +
        'and parse it manually if needed. See polyfills.ts for details.',
    )
  }

  toString(): string {
    let url = `${this.protocol}//`
    if (this.username) {
      url += encodeURIComponent(this.username)
      if (this.password) {
        url += ':' + encodeURIComponent(this.password)
      }
      url += '@'
    }
    url += this.host + this.pathname + this.search + this.hash
    return url
  }

  toJSON(): string {
    return this.href
  }
}

if (typeof URL === 'undefined') {
  ;(globalThis as Record<string, unknown>).URL = PolyfillURL
}

if (typeof URLSearchParams === 'undefined') {
  ;(globalThis as Record<string, unknown>).URLSearchParams = class URLSearchParams {
    private params: Map<string, string[]> = new Map()

    constructor(init?: string | string[][] | Record<string, string> | URLSearchParams) {
      if (typeof init === 'string') {
        // Remove leading '?'
        const queryString = init.startsWith('?') ? init.substring(1) : init
        if (queryString) {
          for (const part of queryString.split('&')) {
            const [key, value = ''] = part.split('=').map(decodeURIComponent)
            this.append(key, value)
          }
        }
      } else if (Array.isArray(init)) {
        for (const [key, value] of init) {
          this.append(key, value)
        }
      } else if (init && typeof init === 'object') {
        if (init instanceof URLSearchParams) {
          init.forEach((value, key) => this.append(key, value))
        } else {
          for (const [key, value] of Object.entries(init)) {
            this.append(key, value)
          }
        }
      }
    }

    append(name: string, value: string): void {
      const values = this.params.get(name) || []
      values.push(value)
      this.params.set(name, values)
    }

    delete(name: string): void {
      this.params.delete(name)
    }

    get(name: string): string | null {
      const values = this.params.get(name)
      return values ? values[0] : null
    }

    getAll(name: string): string[] {
      return this.params.get(name) || []
    }

    has(name: string): boolean {
      return this.params.has(name)
    }

    set(name: string, value: string): void {
      this.params.set(name, [value])
    }

    toString(): string {
      const parts: string[] = []
      this.params.forEach((values, key) => {
        for (const value of values) {
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        }
      })
      return parts.join('&')
    }

    forEach(callback: (value: string, key: string, parent: URLSearchParams) => void): void {
      this.params.forEach((values, key) => {
        for (const value of values) {
          callback(value, key, this)
        }
      })
    }

    *entries(): IterableIterator<[string, string]> {
      for (const [key, values] of this.params) {
        for (const value of values) {
          yield [key, value]
        }
      }
    }

    *keys(): IterableIterator<string> {
      for (const [key] of this.entries()) {
        yield key
      }
    }

    *values(): IterableIterator<string> {
      for (const [, value] of this.entries()) {
        yield value
      }
    }

    [Symbol.iterator](): IterableIterator<[string, string]> {
      return this.entries()
    }
  }
}

// ============================================================
// console
// ============================================================

if (typeof console === 'undefined' || !console.log) {
  const createLogFn =
    (level: string) =>
    (...args: unknown[]): void => {
      const message = args
        .map((arg) => {
          if (typeof arg === 'string') return arg
          if (arg === null) return 'null'
          if (arg === undefined) return 'undefined'
          try {
            return JSON.stringify(arg)
          } catch {
            return String(arg)
          }
        })
        .join(' ')
      __jstorrent_console_log(level, message)
    }

  ;(globalThis as Record<string, unknown>).console = {
    log: createLogFn('info'),
    info: createLogFn('info'),
    warn: createLogFn('warn'),
    error: createLogFn('error'),
    debug: createLogFn('debug'),
    trace: createLogFn('trace'),
    assert: (condition: boolean, ...args: unknown[]): void => {
      if (!condition) {
        createLogFn('error')('Assertion failed:', ...args)
      }
    },
    dir: createLogFn('debug'),
    table: createLogFn('debug'),
    time: (): void => {},
    timeEnd: (): void => {},
    group: (): void => {},
    groupEnd: (): void => {},
    clear: (): void => {},
    count: (): void => {},
    countReset: (): void => {},
  }
}
