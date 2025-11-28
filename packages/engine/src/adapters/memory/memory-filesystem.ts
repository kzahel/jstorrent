import { IFileSystem, IFileHandle, IFileStat } from '../../interfaces/filesystem'

class MemoryFileHandle implements IFileHandle {
  constructor(
    private fs: InMemoryFileSystem,
    private path: string,
  ) {}

  async read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }> {
    const fileData = this.fs.files.get(this.path)
    if (!fileData) throw new Error('File not found')

    const end = Math.min(position + length, fileData.length)
    const bytesRead = end - position

    if (bytesRead <= 0) return { bytesRead: 0 }

    buffer.set(fileData.slice(position, end), offset)
    return { bytesRead }
  }

  async write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }> {
    let fileData = this.fs.files.get(this.path) || new Uint8Array(0)

    const requiredSize = position + length
    if (fileData.length < requiredSize) {
      const newBuffer = new Uint8Array(requiredSize)
      newBuffer.set(fileData)
      fileData = newBuffer
    }

    fileData.set(buffer.slice(offset, offset + length), position)
    this.fs.files.set(this.path, fileData)

    return { bytesWritten: length }
  }

  async truncate(len: number): Promise<void> {
    const fileData = this.fs.files.get(this.path)
    if (fileData) {
      this.fs.files.set(this.path, fileData.slice(0, len))
    }
  }

  async sync(): Promise<void> {}
  async close(): Promise<void> {}
}

export class InMemoryFileSystem implements IFileSystem {
  public files = new Map<string, Uint8Array>()

  async open(path: string, mode: 'r' | 'w' | 'r+'): Promise<IFileHandle> {
    if (mode === 'r' && !this.files.has(path)) {
      throw new Error(`File not found: ${path}`)
    }
    if (!this.files.has(path)) {
      this.files.set(path, new Uint8Array(0))
    }
    return new MemoryFileHandle(this, path)
  }

  async stat(path: string): Promise<IFileStat> {
    const file = this.files.get(path)
    if (file) {
      return {
        size: file.length,
        mtime: new Date(),
        isDirectory: false,
        isFile: true,
      }
    }

    // Check if it's a directory
    const prefix = path.endsWith('/') ? path : `${path}/`
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        return {
          size: 0,
          mtime: new Date(),
          isDirectory: true,
          isFile: false,
        }
      }
    }

    throw new Error(`File not found: ${path}`)
  }

  async mkdir(_path: string): Promise<void> {
    // No-op for flat memory FS
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path)
  }

  async readdir(dirPath: string): Promise<string[]> {
    // Naive implementation for flat map: find keys starting with dirPath
    // This assumes paths are normalized and use / separator
    const entries = new Set<string>()
    const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`

    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) {
        const relative = path.slice(prefix.length)
        const parts = relative.split('/')
        if (parts.length > 0) {
          entries.add(parts[0])
        }
      }
    }
    return Array.from(entries)
  }

  async readFile(path: string): Promise<Uint8Array> {
    const file = this.files.get(path)
    if (!file) throw new Error(`File not found: ${path}`)
    return file
  }
}
