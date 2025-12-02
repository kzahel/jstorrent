import { IStorageHandle } from '../io/storage-handle'
import { TorrentFile } from './torrent-file'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
export declare class TorrentContentStorage extends EngineComponent {
  private storageHandle
  static logName: string
  private files
  private fileHandles
  private openingFiles
  private pieceLength
  private id
  constructor(engine: ILoggingEngine, storageHandle: IStorageHandle)
  open(files: TorrentFile[], pieceLength: number): Promise<void>
  get filesList(): TorrentFile[]
  getTotalSize(): number
  close(): Promise<void>
  private getFileHandle
  write(index: number, begin: number, data: Uint8Array): Promise<void>
  /**
   * Write a complete piece (all data at once).
   * More efficient than multiple write() calls for small blocks.
   */
  writePiece(pieceIndex: number, data: Uint8Array): Promise<void>
  /**
   * Check if a piece fits entirely within a single file.
   * Used to determine if verified write can be used.
   */
  private pieceSpansSingleFile
  /**
   * Write a complete piece with optional hash verification.
   * If expectedHash is provided and the piece fits in a single file with a handle
   * that supports verified writes, the hash verification happens atomically
   * in the io-daemon.
   *
   * @param pieceIndex The piece index
   * @param data The piece data
   * @param expectedHash Optional SHA1 hash to verify (raw bytes, not hex)
   * @returns true if verified write was used, false if caller should verify
   */
  writePieceVerified(
    pieceIndex: number,
    data: Uint8Array,
    expectedHash?: Uint8Array,
  ): Promise<boolean>
  read(index: number, begin: number, length: number): Promise<Uint8Array>
}
//# sourceMappingURL=torrent-content-storage.d.ts.map
