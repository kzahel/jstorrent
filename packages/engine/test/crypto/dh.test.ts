import { describe, it, expect } from 'vitest'
import { DiffieHellman } from '../../src/crypto/dh'

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

describe('DiffieHellman', () => {
  it('should generate 96-byte public key', () => {
    const dh = new DiffieHellman()
    const randomBytes = getRandomBytes(96)

    const pubKey = dh.generateKeys(randomBytes)

    expect(pubKey.length).toBe(96)
  })

  it('should compute same shared secret from both sides', () => {
    const alice = new DiffieHellman()
    const bob = new DiffieHellman()

    const aliceRandom = getRandomBytes(96)
    const bobRandom = getRandomBytes(96)

    const alicePub = alice.generateKeys(aliceRandom)
    const bobPub = bob.generateKeys(bobRandom)

    const aliceSecret = alice.computeSecret(bobPub)
    const bobSecret = bob.computeSecret(alicePub)

    expect(aliceSecret).toEqual(bobSecret)
  })

  it('should produce different secrets with different keys', () => {
    const alice = new DiffieHellman()
    const bob = new DiffieHellman()
    const eve = new DiffieHellman()

    const aliceRandom = getRandomBytes(96)
    const bobRandom = getRandomBytes(96)
    const eveRandom = getRandomBytes(96)

    alice.generateKeys(aliceRandom)
    const bobPub = bob.generateKeys(bobRandom)
    const evePub = eve.generateKeys(eveRandom)

    const secretWithBob = alice.computeSecret(bobPub)
    const secretWithEve = alice.computeSecret(evePub)

    expect(secretWithBob).not.toEqual(secretWithEve)
  })

  it('should produce 96-byte shared secret', () => {
    const alice = new DiffieHellman()
    const bob = new DiffieHellman()

    alice.generateKeys(getRandomBytes(96))
    const bobPub = bob.generateKeys(getRandomBytes(96))

    const secret = alice.computeSecret(bobPub)

    expect(secret.length).toBe(96)
  })

  it('should throw if computing secret before generating keys', () => {
    const dh = new DiffieHellman()
    const fakePubKey = getRandomBytes(96)

    expect(() => dh.computeSecret(fakePubKey)).toThrow('Keys not generated')
  })

  it('should throw if getting public key before generating keys', () => {
    const dh = new DiffieHellman()

    expect(() => dh.getPublicKey()).toThrow('Keys not generated')
  })

  it('should be deterministic with same random bytes', () => {
    const randomBytes = getRandomBytes(96)

    const dh1 = new DiffieHellman()
    const dh2 = new DiffieHellman()

    const pub1 = dh1.generateKeys(randomBytes)
    const pub2 = dh2.generateKeys(randomBytes)

    expect(pub1).toEqual(pub2)
  })
})
