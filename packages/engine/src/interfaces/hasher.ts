/**
 * Interface for cryptographic hashing.
 */
export interface IHasher {
  /**
   * Compute SHA1 hash of data.
   * @param data - Data to hash
   * @returns 20-byte hash as Uint8Array
   */
  sha1(data: Uint8Array): Promise<Uint8Array>
}
