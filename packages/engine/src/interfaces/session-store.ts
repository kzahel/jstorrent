export interface ISessionStore {
  // Binary data (for .torrent files, info dicts)
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  clear(): Promise<void>

  // Optional batch operation (for performance)
  getMulti?(keys: string[]): Promise<Map<string, Uint8Array>>

  // JSON data (for torrent list, state) - stored directly without base64
  getJson<T>(key: string): Promise<T | null>
  setJson<T>(key: string, value: T): Promise<void>
}
