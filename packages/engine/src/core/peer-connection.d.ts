import { ITcpSocket } from '../interfaces/socket'
import { MessageType, WireMessage } from '../protocol/wire-protocol'
import { BitField } from '../utils/bitfield'
import { EngineComponent, ILoggingEngine } from '../logging/logger'
import { SpeedCalculator } from '../utils/speed-calculator'
export interface PeerConnection {
  on(event: 'connect', listener: () => void): this
  on(event: 'close', listener: (hadError: boolean) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(
    event: 'handshake',
    listener: (infoHash: Uint8Array, peerId: Uint8Array, extensions: boolean) => void,
  ): this
  on(event: 'message', listener: (message: WireMessage) => void): this
  on(event: 'bitfield', listener: (bitfield: BitField) => void): this
  on(event: 'have', listener: (index: number) => void): this
  on(event: 'choke', listener: () => void): this
  on(event: 'unchoke', listener: () => void): this
  on(event: 'extended', listener: (id: number, payload: Uint8Array) => void): this
  on(event: 'request', listener: (index: number, begin: number, length: number) => void): this
  on(event: 'piece', listener: (index: number, begin: number, data: Uint8Array) => void): this
  on(event: 'cancel', listener: (index: number, begin: number, length: number) => void): this
  on(event: 'interested', listener: () => void): this
  on(event: 'extension_handshake', listener: (payload: Record<string, unknown>) => void): this
  on(event: 'metadata_request', listener: (piece: number) => void): this
  on(
    event: 'metadata_data',
    listener: (piece: number, totalSize: number, data: Uint8Array) => void,
  ): this
  on(event: 'metadata_reject', listener: (piece: number) => void): this
  on(event: 'bytesDownloaded', listener: (bytes: number) => void): this
  on(event: 'bytesUploaded', listener: (bytes: number) => void): this
  close(): void
}
export declare class PeerConnection extends EngineComponent {
  static logName: string
  private socket
  private buffer
  handshakeReceived: boolean
  private send
  peerChoking: boolean
  peerInterested: boolean
  amChoking: boolean
  amInterested: boolean
  peerExtensions: boolean
  requestsPending: number
  peerMetadataId: number | null
  myMetadataId: number
  uploaded: number
  downloaded: number
  uploadSpeedCalculator: SpeedCalculator
  downloadSpeedCalculator: SpeedCalculator
  peerId: Uint8Array | undefined
  infoHash: Uint8Array | undefined
  bitfield: BitField | null
  remoteAddress?: string
  remotePort?: number
  isIncoming: boolean
  constructor(
    engine: ILoggingEngine,
    socket: ITcpSocket,
    options?: {
      remoteAddress?: string
      remotePort?: number
    },
  )
  connect(port: number, host: string): Promise<void>
  sendHandshake(infoHash: Uint8Array, peerId: Uint8Array, extensions?: boolean): void
  sendMessage(type: MessageType, payload?: Uint8Array): void
  sendRequest(index: number, begin: number, length: number): void
  sendHave(index: number): void
  sendPiece(index: number, begin: number, block: Uint8Array): void
  sendExtendedMessage(id: number, payload: Uint8Array): void
  sendExtendedHandshake(): void
  sendMetadataRequest(piece: number): void
  sendMetadataData(piece: number, totalSize: number, data: Uint8Array): void
  sendMetadataReject(piece: number): void
  private handleData
  private processBuffer
  private handleMessage
  private handleExtendedHandshake
  private handleMetadataMessage
  get uploadSpeed(): number
  get downloadSpeed(): number
}
//# sourceMappingURL=peer-connection.d.ts.map
