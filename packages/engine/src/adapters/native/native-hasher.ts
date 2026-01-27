/**
 * Native Hasher
 *
 * Implements IHasher using native bindings with async hashing to avoid
 * blocking the JS thread during SHA1 computation.
 */

import type { IHasher } from '../../interfaces/hasher'
import './bindings.d.ts'

// Callback ID counter
let _nextCallbackId = 0

// Instrumentation for hash performance
let _hashCallCount = 0
let _hashTotalBytes = 0
let _hashTotalTimeMs = 0
let _hashMaxTimeMs = 0
let _hashLastLogTime = 0

// Initialize callback infrastructure
globalThis.__jstorrent_hash_callbacks = {}

// Track pending callbacks for debugging
let _pendingHashCount = 0

// Dispatch function called by native layer when async hash completes
// This is called from Kotlin: __jstorrent_hash_dispatch_result(callbackId, hash)
globalThis.__jstorrent_hash_dispatch_result = (callbackId: string, hash: ArrayBuffer): void => {
  const callback = globalThis.__jstorrent_hash_callbacks[callbackId]
  if (callback) {
    delete globalThis.__jstorrent_hash_callbacks[callbackId]
    _pendingHashCount--
    callback(hash)
  } else {
    console.warn(`[NativeHasher] Received callback for unknown ID: ${callbackId}`)
  }
}

// Declare the dispatch function on globalThis
declare global {
  function __jstorrent_hash_dispatch_result(callbackId: string, hash: ArrayBuffer): void
}

export class NativeHasher implements IHasher {
  /**
   * Compute SHA1 hash of data (async - doesn't block JS thread).
   */
  async sha1(data: Uint8Array): Promise<Uint8Array> {
    const startTime = Date.now()

    // Optimization: Only slice if the Uint8Array is a view into a larger buffer
    // or has a non-zero byteOffset. This avoids an unnecessary copy.
    const buffer =
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? (data.buffer as ArrayBuffer)
        : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)

    // Use async hashing to avoid blocking the JS thread
    const result = await this.sha1Async(buffer)
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

  /**
   * Internal async hash using native callback mechanism.
   */
  private sha1Async(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const callbackId = `hash_${_nextCallbackId++}`
      _pendingHashCount++

      // Debug: log if we have many pending
      if (_pendingHashCount > 10) {
        console.warn(`[NativeHasher] ${_pendingHashCount} pending hash callbacks`)
      }

      // Timeout to detect stuck callbacks (30 seconds for large data)
      const timeoutId = setTimeout(() => {
        if (globalThis.__jstorrent_hash_callbacks[callbackId]) {
          delete globalThis.__jstorrent_hash_callbacks[callbackId]
          _pendingHashCount--
          console.error(
            `[NativeHasher] Hash callback ${callbackId} timed out after 30s (${buffer.byteLength} bytes)`,
          )
          reject(new Error(`Hash callback timed out: ${callbackId}`))
        }
      }, 30000)

      // Register callback
      globalThis.__jstorrent_hash_callbacks[callbackId] = (hash: ArrayBuffer) => {
        clearTimeout(timeoutId)
        resolve(hash)
      }

      // Initiate async hash
      __jstorrent_sha1_async(buffer, callbackId)
    })
  }
}
