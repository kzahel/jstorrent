import { ISocketFactory, ITcpSocket, IUdpSocket } from '../../interfaces/socket'
import { DaemonConnection } from './daemon-connection'
import { IDaemonSocketManager } from './internal-types'
export declare class DaemonSocketFactory implements ISocketFactory, IDaemonSocketManager {
  private daemon
  private nextSocketIdVal
  private pendingRequests
  private socketHandlers
  constructor(daemon: DaemonConnection)
  createTcpSocket(host?: string, port?: number): Promise<ITcpSocket>
  createUdpSocket(bindAddr?: string, bindPort?: number): Promise<IUdpSocket>
  createTcpServer(): any
  wrapTcpSocket(_socket: any): ITcpSocket
  registerHandler(socketId: number, handler: (payload: Uint8Array, msgType: number) => void): void
  unregisterHandler(socketId: number): void
  private handleFrame
  waitForResponse(reqId: number): Promise<Uint8Array>
  nextRequestId(): number
  packEnvelope(msgType: number, reqId: number, payload?: Uint8Array): ArrayBuffer
}
//# sourceMappingURL=daemon-socket-factory.d.ts.map
