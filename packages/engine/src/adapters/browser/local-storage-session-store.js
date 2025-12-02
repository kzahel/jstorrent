/**
 * Convert Uint8Array to base64 string for storage.
 */
function toBase64(buffer) {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
}
/**
 * Convert base64 string back to Uint8Array.
 */
function fromBase64(base64) {
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
export class LocalStorageSessionStore {
  constructor(prefix = 'jstorrent:session:') {
    this.prefix = prefix
  }
  prefixKey(key) {
    return this.prefix + key
  }
  async get(key) {
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
  async set(key, value) {
    try {
      localStorage.setItem(this.prefixKey(key), toBase64(value))
    } catch (e) {
      // localStorage might be full or disabled
      console.error('[LocalStorageSessionStore] set error:', e)
      throw e
    }
  }
  async delete(key) {
    try {
      localStorage.removeItem(this.prefixKey(key))
    } catch (e) {
      console.warn('[LocalStorageSessionStore] delete error:', e)
    }
  }
  async keys(prefix) {
    const result = []
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
  async clear() {
    try {
      const keysToRemove = []
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
}
