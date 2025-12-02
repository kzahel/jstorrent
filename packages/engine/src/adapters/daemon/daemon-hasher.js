/**
 * Hasher that delegates to io-daemon.
 * Works in any context since hashing happens in Rust.
 */
export class DaemonHasher {
  constructor(connection) {
    this.connection = connection
  }
  async sha1(data) {
    // Returns raw 20 bytes, not hex
    return this.connection.requestBinary('POST', '/hash/sha1', undefined, data)
  }
}
