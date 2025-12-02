export interface IDaemonSocketManager {
  registerHandler(socketId: number, handler: (payload: Uint8Array, msgType: number) => void): void
  unregisterHandler(socketId: number): void
  packEnvelope(msgType: number, reqId: number, payload?: Uint8Array): ArrayBuffer
  waitForResponse(reqId: number): Promise<Uint8Array>
  nextRequestId(): number
}
//# sourceMappingURL=internal-types.d.ts.map
