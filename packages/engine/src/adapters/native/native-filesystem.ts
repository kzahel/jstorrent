/**
 * Native File System
 *
 * Implements IFileSystem using native bindings.
 * Each instance is scoped to a specific storage root.
 */

import type { IFileSystem, IFileHandle, IFileStat } from '../../interfaces/filesystem'
import { NativeFileHandle } from './native-file-handle'
import './bindings.d.ts'

export class NativeFileSystem implements IFileSystem {
  private nextHandleId = 1

  constructor(private readonly rootKey: string) {}

  /**
   * Open a file.
   */
  async open(path: string, mode: 'r' | 'w' | 'r+'): Promise<IFileHandle> {
    const handleId = this.nextHandleId++
    const success = __jstorrent_file_open(handleId, this.rootKey, path, mode)

    if (!success) {
      throw new Error(`Failed to open file: ${path}`)
    }

    return new NativeFileHandle(handleId)
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
