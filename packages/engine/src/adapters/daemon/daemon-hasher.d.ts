import { IHasher } from '../../interfaces/hasher'
import { DaemonConnection } from './daemon-connection'
/**
 * Hasher that delegates to io-daemon.
 * Works in any context since hashing happens in Rust.
 */
export declare class DaemonHasher implements IHasher {
  private connection
  constructor(connection: DaemonConnection)
  sha1(data: Uint8Array): Promise<Uint8Array>
}
//# sourceMappingURL=daemon-hasher.d.ts.map
