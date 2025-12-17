import { IFileSystem, IFileHandle, IFileStat } from '../../interfaces/filesystem'

class NullFileHandle implements IFileHandle {
  constructor(private size: number = 0) {}

  async read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }> {
    // Return zeros - shouldn't normally be called for write-only usage
    const bytesRead = Math.min(length, Math.max(0, this.size - position))
    buffer.fill(0, offset, offset + bytesRead)
    return { bytesRead }
  }

  async write(
    _buffer: Uint8Array,
    _offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }> {
    // Track size but discard data
    this.size = Math.max(this.size, position + length)
    return { bytesWritten: length }
  }

  async truncate(len: number): Promise<void> {
    this.size = len
  }

  async sync(): Promise<void> {}
  async close(): Promise<void> {}
}

export class NullFileSystem implements IFileSystem {
  private sizes = new Map<string, number>()

  async open(path: string, _mode: 'r' | 'w' | 'r+'): Promise<IFileHandle> {
    return new NullFileHandle(this.sizes.get(path) || 0)
  }

  async stat(path: string): Promise<IFileStat> {
    return {
      size: this.sizes.get(path) || 0,
      mtime: new Date(),
      isDirectory: false,
      isFile: true,
    }
  }

  async mkdir(_path: string): Promise<void> {}

  async exists(_path: string): Promise<boolean> {
    return true
  }

  async readdir(_path: string): Promise<string[]> {
    return []
  }

  async delete(path: string): Promise<void> {
    this.sizes.delete(path)
  }
}
