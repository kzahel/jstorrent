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

    encodeInto(
      str: string,
      dest: Uint8Array,
    ): { read: number; written: number } {
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
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
        '',
      )
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`
    },
  }

  if (typeof crypto === 'undefined') {
    ;(globalThis as Record<string, unknown>).crypto = cryptoPolyfill
  } else {
    ;(crypto as unknown as Record<string, unknown>).getRandomValues =
      cryptoPolyfill.getRandomValues
    if (!crypto.randomUUID) {
      ;(crypto as unknown as Record<string, unknown>).randomUUID =
        cryptoPolyfill.randomUUID
    }
  }
}

// ============================================================
// btoa / atob (Base64)
// ============================================================

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

if (typeof btoa === 'undefined') {
  ;(globalThis as Record<string, unknown>).btoa = (str: string): string => {
    // Convert string to bytes (Latin-1 encoding)
    const bytes = new Uint8Array(str.length)
    for (let i = 0; i < str.length; i++) {
      const charCode = str.charCodeAt(i)
      if (charCode > 255) {
        throw new Error(
          "btoa: Character out of range. Use encodeURIComponent for Unicode.",
        )
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
      result +=
        i + 1 < bytes.length ? BASE64_CHARS[((b & 15) << 2) | (c >> 6)] : '='
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
