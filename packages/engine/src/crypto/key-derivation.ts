/**
 * MSE/PE key derivation functions
 */
import { RC4 } from './rc4'

/**
 * Derive RC4 encryption keys from shared secret and info hash.
 * Keys are SHA1 hashes with RC4-drop1024.
 */
export async function deriveEncryptionKeys(
  sharedSecret: Uint8Array,
  infoHash: Uint8Array,
  isInitiator: boolean,
  sha1: (data: Uint8Array) => Promise<Uint8Array>,
): Promise<{ encrypt: RC4; decrypt: RC4 }> {
  // Concatenate for key derivation
  const keyAInput = concat(encode('keyA'), sharedSecret, infoHash)
  const keyBInput = concat(encode('keyB'), sharedSecret, infoHash)

  const keyA = await sha1(keyAInput)
  const keyB = await sha1(keyBInput)

  // Initiator uses keyA for encrypt, keyB for decrypt
  // Responder uses keyB for encrypt, keyA for decrypt
  const encryptKey = isInitiator ? keyA : keyB
  const decryptKey = isInitiator ? keyB : keyA

  const encrypt = new RC4(encryptKey)
  const decrypt = new RC4(decryptKey)

  // RC4-drop1024: discard first 1024 bytes
  encrypt.drop(1024)
  decrypt.drop(1024)

  return { encrypt, decrypt }
}

/**
 * Compute HASH('req1', S) for synchronization
 */
export async function computeReq1Hash(
  sharedSecret: Uint8Array,
  sha1: (data: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  return sha1(concat(encode('req1'), sharedSecret))
}

/**
 * Compute HASH('req2', SKEY) XOR HASH('req3', S) for torrent identification
 */
export async function computeReq2Xor3(
  infoHash: Uint8Array,
  sharedSecret: Uint8Array,
  sha1: (data: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const req2 = await sha1(concat(encode('req2'), infoHash))
  const req3 = await sha1(concat(encode('req3'), sharedSecret))
  return xor(req2, req3)
}

/**
 * Recover infoHash from HASH('req2', SKEY) XOR HASH('req3', S)
 * Given the received XOR value and shared secret, and a list of known info hashes.
 */
export async function recoverInfoHash(
  xorValue: Uint8Array,
  sharedSecret: Uint8Array,
  knownInfoHashes: Uint8Array[],
  sha1: (data: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array | null> {
  const req3 = await sha1(concat(encode('req3'), sharedSecret))
  const req2Computed = xor(xorValue, req3)

  for (const infoHash of knownInfoHashes) {
    const expected = await sha1(concat(encode('req2'), infoHash))
    if (arraysEqual(req2Computed, expected)) {
      return infoHash
    }
  }
  return null
}

// Helpers
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

export function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i]
  }
  return result
}

export function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
