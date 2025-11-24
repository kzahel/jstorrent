import * as crypto from 'crypto'

export async function sha1(data: Uint8Array): Promise<Uint8Array> {
  // Use Node's crypto for now as we are in the engine package which runs in Node/Electron
  // If we need browser support later, we can switch to crypto.subtle
  const hash = crypto.createHash('sha1')
  hash.update(data)
  return new Uint8Array(hash.digest())
}
