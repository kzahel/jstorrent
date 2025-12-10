import { IStorageHandle } from '../io/storage-handle'
import { IFileHandle } from '../interfaces/filesystem'
import { supportsVerifiedWrite } from '../adapters/daemon/daemon-file-handle'
import { TorrentFile } from './torrent-file'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import { IDiskQueue, DiskQueueSnapshot, DiskJob } from './disk-queue'

export class TorrentContentStorage extends EngineComponent {
  static logName = 'content-storage'
  private files: TorrentFile[] = []
  private fileHandles: Map<string, IFileHandle> = new Map()
  private openingFiles: Map<string, Promise<IFileHandle>> = new Map()
  private pieceLength: number = 0
  private jobCounter = 0

  private id = Math.random().toString(36).slice(2, 7)

  constructor(
    engine: ILoggingEngine,
    private storageHandle: IStorageHandle,
    private diskQueue?: IDiskQueue,
  ) {
    super(engine)
    this.logger.debug(
      `TorrentContentStorage: Created instance ${this.id} for storage ${storageHandle.name}`,
    )
  }

  /**
   * Generate a unique job ID for the disk queue.
   */
  private generateJobId(): string {
    return `storage-${this.id}-${++this.jobCounter}`
  }

  /**
   * Get a snapshot of the disk queue state for UI/debugging.
   * Returns null if no queue is configured.
   */
  getDiskQueueSnapshot(): DiskQueueSnapshot | null {
    return this.diskQueue?.getSnapshot() ?? null
  }

  /**
   * Drain the disk queue - wait for all running jobs to complete.
   * Call this before changing file priorities.
   */
  async drainDiskQueue(): Promise<void> {
    await this.diskQueue?.drain()
  }

  /**
   * Resume the disk queue after draining.
   */
  resumeDiskQueue(): void {
    this.diskQueue?.resume()
  }

  async open(files: TorrentFile[], pieceLength: number) {
    this.files = files
    this.pieceLength = pieceLength
    this.logger.debug(`DiskManager ${this.id}: Opened with ${files.length} files`)

    // Pre-open files or open on demand? Let's open on demand for now to save resources,
    // but for simplicity in this phase, we might just open them all if the list is small.
    // Let's stick to open-on-demand logic implicitly in read/write.
  }

  get filesList(): TorrentFile[] {
    return this.files
  }

  getTotalSize(): number {
    return this.files.reduce((sum, f) => sum + f.length, 0)
  }

  async close() {
    this.logger.debug(`DiskManager ${this.id}: Closing all files`)

    // Drain and destroy the disk queue first
    if (this.diskQueue) {
      try {
        await this.diskQueue.drain()
      } catch (err) {
        this.logger.warn(`Error draining disk queue during close: ${err}`)
      }
      this.diskQueue.destroy()
    }

    // Wait for any pending opens?
    // Ideally we should wait, but for now just close what we have.
    for (const [path, handle] of this.fileHandles) {
      this.logger.debug(`DiskManager ${this.id}: Closing file ${path}`)
      await handle.close()
    }
    this.fileHandles.clear()
    this.openingFiles.clear()
  }

  private async getFileHandle(path: string): Promise<IFileHandle> {
    if (this.fileHandles.has(path)) {
      return this.fileHandles.get(path)!
    }

    if (this.openingFiles.has(path)) {
      // this.logger.debug(`DiskManager ${this.id}: Waiting for pending open '${path}'`)
      return this.openingFiles.get(path)!
    }

    this.logger.debug(
      `DiskManager ${this.id}: Opening file '${path}' (cache miss). Current keys: ${Array.from(this.fileHandles.keys())}`,
    )

    const openPromise = (async () => {
      try {
        const fs = this.storageHandle.getFileSystem()
        const handle = await fs.open(path, 'r+')
        this.fileHandles.set(path, handle)
        this.logger.debug(
          `DiskManager ${this.id}: Set handle for '${path}'. Keys now: ${Array.from(this.fileHandles.keys())}`,
        )
        return handle
      } finally {
        this.openingFiles.delete(path)
      }
    })()

    this.openingFiles.set(path, openPromise)
    return openPromise
  }

  async write(index: number, begin: number, data: Uint8Array): Promise<void> {
    // If we have a disk queue, enqueue the write operation
    if (this.diskQueue) {
      const filePath = this.getFilePathForOffset(index * this.pieceLength + begin)
      const job: DiskJob = {
        id: this.generateJobId(),
        type: 'write',
        filePath,
        offset: index * this.pieceLength + begin,
        length: data.length,
        isPartsFile: filePath.endsWith('.parts'),
        enqueuedAt: Date.now(),
        executor: () => this.writeInternal(index, begin, data),
      }
      await this.diskQueue.enqueue(job)
    } else {
      await this.writeInternal(index, begin, data)
    }
  }

