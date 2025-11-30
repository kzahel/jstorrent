export function randomBytes(size: number): Uint8Array {
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    const array = new Uint8Array(size)
    globalThis.crypto.getRandomValues(array)
    return array
  }
  throw new Error('Crypto API not available')
}
