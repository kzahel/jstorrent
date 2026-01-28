/**
 * Native Batching Disk Queue
 *
 * Collects verified writes during a tick and flushes them in a single FFI call.
 * This reduces FFI overhead when multiple pieces complete in the same tick.
 *
 * Flow:
 *   1. NativeFileHandle.writeVerified() -> queueVerifiedWrite() (no FFI)
 *   2. End of tick -> flushPending() -> __jstorrent_file_write_verified_batch (single FFI)
 *   3. Kotlin processes all writes in parallel
 *   4. Results returned via __jstorrent_file_dispatch_batch
 */

import type { IDiskQueue, DiskJob, DiskQueueSnapshot } from '../../core/disk-queue'
import { toHex } from '../../utils/buffer'
import { HashMismatchError } from './native-file-handle'
import './bindings.d.ts'

/** Result codes from native verified write */
const WriteResultCode = {
  SUCCESS: 0,
  HASH_MISMATCH: 1,
  IO_ERROR: 2,
  INVALID_ARGS: 3,
} as const

/** Counter for unique callback IDs */
let nextCallbackId = 1

/** Pending verified write request */
interface PendingVerifiedWrite {
  rootKey: string
  path: string
  position: number
  data: ArrayBuffer
  expectedHashHex: string
  callbackId: string
  resolve: (result: { bytesWritten: number }) => void
  reject: (error: Error) => void
}

/**
 * Pack an array of verified write requests into a binary buffer.
 *
 * Format (all multi-byte integers are little-endian):
 *   [count: u32 LE] then for each write:
 *     [rootKeyLen: u8] [rootKey: UTF-8 bytes]
 *     [pathLen: u16 LE] [path: UTF-8 bytes]
 *     [position: u64 LE]
 *     [dataLen: u32 LE] [data: bytes]
 *     [hashHex: 40 bytes] (fixed size - SHA1 hex is always 40 chars)
 *     [callbackIdLen: u8] [callbackId: UTF-8 bytes]
 */
export function packVerifiedWriteBatch(writes: PendingVerifiedWrite[]): ArrayBuffer {
  const textEncoder = new TextEncoder()

  // Pre-encode strings to calculate total size
  const encoded = writes.map((w) => ({
    rootKey: textEncoder.encode(w.rootKey),
    path: textEncoder.encode(w.path),
    hashHex: textEncoder.encode(w.expectedHashHex),
    callbackId: textEncoder.encode(w.callbackId),
    data: w.data,
    position: w.position,
  }))

  // Calculate total size
  let totalSize = 4 // count
  for (const e of encoded) {
    totalSize += 1 + e.rootKey.length // rootKeyLen + rootKey
    totalSize += 2 + e.path.length // pathLen + path
    totalSize += 8 // position (u64)
    totalSize += 4 + e.data.byteLength // dataLen + data
    totalSize += 40 // hashHex (fixed 40 bytes)
    totalSize += 1 + e.callbackId.length // callbackIdLen + callbackId
  }

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  let offset = 0

  // Count
  view.setUint32(offset, writes.length, true)
  offset += 4

  for (const e of encoded) {
    // rootKeyLen + rootKey
    bytes[offset] = e.rootKey.length
    offset += 1
    bytes.set(e.rootKey, offset)
    offset += e.rootKey.length

    // pathLen + path
    view.setUint16(offset, e.path.length, true)
    offset += 2
    bytes.set(e.path, offset)
    offset += e.path.length

    // position (u64 LE)
    // JavaScript can't write u64 directly, but positions fit in 52 bits (Number.MAX_SAFE_INTEGER)
    // Write as two u32 values
    view.setUint32(offset, e.position >>> 0, true) // low 32 bits
    view.setUint32(offset + 4, Math.floor(e.position / 0x100000000) >>> 0, true) // high 32 bits
    offset += 8

    // dataLen + data
    view.setUint32(offset, e.data.byteLength, true)
    offset += 4
    bytes.set(new Uint8Array(e.data), offset)
    offset += e.data.byteLength

    // hashHex (40 bytes, fixed size)
    bytes.set(e.hashHex, offset)
    offset += 40

    // callbackIdLen + callbackId
    bytes[offset] = e.callbackId.length
    offset += 1
    bytes.set(e.callbackId, offset)
    offset += e.callbackId.length
  }

  return buffer
}

/**
 * Batching disk queue for Android native layer.
 *
 * Instead of individual FFI calls per write, this queues writes locally
 * and flushes them all in a single FFI call at the end of each tick.
 */
/**
 * Global singleton instance of the batching disk queue.
 * All NativeFileHandle instances use this to queue verified writes.
 */
let globalBatchingQueue: NativeBatchingDiskQueue | null = null

/**
 * Get or create the global batching disk queue singleton.
 */
export function getGlobalBatchingQueue(): NativeBatchingDiskQueue {
  if (!globalBatchingQueue) {
    globalBatchingQueue = new NativeBatchingDiskQueue()
  }
  return globalBatchingQueue
}

/**
 * Flush all pending batched writes.
 * Called by BtEngine at end of engine tick to send accumulated writes
 * in a single FFI call. No-op if no writes are pending.
 */
export function flushBatchedWrites(): void {
  if (globalBatchingQueue) {
    globalBatchingQueue.flushPending()
  }
}

/** Metrics for batch write performance tracking */
interface BatchWriteMetrics {
  /** Total number of writes processed */
  totalWrites: number
  /** Total bytes written */
  totalBytes: number
  /** Total time spent in FFI calls (ms) */
  totalFfiTimeMs: number
  /** Total time spent packing batches (ms) */
  totalPackTimeMs: number
  /** Number of batches flushed */
  batchCount: number
  /** Timestamp of last metrics log */
  lastLogTime: number
}

