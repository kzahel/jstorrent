import { describe, it, expect, afterEach } from 'vitest'
import { PieceBufferManager } from '../../src/core/piece-buffer-manager'
import { BLOCK_SIZE } from '../../src/core/piece-manager'

describe('PieceBufferManager', () => {
  let manager: PieceBufferManager

  afterEach(() => {
    manager?.destroy()
  })

  it('should create buffers for pieces', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10)

    const buffer = manager.getOrCreate(0)
    expect(buffer).not.toBeNull()
    expect(manager.activeCount).toBe(1)
  })

  it('should return existing buffer', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10)

    const buffer1 = manager.getOrCreate(0)
    const buffer2 = manager.getOrCreate(0)
    expect(buffer1).toBe(buffer2)
    expect(manager.activeCount).toBe(1)
  })

  it('should enforce max active pieces limit', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 100, {
      maxActivePieces: 3,
    })

    expect(manager.getOrCreate(0)).not.toBeNull()
    expect(manager.getOrCreate(1)).not.toBeNull()
    expect(manager.getOrCreate(2)).not.toBeNull()
    expect(manager.getOrCreate(3)).toBeNull() // At limit
    expect(manager.activeCount).toBe(3)
  })

  it('should remove completed pieces', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10, {
      maxActivePieces: 2,
    })

    manager.getOrCreate(0)
    manager.getOrCreate(1)
    expect(manager.getOrCreate(2)).toBeNull()

    manager.remove(0)
    expect(manager.getOrCreate(2)).not.toBeNull()
  })

  it('should use correct length for last piece', () => {
    const lastPieceLength = BLOCK_SIZE + 500
    manager = new PieceBufferManager(BLOCK_SIZE * 4, lastPieceLength, 10)

    const regularBuffer = manager.getOrCreate(0)
    const lastBuffer = manager.getOrCreate(9)

    expect(regularBuffer?.pieceLength).toBe(BLOCK_SIZE * 4)
    expect(lastBuffer?.pieceLength).toBe(lastPieceLength)
  })

  it('should get existing buffer without creating', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10)

    expect(manager.get(0)).toBeUndefined()

    manager.getOrCreate(0)
    expect(manager.get(0)).not.toBeUndefined()
  })

  it('should check if piece is buffered', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10)

    expect(manager.has(0)).toBe(false)

    manager.getOrCreate(0)
    expect(manager.has(0)).toBe(true)
  })

  it('should return list of active pieces', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10)

    manager.getOrCreate(5)
    manager.getOrCreate(10)
    manager.getOrCreate(15)

    const active = manager.getActivePieces()
    expect(active.sort((a, b) => a - b)).toEqual([5, 10, 15])
  })

  it('should cleanup stale buffers', async () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10, {
      staleTimeoutMs: 50, // 50ms for testing
    })

    const buffer = manager.getOrCreate(0)
    expect(buffer).not.toBeNull()

    // Force the buffer to appear stale
    buffer!.lastActivity = Date.now() - 100

    // Trigger cleanup by trying to create more (which calls cleanupStale internally)
    // Or we can wait for the interval, but that's slow.
    // Let's fill up to the limit and trigger cleanup
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10, {
      maxActivePieces: 1,
      staleTimeoutMs: 50,
    })

    const buf = manager.getOrCreate(0)
    buf!.lastActivity = Date.now() - 100

    // Now try to create another - should trigger cleanup
    const buf2 = manager.getOrCreate(1)
    expect(buf2).not.toBeNull()
    expect(manager.has(0)).toBe(false) // Should have been cleaned up
  })

  it('should cleanup on destroy', () => {
    manager = new PieceBufferManager(BLOCK_SIZE * 4, BLOCK_SIZE * 4, 10)

    manager.getOrCreate(0)
    manager.getOrCreate(1)
    expect(manager.activeCount).toBe(2)

    manager.destroy()
    expect(manager.activeCount).toBe(0)
  })
})
