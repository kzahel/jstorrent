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
})
