/* eslint-disable @typescript-eslint/no-explicit-any */
export class Bencode {
  static decode(data) {
    const decoder = new BencodeDecoder(data)
    return decoder.decode()
  }
  static encode(data) {
    const encoder = new BencodeEncoder()
    return encoder.encode(data)
  }
  static getRawInfo(data) {
    const decoder = new BencodeDecoder(data)
    // We want to find the 'info' key in the root dictionary
    if (data[0] !== 0x64) return null // Must be dictionary
    decoder.pos++ // skip 'd'
    while (decoder.pos < data.length && data[decoder.pos] !== 0x65) {
      // Decode key
      const key = decoder.decode()
      // Check if key was "info"
      // "info" is 4 bytes: 0x69, 0x6e, 0x66, 0x6f
      if (
        key instanceof Uint8Array &&
        key.length === 4 &&
        key[0] === 0x69 &&
        key[1] === 0x6e &&
        key[2] === 0x66 &&
        key[3] === 0x6f
      ) {
        // Found info key. The next value is the info dict.
        const valStart = decoder.pos
        console.error(`Bencode: Found info key at ${valStart}`)
        decoder.decode() // Advance past the value
        const valEnd = decoder.pos
        console.error(`Bencode: Info value ends at ${valEnd}, length ${valEnd - valStart}`)
        return data.slice(valStart, valEnd)
      }
      // Skip value
      decoder.decode()
    }
    return null
  }
}
class BencodeDecoder {
  constructor(data) {
    this.data = data
    this.pos = 0
  }
  decode() {
    if (this.pos >= this.data.length) return null
    const char = this.data[this.pos]
    if (char === 0x69) {
      // 'i' -> integer
      this.pos++
      const start = this.pos
      while (this.data[this.pos] !== 0x65) {
        // 'e'
        this.pos++
        if (this.pos >= this.data.length) throw new Error('Invalid bencode: unterminated integer')
      }
      const numStr = new TextDecoder().decode(this.data.slice(start, this.pos))
      this.pos++
      return parseInt(numStr, 10)
    } else if (char === 0x6c) {
      // 'l' -> list
      this.pos++
      const list = []
      while (this.data[this.pos] !== 0x65) {
        // 'e'
        list.push(this.decode())
        if (this.pos >= this.data.length) throw new Error('Invalid bencode: unterminated list')
      }
      this.pos++
      return list
    } else if (char === 0x64) {
      // 'd' -> dictionary
      this.pos++
      const dict = {}
      while (this.data[this.pos] !== 0x65) {
        // 'e'
        const key = this.decode()
        if (!(key instanceof Uint8Array))
          throw new Error('Invalid bencode: dictionary key must be string (bytes)')
        const keyStr = new TextDecoder().decode(key)
        const val = this.decode()
        dict[keyStr] = val
        if (this.pos >= this.data.length)
          throw new Error('Invalid bencode: unterminated dictionary')
      }
      this.pos++
      return dict
    } else if (char >= 0x30 && char <= 0x39) {
      // '0'-'9' -> string length
      const start = this.pos
      while (this.data[this.pos] !== 0x3a) {
        // ':'
        this.pos++
        if (this.pos >= this.data.length)
          throw new Error('Invalid bencode: unterminated string length')
      }
      const lenStr = new TextDecoder().decode(this.data.slice(start, this.pos))
      const len = parseInt(lenStr, 10)
      this.pos++ // skip ':'
      if (this.pos + len > this.data.length)
        throw new Error('Invalid bencode: string length out of bounds')
      const str = this.data.slice(this.pos, this.pos + len)
      this.pos += len
      return str
    } else {
      throw new Error(`Invalid bencode: unexpected character code ${char} at pos ${this.pos}`)
    }
  }
}
class BencodeEncoder {
  constructor() {
    this.chunks = []
  }
  encode(data) {
    this.encodeValue(data)
    return this.concatChunks()
  }
  encodeValue(data) {
    if (typeof data === 'number') {
      this.pushString(`i${Math.floor(data)}e`)
    } else if (typeof data === 'string') {
      const buf = new TextEncoder().encode(data)
      this.pushString(`${buf.length}:`)
      this.chunks.push(buf)
    } else if (data instanceof Uint8Array) {
      this.pushString(`${data.length}:`)
      this.chunks.push(data)
    } else if (Array.isArray(data)) {
      this.pushString('l')
      for (const item of data) {
        this.encodeValue(item)
      }
      this.pushString('e')
    } else if (typeof data === 'object' && data !== null) {
      this.pushString('d')
      const keys = Object.keys(data).sort() // Keys must be sorted
      for (const key of keys) {
        this.encodeValue(key)
        this.encodeValue(data[key])
      }
      this.pushString('e')
    } else {
      throw new Error(`Unsupported type for bencode: ${typeof data}`)
    }
  }
  pushString(str) {
    this.chunks.push(new TextEncoder().encode(str))
  }
  concatChunks() {
    let total = 0
    for (const c of this.chunks) total += c.length
    const res = new Uint8Array(total)
    let offset = 0
    for (const c of this.chunks) {
      res.set(c, offset)
      offset += c.length
    }
    return res
  }
}
