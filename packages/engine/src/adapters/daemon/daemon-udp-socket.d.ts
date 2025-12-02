import { IUdpSocket } from '../../interfaces/socket'
import { DaemonConnection } from './daemon-connection'
import { IDaemonSocketManager } from './internal-types'
export declare class DaemonUdpSocket implements IUdpSocket {
  private id
  private daemon
  private manager
  private onMessageCb
  constructor(id: number, daemon: DaemonConnection, manager: IDaemonSocketManager)
  send(addr: string, port: number, data: Uint8Array): void
  onMessage(
    cb: (
      src: {
        addr: string
        port: number
      },
      data: Uint8Array,
    ) => void,
  ): void
  close(): void
}
//# sourceMappingURL=daemon-udp-socket.d.ts.map
