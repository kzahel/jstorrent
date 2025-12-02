/**
 * Hasher using Web Crypto API.
 * Only works in secure contexts (HTTPS, extensions, localhost in some browsers).
 */
export class SubtleCryptoHasher {
  async sha1(data) {
    if (!crypto?.subtle) {
      throw new Error('crypto.subtle not available (requires secure context)')
    }
    // Use slice() to get a copy of the data as a proper ArrayBuffer
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer)
    return new Uint8Array(hashBuffer)
  }
}
