import { ISessionStore } from '../../interfaces/session-store'

export class MemorySessionStore implements ISessionStore {
    private data: Map<string, Uint8Array> = new Map()

    async get(key: string): Promise<Uint8Array | null> {
        return this.data.get(key) ?? null
    }

    async set(key: string, value: Uint8Array): Promise<void> {
        this.data.set(key, value)
    }

    async delete(key: string): Promise<void> {
        this.data.delete(key)
    }

    async keys(prefix?: string): Promise<string[]> {
        const keys = Array.from(this.data.keys())
        if (prefix) {
            return keys.filter((k) => k.startsWith(prefix))
        }
        return keys
    }

    async clear(): Promise<void> {
        this.data.clear()
    }
}
