export async function sha1(data: Uint8Array): Promise<Uint8Array> {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await globalThis.crypto.subtle.digest('SHA-1', data as any)
    return new Uint8Array(buffer)
  }
  // Fallback for non-secure contexts (e.g., http://local.jstorrent.com dev server)
  return sha1Pure(data)
}

// Pure JavaScript SHA1 implementation for non-secure contexts
function sha1Pure(data: Uint8Array): Uint8Array {
  const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6]

  let H0 = 0x67452301
  let H1 = 0xefcdab89
  let H2 = 0x98badcfe
  let H3 = 0x10325476
  let H4 = 0xc3d2e1f0

  // Pre-processing: adding padding bits
  const msgLen = data.length
  const bitLen = msgLen * 8

  // Message needs to be padded to 512-bit blocks (64 bytes)
  // Padding: 1 bit, then zeros, then 64-bit length
  const padLen = (msgLen % 64 < 56 ? 56 : 120) - (msgLen % 64)
  const padded = new Uint8Array(msgLen + padLen + 8)
  padded.set(data)
  padded[msgLen] = 0x80

  // Append length in bits as 64-bit big-endian
  const view = new DataView(padded.buffer)
  // JavaScript bit operations are 32-bit, so we handle high and low parts
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000), false)
  view.setUint32(padded.length - 4, bitLen >>> 0, false)

  // Process each 64-byte block
  const W = new Uint32Array(80)
  for (let offset = 0; offset < padded.length; offset += 64) {
    // Break block into sixteen 32-bit big-endian words
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false)
    }

    // Extend to 80 words
    for (let i = 16; i < 80; i++) {
      const val = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]
      W[i] = (val << 1) | (val >>> 31)
    }

    let a = H0,
      b = H1,
      c = H2,
      d = H3,
      e = H4

    for (let i = 0; i < 80; i++) {
      let f: number, k: number
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = K[0]
      } else if (i < 40) {
        f = b ^ c ^ d
        k = K[1]
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = K[2]
      } else {
        f = b ^ c ^ d
        k = K[3]
      }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) >>> 0
      e = d
      d = c
      c = ((b << 30) | (b >>> 2)) >>> 0
      b = a
      a = temp
    }

    H0 = (H0 + a) >>> 0
    H1 = (H1 + b) >>> 0
    H2 = (H2 + c) >>> 0
    H3 = (H3 + d) >>> 0
    H4 = (H4 + e) >>> 0
  }

  // Produce the final hash value (20 bytes)
  const result = new Uint8Array(20)
  const resultView = new DataView(result.buffer)
  resultView.setUint32(0, H0, false)
  resultView.setUint32(4, H1, false)
  resultView.setUint32(8, H2, false)
  resultView.setUint32(12, H3, false)
  resultView.setUint32(16, H4, false)

  return result
}

export function randomBytes(size: number): Uint8Array {
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    const array = new Uint8Array(size)
    globalThis.crypto.getRandomValues(array)
    return array
  }
  throw new Error('Crypto API not available')
}
