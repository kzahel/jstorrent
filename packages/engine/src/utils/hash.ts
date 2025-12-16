/**
 * Generate cryptographically secure random bytes.
 * Uses crypto.getRandomValues when available, falls back to Math.random.
 */
export function randomBytes(size: number): Uint8Array {
  const array = new Uint8Array(size)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array)
  } else {
    // Fallback for environments without Web Crypto API
    for (let i = 0; i < size; i++) {
      array[i] = Math.floor(Math.random() * 256)
    }
  }
  return array
}
