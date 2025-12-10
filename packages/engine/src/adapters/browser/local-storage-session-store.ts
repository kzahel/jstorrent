import { ISessionStore } from '../../interfaces/session-store'

/**
 * Convert Uint8Array to base64 string for storage.
 */
function toBase64(buffer: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
}

/**
 * Convert base64 string back to Uint8Array.
 */
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Session store backed by window.localStorage.
 * Useful for dev mode when chrome.storage.local isn't available.
 *
 * TODO: Replace with IndexedDB or OPFS for better performance.
 * localStorage is synchronous/blocking which can cause jank on the main thread,
 * especially with larger datasets. IndexedDB is async and has much higher
 * storage limits (~50MB+ vs ~5MB for localStorage).
 *
 * Note: localStorage has a ~5MB limit per origin, which should be
 * sufficient for session metadata but not for large data.
 */
export class LocalStorageSessionStore implements ISessionStore {
  constructor(private prefix: string = 'jstorrent:session:') {}

  private prefixKey(key: string): string {
    return this.prefix + key
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const value = localStorage.getItem(this.prefixKey(key))
      if (value !== null) {
        return fromBase64(value)
      }
    } catch (e) {
      console.warn('[LocalStorageSessionStore] get error:', e)
    }
    return null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    try {
      localStorage.setItem(this.prefixKey(key), toBase64(value))
    } catch (e) {
      // localStorage might be full or disabled
      console.error('[LocalStorageSessionStore] set error:', e)
      throw e
    }
  }

  async delete(key: string): Promise<void> {
    try {
      localStorage.removeItem(this.prefixKey(key))
    } catch (e) {
      console.warn('[LocalStorageSessionStore] delete error:', e)
    }
  }

  async keys(prefix?: string): Promise<string[]> {
    const result: string[] = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i)
        if (fullKey && fullKey.startsWith(this.prefix)) {
          const key = fullKey.slice(this.prefix.length)
          if (!prefix || key.startsWith(prefix)) {
            result.push(key)
          }
        }
      }
    } catch (e) {
      console.warn('[LocalStorageSessionStore] keys error:', e)
    }
    return result
  }

  async clear(): Promise<void> {
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith(this.prefix)) {
          keysToRemove.push(key)
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key)
      }
    } catch (e) {
      console.warn('[LocalStorageSessionStore] clear error:', e)
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const value = localStorage.getItem(this.prefixKey(key))
      if (value !== null) {
        return JSON.parse(value) as T
      }
    } catch (e) {
      console.warn('[LocalStorageSessionStore] getJson error:', e)
    }
    return null
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    try {
      localStorage.setItem(this.prefixKey(key), JSON.stringify(value))
    } catch (e) {
      console.error('[LocalStorageSessionStore] setJson error:', e)
      throw e
    }
  }
}
