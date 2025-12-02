import { ITcpSocket } from '../../interfaces/socket'
import { DaemonConnection } from './daemon-connection'
import { IDaemonSocketManager } from './internal-types'
export declare class DaemonTcpSocket implements ITcpSocket {
  private id
  private daemon
  private manager
  private onDataCb
  private onCloseCb
  private onErrorCb
  constructor(id: number, daemon: DaemonConnection, manager: IDaemonSocketManager)
  connect(port: number, host: string): Promise<void>
  send(data: Uint8Array): void
  onData(cb: (data: Uint8Array) => void): void
  onClose(cb: (hadError: boolean) => void): void
  onError(cb: (err: Error) => void): void
  close(): void
}
//# sourceMappingURL=daemon-tcp-socket.d.ts.map
