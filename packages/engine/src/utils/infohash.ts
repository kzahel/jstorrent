export function normalizeInfoHash(infoHash: string): string {
  return infoHash.toLowerCase()
}

export function areInfoHashesEqual(a: string, b: string): boolean {
  return normalizeInfoHash(a) === normalizeInfoHash(b)
}

export function toInfoHashString(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
