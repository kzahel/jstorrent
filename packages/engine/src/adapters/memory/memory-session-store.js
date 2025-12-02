export class MemorySessionStore {
  constructor() {
    this.data = new Map()
  }
  async get(key) {
    return this.data.get(key) ?? null
  }
  async set(key, value) {
    this.data.set(key, value)
  }
  async delete(key) {
    this.data.delete(key)
  }
  async keys(prefix) {
    const keys = Array.from(this.data.keys())
    if (prefix) {
      return keys.filter((k) => k.startsWith(prefix))
    }
    return keys
  }
  async clear() {
    this.data.clear()
  }
}
