/**
 * Branded type for normalized (lowercase) info hash hex strings.
 * Use the factory functions to create instances - never cast directly.
 */
declare const InfoHashBrand: unique symbol
export type InfoHashHex = string & { readonly [InfoHashBrand]: true }

/**
 * Convert a hex string to InfoHashHex, normalizing to lowercase.
 * Use for ANY external input: magnet links, tracker responses, user input.
 * @throws Error if not a valid 40-char hex string
 */
export function infoHashFromHex(hex: string): InfoHashHex {
  const normalized = hex.toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Invalid info hash hex: ${hex}`)
  }
  return normalized as InfoHashHex
}

/**
 * Convert raw bytes to InfoHashHex. Always produces lowercase.
 * Use when you have the 20-byte binary form.
 */
export function infoHashFromBytes(bytes: Uint8Array): InfoHashHex {
  if (bytes.length !== 20) {
    throw new Error(`Invalid info hash bytes: expected 20, got ${bytes.length}`)
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('') as InfoHashHex
}

/**
 * Parse info hash from bytes, returning both binary and hex forms.
 * Convenience for places that need both.
 */
export function parseInfoHash(bytes: Uint8Array): { bytes: Uint8Array; hex: InfoHashHex } {
  return {
    bytes,
    hex: infoHashFromBytes(bytes),
  }
}

// Legacy compatibility functions - deprecated, use the above functions instead

/**
 * @deprecated Use infoHashFromHex instead
 */
export function normalizeInfoHash(infoHash: string): string {
  return infoHash.toLowerCase()
}

/**
 * @deprecated Use direct === comparison with InfoHashHex values instead
 */
export function areInfoHashesEqual(a: string, b: string): boolean {
  return normalizeInfoHash(a) === normalizeInfoHash(b)
}

/**
 * @deprecated Use infoHashFromBytes instead
 */
export function toInfoHashString(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
