import { supportsVerifiedWrite } from '../adapters/daemon/daemon-file-handle'
import { EngineComponent } from '../logging/logger'
export class TorrentContentStorage extends EngineComponent {
  constructor(engine, storageHandle) {
    super(engine)
    this.storageHandle = storageHandle
    this.files = []
    this.fileHandles = new Map()
    this.openingFiles = new Map()
    this.pieceLength = 0
    this.id = Math.random().toString(36).slice(2, 7)
    this.logger.debug(
      `TorrentContentStorage: Created instance ${this.id} for storage ${storageHandle.name}`,
    )
  }
  async open(files, pieceLength) {
    this.files = files
    this.pieceLength = pieceLength
    this.logger.debug(`DiskManager ${this.id}: Opened with ${files.length} files`)
    // Pre-open files or open on demand? Let's open on demand for now to save resources,
    // but for simplicity in this phase, we might just open them all if the list is small.
    // Let's stick to open-on-demand logic implicitly in read/write.
  }
  get filesList() {
    return this.files
  }
  getTotalSize() {
    return this.files.reduce((sum, f) => sum + f.length, 0)
  }
  async close() {
    this.logger.debug(`DiskManager ${this.id}: Closing all files`)
    // Wait for any pending opens?
    // Ideally we should wait, but for now just close what we have.
    for (const [path, handle] of this.fileHandles) {
      this.logger.debug(`DiskManager ${this.id}: Closing file ${path}`)
      await handle.close()
    }
    this.fileHandles.clear()
    this.openingFiles.clear()
  }
  async getFileHandle(path) {
    if (this.fileHandles.has(path)) {
      return this.fileHandles.get(path)
    }
    if (this.openingFiles.has(path)) {
      // this.logger.debug(`DiskManager ${this.id}: Waiting for pending open '${path}'`)
      return this.openingFiles.get(path)
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
  async write(index, begin, data) {
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
  async writePiece(pieceIndex, data) {
    await this.write(pieceIndex, 0, data)
  }
  /**
   * Check if a piece fits entirely within a single file.
   * Used to determine if verified write can be used.
   */
  pieceSpansSingleFile(pieceIndex, pieceLength) {
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
  async writePieceVerified(pieceIndex, data, expectedHash) {
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
  async read(index, begin, length) {
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
TorrentContentStorage.logName = 'content-storage'
