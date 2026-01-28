import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  NativeBatchingDiskQueue,
  packVerifiedWriteBatch,
} from '../../../src/adapters/native/native-batching-disk-queue'

// Mock the native bindings
vi.stubGlobal('__jstorrent_file_write_verified_batch', vi.fn())
vi.stubGlobal('__jstorrent_file_write_callbacks', {})

describe('packVerifiedWriteBatch', () => {
  it('should pack a single write correctly', () => {
    const writes = [
      {
        rootKey: 'root1',
        path: 'path/to/file.txt',
        position: 12345,
        data: new Uint8Array([1, 2, 3, 4, 5]).buffer,
        expectedHashHex: 'a'.repeat(40), // 40 char hex string
        callbackId: 'vw_1',
        resolve: () => {},
        reject: () => {},
      },
    ]

    const packed = packVerifiedWriteBatch(writes)
    const view = new DataView(packed)
    const bytes = new Uint8Array(packed)
    const textDecoder = new TextDecoder()
    let offset = 0

    // Count
    expect(view.getUint32(offset, true)).toBe(1)
    offset += 4

    // rootKeyLen + rootKey
    const rootKeyLen = bytes[offset]
    offset += 1
    expect(rootKeyLen).toBe(5) // 'root1'
    const rootKey = textDecoder.decode(bytes.subarray(offset, offset + rootKeyLen))
    expect(rootKey).toBe('root1')
    offset += rootKeyLen

    // pathLen + path
    const pathLen = view.getUint16(offset, true)
    offset += 2
    expect(pathLen).toBe(16) // 'path/to/file.txt'
    const path = textDecoder.decode(bytes.subarray(offset, offset + pathLen))
    expect(path).toBe('path/to/file.txt')
    offset += pathLen

    // position (u64 LE)
    const positionLow = view.getUint32(offset, true)
    const positionHigh = view.getUint32(offset + 4, true)
    const position = positionLow + positionHigh * 0x100000000
    expect(position).toBe(12345)
    offset += 8

    // dataLen + data
    const dataLen = view.getUint32(offset, true)
    offset += 4
    expect(dataLen).toBe(5)
    expect([...bytes.subarray(offset, offset + dataLen)]).toEqual([1, 2, 3, 4, 5])
    offset += dataLen

    // hashHex (fixed 40 bytes)
    const hashHex = textDecoder.decode(bytes.subarray(offset, offset + 40))
    expect(hashHex).toBe('a'.repeat(40))
    offset += 40

    // callbackIdLen + callbackId
    const callbackIdLen = bytes[offset]
    offset += 1
    expect(callbackIdLen).toBe(4) // 'vw_1'
    const callbackId = textDecoder.decode(bytes.subarray(offset, offset + callbackIdLen))
    expect(callbackId).toBe('vw_1')
    offset += callbackIdLen

    // Verify we consumed the entire buffer
    expect(offset).toBe(packed.byteLength)
  })

  it('should pack multiple writes correctly', () => {
    const writes = [
      {
        rootKey: 'r1',
        path: 'a.txt',
        position: 100,
        data: new Uint8Array([1]).buffer,
        expectedHashHex: '0'.repeat(40),
        callbackId: 'vw_1',
        resolve: () => {},
        reject: () => {},
      },
      {
        rootKey: 'r2',
        path: 'b.txt',
        position: 200,
        data: new Uint8Array([2, 3]).buffer,
        expectedHashHex: '1'.repeat(40),
        callbackId: 'vw_2',
        resolve: () => {},
        reject: () => {},
      },
    ]

    const packed = packVerifiedWriteBatch(writes)
    const view = new DataView(packed)

    // Count should be 2
    expect(view.getUint32(0, true)).toBe(2)

    // Just verify total size is reasonable
    // Each write: rootKeyLen(1) + rootKey + pathLen(2) + path + position(8) + dataLen(4) + data + hash(40) + callbackIdLen(1) + callbackId
    // Write 1: 1+2 + 2+5 + 8 + 4+1 + 40 + 1+4 = 68
    // Write 2: 1+2 + 2+5 + 8 + 4+2 + 40 + 1+4 = 69
    // Total: 4 (count) + 68 + 69 = 141
    expect(packed.byteLength).toBe(141)
  })

  it('should handle large positions (> 32 bits)', () => {
    const largePosition = 0x1_0000_0001 // 4294967297 (requires > 32 bits)

    const writes = [
      {
        rootKey: 'r',
        path: 'f',
        position: largePosition,
        data: new ArrayBuffer(0),
        expectedHashHex: 'f'.repeat(40),
        callbackId: 'c',
        resolve: () => {},
        reject: () => {},
      },
    ]

    const packed = packVerifiedWriteBatch(writes)
    const view = new DataView(packed)
    let offset = 4 // skip count

    // Skip rootKey
    const rootKeyLen = new Uint8Array(packed)[offset]
    offset += 1 + rootKeyLen

    // Skip path
    const pathLen = view.getUint16(offset, true)
    offset += 2 + pathLen

    // Read position as two u32 values
    const positionLow = view.getUint32(offset, true)
    const positionHigh = view.getUint32(offset + 4, true)
    const position = positionLow + positionHigh * 0x100000000

    expect(position).toBe(largePosition)
  })

  it('should handle empty data', () => {
    const writes = [
      {
        rootKey: 'r',
        path: 'f',
        position: 0,
        data: new ArrayBuffer(0),
        expectedHashHex: '0'.repeat(40),
        callbackId: 'c',
        resolve: () => {},
        reject: () => {},
      },
    ]

    const packed = packVerifiedWriteBatch(writes)
    expect(packed.byteLength).toBeGreaterThan(0)

    // Verify we can parse it
    const view = new DataView(packed)
    expect(view.getUint32(0, true)).toBe(1)
  })

  it('should handle unicode paths', () => {
    const writes = [
      {
        rootKey: 'root',
        path: '文件/テスト.txt', // Chinese and Japanese characters
        position: 0,
        data: new ArrayBuffer(0),
        expectedHashHex: '0'.repeat(40),
        callbackId: 'vw_1',
        resolve: () => {},
        reject: () => {},
      },
    ]

    const packed = packVerifiedWriteBatch(writes)
    const view = new DataView(packed)
    const bytes = new Uint8Array(packed)
    const textDecoder = new TextDecoder()
    let offset = 4 // skip count

    // Skip rootKey
    const rootKeyLen = bytes[offset]
    offset += 1 + rootKeyLen

    // Read path
    const pathLen = view.getUint16(offset, true)
    offset += 2
    const path = textDecoder.decode(bytes.subarray(offset, offset + pathLen))

    expect(path).toBe('文件/テスト.txt')
  })
})

