import type { ISessionStore } from '../../interfaces/session-store'
import { JsBridgeKVStore } from './JsBridgeKVStore'

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

const SESSION_PREFIX = 'session:'
const JSON_MARKER = 'json:'

/**
 * Session store for Android standalone mode.
 * Stores torrent sessions in SharedPreferences via KVBridge.
 *
 * Binary data is stored as base64.
 * JSON data is stored with a 'json:' prefix to distinguish from binary.
 */
export class JsBridgeSessionStore implements ISessionStore {
  private kv = new JsBridgeKVStore()

  private prefixKey(key: string): string {
    return SESSION_PREFIX + key
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const value = this.kv.get(this.prefixKey(key))
      if (value !== null && !value.startsWith(JSON_MARKER)) {
        return fromBase64(value)
      }
    } catch (e) {
      console.warn('[JsBridgeSessionStore] get error:', e)
    }
    return null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    try {
      this.kv.set(this.prefixKey(key), toBase64(value))
    } catch (e) {
      console.error('[JsBridgeSessionStore] set error:', e)
      throw e
    }
  }

  async delete(key: string): Promise<void> {
    try {
      this.kv.delete(this.prefixKey(key))
    } catch (e) {
      console.warn('[JsBridgeSessionStore] delete error:', e)
    }
  }

  async keys(prefix?: string): Promise<string[]> {
    try {
      const fullPrefix = SESSION_PREFIX + (prefix ?? '')
      const allKeys = this.kv.keys(fullPrefix)
      return allKeys.map((k) => k.slice(SESSION_PREFIX.length))
    } catch (e) {
      console.warn('[JsBridgeSessionStore] keys error:', e)
    }
    return []
  }

  async clear(): Promise<void> {
    try {
      // Only clear session keys, not all keys
      const sessionKeys = this.kv.keys(SESSION_PREFIX)
      for (const key of sessionKeys) {
        this.kv.delete(key)
      }
    } catch (e) {
      console.warn('[JsBridgeSessionStore] clear error:', e)
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const value = this.kv.get(this.prefixKey(key))
      if (value !== null) {
        // Handle both old format (direct JSON) and new format (json: prefix)
        if (value.startsWith(JSON_MARKER)) {
          return JSON.parse(value.slice(JSON_MARKER.length)) as T
        }
        // Try parsing as JSON (legacy support)
        try {
          return JSON.parse(value) as T
        } catch {
          // Not JSON, return null
        }
      }
    } catch (e) {
      console.warn('[JsBridgeSessionStore] getJson error:', e)
    }
    return null
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    try {
      // Prefix with 'json:' to distinguish from binary base64 data
      this.kv.set(this.prefixKey(key), JSON_MARKER + JSON.stringify(value))
    } catch (e) {
      console.error('[JsBridgeSessionStore] setJson error:', e)
      throw e
    }
  }
}
