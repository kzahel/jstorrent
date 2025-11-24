import { IStorageHandle } from '../io/storage-handle'
import { IFileHandle } from '../interfaces/filesystem'
import { TorrentFile } from './torrent-file'

export class DiskManager {
  private files: TorrentFile[] = []
  private fileHandles: Map<string, IFileHandle> = new Map()
  private openingFiles: Map<string, Promise<IFileHandle>> = new Map()
  private pieceLength: number = 0

  private id = Math.random().toString(36).slice(2, 7)

  constructor(private storageHandle: IStorageHandle) {
    console.error(`DiskManager: Created instance ${this.id} for storage ${storageHandle.name}`)
  }

  async open(files: TorrentFile[], pieceLength: number) {
    this.files = files
    this.pieceLength = pieceLength
    console.error(`DiskManager ${this.id}: Opened with ${files.length} files`)

    // Pre-open files or open on demand? Let's open on demand for now to save resources,
    // but for simplicity in this phase, we might just open them all if the list is small.
    // Let's stick to open-on-demand logic implicitly in read/write.
  }

  async close() {
    console.error(`DiskManager ${this.id}: Closing all files`)
    // Wait for any pending opens?
    // Ideally we should wait, but for now just close what we have.
    for (const [path, handle] of this.fileHandles) {
      console.error(`DiskManager ${this.id}: Closing file ${path}`)
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
      // console.error(`DiskManager ${this.id}: Waiting for pending open '${path}'`)
      return this.openingFiles.get(path)!
    }

    console.error(
      `DiskManager ${this.id}: Opening file '${path}' (cache miss). Current keys: ${Array.from(this.fileHandles.keys())}`,
    )

    const openPromise = (async () => {
      try {
        const fs = this.storageHandle.getFileSystem()
        const handle = await fs.open(path, 'r+')
        this.fileHandles.set(path, handle)
        console.error(
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

  async read(index: number, begin: number, length: number): Promise<Uint8Array> {
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
