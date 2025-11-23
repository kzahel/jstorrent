/**
 * Abstract File System Interfaces
 */

export interface IFileStat {
  size: number
  mtime: Date
  isDirectory: boolean
  isFile: boolean
}

export interface IFileHandle {
  /**
   * Read data from the file at a specific position.
   */
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>

  /**
   * Write data to the file at a specific position.
   */
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }>

  /**
   * Truncate the file to a specific size.
   */
  truncate(len: number): Promise<void>

  /**
   * Flush changes to storage.
   */
  sync(): Promise<void>

  /**
   * Close the file handle.
   */
  close(): Promise<void>
}

export interface IFileSystem {
  /**
   * Open a file.
   */
  open(path: string, mode: 'r' | 'w' | 'r+'): Promise<IFileHandle>

  /**
   * Get file statistics.
   */
  stat(path: string): Promise<IFileStat>

  /**
   * Create a directory.
   */
  mkdir(path: string): Promise<void>

  /**
   * Check if a path exists.
   */
  exists(path: string): Promise<boolean>
}
