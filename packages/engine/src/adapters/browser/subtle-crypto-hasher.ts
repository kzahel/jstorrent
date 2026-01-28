import { IHasher } from '../../interfaces/hasher'

/**
 * Hasher using Web Crypto API.
 * Only works in secure contexts (HTTPS, extensions, localhost in some browsers).
 */
export class SubtleCryptoHasher implements IHasher {
  async sha1(data: Uint8Array): Promise<Uint8Array> {
    if (!crypto?.subtle) {
      throw new Error('crypto.subtle not available (requires secure context)')
    }
    // Only slice if the Uint8Array is a view into a larger buffer or has a non-zero offset
    const buffer =
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? (data.buffer as ArrayBuffer)
        : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer)
    return new Uint8Array(hashBuffer)
  }
}
