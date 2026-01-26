/**
 * Native File Handle
 *
 * Implements IFileHandle using stateless native bindings.
 * Each read/write is a complete operation - no persistent file handle is maintained.
 *
 * Supports verified writes: when setExpectedHashForNextWrite() is called,
 * the next write() uses async verified write (hash + write on background thread).
 */

import type { IFileHandle } from '../../interfaces/filesystem'
import { toHex } from '../../utils/buffer'
import './bindings.d.ts'

/**
 * Error thrown when hash verification fails during a verified write.
 */
export class HashMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HashMismatchError'
  }
}

/** Result codes from native verified write */
const WriteResultCode = {
  SUCCESS: 0,
  HASH_MISMATCH: 1,
  IO_ERROR: 2,
  INVALID_ARGS: 3,
} as const

/** Counter for unique callback IDs */
let nextCallbackId = 1

export class NativeFileHandle implements IFileHandle {
  private closed = false
  private pendingHash: Uint8Array | null = null

  constructor(
    private readonly rootKey: string,
    private readonly path: string,
  ) {}

  /**
   * Set expected SHA1 hash for the next write operation.
   * If the hash mismatches, the write will throw HashMismatchError.
   * The hash is consumed after one write operation.
   *
   * When set, write() uses async verified write (background thread).
   */
  setExpectedHashForNextWrite(sha1: Uint8Array): void {
    this.pendingHash = sha1
  }

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
   *
   * If setExpectedHashForNextWrite() was called, uses async verified write:
   * - Hashing and I/O run on background thread
   * - Returns Promise that resolves when complete
   * - Throws HashMismatchError if hash doesn't match
   *
   * Otherwise uses synchronous write (blocks JS thread).
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

    // Check if we have a pending hash for verified write
    if (this.pendingHash) {
      const expectedHash = this.pendingHash
      this.pendingHash = null // Consume it

      return this.writeVerified(arrayBuffer, position, expectedHash)
    }

    // Synchronous write (no hash verification)
    const bytesWritten = __jstorrent_file_write(this.rootKey, this.path, position, arrayBuffer)

    if (bytesWritten < 0) {
      throw new Error('Write failed')
    }

    return { bytesWritten }
  }

  /**
   * Async verified write - runs hash + write on background thread.
   */
  private writeVerified(
    data: ArrayBuffer,
    position: number,
    expectedHash: Uint8Array,
  ): Promise<{ bytesWritten: number }> {
    return new Promise((resolve, reject) => {
      const callbackId = `vw_${nextCallbackId++}`
      const expectedHashHex = toHex(expectedHash)

      // Register callback for result
      // Note: QuickJS passes values as strings, so we convert to numbers
      globalThis.__jstorrent_file_write_callbacks[callbackId] = (
        bytesWrittenStr: string | number,
        resultCodeStr: string | number,
      ) => {
        const bytesWritten = Number(bytesWrittenStr)
        const resultCode = Number(resultCodeStr)

        if (resultCode === WriteResultCode.SUCCESS) {
          resolve({ bytesWritten })
        } else if (resultCode === WriteResultCode.HASH_MISMATCH) {
          reject(new HashMismatchError(`Hash mismatch for ${this.path}`))
        } else if (resultCode === WriteResultCode.IO_ERROR) {
          reject(new Error(`I/O error writing to ${this.path}`))
        } else {
          reject(new Error(`Write failed with code ${resultCode}`))
        }
      }

      // Initiate async verified write
      __jstorrent_file_write_verified(
        this.rootKey,
        this.path,
        position,
        data,
        expectedHashHex,
        callbackId,
      )
    })
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
