import { IStorageHandle } from './storage-handle'
import { IFileSystem } from '../interfaces/filesystem'

export class FileSystemStorageHandle implements IStorageHandle {
  public id: string
  public name: string

  constructor(private fileSystem: IFileSystem) {
    this.id = 'fs-' + Math.random().toString(36).slice(2, 9)
    this.name = 'FileSystem'
  }

  getFileSystem(): IFileSystem {
    return this.fileSystem
  }
}
