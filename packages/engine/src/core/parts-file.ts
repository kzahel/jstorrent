import { IStorageHandle } from '../io/storage-handle'
import { Bencode } from '../utils/bencode'
import { EngineComponent, ILoggingEngine } from '../logging/logger'

/**
 * Manages the .parts file for storing boundary pieces.
 *
 * Boundary pieces span both skipped and non-skipped files.
 * They are stored in the .parts file until all files they touch are un-skipped,
 * at which point they can be materialized to regular files.
 *
 * Format: Bencoded dictionary where keys are piece indices (as strings) and
 * values are the raw piece data.
 */
export class PartsFile extends EngineComponent {
  static logName = 'parts-file'

  private filename: string
  private data: Map<number, Uint8Array> = new Map()
  private dirty = false

  constructor(
    engine: ILoggingEngine,
    private storageHandle: IStorageHandle,
    torrentInfoHash: string,
  ) {
    super(engine)
    this.filename = `${torrentInfoHash}.parts`
    this.instanceLogName = `parts:${torrentInfoHash.slice(0, 6)}`
  }

  /**
   * Get the set of piece indices currently stored in the .parts file.
   */
  get pieces(): Set<number> {
    return new Set(this.data.keys())
  }

  /**
   * Check if a piece is stored in .parts.
   */
  hasPiece(index: number): boolean {
    return this.data.has(index)
  }

  /**
   * Get piece data from .parts.
   */
  getPiece(index: number): Uint8Array | undefined {
    return this.data.get(index)
  }

  /**
   * Add a piece to .parts (in-memory only until flush is called).
   */
  addPiece(index: number, data: Uint8Array): void {
    this.data.set(index, data)
    this.dirty = true
    this.logger.debug(`Added piece ${index} to .parts (${data.length} bytes)`)
  }

  /**
   * Remove a piece from .parts (in-memory only until flush is called).
   */
  removePiece(index: number): boolean {
    const existed = this.data.delete(index)
    if (existed) {
      this.dirty = true
      this.logger.debug(`Removed piece ${index} from .parts`)
    }
    return existed
  }

  /**
   * Load the .parts file from disk.
   * Call this on startup before using the PartsFile.
   */
  async load(): Promise<void> {
    try {
      const fs = this.storageHandle.getFileSystem()

      // Check if file exists
      const exists = await fs.exists(this.filename)
      if (!exists) {
        this.logger.debug(`.parts file does not exist, starting fresh`)
        return
      }

      // Get file size via filesystem stat
      const stat = await fs.stat(this.filename)

      // Read the file
      const handle = await fs.open(this.filename, 'r')
      try {
        const buffer = new Uint8Array(stat.size)
        await handle.read(buffer, 0, stat.size, 0)

        // Decode bencode
        const decoded = Bencode.decode(buffer)
        if (typeof decoded !== 'object' || decoded === null) {
          this.logger.warn(`.parts file has invalid format, starting fresh`)
          return
        }

        // Load pieces into map
        let loadedCount = 0
        for (const [key, value] of Object.entries(decoded)) {
          const index = parseInt(key, 10)
          if (!isNaN(index) && value instanceof Uint8Array) {
            this.data.set(index, value)
            loadedCount++
          }
        }

        this.logger.info(`Loaded ${loadedCount} pieces from .parts file`)
      } finally {
        await handle.close()
      }
    } catch (e) {
      // File doesn't exist or can't be read - that's ok, we start fresh
      this.logger.debug(`.parts file load failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * Flush changes to disk.
   * Writes directly to the .parts file with fsync for durability.
   *
   * If the .parts file becomes empty, it is deleted.
   */
  async flush(): Promise<void> {
    if (!this.dirty) return

    const fs = this.storageHandle.getFileSystem()

    if (this.data.size === 0) {
      // Delete the .parts file if empty
      try {
        await fs.delete(this.filename)
        this.logger.info(`Deleted empty .parts file`)
      } catch {
        // File may not exist, that's fine
      }
      this.dirty = false
      return
    }

    // Convert map to object for bencoding
    const obj: Record<string, Uint8Array> = {}
    for (const [index, data] of this.data) {
      obj[index.toString()] = data
    }

    // Encode
    const encoded = Bencode.encode(obj)

    // Write directly (io-daemon handles creation)
    const handle = await fs.open(this.filename, 'w')
    try {
      await handle.write(encoded, 0, encoded.length, 0)
      await handle.sync()
    } finally {
      await handle.close()
    }

    this.dirty = false
    this.logger.debug(`Flushed ${this.data.size} pieces to .parts file (${encoded.length} bytes)`)
  }

  /**
   * Add a piece and immediately flush to disk.
   * This is the safe way to add pieces during download.
   */
  async addPieceAndFlush(index: number, data: Uint8Array): Promise<void> {
    this.addPiece(index, data)
    await this.flush()
  }

  /**
   * Remove a piece and immediately flush to disk.
   */
  async removePieceAndFlush(index: number): Promise<boolean> {
    const removed = this.removePiece(index)
    if (removed) {
      await this.flush()
    }
    return removed
  }

  /**
   * Get piece count.
   */
  get count(): number {
    return this.data.size
  }

  /**
   * Check if there are any pieces stored.
   */
  get isEmpty(): boolean {
    return this.data.size === 0
  }
}
