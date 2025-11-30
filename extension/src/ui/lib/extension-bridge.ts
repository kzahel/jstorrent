/**
 * Abstraction for communicating with the Chrome extension service worker.
 *
 * In production (chrome-extension://), uses chrome.runtime.sendMessage directly.
 * In dev mode (localhost), uses chrome.runtime.sendMessage with extension ID
 * via externally_connectable.
 */

export interface ExtensionBridge {
  /**
   * Send a message to the service worker and wait for response.
   */
  sendMessage<T = unknown>(message: unknown): Promise<T>

  /**
   * Send a message without waiting for response (fire and forget).
   */
  postMessage(message: unknown): void

  /**
   * Whether we're running in dev mode (localhost).
   */
  readonly isDevMode: boolean

  /**
   * The extension ID (only set in dev mode).
   */
  readonly extensionId: string | null
}

/**
 * Bridge for use inside the Chrome extension context.
 * Uses chrome.runtime.sendMessage directly.
 */
class InternalBridge implements ExtensionBridge {
  readonly isDevMode = false
  readonly extensionId = null

  sendMessage<T = unknown>(message: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response as T)
        }
      })
    })
  }

  postMessage(message: unknown): void {
    chrome.runtime.sendMessage(message).catch(() => {
      // Ignore errors for fire-and-forget messages
    })
  }
}

/**
 * Bridge for use from localhost dev server.
 * Uses chrome.runtime.sendMessage with extension ID via externally_connectable.
 */
class ExternalBridge implements ExtensionBridge {
  readonly isDevMode = true
  readonly extensionId: string

  constructor(extensionId: string) {
    this.extensionId = extensionId
  }

  sendMessage<T = unknown>(message: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(this.extensionId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response as T)
        }
      })
    })
  }

  postMessage(message: unknown): void {
    chrome.runtime.sendMessage(this.extensionId, message).catch(() => {
      // Ignore errors for fire-and-forget messages
    })
  }
}

/**
 * Storage key for persisting extension ID in dev mode.
 */
const EXTENSION_ID_KEY = 'jstorrent_extension_id'

/**
 * Get extension ID from various sources (for dev mode).
 */
function getExtensionId(): string | null {
  // 1. Check Vite env variable
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV_EXTENSION_ID) {
    return import.meta.env.DEV_EXTENSION_ID
  }

  // 2. Check localStorage (previously saved)
  try {
    const saved = localStorage.getItem(EXTENSION_ID_KEY)
    if (saved) return saved
  } catch {
    // localStorage might not be available
  }

  // 3. Check URL query param (useful for first-time setup)
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('extensionId')
    if (fromUrl) {
      // Save for future use
      localStorage.setItem(EXTENSION_ID_KEY, fromUrl)
      return fromUrl
    }
  } catch {
    // URL parsing might fail
  }

  return null
}

/**
 * Save extension ID to localStorage for future dev sessions.
 */
export function saveExtensionId(extensionId: string): void {
  try {
    localStorage.setItem(EXTENSION_ID_KEY, extensionId)
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear saved extension ID.
 */
export function clearExtensionId(): void {
  try {
    localStorage.removeItem(EXTENSION_ID_KEY)
  } catch {
    // Ignore storage errors
  }
}

/**
 * Check if we're running inside a Chrome extension context.
 */
function isExtensionContext(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.id === 'string' &&
    chrome.runtime.id.length > 0
  )
}

/**
 * Create the appropriate bridge based on context.
 *
 * - Inside extension: returns InternalBridge
 * - On localhost with extension ID: returns ExternalBridge
 * - On localhost without extension ID: throws error with instructions
 */
export function createBridge(): ExtensionBridge {
  // Inside extension context - use internal bridge
  if (isExtensionContext()) {
    console.log('[ExtensionBridge] Running in extension context')
    return new InternalBridge()
  }

  // Dev mode - need extension ID for external messaging
  const extensionId = getExtensionId()

  if (!extensionId) {
    const msg = `
[ExtensionBridge] Dev mode detected but no extension ID found.

To connect to the extension from localhost:

1. Load the extension in Chrome and find its ID:
   chrome://extensions → Your extension → Copy ID

2. Provide the extension ID via one of:
   - URL param: ?extensionId=YOUR_EXTENSION_ID
   - Env var: DEV_EXTENSION_ID=YOUR_EXTENSION_ID npm run dev
   - localStorage: localStorage.setItem('jstorrent_extension_id', 'YOUR_EXTENSION_ID')

3. Make sure the extension's manifest.json has your dev origin in externally_connectable:
   "externally_connectable": {
     "matches": ["http://local.jstorrent.com:*", ...]
   }
`.trim()
    console.error(msg)
    throw new Error('Extension ID required for dev mode. See console for instructions.')
  }

  console.log(`[ExtensionBridge] Dev mode with extension ID: ${extensionId}`)
  return new ExternalBridge(extensionId)
}

// Singleton bridge instance
let bridgeInstance: ExtensionBridge | null = null

/**
 * Get the singleton bridge instance.
 * Creates it on first call.
 */
export function getBridge(): ExtensionBridge {
  if (!bridgeInstance) {
    bridgeInstance = createBridge()
  }
  return bridgeInstance
}

/**
 * Reset the bridge (useful for testing or reconnecting with different extension ID).
 */
export function resetBridge(): void {
  bridgeInstance = null
}
