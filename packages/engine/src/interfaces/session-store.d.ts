export interface ISessionStore {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
  clear(): Promise<void>
  getMulti?(keys: string[]): Promise<Map<string, Uint8Array>>
}
//# sourceMappingURL=session-store.d.ts.map
