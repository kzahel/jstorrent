export interface ISessionStore {
    get(key: string): Promise<Uint8Array | null>
    set(key: string, value: Uint8Array): Promise<void>
    delete(key: string): Promise<void>
    keys(prefix?: string): Promise<string[]>
    clear(): Promise<void>
}
