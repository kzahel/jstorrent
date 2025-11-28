import { IStorageHandle } from '../../io/storage-handle'
import { IFileSystem } from '../../interfaces/filesystem'
import { NodeFileSystem } from './node-filesystem'
import { ScopedNodeFileSystem } from './scoped-node-filesystem'

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
