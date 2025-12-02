export function fromHex(hex) {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}
export function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
export function fromString(str) {
  return new TextEncoder().encode(str)
}
export function toString(bytes) {
  return new TextDecoder().decode(bytes)
}
export function concat(arrays) {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}
export function compare(a, b) {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }
  if (a.length < b.length) return -1
  if (a.length > b.length) return 1
  return 0
}
