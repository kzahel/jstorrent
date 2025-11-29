export async function sha1(data: Uint8Array): Promise<Uint8Array> {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await globalThis.crypto.subtle.digest('SHA-1', data as any)
    return new Uint8Array(buffer)
  }
  throw new Error('Crypto API not available')
}

export function randomBytes(size: number): Uint8Array {
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    const array = new Uint8Array(size)
    globalThis.crypto.getRandomValues(array)
    return array
  }
  throw new Error('Crypto API not available')
}
