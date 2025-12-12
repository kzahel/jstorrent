import { ITcpServer } from '../../interfaces/socket'
import { DaemonConnection } from './daemon-connection'
import { DaemonTcpSocket } from './daemon-tcp-socket'
import { IDaemonSocketManager } from './internal-types'

// Opcodes
const OP_TCP_LISTEN = 0x15
const OP_TCP_ACCEPT = 0x17
const OP_TCP_STOP_LISTEN = 0x18
const PROTOCOL_VERSION = 1

export class DaemonTcpServer implements ITcpServer {
  private serverId: number
  private boundPort: number | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connectionCallback: ((socket: any) => void) | null = null

  constructor(
    serverId: number,
    private daemon: DaemonConnection,
    private manager: IDaemonSocketManager,
  ) {
    this.serverId = serverId

    // Register handler for TCP_ACCEPT events
    this.manager.registerHandler(serverId, (payload, msgType) => {
      if (msgType === OP_TCP_ACCEPT) {
        this.handleAccept(payload)
      }
    })
  }

  listen(port: number, callback?: () => void): void {
    const reqId = this.manager.nextRequestId()

    // Payload: serverId(4), port(2), bindAddr(string)
    const buffer = new ArrayBuffer(4 + 2)
    const view = new DataView(buffer)
    view.setUint32(0, this.serverId, true)
    view.setUint16(4, port, true)
    // Empty bind address means 0.0.0.0

    this.daemon.sendFrame(this.manager.packEnvelope(OP_TCP_LISTEN, reqId, new Uint8Array(buffer)))

    // Wait for response
    this.manager.waitForResponse(reqId).then(
      (payload) => {
        // Parse response: serverId(4), status(1), boundPort(2), errno(4)
        if (payload.byteLength >= 7) {
          const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
          const boundPort = view.getUint16(5, true)
          this.boundPort = boundPort
          callback?.()
        }
      },
      (err) => {
        console.error('TCP listen failed:', err)
      },
    )
  }

  address(): { port: number } | null {
    if (this.boundPort === null) {
      return null
    }
    return { port: this.boundPort }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: 'connection', cb: (socket: any) => void): void {
    if (event === 'connection') {
      this.connectionCallback = cb
    }
  }

  close(): void {
    // Send OP_TCP_STOP_LISTEN
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setUint32(0, this.serverId, true)

    const env = new ArrayBuffer(8 + 4)
    const envView = new DataView(env)
    envView.setUint8(0, PROTOCOL_VERSION)
    envView.setUint8(1, OP_TCP_STOP_LISTEN)
    envView.setUint16(2, 0, true)
    envView.setUint32(4, 0, true) // reqId=0 for async
    new Uint8Array(env, 8).set(new Uint8Array(buffer))

    this.daemon.sendFrame(env)
    this.manager.unregisterHandler(this.serverId)
  }

  private handleAccept(payload: Uint8Array): void {
    // Payload: serverId(4), socketId(4), remotePort(2), remoteAddr(string)
    if (payload.byteLength < 10) {
      return
    }

    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const socketId = view.getUint32(4, true)
    const remotePort = view.getUint16(8, true)
    const remoteAddress = new TextDecoder().decode(payload.slice(10))

    // Create a DaemonTcpSocket for the accepted connection with remote address info
    const socket = new DaemonTcpSocket(socketId, this.daemon, this.manager, {
      remoteAddress,
      remotePort,
    })

    // Call the connection callback with the socket
    // The engine expects to receive the socket and will call wrapTcpSocket on it,
    // but since DaemonTcpSocket already implements ITcpSocket, we pass it directly
    this.connectionCallback?.(socket)
  }
}
