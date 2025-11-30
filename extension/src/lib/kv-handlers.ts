/**
 * KV storage handlers for external session store.
 *
 * Uses chrome.storage.local directly with 'session:' prefix.
 * Values are stored as base64 strings (passed through from external store).
 */

const PREFIX = 'session:'

function prefixKey(key: string): string {
  return PREFIX + key
}

function unprefixKey(key: string): string {
  return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key
}

export type KVSendResponse = (response: unknown) => void

export function handleKVMessage(
  message: { type?: string; key?: string; keys?: string[]; value?: string; prefix?: string },
  sendResponse: KVSendResponse,
): boolean {
  if (message.type === 'KV_GET') {
    const prefixedKey = prefixKey(message.key!)
    chrome.storage.local
      .get(prefixedKey)
      .then((result) => {
        const value = result[prefixedKey] ?? null // Already base64 or null
        sendResponse({ ok: true, value })
      })
      .catch((e) => {
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  if (message.type === 'KV_GET_MULTI') {
    const prefixedKeys = message.keys!.map(prefixKey)
    chrome.storage.local
      .get(prefixedKeys)
      .then((result) => {
        const values: Record<string, string | null> = {}
        for (const key of message.keys!) {
          values[key] = result[prefixKey(key)] ?? null
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
    // Store base64 value directly - no decode/re-encode
    chrome.storage.local
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
    chrome.storage.local
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
    chrome.storage.local
      .get(null)
      .then((all) => {
        const keys = Object.keys(all)
          .filter((k) => k.startsWith(PREFIX))
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
    chrome.storage.local
      .get(null)
      .then((all) => {
        const keysToRemove = Object.keys(all).filter((k) => k.startsWith(PREFIX))
        return chrome.storage.local.remove(keysToRemove)
      })
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
