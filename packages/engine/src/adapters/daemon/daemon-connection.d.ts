export declare class DaemonConnection {
  private port
  private authToken
  private baseUrl
  private ws
  private frameHandlers
  ready: boolean
  private static readonly OP_CLIENT_HELLO
  private static readonly OP_SERVER_HELLO
  private static readonly OP_AUTH
  private static readonly OP_AUTH_RESULT
  private static readonly OP_ERROR
  private static readonly PROTOCOL_VERSION
  constructor(port: number, authToken: string)
  static connect(port: number, authToken: string): Promise<DaemonConnection>
  connectWebSocket(): Promise<void>
  sendFrame(frame: ArrayBuffer): void
  private sendFrameInternal
  onFrame(cb: (f: ArrayBuffer) => void): void
  close(): void
  private waitForOpcode
  private packEnvelope
  private unpackEnvelope
  request<T>(
    method: string,
    path: string,
    params?: Record<string, string | number | boolean>,
    body?: unknown,
  ): Promise<T>
  requestBinary(
    method: string,
    path: string,
    params?: Record<string, string | number | boolean>,
    body?: Uint8Array,
  ): Promise<Uint8Array>
  /**
   * Make an HTTP request with custom headers.
   * Returns the raw Response object for status code inspection.
   */
  requestWithHeaders(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: Uint8Array,
  ): Promise<Response>
  /**
   * Make an HTTP request with custom headers and return binary data.
   */
  requestBinaryWithHeaders(
    method: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<Uint8Array>
}
//# sourceMappingURL=daemon-connection.d.ts.map
