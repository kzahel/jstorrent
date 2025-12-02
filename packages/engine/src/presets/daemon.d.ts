import { BtEngine } from '../core/bt-engine'
import { StorageRoot } from '../storage/storage-root-manager'
import { ISessionStore } from '../interfaces/session-store'
import { LogEntry } from '../logging/logger'
export interface DaemonEngineConfig {
  daemon: {
    port: number
    authToken: string
  }
  contentRoots: StorageRoot[]
  defaultContentRoot?: string
  sessionStore: ISessionStore
  onLog?: (entry: LogEntry) => void
  port?: number
}
export declare function createDaemonEngine(config: DaemonEngineConfig): Promise<BtEngine>
//# sourceMappingURL=daemon.d.ts.map