export class NativeBatchingDiskQueue implements IDiskQueue {
  private pending: PendingVerifiedWrite[] = []

  /** Performance metrics for monitoring batch efficiency */
  private metrics: BatchWriteMetrics = {
    totalWrites: 0,
    totalBytes: 0,
    totalFfiTimeMs: 0,
    totalPackTimeMs: 0,
    batchCount: 0,
    lastLogTime: Date.now(),
  }

  /**
   * Queue a verified write for batched dispatch.
   * Called by NativeFileHandle.writeVerified() instead of direct FFI.
   *
   * @returns Promise that resolves when the write completes
   */
  queueVerifiedWrite(
    rootKey: string,
    path: string,
    position: number,
    data: ArrayBuffer,
    expectedHash: Uint8Array,
  ): Promise<{ bytesWritten: number }> {
    return new Promise((resolve, reject) => {
      const callbackId = `vw_${nextCallbackId++}`
      const expectedHashHex = toHex(expectedHash)

      // Register callback for when result comes back
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
          reject(new HashMismatchError(`Hash mismatch for ${path}`))
        } else if (resultCode === WriteResultCode.IO_ERROR) {
          reject(new Error(`I/O error writing to ${path}`))
        } else {
          reject(new Error(`Write failed with code ${resultCode}`))
        }
      }

      this.pending.push({
        rootKey,
        path,
        position,
        data,
        expectedHashHex,
        callbackId,
        resolve,
        reject,
      })
    })
  }

  /**
   * Flush all pending writes in a single FFI call.
   * Called at end of tick by the engine.
   */
  flushPending(): void {
    if (this.pending.length === 0) return

    const writeCount = this.pending.length
    const totalDataBytes = this.pending.reduce((sum, w) => sum + w.data.byteLength, 0)

    // Time the packing phase
    const packStart = Date.now()
    const packed = packVerifiedWriteBatch(this.pending)
    const packEnd = Date.now()
    const packTimeMs = packEnd - packStart

    // Time the FFI call
    const ffiStart = Date.now()
    __jstorrent_file_write_verified_batch(packed)
    const ffiEnd = Date.now()
    const ffiTimeMs = ffiEnd - ffiStart

    // Update metrics
    this.metrics.totalWrites += writeCount
    this.metrics.totalBytes += totalDataBytes
    this.metrics.totalPackTimeMs += packTimeMs
    this.metrics.totalFfiTimeMs += ffiTimeMs
    this.metrics.batchCount++

    // Log individual batch if it's significant (>1 write or notable time)
    if (writeCount > 1 || ffiTimeMs > 5) {
      const dataMB = (totalDataBytes / (1024 * 1024)).toFixed(2)
      const packedKB = (packed.byteLength / 1024).toFixed(1)
      console.log(
        `[BatchWrite] ${writeCount} writes, ${dataMB}MB data, packed ${packedKB}KB, ` +
          `pack ${packTimeMs}ms, FFI ${ffiTimeMs}ms`,
      )
    }

    // Log aggregate metrics every 5 seconds
    this.maybeLogMetrics()

    this.pending = []
  }

  /**
   * Log aggregate metrics periodically (every 5 seconds).
   */
  private maybeLogMetrics(): void {
    const now = Date.now()
    if (now - this.metrics.lastLogTime < 5000) return
    if (this.metrics.batchCount === 0) return

    const avgWritesPerBatch = (this.metrics.totalWrites / this.metrics.batchCount).toFixed(1)
    const totalMB = (this.metrics.totalBytes / (1024 * 1024)).toFixed(2)
    const avgFfiMs = (this.metrics.totalFfiTimeMs / this.metrics.batchCount).toFixed(1)
    const avgPackMs = (this.metrics.totalPackTimeMs / this.metrics.batchCount).toFixed(1)

    console.log(
      `[BatchWrite] Stats: ${this.metrics.batchCount} batches, ${this.metrics.totalWrites} writes, ` +
        `${totalMB}MB total, avg ${avgWritesPerBatch} writes/batch, ` +
        `avg pack ${avgPackMs}ms, avg FFI ${avgFfiMs}ms`,
    )

    // Reset metrics for next window
    this.metrics = {
      totalWrites: 0,
      totalBytes: 0,
      totalFfiTimeMs: 0,
      totalPackTimeMs: 0,
      batchCount: 0,
      lastLogTime: now,
    }
  }

  /**
   * Get count of pending writes (for debugging/metrics).
   */
  get pendingCount(): number {
    return this.pending.length
  }

  /**
   * Get current metrics snapshot (for debugging/monitoring).
   */
  getMetrics(): Readonly<BatchWriteMetrics> {
    return { ...this.metrics }
  }

  // ============================================================
  // IDiskQueue interface methods
  // These are for general disk queue operations; verified writes
  // bypass this and use queueVerifiedWrite() directly.
  // ============================================================

  async enqueue(
    _job: Omit<DiskJob, 'id' | 'status' | 'enqueuedAt'>,
    execute: () => Promise<void>,
  ): Promise<void> {
    // For non-verified writes, execute directly
    // In practice, all piece writes go through verified write path
    await execute()
  }

  async drain(): Promise<void> {
    // Flush any pending writes before draining
    this.flushPending()
    // Note: We can't truly wait for pending results here without
    // a more complex callback tracking mechanism. For now, just flush.
    // The caller should wait for promises returned from queueVerifiedWrite().
  }

  resume(): void {
    // No-op - we don't pause batching
  }

  getSnapshot(): DiskQueueSnapshot {
    return {
      pending: [],
      running: [],
      draining: false,
    }
  }
}
