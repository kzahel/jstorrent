import { ISessionStore } from '../../interfaces/session-store'
import * as fs from 'fs/promises'
import * as path from 'path'

export class JsonFileSessionStore implements ISessionStore {
  private binaryData: Map<string, Uint8Array> = new Map()
  private jsonData: Map<string, unknown> = new Map()
  private dirty = false
  private loaded = false

  constructor(private filePath: string) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    try {
      const content = await fs.readFile(this.filePath, 'utf-8')
      const json = JSON.parse(content)

      // Load binary data (base64 encoded strings with 'binary:' prefix)
      const binarySection = json.binary || {}
      for (const [key, value] of Object.entries(binarySection)) {
        if (typeof value === 'string') {
          this.binaryData.set(key, Buffer.from(value, 'base64'))
        }
      }

      // Load JSON data
      const jsonSection = json.json || {}
      for (const [key, value] of Object.entries(jsonSection)) {
        this.jsonData.set(key, value)
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

    const binary: Record<string, string> = {}
    for (const [key, value] of this.binaryData.entries()) {
      binary[key] = Buffer.from(value).toString('base64')
    }

    const json: Record<string, unknown> = {}
    for (const [key, value] of this.jsonData.entries()) {
      json[key] = value
    }

    const output = { binary, json }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(output, null, 2))
    this.dirty = false
  }

  async get(key: string): Promise<Uint8Array | null> {
    await this.ensureLoaded()
    return this.binaryData.get(key) ?? null
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await this.ensureLoaded()
    this.binaryData.set(key, value)
    this.dirty = true
    // Immediately flush to ensure persistence across restarts
    await this.flush()
  }

  async delete(key: string): Promise<void> {
    await this.ensureLoaded()
    this.binaryData.delete(key)
    this.jsonData.delete(key)
    this.dirty = true
  }

  async keys(prefix?: string): Promise<string[]> {
    await this.ensureLoaded()
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
    this.dirty = true
  }

  async getJson<T>(key: string): Promise<T | null> {
    await this.ensureLoaded()
    const value = this.jsonData.get(key)
    return (value as T) ?? null
  }

  async setJson<T>(key: string, value: T): Promise<void> {
    await this.ensureLoaded()
    this.jsonData.set(key, value)
    this.dirty = true
    // Immediately flush to ensure persistence across restarts
    await this.flush()
  }
}