  /**
   * Get the primary file path for a given torrent offset.
   * Used for job identification in the queue.
   */
  private getFilePathForOffset(torrentOffset: number): string {
    for (const file of this.files) {
      const fileEnd = file.offset + file.length
      if (torrentOffset >= file.offset && torrentOffset < fileEnd) {
        return file.path
      }
    }
    return 'unknown'
  }

  /**
   * Internal write implementation - does the actual disk I/O.
   */
  private async writeInternal(index: number, begin: number, data: Uint8Array): Promise<void> {
    const torrentOffset = index * this.pieceLength + begin
    let remaining = data.length
    let dataOffset = 0
    let currentTorrentOffset = torrentOffset

    // Find the first file that contains this offset
    // Optimization: Could use binary search or keep track of last used file
    for (const file of this.files) {
      const fileEnd = file.offset + file.length

      if (currentTorrentOffset >= file.offset && currentTorrentOffset < fileEnd) {
        // We found the starting file
        const fileRelativeOffset = currentTorrentOffset - file.offset
        const bytesToWrite = Math.min(remaining, file.length - fileRelativeOffset)

        this.logger.debug(
          `DiskManager: Writing to ${file.path}, fileRelOffset=${fileRelativeOffset}, bytes=${bytesToWrite}, dataOffset=${dataOffset}`,
        )

        const handle = await this.getFileHandle(file.path)
        await handle.write(data, dataOffset, bytesToWrite, fileRelativeOffset)

        remaining -= bytesToWrite
        dataOffset += bytesToWrite
        currentTorrentOffset += bytesToWrite

        if (remaining === 0) break
      }
    }

    if (remaining > 0) {
      throw new Error('Write out of bounds')
    }
  }

  /**
   * Write a complete piece (all data at once).
   * More efficient than multiple write() calls for small blocks.
   */
  async writePiece(pieceIndex: number, data: Uint8Array): Promise<void> {
    await this.write(pieceIndex, 0, data)
  }

  /**
   * Check if a piece fits entirely within a single file.
   * Used to determine if verified write can be used.
   */
  private pieceSpansSingleFile(pieceIndex: number, pieceLength: number): TorrentFile | null {
    const torrentOffset = pieceIndex * this.pieceLength
    const torrentEnd = torrentOffset + pieceLength

    for (const file of this.files) {
      const fileEnd = file.offset + file.length
      // Check if the entire piece is within this file
      if (torrentOffset >= file.offset && torrentEnd <= fileEnd) {
        return file
      }
    }
    return null
  }

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
  async writePieceVerified(
    pieceIndex: number,
    data: Uint8Array,
    expectedHash?: Uint8Array,
  ): Promise<boolean> {
    // Check if we can use verified write
    if (expectedHash) {
      const singleFile = this.pieceSpansSingleFile(pieceIndex, data.length)
      if (singleFile) {
        const handle = await this.getFileHandle(singleFile.path)
        if (supportsVerifiedWrite(handle)) {
          // Use verified write - hash check happens in io-daemon
          const torrentOffset = pieceIndex * this.pieceLength
          const fileRelativeOffset = torrentOffset - singleFile.offset

          handle.setExpectedHashForNextWrite(expectedHash)
          await handle.write(data, 0, data.length, fileRelativeOffset)
          return true // Verified write was used
        }
      }
    }

    // Fall back to regular write (caller should verify hash)
    await this.write(pieceIndex, 0, data)
    return false
  }

  async read(index: number, begin: number, length: number): Promise<Uint8Array> {
    // Reads bypass the queue - they're fast, don't need serialization,
    // and blocking reads would hurt seeding performance
    return this.readInternal(index, begin, length)
  }

  /**
   * Internal read implementation - does the actual disk I/O.
   */
  private async readInternal(index: number, begin: number, length: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(length)
    const torrentOffset = index * this.pieceLength + begin
    let remaining = length
    let bufferOffset = 0
    let currentTorrentOffset = torrentOffset

    for (const file of this.files) {
      const fileEnd = file.offset + file.length

      if (currentTorrentOffset >= file.offset && currentTorrentOffset < fileEnd) {
        const fileRelativeOffset = currentTorrentOffset - file.offset
        const bytesToRead = Math.min(remaining, file.length - fileRelativeOffset)

        const handle = await this.getFileHandle(file.path)
        await handle.read(buffer, bufferOffset, bytesToRead, fileRelativeOffset)

        remaining -= bytesToRead
        bufferOffset += bytesToRead
        currentTorrentOffset += bytesToRead

        if (remaining === 0) break
      }
    }

    if (remaining > 0) {
      throw new Error('Read out of bounds')
    }

    return buffer
  }
}
