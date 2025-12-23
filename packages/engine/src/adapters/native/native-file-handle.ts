/**
 * Native File Handle
 *
 * Implements IFileHandle using native bindings.
 */

import type { IFileHandle } from '../../interfaces/filesystem'
import './bindings.d.ts'

export class NativeFileHandle implements IFileHandle {
  private closed = false

  constructor(private readonly handleId: number) {}

  /**
   * Read data from the file at a specific position.
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

    const result = __jstorrent_file_read(this.handleId, offset, length, position)

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

    const bytesWritten = __jstorrent_file_write(
      this.handleId,
      arrayBuffer,
      position,
    )

    if (bytesWritten < 0) {
      throw new Error('Write failed')
    }

    return { bytesWritten }
  }

  /**
   * Truncate the file to a specific size.
   */
  async truncate(len: number): Promise<void> {
    if (this.closed) {
      throw new Error('File handle is closed')
    }

    const success = __jstorrent_file_truncate(this.handleId, len)
    if (!success) {
      throw new Error('Truncate failed')
    }
  }

  /**
   * Flush changes to storage.
   */
  async sync(): Promise<void> {
    if (this.closed) {
      throw new Error('File handle is closed')
    }

    __jstorrent_file_sync(this.handleId)
  }

  /**
   * Close the file handle.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    __jstorrent_file_close(this.handleId)
  }
}
