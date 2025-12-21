/**
 * TypeScript type declarations for Android WebView bridges.
 */
declare global {
  interface Window {
    KVBridge?: {
      get(key: string): string | null
      set(key: string, value: string): void
      delete(key: string): void
      clear(): void
      keys(prefix: string): string // JSON array
      getMulti(keysJson: string): string // JSON object
    }
    RootsBridge?: {
      hasDownloadRoot(): boolean
      getDownloadRoots(): string // JSON array
      getDefaultRootKey(): string | null
    }
  }
}

/**
 * KV store implementation using Android's @JavascriptInterface bridge.
 * Synchronous under the hood (SharedPreferences), but we wrap in async
 * for interface compatibility.
 */
export class JsBridgeKVStore {
  private get bridge() {
    if (!window.KVBridge) {
      throw new Error('KVBridge not available - not running in Android WebView')
    }
    return window.KVBridge
  }

  get(key: string): string | null {
    return this.bridge.get(key)
  }

  getJSON<T>(key: string): T | null {
    const value = this.bridge.get(key)
    return value ? JSON.parse(value) : null
  }

  set(key: string, value: string): void {
    this.bridge.set(key, value)
  }

  setJSON(key: string, value: unknown): void {
    this.bridge.set(key, JSON.stringify(value))
  }

  delete(key: string): void {
    this.bridge.delete(key)
  }

  keys(prefix: string): string[] {
    const json = this.bridge.keys(prefix)
    return JSON.parse(json)
  }

  getMulti(keys: string[]): Record<string, string> {
    const json = this.bridge.getMulti(JSON.stringify(keys))
    return JSON.parse(json)
  }

  clear(): void {
    this.bridge.clear()
  }
}
