/**
 * Abstract Socket Interfaces
 *
 * These interfaces are designed to be compatible with the existing implementation
 * in extension/src/lib/sockets.ts, while adding necessary methods for the engine
 * to initiate connections.
 */

export interface ITcpSocket {
  /**
   * Send data to the remote peer.
   */
  send(data: Uint8Array): void

  /**
   * Register a callback for incoming data.
   */
  onData(cb: (data: Uint8Array) => void): void

  /**
   * Register a callback for connection close.
   */
  onClose(cb: (hadError: boolean) => void): void

  /**
   * Register a callback for errors.
   */
  onError(cb: (err: Error) => void): void

  /**
   * Close the connection.
   */
  close(): void

  /**
   * Remote peer address (available for accepted connections).
   */
  remoteAddress?: string

  /**
   * Remote peer port (available for accepted connections).
   */
  remotePort?: number

  /**
   * Connect to a remote peer.
   * Note: This is an addition to the extension's interface to allow
   * the engine to initiate connections.
   */
  connect?(port: number, host: string): Promise<void>
}

export interface ITcpServer {
  /**
   * Start listening on the specified port.
   * Calls the callback when the server is ready.
   */
  listen(port: number, callback?: () => void): void

  /**
   * Get the address the server is listening on.
   */
  address(): { port: number } | null

  /**
   * Register a callback for incoming connections.
   * The socket passed to the callback is the native socket that needs to be wrapped.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: 'connection', cb: (socket: any) => void): void

  /**
   * Close the server.
   */
  close(): void
}

export interface IUdpSocket {
  /**
   * Send data to a specific address and port.
   */
  send(addr: string, port: number, data: Uint8Array): void

  /**
   * Register a callback for incoming messages.
   */
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void

  /**
   * Close the socket.
   */
  close(): void

  /**
   * Join a multicast group to receive multicast packets.
   * Required for SSDP (UPnP discovery) and LPD (local peer discovery).
   */
  joinMulticast(group: string): Promise<void>

  /**
   * Leave a multicast group.
   */
  leaveMulticast(group: string): Promise<void>
}

export interface ISocketFactory {
  /**
   * Create a new TCP socket.
   * If host and port are provided, it may attempt to connect immediately
   * (depending on implementation), or return a socket ready to connect.
   */
  createTcpSocket(host?: string, port?: number): Promise<ITcpSocket>

  /**
   * Create a new UDP socket bound to the specified address and port.
   */
  createUdpSocket(bindAddr?: string, bindPort?: number): Promise<IUdpSocket>

  /**
   * Create a TCP server.
   */
  createTcpServer(): ITcpServer

  /**
   * Wrap a native socket into ITcpSocket.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapTcpSocket(socket: any): ITcpSocket
}
