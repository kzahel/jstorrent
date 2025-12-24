/**
 * Native File Handle
 *
 * Implements IFileHandle using stateless native bindings.
 * Each read/write is a complete operation - no persistent file handle is maintained.
 */

import type { IFileHandle } from '../../interfaces/filesystem'
import './bindings.d.ts'

export class NativeFileHandle implements IFileHandle {
  private closed = false

  constructor(
    private readonly rootKey: string,
    private readonly path: string,
  ) {}

  /**
   * Read data from the file at a specific position.
   * Each call is stateless - Kotlin opens, seeks, reads, closes internally.
   */
  async read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }> {
    if (this.closed) {
      throw new Error('File handle is closed')
    }

    const result = __jstorrent_file_read(this.rootKey, this.path, position, length)

    if (!result || result.byteLength === 0) {
      return { bytesRead: 0 }
    }

    const data = new Uint8Array(result)
    // Copy data into the provided buffer at the specified offset
    const bytesToCopy = Math.min(data.length, buffer.length - offset)
    buffer.set(data.subarray(0, bytesToCopy), offset)

    return { bytesRead: bytesToCopy }
  }

  /**
   * Write data to the file at a specific position.
   * Each call is stateless - Kotlin opens, seeks, writes, syncs, closes internally.
   */
  async write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }> {
    if (this.closed) {
      throw new Error('File handle is closed')
    }

    // Extract the portion of buffer to write
    const data = buffer.subarray(offset, offset + length)

    // Convert to ArrayBuffer for native binding
    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer

    const bytesWritten = __jstorrent_file_write(this.rootKey, this.path, position, arrayBuffer)

    if (bytesWritten < 0) {
      throw new Error('Write failed')
    }

    return { bytesWritten }
  }

  /**
   * Truncate the file to a specific size.
   * Not supported in stateless mode - can be added later if needed.
   */
  async truncate(_len: number): Promise<void> {
    throw new Error('Truncate not supported in stateless mode')
  }

  /**
   * Flush changes to storage.
   * No-op - each write already syncs to storage.
   */
  async sync(): Promise<void> {
    // No-op - each write is already synced
  }

  /**
   * Close the file handle.
   * No-op - there's no actual handle to close. Just marks as closed.
   */
  async close(): Promise<void> {
    this.closed = true
  }
}
