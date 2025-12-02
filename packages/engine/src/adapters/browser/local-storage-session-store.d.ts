import { ISessionStore } from '../../interfaces/session-store'
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
export declare class LocalStorageSessionStore implements ISessionStore {
  private prefix
  constructor(prefix?: string)
  private prefixKey
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  clear(): Promise<void>
}
//# sourceMappingURL=local-storage-session-store.d.ts.map
