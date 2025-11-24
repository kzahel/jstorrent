import { IFileSystem } from '../interfaces/filesystem'

export interface IStorageHandle {
  /**
   * Unique identifier for this storage handle.
   * For persisted handles, this should be stable across sessions.
   */
  id: string

  /**
   * Human-readable name for this storage location (e.g. "Downloads", "External Drive")
   */
  name: string

  /**
   * Returns a file system interface rooted at this storage handle.
   * All paths used with this file system should be relative to the handle's root.
   */
  getFileSystem(): IFileSystem
}
