/**
 * Native Adapter Exports
 *
 * This module provides adapters for running the JSTorrent engine
 * in QuickJS (Android) and JavaScriptCore (iOS) runtimes.
 */

// Import polyfills first to ensure they're available
import './polyfills'

// Re-export adapter classes
export { NativeSocketFactory } from './native-socket-factory'
export { NativeTcpSocket } from './native-tcp-socket'
export { NativeUdpSocket } from './native-udp-socket'
export { NativeTcpServer } from './native-tcp-server'
export { NativeFileSystem } from './native-filesystem'
export { NativeFileHandle } from './native-file-handle'
export { NativeSessionStore } from './native-session-store'
export { NativeHasher } from './native-hasher'
export { callbackManager } from './callback-manager'
export { setupController, startStatePushLoop } from './controller'
export { NativeConfigHub } from './native-config-hub'

/**
 * Batch flush all peers using a single FFI call.
 * This is more efficient than calling flush() on each peer individually.
 *
 * @param peers Array of objects with getSocketId() and getQueuedData() methods
 * @returns true if batch send was used, false if fell back to per-peer flush
 */
export function batchFlushPeers(
  peers: Array<{
    getSocketId(): number | undefined
    getQueuedData(): Uint8Array | null
    flush(): void
  }>,
): boolean {
  // Check if batch binding is available
  if (typeof __jstorrent_tcp_send_batch === 'undefined') {
    // Fall back to per-peer flush
    for (const peer of peers) {
      peer.flush()
    }
    return false
  }

  // Collect all pending sends
  const sends: Array<{ socketId: number; data: Uint8Array }> = []
  for (const peer of peers) {
    const socketId = peer.getSocketId()
    if (socketId === undefined) continue

    const data = peer.getQueuedData()
    if (data === null) continue

    sends.push({ socketId, data })
  }

  if (sends.length === 0) return true

  // Pack into single buffer
  // Format: [count: u32 LE] then for each: [socketId: u32 LE] [len: u32 LE] [data: len bytes]
  let totalSize = 4 // count
  for (const { data } of sends) {
    totalSize += 8 + data.length // socketId + len + data
  }

  const packed = new ArrayBuffer(totalSize)
  const view = new DataView(packed)
  const bytes = new Uint8Array(packed)

  let offset = 0
  view.setUint32(offset, sends.length, true)
  offset += 4

  for (const { socketId, data } of sends) {
    view.setUint32(offset, socketId, true)
    offset += 4
    view.setUint32(offset, data.length, true)
    offset += 4
    bytes.set(data, offset)
    offset += data.length
  }

  __jstorrent_tcp_send_batch(packed)
  return true
}
