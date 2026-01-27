import { describe, it, expect } from 'vitest'
import { BitField } from '../../src/utils/bitfield'

describe('BitField', () => {
  it('should initialize with length', () => {
    const bf = new BitField(10)
    expect(bf.toBuffer().length).toBe(2) // ceil(10/8)
    expect(bf.hasNone()).toBe(true)
  })

  it('should initialize with buffer', () => {
    const buffer = new Uint8Array([0xff, 0x00])
    const bf = new BitField(buffer)
    expect(bf.get(0)).toBe(true)
    expect(bf.get(7)).toBe(true)
    expect(bf.get(8)).toBe(false)
  })

  it('should set and get bits', () => {
    const bf = new BitField(16)
    bf.set(0, true)
    bf.set(15, true)

    expect(bf.get(0)).toBe(true)
    expect(bf.get(15)).toBe(true)
    expect(bf.get(1)).toBe(false)

    bf.set(0, false)
    expect(bf.get(0)).toBe(false)
  })

  it('should check hasAll correctly', () => {
    const bf = new BitField(8)
    expect(bf.hasAll()).toBe(false)

    for (let i = 0; i < 8; i++) bf.set(i, true)
    expect(bf.hasAll()).toBe(true)
  })

  it('should check hasAll with partial last byte', () => {
    const bf = new BitField(10)
    for (let i = 0; i < 10; i++) bf.set(i, true)
    expect(bf.hasAll()).toBe(true)

    bf.set(9, false)
    expect(bf.hasAll()).toBe(false)
  })

  it('should create full bitfield with createFull', () => {
    // Exact byte boundary
    const bf8 = BitField.createFull(8)
    expect(bf8.hasAll()).toBe(true)
    expect(bf8.count()).toBe(8)
    for (let i = 0; i < 8; i++) expect(bf8.get(i)).toBe(true)

    // Partial last byte
    const bf10 = BitField.createFull(10)
    expect(bf10.hasAll()).toBe(true)
    expect(bf10.count()).toBe(10)
    expect(bf10.size).toBe(10) // size returns the logical length, not buffer size
    for (let i = 0; i < 10; i++) expect(bf10.get(i)).toBe(true)

    // Large count
    const bf100 = BitField.createFull(100)
    expect(bf100.hasAll()).toBe(true)
    expect(bf100.count()).toBe(100)
  })

  it('should create empty bitfield with createEmpty', () => {
    const bf = BitField.createEmpty(10)
    expect(bf.hasNone()).toBe(true)
    expect(bf.count()).toBe(0)
    for (let i = 0; i < 10; i++) expect(bf.get(i)).toBe(false)
  })

  describe('count() optimization', () => {
    it('partial last byte handled correctly', () => {
      const bf = BitField.createFull(13) // 1 byte + 5 bits
      expect(bf.count()).toBe(13)
    })

    it('incremental set updates count', () => {
      const bf = BitField.createEmpty(100)
      bf.set(5)
      bf.set(10)
      bf.set(99)
      expect(bf.count()).toBe(3)
    })

    it('incremental clear updates count', () => {
      const bf = BitField.createFull(100)
      bf.set(5, false)
      bf.set(10, false)
      expect(bf.count()).toBe(98)
    })

    it('set same bit twice does not double count', () => {
      const bf = BitField.createEmpty(100)
      bf.set(5)
      bf.set(5)
      expect(bf.count()).toBe(1)
    })

    it('clear same bit twice does not double decrement', () => {
      const bf = BitField.createFull(100)
      bf.set(5, false)
      bf.set(5, false)
      expect(bf.count()).toBe(99)
    })

    it('restoreFromHex invalidates cache', () => {
      const bf = BitField.createEmpty(16)
      bf.count() // Prime cache
      bf.restoreFromHex('ff00') // 8 bits set
      expect(bf.count()).toBe(8)
    })

    it('from buffer constructor computes count correctly', () => {
      const buffer = new Uint8Array([0xff, 0x0f]) // 8 + 4 = 12 bits
      const bf = new BitField(buffer)
      expect(bf.count()).toBe(12)
    })

    it('clone preserves count cache', () => {
      const bf = BitField.createFull(100)
      bf.set(50, false)
      expect(bf.count()).toBe(99) // Prime cache
      const cloned = bf.clone()
      expect(cloned.count()).toBe(99)
    })

    it('fromHex computes count correctly', () => {
      const bf = BitField.fromHex('f0f0', 16) // 4 + 4 = 8 bits set
      expect(bf.count()).toBe(8)
    })

    it('count matches naive recompute after random mutations', () => {
      const bf = BitField.createEmpty(200)
      // Randomly set some bits
      for (let i = 0; i < 50; i++) {
        bf.set(Math.floor(Math.random() * 200))
      }
      // Randomly clear some bits
      for (let i = 0; i < 20; i++) {
        bf.set(Math.floor(Math.random() * 200), false)
      }
      // Verify count matches naive count
      let naiveCount = 0
      for (let i = 0; i < 200; i++) {
        if (bf.get(i)) naiveCount++
      }
      expect(bf.count()).toBe(naiveCount)
    })

    it('invalidateCount() forces recompute after external buffer mutation', () => {
      const bf = BitField.createFull(8)
      expect(bf.count()).toBe(8) // Prime cache

      // External mutation via toBuffer()
      bf.toBuffer()[0] = 0x00

      // Cache is stale - would return wrong value without invalidate
      bf.invalidateCount()
      expect(bf.count()).toBe(0) // Correctly recomputed
    })

    it('invalidateCount() after constructor buffer mutation', () => {
      const buffer = new Uint8Array([0xff])
      const bf = new BitField(buffer)
      expect(bf.count()).toBe(8) // Prime cache

      // Mutate the original buffer
      buffer[0] = 0x0f // 4 bits set

      // Cache is stale
      bf.invalidateCount()
      expect(bf.count()).toBe(4) // Correctly recomputed
    })
  })
})
