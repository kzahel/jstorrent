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
    // Use slice() to get a copy of the data as a proper ArrayBuffer
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer)
    return new Uint8Array(hashBuffer)
  }
}
