import { NodeFileSystem } from './node-filesystem'
import * as path from 'path'

export class ScopedNodeFileSystem extends NodeFileSystem {
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
