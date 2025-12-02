import { IFileHandle } from '../../interfaces/filesystem'
import { DaemonConnection } from './daemon-connection'
/**
 * Error thrown when hash verification fails during a write operation.
 */
export declare class HashMismatchError extends Error {
  constructor(message: string)
}
/**
 * Type guard to check if a file handle supports verified writes.
 */
export declare function supportsVerifiedWrite(handle: IFileHandle): handle is DaemonFileHandle
export declare class DaemonFileHandle implements IFileHandle {
  private connection
  private path
  private rootKey
  private pendingHash
  constructor(connection: DaemonConnection, path: string, rootKey: string)
  /**
   * Set expected SHA1 hash for the next write operation.
   * If the hash mismatches, the write will throw HashMismatchError.
   * The hash is consumed after one write operation.
   */
  setExpectedHashForNextWrite(sha1: Uint8Array): void
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{
    bytesRead: number
  }>
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{
    bytesWritten: number
  }>
  truncate(len: number): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}
//# sourceMappingURL=daemon-file-handle.d.ts.map
