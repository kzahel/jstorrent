/**
 * Native Hasher
 *
 * Implements IHasher using native bindings.
 */

import type { IHasher } from '../../interfaces/hasher'
import './bindings.d.ts'

export class NativeHasher implements IHasher {
  /**
   * Compute SHA1 hash of data.
   */
  async sha1(data: Uint8Array): Promise<Uint8Array> {
    // Convert Uint8Array to ArrayBuffer for native binding
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer

    const result = __jstorrent_sha1(buffer)
    return new Uint8Array(result)
  }
}
