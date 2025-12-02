import { ISessionStore } from '../../interfaces/session-store'
export declare class ChromeStorageSessionStore implements ISessionStore {
  private storageArea
  private prefix
  constructor(storageArea?: any, prefix?: string)
  private prefixKey
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  clear(): Promise<void>
}
//# sourceMappingURL=chrome-storage-session-store.d.ts.map
