import { IHasher } from '../../interfaces/hasher'
/**
 * Hasher using Web Crypto API.
 * Only works in secure contexts (HTTPS, extensions, localhost in some browsers).
 */
export declare class SubtleCryptoHasher implements IHasher {
  sha1(data: Uint8Array): Promise<Uint8Array>
}
//# sourceMappingURL=subtle-crypto-hasher.d.ts.map
