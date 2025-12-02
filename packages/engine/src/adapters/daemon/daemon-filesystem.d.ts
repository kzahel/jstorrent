import { IFileSystem, IFileHandle, IFileStat } from '../../interfaces/filesystem'
import { DaemonConnection } from './daemon-connection'
export declare class DaemonFileSystem implements IFileSystem {
  private connection
  private rootKey
  constructor(connection: DaemonConnection, rootKey: string)
  open(path: string, _mode: 'r' | 'w' | 'r+'): Promise<IFileHandle>
  stat(path: string): Promise<IFileStat>
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  readdir(path: string): Promise<string[]>
  delete(path: string): Promise<void>
}
//# sourceMappingURL=daemon-filesystem.d.ts.map
