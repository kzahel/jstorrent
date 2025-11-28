import { IFileSystem, IFileHandle, IFileStat } from '../../interfaces/filesystem'
import { DaemonConnection } from './daemon-connection'
import { DaemonFileHandle } from './daemon-file-handle'

export class DaemonFileSystem implements IFileSystem {
  constructor(
    private connection: DaemonConnection,
    private rootToken: string,
  ) {}

  async open(path: string, _mode: 'r' | 'w' | 'r+'): Promise<IFileHandle> {
    // For 'w' or 'r+', we might want to ensure the file exists or is created.
    // The current io-daemon `write_file` handles creation.
    // `read_file` errors if not found.
    // We can just return the handle and let the operations fail if needed,
    // or we could do a stat check here.
    // For now, just return the handle.
    return new DaemonFileHandle(this.connection, path, this.rootToken)
  }

  async stat(path: string): Promise<IFileStat> {
    const stat = await this.connection.request<{
      size: number
      mtime: number
      is_directory: boolean
      is_file: boolean
    }>('GET', '/ops/stat', {
      path,
      root_token: this.rootToken,
    })

    return {
      size: stat.size,
      mtime: new Date(stat.mtime),
      isDirectory: stat.is_directory,
      isFile: stat.is_file,
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.connection.request('POST', '/files/ensure_dir', undefined, {
      path,
      root_token: this.rootToken,
    })
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path)
      return true
    } catch (_e) {
      return false
    }
  }

  async readdir(path: string): Promise<string[]> {
    return this.connection.request<string[]>('GET', '/ops/list', {
      path,
      root_token: this.rootToken,
    })
  }

  async delete(path: string): Promise<void> {
    await this.connection.request('POST', '/ops/delete', undefined, {
      path,
      root_token: this.rootToken,
    })
  }
}
