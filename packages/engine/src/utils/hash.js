export function randomBytes(size) {
  const array = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    array[i] = Math.floor(Math.random() * 256)
  }
  return array
}
