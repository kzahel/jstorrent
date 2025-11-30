import { IHasher } from '../../interfaces/hasher'
import { DaemonConnection } from './daemon-connection'

/**
 * Hasher that delegates to io-daemon.
 * Works in any context since hashing happens in Rust.
 */
export class DaemonHasher implements IHasher {
  constructor(private connection: DaemonConnection) {}

  async sha1(data: Uint8Array): Promise<Uint8Array> {
    // Returns raw 20 bytes, not hex
    return this.connection.requestBinary('POST', '/hash/sha1', undefined, data)
  }
}
