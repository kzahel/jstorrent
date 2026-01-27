/**
 * Native Hasher
 *
 * Implements IHasher using native bindings.
 */

import type { IHasher } from '../../interfaces/hasher'
import './bindings.d.ts'

// Instrumentation for hash performance
let _hashCallCount = 0
let _hashTotalBytes = 0
let _hashTotalTimeMs = 0
let _hashMaxTimeMs = 0
let _hashLastLogTime = 0

export class NativeHasher implements IHasher {
  /**
   * Compute SHA1 hash of data.
   */
  async sha1(data: Uint8Array): Promise<Uint8Array> {
    const startTime = Date.now()

    // Convert Uint8Array to ArrayBuffer for native binding
    // NOTE: This slice() creates a copy - potential optimization target
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer

    const result = __jstorrent_sha1(buffer)
    const hashResult = new Uint8Array(result)

    // Track timing
    const elapsed = Date.now() - startTime
    _hashCallCount++
    _hashTotalBytes += data.byteLength
    _hashTotalTimeMs += elapsed
    if (elapsed > _hashMaxTimeMs) {
      _hashMaxTimeMs = elapsed
    }

    // Log every 5 seconds
    const now = Date.now()
    if (now - _hashLastLogTime >= 5000 && _hashCallCount > 0) {
      const avgMs = (_hashTotalTimeMs / _hashCallCount).toFixed(2)
      const throughputMBps = (_hashTotalBytes / 1024 / 1024 / (_hashTotalTimeMs / 1000)).toFixed(1)
      console.log(
        `[NativeHasher] ${_hashCallCount} hashes, ${(_hashTotalBytes / 1024 / 1024).toFixed(1)}MB, ` +
          `avg ${avgMs}ms, max ${_hashMaxTimeMs}ms, throughput ${throughputMBps}MB/s`,
      )
      _hashCallCount = 0
      _hashTotalBytes = 0
      _hashTotalTimeMs = 0
      _hashMaxTimeMs = 0
      _hashLastLogTime = now
    }

    return hashResult
  }
}
