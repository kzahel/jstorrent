import { ISessionStore } from '../../interfaces/session-store'
/**
 * Session store that relays operations to the extension service worker
 * via externally_connectable messaging.
 *
 * Use this when running the engine on jstorrent.com or localhost dev server.
 *
 * Values are base64 encoded for transport and stored as-is in chrome.storage.local.
 * The SW owns the key prefix - this class sends unprefixed keys.
 */
export declare class ExternalChromeStorageSessionStore implements ISessionStore {
  private extensionId
  constructor(extensionId: string)
  private send
  get(key: string): Promise<Uint8Array | null>
  getMulti(keys: string[]): Promise<Map<string, Uint8Array>>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  clear(): Promise<void>
}
//# sourceMappingURL=external-chrome-storage-session-store.d.ts.map
