function toBase64(buffer) {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
}
function fromBase64(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
/**
 * Session store that relays operations to the extension service worker
 * via externally_connectable messaging.
 *
 * Use this when running the engine on jstorrent.com or localhost dev server.
 *
 * Values are base64 encoded for transport and stored as-is in chrome.storage.local.
 * The SW owns the key prefix - this class sends unprefixed keys.
 */
export class ExternalChromeStorageSessionStore {
  constructor(extensionId) {
    this.extensionId = extensionId
  }
  async send(message) {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error('chrome.runtime.sendMessage not available'))
        return
      }
      chrome.runtime.sendMessage(this.extensionId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (!response) {
          reject(new Error('No response from extension - is it installed?'))
        } else {
          resolve(response)
        }
      })
    })
  }
  async get(key) {
    const response = await this.send({
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
  async getMulti(keys) {
    if (keys.length === 0) {
      return new Map()
    }
    const response = await this.send({
      type: 'KV_GET_MULTI',
      keys,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_GET_MULTI failed')
    }
    const result = new Map()
    if (response.values) {
      for (const [key, value] of Object.entries(response.values)) {
        if (value !== null) {
          result.set(key, fromBase64(value))
        }
      }
    }
    return result
  }
  async set(key, value) {
    const response = await this.send({
      type: 'KV_SET',
      key,
      value: toBase64(value), // Encode once, stored as-is
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_SET failed')
    }
  }
  async delete(key) {
    const response = await this.send({
      type: 'KV_DELETE',
      key,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_DELETE failed')
    }
  }
  async keys(prefix) {
    const response = await this.send({
      type: 'KV_KEYS',
      prefix,
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_KEYS failed')
    }
    return response.keys || []
  }
  async clear() {
    const response = await this.send({
      type: 'KV_CLEAR',
    })
    if (!response.ok) {
      throw new Error(response.error || 'KV_CLEAR failed')
    }
  }
}
