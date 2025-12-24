/**
 * Native File System
 *
 * Implements IFileSystem using stateless native bindings.
 * Each instance is scoped to a specific storage root.
 */

import type { IFileSystem, IFileHandle, IFileStat } from '../../interfaces/filesystem'
import { NativeFileHandle } from './native-file-handle'
import './bindings.d.ts'

export class NativeFileSystem implements IFileSystem {
  constructor(private readonly rootKey: string) {}

  /**
   * Open a file.
   * Returns a stateless handle that stores (rootKey, path).
   * The mode parameter is ignored - actual file operations determine read/write behavior.
   */
  async open(path: string, _mode: 'r' | 'w' | 'r+'): Promise<IFileHandle> {
    // Stateless - just return a handle that stores the path
    // The actual file operations happen on read/write
    return new NativeFileHandle(this.rootKey, path)
  }

  /**
   * Get file statistics.
   */
  async stat(path: string): Promise<IFileStat> {
    const result = __jstorrent_file_stat(this.rootKey, path)

    if (!result) {
      throw new Error(`File not found: ${path}`)
    }

    const stat = JSON.parse(result) as {
      size: number
      mtime: number | string
      isDirectory: boolean
      isFile: boolean
    }

    return {
      size: stat.size,
      mtime: new Date(stat.mtime),
      isDirectory: stat.isDirectory,
      isFile: stat.isFile,
    }
  }

  /**
   * Create a directory.
   */
  async mkdir(path: string): Promise<void> {
    const success = __jstorrent_file_mkdir(this.rootKey, path)

    if (!success) {
      throw new Error(`Failed to create directory: ${path}`)
    }
  }

  /**
   * Check if a path exists.
   */
  async exists(path: string): Promise<boolean> {
    return __jstorrent_file_exists(this.rootKey, path)
  }

  /**
   * Read directory contents.
   * Returns list of filenames (not full paths).
   */
  async readdir(path: string): Promise<string[]> {
    const result = __jstorrent_file_readdir(this.rootKey, path)
    return JSON.parse(result) as string[]
  }

  /**
   * Delete a file or directory.
   */
  async delete(path: string): Promise<void> {
    const success = __jstorrent_file_delete(this.rootKey, path)

    if (!success) {
      throw new Error(`Failed to delete: ${path}`)
    }
  }
}
