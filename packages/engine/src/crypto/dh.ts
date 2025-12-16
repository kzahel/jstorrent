/**
 * Diffie-Hellman key exchange using bn.js
 * 768-bit DH as specified by MSE/PE
 */
import BN from 'bn.js'
import { DH_PRIME_HEX, DH_GENERATOR } from './constants'

export class DiffieHellman {
  private prime: BN
  private red: ReturnType<typeof BN.red>
  private generator: BN
  private privateKey: BN | null = null
  private publicKey: BN | null = null

  constructor() {
    this.prime = new BN(DH_PRIME_HEX, 16)
    this.red = BN.red(this.prime)
    this.generator = new BN(DH_GENERATOR)
  }

  /**
   * Generate key pair. Returns 96-byte public key.
   */
  generateKeys(randomBytes: Uint8Array): Uint8Array {
    // Private key from random bytes (should be ~96 bytes for full security)
    this.privateKey = new BN(randomBytes)

    // Public key: G^privateKey mod P
    this.publicKey = this.generator.toRed(this.red).redPow(this.privateKey).fromRed()

    return this.getPublicKey()
  }

  /**
   * Get public key as 96-byte Uint8Array (zero-padded if needed)
   */
  getPublicKey(): Uint8Array {
    if (!this.publicKey) throw new Error('Keys not generated')
    const arr = this.publicKey.toArray('be')
    const result = new Uint8Array(96)
    result.set(arr, 96 - arr.length)
    return result
  }

  /**
   * Compute shared secret from peer's public key.
   * Returns 96-byte shared secret.
   */
  computeSecret(peerPublicKey: Uint8Array): Uint8Array {
    if (!this.privateKey) throw new Error('Keys not generated')

    const peerPub = new BN(peerPublicKey)
    const secret = peerPub.toRed(this.red).redPow(this.privateKey).fromRed()

    // Pad to 96 bytes
    const arr = secret.toArray('be')
    const result = new Uint8Array(96)
    result.set(arr, 96 - arr.length)
    return result
  }
}
