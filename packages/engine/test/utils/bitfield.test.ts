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
})
