import { ISessionStore } from '../../interfaces/session-store'
import * as fs from 'fs/promises'
import * as path from 'path'

export class JsonFileSessionStore implements ISessionStore {
  private data: Map<string, Uint8Array> = new Map()
  private dirty = false
  private loaded = false

  constructor(private filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    try {
      const content = await fs.readFile(this.filePath, 'utf-8')
      const json = JSON.parse(content)
      for (const [key, value] of Object.entries(json)) {
        if (typeof value === 'string') {
          this.data.set(key, Buffer.from(value, 'base64'))
        }
      }
    } catch (error) {
      if ((error as { code: string }).code !== 'ENOENT') {
        throw error
      }
    }
    this.loaded = true
  }

  async flush(): Promise<void> {
    if (!this.dirty) return

    const json: Record<string, string> = {}
    for (const [key, value] of this.data.entries()) {
      json[key] = Buffer.from(value).toString('base64')
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(json, null, 2))
    this.dirty = false
  }

  async get(key: string): Promise<Uint8Array | null> {
    await this.ensureLoaded()
    return this.data.get(key) ?? null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await this.ensureLoaded()
    this.data.set(key, value)
    this.dirty = true
  }

  async delete(key: string): Promise<void> {
    await this.ensureLoaded()
    this.data.delete(key)
    this.dirty = true
  }

  async keys(prefix?: string): Promise<string[]> {
    await this.ensureLoaded()
    const keys = Array.from(this.data.keys())
    if (prefix) {
      return keys.filter((k) => k.startsWith(prefix))
    }
    return keys
  }

  async clear(): Promise<void> {
    this.data.clear()
    this.dirty = true
  }
}