describe('NativeBatchingDiskQueue', () => {
  let queue: NativeBatchingDiskQueue
  let mockBatchFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queue = new NativeBatchingDiskQueue()
    mockBatchFn = vi.fn()
    vi.stubGlobal('__jstorrent_file_write_verified_batch', mockBatchFn)
    vi.stubGlobal('__jstorrent_file_write_callbacks', {})
  })

  describe('queueVerifiedWrite', () => {
    it('should add writes to pending queue without calling FFI', () => {
      const hash = new Uint8Array(20).fill(0xab)

      // Queue a write - should not call FFI yet
      queue.queueVerifiedWrite('root', 'path/file.txt', 100, new ArrayBuffer(10), hash)

      expect(mockBatchFn).not.toHaveBeenCalled()
      expect(queue.pendingCount).toBe(1)
    })

    it('should queue multiple writes', () => {
      const hash = new Uint8Array(20).fill(0)

      queue.queueVerifiedWrite('r1', 'f1.txt', 0, new ArrayBuffer(5), hash)
      queue.queueVerifiedWrite('r2', 'f2.txt', 100, new ArrayBuffer(10), hash)
      queue.queueVerifiedWrite('r3', 'f3.txt', 200, new ArrayBuffer(15), hash)

      expect(queue.pendingCount).toBe(3)
      expect(mockBatchFn).not.toHaveBeenCalled()
    })

    it('should register callbacks in global object', () => {
      const hash = new Uint8Array(20).fill(0)
      const callbacks = globalThis.__jstorrent_file_write_callbacks

      queue.queueVerifiedWrite('root', 'file.txt', 0, new ArrayBuffer(5), hash)

      // Should have registered a callback
      const keys = Object.keys(callbacks)
      expect(keys.length).toBe(1)
      expect(keys[0]).toMatch(/^vw_\d+$/)
    })

    it('should return a promise that resolves on success', async () => {
      const hash = new Uint8Array(20).fill(0)
      const callbacks = globalThis.__jstorrent_file_write_callbacks

      const promise = queue.queueVerifiedWrite('root', 'file.txt', 0, new ArrayBuffer(100), hash)

      // Find the callback ID
      const callbackId = Object.keys(callbacks)[0]

      // Simulate success callback
      callbacks[callbackId](100, 0) // bytesWritten=100, resultCode=0 (SUCCESS)

      const result = await promise
      expect(result).toEqual({ bytesWritten: 100 })
    })

    it('should return a promise that rejects on hash mismatch', async () => {
      const hash = new Uint8Array(20).fill(0)
      const callbacks = globalThis.__jstorrent_file_write_callbacks

      const promise = queue.queueVerifiedWrite('root', 'file.txt', 0, new ArrayBuffer(100), hash)

      // Find the callback ID
      const callbackId = Object.keys(callbacks)[0]

      // Simulate hash mismatch callback
      callbacks[callbackId](-1, 1) // resultCode=1 (HASH_MISMATCH)

      await expect(promise).rejects.toThrow('Hash mismatch')
    })

    it('should return a promise that rejects on IO error', async () => {
      const hash = new Uint8Array(20).fill(0)
      const callbacks = globalThis.__jstorrent_file_write_callbacks

      const promise = queue.queueVerifiedWrite('root', 'file.txt', 0, new ArrayBuffer(100), hash)

      // Find the callback ID
      const callbackId = Object.keys(callbacks)[0]

      // Simulate IO error callback
      callbacks[callbackId](-1, 2) // resultCode=2 (IO_ERROR)

      await expect(promise).rejects.toThrow('I/O error')
    })
  })

  describe('flushPending', () => {
    it('should not call FFI if no pending writes', () => {
      queue.flushPending()
      expect(mockBatchFn).not.toHaveBeenCalled()
    })

    it('should call FFI with packed data and clear pending queue', () => {
      const hash = new Uint8Array(20).fill(0xab)

      queue.queueVerifiedWrite('root', 'file.txt', 100, new ArrayBuffer(10), hash)
      queue.queueVerifiedWrite('root2', 'file2.txt', 200, new ArrayBuffer(20), hash)

      expect(queue.pendingCount).toBe(2)

      queue.flushPending()

      expect(mockBatchFn).toHaveBeenCalledTimes(1)
      expect(mockBatchFn.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer)
      expect(queue.pendingCount).toBe(0)
    })

    it('should pack data correctly', () => {
      const hash = new Uint8Array(20).fill(0)

      queue.queueVerifiedWrite('root', 'test.txt', 0, new ArrayBuffer(5), hash)
      queue.flushPending()

      const packed = mockBatchFn.mock.calls[0][0] as ArrayBuffer
      const view = new DataView(packed)

      // Verify count is 1
      expect(view.getUint32(0, true)).toBe(1)
    })
  })

  describe('IDiskQueue interface', () => {
    it('should execute enqueue jobs directly', async () => {
      let executed = false

      await queue.enqueue({ type: 'write', pieceIndex: 0, fileCount: 1, size: 100 }, async () => {
        executed = true
      })

      expect(executed).toBe(true)
    })

    it('should flush pending on drain', async () => {
      const hash = new Uint8Array(20).fill(0)

      queue.queueVerifiedWrite('root', 'file.txt', 0, new ArrayBuffer(10), hash)

      await queue.drain()

      expect(mockBatchFn).toHaveBeenCalledTimes(1)
    })

    it('should return empty snapshot', () => {
      const snapshot = queue.getSnapshot()
      expect(snapshot.pending).toEqual([])
      expect(snapshot.running).toEqual([])
      expect(snapshot.draining).toBe(false)
    })

    it('resume should be a no-op', () => {
      // Should not throw
      queue.resume()
    })
  })
})
