export declare enum MessageType {
  CHOKE = 0,
  UNCHOKE = 1,
  INTERESTED = 2,
  NOT_INTERESTED = 3,
  HAVE = 4,
  BITFIELD = 5,
  REQUEST = 6,
  PIECE = 7,
  CANCEL = 8,
  EXTENDED = 20,
  KEEP_ALIVE = -1, // Internal representation
  HANDSHAKE = -2,
}
export declare enum MetadataMsgType {
  REQUEST = 0,
  DATA = 1,
  REJECT = 2,
}
export declare const EXTENDED_HANDSHAKE_ID = 0
export interface WireMessage {
  type: MessageType
  payload?: Uint8Array
  index?: number
  begin?: number
  length?: number
  block?: Uint8Array
  extendedId?: number
  extendedPayload?: Uint8Array
}
export declare class PeerWireProtocol {
  static parseHandshake(buffer: Uint8Array): {
    infoHash: Uint8Array
    peerId: Uint8Array
    protocol: string
    extensions: boolean
  } | null
  static createHandshake(infoHash: Uint8Array, peerId: Uint8Array, extensions?: boolean): Uint8Array
  static parseMessage(buffer: Uint8Array): WireMessage | null
  static createMessage(type: MessageType, payload?: Uint8Array): Uint8Array
  static createRequest(index: number, begin: number, length: number): Uint8Array
  static createPiece(index: number, begin: number, block: Uint8Array): Uint8Array
  static createExtendedMessage(id: number, payload: Uint8Array): Uint8Array
  static createMetadataRequest(metadataId: number, piece: number): Uint8Array
  static createMetadataReject(metadataId: number, piece: number): Uint8Array
  static createMetadataData(
    metadataId: number,
    piece: number,
    totalSize: number,
    data: Uint8Array,
  ): Uint8Array
}
//# sourceMappingURL=wire-protocol.d.ts.map
