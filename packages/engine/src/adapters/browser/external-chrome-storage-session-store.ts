import { ISessionStore } from '../../interfaces/session-store'

function toBase64(buffer: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any

/**
 * Session store that relays operations to the extension service worker
 * via messaging.
 *
 * When extensionId is provided, uses externally_connectable messaging
 * (for jstorrent.com or localhost dev server).
 *
 * When extensionId is undefined, uses internal messaging
 * (for extension UI context).
 *
 * Binary values are base64 encoded for transport.
 * JSON values are passed directly.
 */
export class ExternalChromeStorageSessionStore implements ISessionStore {
  constructor(private extensionId?: string) {}

  private async send<T>(message: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error('chrome.runtime.sendMessage not available'))
        return
      }

      const callback = (response: T) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (!response) {
          reject(new Error('No response from extension - is it installed?'))
        } else {
          resolve(response)
        }
      }

      if (this.extensionId) {
        // External context: include extension ID
        chrome.runtime.sendMessage(this.extensionId, message, callback)
      } else {
        // Internal context: message within extension
        chrome.runtime.sendMessage(message, callback)
      }
    })
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.send<{ ok: boolean; value?: string | null; error?: string }>({
      type: 'KV_GET',
      key,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_GET failed')
    }
    if (response.value) {
      return fromBase64(response.value)
    }
    return null
  }

  async getMulti(keys: string[]): Promise<Map<string, Uint8Array>> {
    if (keys.length === 0) {
      return new Map()
    }

    const response = await this.send<{
      ok: boolean
      values?: Record<string, string | null>
      error?: string
    }>({
      type: 'KV_GET_MULTI',
      keys,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_GET_MULTI failed')
    }

    const result = new Map<string, Uint8Array>()
    if (response.values) {
      for (const [key, value] of Object.entries(response.values)) {
        if (value !== null) {
          result.set(key, fromBase64(value))
        }
      }
    }
    return result
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    const response = await this.send<{ ok: boolean; error?: string }>({
      type: 'KV_SET',
      key,
      value: toBase64(value),
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_SET failed')
    }
  }

  async delete(key: string): Promise<void> {
    const response = await this.send<{ ok: boolean; error?: string }>({
      type: 'KV_DELETE',
      key,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_DELETE failed')
    }
  }

  async keys(prefix?: string): Promise<string[]> {
    const response = await this.send<{ ok: boolean; keys?: string[]; error?: string }>({
      type: 'KV_KEYS',
      prefix,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_KEYS failed')
    }
    return response.keys || []
  }

  async clear(): Promise<void> {
    const response = await this.send<{ ok: boolean; error?: string }>({
      type: 'KV_CLEAR',
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_CLEAR failed')
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const response = await this.send<{ ok: boolean; value?: T | null; error?: string }>({
      type: 'KV_GET_JSON',
      key,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_GET_JSON failed')
    }
    return response.value ?? null
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    const response = await this.send<{ ok: boolean; error?: string }>({
      type: 'KV_SET_JSON',
      key,
      value,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_SET_JSON failed')
    }
  }
}
