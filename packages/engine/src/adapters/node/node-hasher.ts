import * as crypto from 'crypto'
import { IHasher } from '../../interfaces/hasher'

/**
 * Hasher using Node.js native crypto module.
 * Uses crypto.createHash() for maximum compatibility and performance.
 */
export class NodeHasher implements IHasher {
  async sha1(data: Uint8Array): Promise<Uint8Array> {
    const hash = crypto.createHash('sha1')
    hash.update(data)
    return new Uint8Array(hash.digest())
  }
}
