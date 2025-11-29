import { ISessionStore } from '../../interfaces/session-store'

// Helper to convert Uint8Array to base64 string for storage
function toBase64(buffer: Uint8Array): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// Helper to convert base64 string back to Uint8Array
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any

export class ChromeStorageSessionStore implements ISessionStore {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private storageArea: any = chrome.storage.local,
    private prefix: string = 'session:'
  ) {}

  private prefixKey(key: string): string {
    return this.prefix + key
  }

  async get(key: string): Promise<Uint8Array | null> {
    const prefixedKey = this.prefixKey(key)
    const result = await this.storageArea.get(prefixedKey)
    const value = result[prefixedKey]
    if (typeof value === 'string') {
      return fromBase64(value)
    }
    return null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await this.storageArea.set({ [this.prefixKey(key)]: toBase64(value) })
  }

  async delete(key: string): Promise<void> {
    await this.storageArea.remove(this.prefixKey(key))
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = await this.storageArea.get(null)
    const allKeys = Object.keys(all)

    // Filter to only our namespace
    const ourKeys = allKeys
      .filter((k) => k.startsWith(this.prefix))
      .map((k) => k.slice(this.prefix.length))

    if (prefix) {
      return ourKeys.filter((k) => k.startsWith(prefix))
    }
    return ourKeys
  }

  async clear(): Promise<void> {
    // Only clear keys in our namespace, not all extension storage
    const keys = await this.keys()
    const prefixedKeys = keys.map((k) => this.prefixKey(k))
    await this.storageArea.remove(prefixedKeys)
  }
}
