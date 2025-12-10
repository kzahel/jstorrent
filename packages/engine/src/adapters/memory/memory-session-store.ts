import { ISessionStore } from '../../interfaces/session-store'

export class MemorySessionStore implements ISessionStore {
  private binaryData: Map<string, Uint8Array> = new Map()
  private jsonData: Map<string, unknown> = new Map()

  async get(key: string): Promise<Uint8Array | null> {
    return this.binaryData.get(key) ?? null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    this.binaryData.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.binaryData.delete(key)
    this.jsonData.delete(key)
  }

  async keys(prefix?: string): Promise<string[]> {
    const binaryKeys = Array.from(this.binaryData.keys())
    const jsonKeys = Array.from(this.jsonData.keys())
    const allKeys = [...new Set([...binaryKeys, ...jsonKeys])]
    if (prefix) {
      return allKeys.filter((k) => k.startsWith(prefix))
    }
    return allKeys
  }

  async clear(): Promise<void> {
    this.binaryData.clear()
    this.jsonData.clear()
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = this.jsonData.get(key)
    return (value as T) ?? null
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    this.jsonData.set(key, value)
  }
}
