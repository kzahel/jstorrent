import * as fs from 'fs/promises'
import * as path from 'path'
import { IFileSystem, IFileHandle, IFileStat } from '../../interfaces/filesystem'

export class NodeFileHandle implements IFileHandle {
  constructor(private handle: fs.FileHandle) {}

  async read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }> {
    const result = await this.handle.read(buffer, offset, length, position)
    return { bytesRead: result.bytesRead }
  }

  async write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }> {
    const result = await this.handle.write(buffer, offset, length, position)
    return { bytesWritten: result.bytesWritten }
  }

  async truncate(len: number): Promise<void> {
    await this.handle.truncate(len)
  }

  async sync(): Promise<void> {
    await this.handle.sync()
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}

export class NodeFileSystem implements IFileSystem {
  async open(filePath: string, mode: 'r' | 'w' | 'r+'): Promise<IFileHandle> {
    // Map modes to Node.js flags
    let flags = 'r'
    if (mode === 'w') flags = 'w+' // Open for reading and writing, file created (if it does not exist) or truncated (if it exists).
    if (mode === 'r+') flags = 'r+' // Open file for reading and writing. An exception occurs if the file does not exist.

    // Ensure directory exists if writing
    if (mode !== 'r') {
      await fs.mkdir(path.dirname(filePath), { recursive: true })

      // If mode is r+, ensure file exists to avoid ENOENT
      if (mode === 'r+') {
        try {
          await fs.access(filePath)
        } catch {
          // File doesn't exist, create it (empty)
          const handle = await fs.open(filePath, 'w')
          await handle.close()
        }
      }
    }

    const handle = await fs.open(filePath, flags)
    return new NodeFileHandle(handle)
  }

  async stat(filePath: string): Promise<IFileStat> {
    const stats = await fs.stat(filePath)
    return {
      size: stats.size,
      mtime: stats.mtime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true })
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }
}
