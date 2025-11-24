import { IStorageHandle } from '../storage-handle'
import { IFileSystem } from '../../interfaces/filesystem'
import { NodeFileSystem } from './node-filesystem'
import * as path from 'path'

export class NodeStorageHandle implements IStorageHandle {
  private fs: NodeFileSystem

  constructor(
    public id: string,
    public name: string,
    _rootPath: string,
  ) {
    // NodeFileSystem currently doesn't support "rooting" to a specific path easily
    // without modification. For now, we'll assume NodeFileSystem can handle absolute paths
    // and we will prepend the rootPath to any relative paths passed to it.
    // Ideally, NodeFileSystem should be updated to support a root path.
    // But wait, IFileSystem interface methods take a path.
    // Let's create a ScopedNodeFileSystem wrapper.
    this.fs = new ScopedNodeFileSystem(_rootPath)
  }

  getFileSystem(): IFileSystem {
    return this.fs
  }
}

class ScopedNodeFileSystem extends NodeFileSystem {
  constructor(private root: string) {
    super()
  }

  private resolve(p: string): string {
    return path.resolve(this.root, p)
  }

  // Override methods to resolve paths relative to root
  // Note: NodeFileSystem methods are async

  async open(filePath: string, mode: 'r' | 'w' | 'r+') {
    return super.open(this.resolve(filePath), mode)
  }

  async stat(filePath: string) {
    return super.stat(this.resolve(filePath))
  }

  async mkdir(dirPath: string) {
    return super.mkdir(this.resolve(dirPath))
  }

  async exists(filePath: string) {
    return super.exists(this.resolve(filePath))
  }
}
