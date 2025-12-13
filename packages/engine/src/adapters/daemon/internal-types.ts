export interface IDaemonSocketManager {
  registerHandler(
    socketId: number,
    handler: (payload: Uint8Array, msgType: number) => void,
    socketType?: 'tcp' | 'udp',
  ): void
  unregisterHandler(socketId: number): void
  packEnvelope(msgType: number, reqId: number, payload?: Uint8Array): ArrayBuffer
  waitForResponse(reqId: number): Promise<Uint8Array>
  nextRequestId(): number
}
