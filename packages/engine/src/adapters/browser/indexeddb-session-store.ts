import { ISessionStore } from '../../interfaces/session-store'

export class IndexedDBSessionStore implements ISessionStore {
  constructor(private _dbName: string) {
    // Prevent unused variable error
    void this._dbName
  }

  async get(_key: string): Promise<Uint8Array | null> {
    throw new Error('Method not implemented.')
  }

  async set(_key: string, _value: Uint8Array): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async delete(_key: string): Promise<void> {
    throw new Error('Method not implemented.')
  }

  async keys(_prefix?: string): Promise<string[]> {
    throw new Error('Method not implemented.')
  }

  async clear(): Promise<void> {
    throw new Error('Method not implemented.')
  }
}
