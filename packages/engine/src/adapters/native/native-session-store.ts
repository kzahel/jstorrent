/**
 * Native Session Store
 *
 * Implements ISessionStore using native storage bindings.
 * Binary data is stored as base64, JSON data with a 'json:' prefix.
 */

import type { ISessionStore } from '../../interfaces/session-store'
import './bindings.d.ts'

const SESSION_PREFIX = 'session:'
const JSON_MARKER = 'json:'

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

export class NativeSessionStore implements ISessionStore {
  private prefixKey(key: string): string {
    return SESSION_PREFIX + key
  }

  /**
   * Get binary data by key.
   */
  async get(key: string): Promise<Uint8Array | null> {
    try {
      const value = __jstorrent_storage_get(this.prefixKey(key))
      if (value != null && !value.startsWith(JSON_MARKER)) {
        return fromBase64(value)
      }
    } catch (e) {
      console.warn('[NativeSessionStore] get error:', e)
    }
    return null
  }

  /**
   * Set binary data by key.
   */
  async set(key: string, value: Uint8Array): Promise<void> {
    try {
      __jstorrent_storage_set(this.prefixKey(key), toBase64(value))
    } catch (e) {
      console.error('[NativeSessionStore] set error:', e)
      throw e
    }
  }

  /**
   * Delete a key.
   */
  async delete(key: string): Promise<void> {
    try {
      __jstorrent_storage_delete(this.prefixKey(key))
    } catch (e) {
      console.warn('[NativeSessionStore] delete error:', e)
    }
  }

  /**
   * Get all keys with optional prefix.
   */
  async keys(prefix?: string): Promise<string[]> {
    try {
      const fullPrefix = SESSION_PREFIX + (prefix ?? '')
      const result = __jstorrent_storage_keys(fullPrefix)
      const allKeys = JSON.parse(result) as string[]
      // Remove the session prefix from keys before returning
      return allKeys.map((k) => k.slice(SESSION_PREFIX.length))
    } catch (e) {
      console.warn('[NativeSessionStore] keys error:', e)
    }
    return []
  }

  /**
   * Clear all session data.
   */
  async clear(): Promise<void> {
    try {
      // Get all session keys and delete them
      const result = __jstorrent_storage_keys(SESSION_PREFIX)
      const sessionKeys = JSON.parse(result) as string[]
      for (const key of sessionKeys) {
        __jstorrent_storage_delete(key)
      }
    } catch (e) {
      console.warn('[NativeSessionStore] clear error:', e)
    }
  }

  /**
   * Get JSON data by key.
   */
  async getJson<T>(key: string): Promise<T | null> {
    try {
      const value = __jstorrent_storage_get(this.prefixKey(key))
      if (value != null) {
        // Handle json: prefix format
        if (value.startsWith(JSON_MARKER)) {
          return JSON.parse(value.slice(JSON_MARKER.length)) as T
        }
        // Legacy: try parsing as JSON (for backwards compatibility)
        try {
          return JSON.parse(value) as T
        } catch {
          // Not JSON, return null
        }
      }
    } catch (e) {
      console.warn('[NativeSessionStore] getJson error:', e)
    }
    return null
  }

  /**
   * Set JSON data by key.
   */
  async setJson<T>(key: string, value: T): Promise<void> {
    try {
      // Prefix with 'json:' to distinguish from binary base64 data
      __jstorrent_storage_set(
        this.prefixKey(key),
        JSON_MARKER + JSON.stringify(value),
      )
    } catch (e) {
      console.error('[NativeSessionStore] setJson error:', e)
      throw e
    }
  }
}
