import { toHex } from '../../utils/buffer'
/**
 * Error thrown when hash verification fails during a write operation.
 */
export class HashMismatchError extends Error {
  constructor(message) {
    super(message)
    this.name = 'HashMismatchError'
  }
}
/**
 * Type guard to check if a file handle supports verified writes.
 */
export function supportsVerifiedWrite(handle) {
  return 'setExpectedHashForNextWrite' in handle
}
export class DaemonFileHandle {
  constructor(connection, path, rootKey) {
    this.connection = connection
    this.path = path
    this.rootKey = rootKey
    this.pendingHash = null
  }
  /**
   * Set expected SHA1 hash for the next write operation.
   * If the hash mismatches, the write will throw HashMismatchError.
   * The hash is consumed after one write operation.
   */
  setExpectedHashForNextWrite(sha1) {
    this.pendingHash = sha1
  }
  async read(buffer, offset, length, position) {
    const pathB64 = btoa(this.path)
    const data = await this.connection.requestBinaryWithHeaders('GET', `/read/${this.rootKey}`, {
      'X-Path-Base64': pathB64,
      'X-Offset': String(position),
      'X-Length': String(length),
    })
    if (data.length !== length) {
      throw new Error(
        `Short read from daemon: requested ${length} bytes at position ${position}, got ${data.length}`,
      )
    }
    buffer.set(data, offset)
    return { bytesRead: data.length }
  }
  async write(buffer, offset, length, position) {
    const data = buffer.subarray(offset, offset + length)
    const pathB64 = btoa(this.path)
    const headers = {
      'X-Path-Base64': pathB64,
      'X-Offset': String(position),
    }
    // Attach pending hash if set
    if (this.pendingHash) {
      headers['X-Expected-SHA1'] = toHex(this.pendingHash)
      this.pendingHash = null // Consume it
    }
    const response = await this.connection.requestWithHeaders(
      'POST',
      `/write/${this.rootKey}`,
      headers,
      data,
    )
    if (response.status === 409) {
      throw new HashMismatchError(await response.text())
    }
    if (!response.ok) {
      throw new Error(`Write failed: ${response.status} ${response.statusText}`)
    }
    return { bytesWritten: length }
  }
  async truncate(len) {
    await this.connection.request('POST', '/ops/truncate', undefined, {
      path: this.path,
      root_key: this.rootKey,
      length: len,
    })
  }
  async sync() {
    // io-daemon doesn't expose explicit sync yet, but writes are likely flushed or OS-managed.
    // We can treat this as a no-op or add a sync endpoint later.
  }
  async close() {
    // Stateless handle, nothing to close on the daemon side.
  }
}
