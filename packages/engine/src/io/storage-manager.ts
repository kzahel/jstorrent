import { IStorageHandle } from './storage-handle'

export class StorageManager {
  private handles: Map<string, IStorageHandle> = new Map()

  /**
   * Register a storage handle.
   */
  register(handle: IStorageHandle): void {
    if (this.handles.has(handle.id)) {
      console.warn(`StorageManager: Overwriting handle with id ${handle.id}`)
    }
    this.handles.set(handle.id, handle)
  }

  /**
   * Retrieve a storage handle by ID.
   */
  get(id: string): IStorageHandle | undefined {
    return this.handles.get(id)
  }

  /**
   * Unregister a storage handle.
   */
  unregister(id: string): boolean {
    return this.handles.delete(id)
  }

  /**
   * Get all registered handles.
   */
  getAll(): IStorageHandle[] {
    return Array.from(this.handles.values())
  }
}
