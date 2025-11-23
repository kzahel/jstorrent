import { describe, it, expect } from 'vitest'
import { Bencode } from '../../src/utils/bencode'

describe('Bencode', () => {
  it('should encode and decode integers', () => {
    const val = 12345
    const encoded = Bencode.encode(val)
    expect(new TextDecoder().decode(encoded)).toBe('i12345e')
    const decoded = Bencode.decode(encoded)
    expect(decoded).toBe(val)
  })

  it('should encode and decode strings', () => {
    const val = 'hello'
    const encoded = Bencode.encode(val)
    expect(new TextDecoder().decode(encoded)).toBe('5:hello')
    const decoded = Bencode.decode(encoded)
    expect(new TextDecoder().decode(decoded)).toBe(val)
  })

  it('should encode and decode lists', () => {
    const val = ['a', 1]
    const encoded = Bencode.encode(val)
    // l1:ai1ee
    const decoded = Bencode.decode(encoded)
    expect(new TextDecoder().decode(decoded[0])).toBe('a')
    expect(decoded[1]).toBe(1)
  })

  it('should encode and decode dictionaries', () => {
    const val = { foo: 'bar', baz: 42 }
    const encoded = Bencode.encode(val)
    // d3:bazi42e3:foo3:bare (keys sorted)
    const decoded = Bencode.decode(encoded)
    expect(decoded['baz']).toBe(42)
    expect(new TextDecoder().decode(decoded['foo'])).toBe('bar')
  })
})
