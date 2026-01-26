import { describe, it, expect, beforeEach } from 'vitest'
import { ChunkedBuffer } from '../../src/core/chunked-buffer'

describe('ChunkedBuffer', () => {
  let buffer: ChunkedBuffer

  beforeEach(() => {
    buffer = new ChunkedBuffer()
  })

  describe('push', () => {
    it('should increase length correctly', () => {
      expect(buffer.length).toBe(0)

      buffer.push(new Uint8Array([1, 2, 3]))
      expect(buffer.length).toBe(3)

      buffer.push(new Uint8Array([4, 5]))
      expect(buffer.length).toBe(5)
    })

    it('should ignore empty arrays', () => {
      buffer.push(new Uint8Array(0))
      expect(buffer.length).toBe(0)
    })

    it('should handle many small chunks', () => {
      for (let i = 0; i < 100; i++) {
        buffer.push(new Uint8Array([i]))
      }
      expect(buffer.length).toBe(100)
    })
  })

  describe('peekUint32', () => {
    it('should read uint32 within single chunk', () => {
      // Big-endian: 0x01020304 = 16909060
      buffer.push(new Uint8Array([0x01, 0x02, 0x03, 0x04]))
      expect(buffer.peekUint32(0)).toBe(0x01020304)
    })

    it('should read uint32 at offset within single chunk', () => {
      buffer.push(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]))
      expect(buffer.peekUint32(1)).toBe(0x01020304)
    })

    it('should read uint32 across chunk boundary', () => {
      // Split 0x01020304 across two chunks
      buffer.push(new Uint8Array([0x01, 0x02]))
      buffer.push(new Uint8Array([0x03, 0x04]))
      expect(buffer.peekUint32(0)).toBe(0x01020304)
    })

    it('should read uint32 across multiple chunk boundaries', () => {
      // Each byte in separate chunk
      buffer.push(new Uint8Array([0x01]))
      buffer.push(new Uint8Array([0x02]))
      buffer.push(new Uint8Array([0x03]))
      buffer.push(new Uint8Array([0x04]))
      expect(buffer.peekUint32(0)).toBe(0x01020304)
    })

    it('should read uint32 at offset across chunks', () => {
      buffer.push(new Uint8Array([0x00, 0x01]))
      buffer.push(new Uint8Array([0x02, 0x03, 0x04]))
      expect(buffer.peekUint32(1)).toBe(0x01020304)
    })

    it('should return null when insufficient data', () => {
      buffer.push(new Uint8Array([0x01, 0x02, 0x03]))
      expect(buffer.peekUint32(0)).toBe(null)
    })

    it('should return null when offset + 4 exceeds length', () => {
      buffer.push(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]))
      expect(buffer.peekUint32(2)).toBe(null)
    })

    it('should handle zero value', () => {
      buffer.push(new Uint8Array([0x00, 0x00, 0x00, 0x00]))
      expect(buffer.peekUint32(0)).toBe(0)
    })

    it('should handle max uint32', () => {
      buffer.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
      expect(buffer.peekUint32(0)).toBe(0xffffffff)
    })
  })

  describe('copyTo', () => {
    it('should copy within single chunk', () => {
      buffer.push(new Uint8Array([1, 2, 3, 4, 5]))
      const dest = new Uint8Array(3)
      buffer.copyTo(dest, 0, 1, 3)
      expect(Array.from(dest)).toEqual([2, 3, 4])
    })

    it('should copy across chunk boundary', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      buffer.push(new Uint8Array([4, 5, 6]))
      const dest = new Uint8Array(4)
      buffer.copyTo(dest, 0, 1, 4)
      expect(Array.from(dest)).toEqual([2, 3, 4, 5])
    })

    it('should copy across multiple chunks', () => {
      buffer.push(new Uint8Array([1, 2]))
      buffer.push(new Uint8Array([3, 4]))
      buffer.push(new Uint8Array([5, 6]))
      const dest = new Uint8Array(6)
      buffer.copyTo(dest, 0, 0, 6)
      expect(Array.from(dest)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('should copy to destination offset', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      const dest = new Uint8Array(5)
      dest.fill(0)
      buffer.copyTo(dest, 2, 0, 3)
      expect(Array.from(dest)).toEqual([0, 0, 1, 2, 3])
    })

    it('should throw when insufficient source data', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      const dest = new Uint8Array(5)
      expect(() => buffer.copyTo(dest, 0, 0, 5)).toThrow('insufficient data')
    })

    it('should throw when destination too small', () => {
      buffer.push(new Uint8Array([1, 2, 3, 4, 5]))
      const dest = new Uint8Array(3)
      expect(() => buffer.copyTo(dest, 0, 0, 5)).toThrow('destination too small')
    })

    it('should throw when destOffset + length exceeds dest', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      const dest = new Uint8Array(3)
      expect(() => buffer.copyTo(dest, 1, 0, 3)).toThrow('destination too small')
    })
  })

  describe('discard', () => {
    it('should remove bytes from front', () => {
      buffer.push(new Uint8Array([1, 2, 3, 4, 5]))
      buffer.discard(2)
      expect(buffer.length).toBe(3)

      const dest = new Uint8Array(3)
      buffer.copyTo(dest, 0, 0, 3)
      expect(Array.from(dest)).toEqual([3, 4, 5])
    })

    it('should handle discarding entire chunk', () => {
      buffer.push(new Uint8Array([1, 2]))
      buffer.push(new Uint8Array([3, 4]))
      buffer.discard(2) // Discard first chunk entirely
      expect(buffer.length).toBe(2)

      const dest = new Uint8Array(2)
      buffer.copyTo(dest, 0, 0, 2)
      expect(Array.from(dest)).toEqual([3, 4])
    })

    it('should handle discarding across chunks', () => {
      buffer.push(new Uint8Array([1, 2]))
      buffer.push(new Uint8Array([3, 4]))
      buffer.discard(3) // 2 from first chunk, 1 from second
      expect(buffer.length).toBe(1)

      const dest = new Uint8Array(1)
      buffer.copyTo(dest, 0, 0, 1)
      expect(Array.from(dest)).toEqual([4])
    })

    it('should handle partial chunk discard', () => {
      buffer.push(new Uint8Array([1, 2, 3, 4, 5]))
      buffer.discard(2)
      expect(buffer.length).toBe(3)

      // Now discard 1 more
      buffer.discard(1)
      expect(buffer.length).toBe(2)

      const dest = new Uint8Array(2)
      buffer.copyTo(dest, 0, 0, 2)
      expect(Array.from(dest)).toEqual([4, 5])
    })

    it('should handle discard of zero bytes', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      buffer.discard(0)
      expect(buffer.length).toBe(3)
    })

    it('should throw when discarding more than available', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      expect(() => buffer.discard(5)).toThrow('cannot discard')
    })

    it('should handle discarding all data', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      buffer.discard(3)
      expect(buffer.length).toBe(0)
    })
  })

  describe('consume', () => {
    it('should return data and discard it', () => {
      buffer.push(new Uint8Array([1, 2, 3, 4, 5]))
      const consumed = buffer.consume(3)
      expect(Array.from(consumed)).toEqual([1, 2, 3])
      expect(buffer.length).toBe(2)
    })

    it('should work across chunks', () => {
      buffer.push(new Uint8Array([1, 2]))
      buffer.push(new Uint8Array([3, 4]))
      const consumed = buffer.consume(3)
      expect(Array.from(consumed)).toEqual([1, 2, 3])
      expect(buffer.length).toBe(1)
    })

    it('should throw when insufficient data', () => {
      buffer.push(new Uint8Array([1, 2]))
      expect(() => buffer.consume(5)).toThrow('insufficient data')
    })
  })

  describe('hasBytes', () => {
    it('should return true when sufficient bytes', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      expect(buffer.hasBytes(3)).toBe(true)
      expect(buffer.hasBytes(2)).toBe(true)
      expect(buffer.hasBytes(1)).toBe(true)
      expect(buffer.hasBytes(0)).toBe(true)
    })

    it('should return false when insufficient bytes', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      expect(buffer.hasBytes(4)).toBe(false)
      expect(buffer.hasBytes(100)).toBe(false)
    })
  })

  describe('clear', () => {
    it('should reset buffer to empty', () => {
      buffer.push(new Uint8Array([1, 2, 3]))
      buffer.push(new Uint8Array([4, 5, 6]))
      buffer.clear()
      expect(buffer.length).toBe(0)
    })
  })

  describe('peekBytes', () => {
    it('should peek bytes without consuming', () => {
      buffer.push(new Uint8Array([1, 2, 3, 4, 5]))
      const peeked = buffer.peekBytes(1, 3)
      expect(peeked).not.toBeNull()
      expect(Array.from(peeked!)).toEqual([2, 3, 4])
      expect(buffer.length).toBe(5) // unchanged
    })

    it('should return null when insufficient data', () => {
      buffer.push(new Uint8Array([1, 2]))
      expect(buffer.peekBytes(0, 5)).toBe(null)
    })

    it('should peek across chunks', () => {
      buffer.push(new Uint8Array([1, 2]))
      buffer.push(new Uint8Array([3, 4]))
      const peeked = buffer.peekBytes(1, 3)
      expect(peeked).not.toBeNull()
      expect(Array.from(peeked!)).toEqual([2, 3, 4])
    })
  })

  describe('stress tests', () => {
    it('should handle many small chunks with operations', () => {
      // Simulate receiving many small packets
      for (let i = 0; i < 1000; i++) {
        buffer.push(new Uint8Array([i % 256]))
      }
      expect(buffer.length).toBe(1000)

      // Read across many chunks
      const dest = new Uint8Array(100)
      buffer.copyTo(dest, 0, 450, 100)
      for (let i = 0; i < 100; i++) {
        expect(dest[i]).toBe((450 + i) % 256)
      }

      // Discard and verify
      buffer.discard(500)
      expect(buffer.length).toBe(500)

      const dest2 = new Uint8Array(10)
      buffer.copyTo(dest2, 0, 0, 10)
      for (let i = 0; i < 10; i++) {
        expect(dest2[i]).toBe((500 + i) % 256)
      }
    })

    it('should handle large chunks efficiently', () => {
      // Simulate receiving larger packets
      const chunk1 = new Uint8Array(16384) // 16KB
      const chunk2 = new Uint8Array(16384)
      for (let i = 0; i < 16384; i++) {
        chunk1[i] = i % 256
        chunk2[i] = (i + 128) % 256
      }

      buffer.push(chunk1)
      buffer.push(chunk2)
      expect(buffer.length).toBe(32768)

      // Copy spanning both chunks
      const dest = new Uint8Array(1000)
      buffer.copyTo(dest, 0, 16000, 1000) // spans chunk boundary

      // Verify data from first chunk (bytes 16000-16383)
      for (let i = 0; i < 384; i++) {
        expect(dest[i]).toBe((16000 + i) % 256)
      }
      // Verify data from second chunk (bytes 0-615)
      for (let i = 384; i < 1000; i++) {
        expect(dest[i]).toBe((i - 384 + 128) % 256)
      }
    })

    it('should handle interleaved push/consume operations', () => {
      // Simulate BitTorrent message processing
      buffer.push(new Uint8Array([0, 0, 0, 5])) // length prefix
      buffer.push(new Uint8Array([1, 2, 3, 4, 5])) // message body

      const len = buffer.peekUint32(0)
      expect(len).toBe(5)

      const message = buffer.consume(4 + 5)
      expect(message.length).toBe(9)
      expect(buffer.length).toBe(0)

      // Another message arrives in parts
      buffer.push(new Uint8Array([0, 0]))
      buffer.push(new Uint8Array([0, 3]))
      buffer.push(new Uint8Array([10, 20, 30]))

      const len2 = buffer.peekUint32(0)
      expect(len2).toBe(3)

      const message2 = buffer.consume(7)
      expect(Array.from(message2)).toEqual([0, 0, 0, 3, 10, 20, 30])
    })
  })
})
