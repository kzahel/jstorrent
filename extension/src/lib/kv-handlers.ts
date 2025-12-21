/**
 * KV storage handlers for external session store and settings.
 *
 * Supports configurable storage area (local/sync) and key prefix.
 * Defaults to chrome.storage.local with 'session:' prefix for backward compatibility.
 * Binary values are stored as base64 strings.
 * JSON values are stored directly.
 */

const DEFAULT_PREFIX = 'session:'

export type KVSendResponse = (response: unknown) => void

export function handleKVMessage(
  message: {
    type?: string
    key?: string
    keys?: string[]
    value?: string | unknown
    prefix?: string
    keyPrefix?: string // The prefix to use for storage keys (defaults to 'session:')
    area?: 'sync' | 'local' // Storage area (defaults to 'local')
  },
  sendResponse: KVSendResponse,
): boolean {
  // Select storage area and prefix based on message parameters
  const keyPrefix = message.keyPrefix ?? DEFAULT_PREFIX
  const storage = message.area === 'sync' ? chrome.storage.sync : chrome.storage.local

  function prefixKey(key: string): string {
    return keyPrefix + key
  }

  function unprefixKey(key: string): string {
    return key.startsWith(keyPrefix) ? key.slice(keyPrefix.length) : key
  }
  if (message.type === 'KV_GET') {
    const prefixedKey = prefixKey(message.key!)
    storage
      .get(prefixedKey)
      .then((result) => {
        const value = result[prefixedKey] ?? null
        sendResponse({ ok: true, value })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_GET_MULTI') {
    const prefixedKeys = message.keys!.map(prefixKey)
    storage
      .get(prefixedKeys)
      .then((result) => {
        const values: Record<string, string | null> = {}
        for (const key of message.keys!) {
          values[key] = (result[prefixKey(key)] as string | undefined) ?? null
        }
        sendResponse({ ok: true, values })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_SET') {
    const prefixedKey = prefixKey(message.key!)
    storage
      .set({ [prefixedKey]: message.value })
      .then(() => {
        sendResponse({ ok: true })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_DELETE') {
    const prefixedKey = prefixKey(message.key!)
    storage
      .remove(prefixedKey)
      .then(() => {
        sendResponse({ ok: true })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_KEYS') {
    storage
      .get(null)
      .then((all) => {
        const keys = Object.keys(all)
          .filter((k) => k.startsWith(keyPrefix))
          .map(unprefixKey)
          .filter((k) => !message.prefix || k.startsWith(message.prefix))
        sendResponse({ ok: true, keys })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_CLEAR') {
    storage
      .get(null)
      .then((all) => {
        const keysToRemove = Object.keys(all).filter((k) => k.startsWith(keyPrefix))
        return storage.remove(keysToRemove)
      })
      .then(() => {
        sendResponse({ ok: true })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  // JSON-specific handlers (stored directly, not as base64)
  if (message.type === 'KV_GET_JSON') {
    const prefixedKey = prefixKey(message.key!)
    storage
      .get(prefixedKey)
      .then((result) => {
        const value = result[prefixedKey] ?? null
        sendResponse({ ok: true, value })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_SET_JSON') {
    const prefixedKey = prefixKey(message.key!)
    storage
      .set({ [prefixedKey]: message.value })
      .then(() => {
        sendResponse({ ok: true })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  return false
}
