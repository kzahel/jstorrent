/**
 * Native TCP Socket
 *
 * Implements ITcpSocket using native bindings.
 */

import type { ITcpSocket } from '../../interfaces/socket'
import { callbackManager } from './callback-manager'
import './bindings.d.ts'

export class NativeTcpSocket implements ITcpSocket {
  private onDataCb: ((data: Uint8Array) => void) | null = null
  private onCloseCb: ((hadError: boolean) => void) | null = null
  private onErrorCb: ((err: Error) => void) | null = null
  private closed = false
  private closeFired = false

  public remoteAddress?: string
  public remotePort?: number
  public isEncrypted?: boolean
  public isSecure?: boolean

  constructor(
    private readonly id: number,
    options?: { remoteAddress?: string; remotePort?: number },
  ) {
    if (options) {
      this.remoteAddress = options.remoteAddress
      this.remotePort = options.remotePort
    }

    callbackManager.registerTcp(id, {
      onData: (data) => this.onDataCb?.(data),
      onClose: (hadError) => {
        if (this.closeFired) return
        this.closeFired = true
        this.closed = true
        this.onCloseCb?.(hadError)
        callbackManager.unregisterTcp(this.id)
      },
      onError: (err) => this.onErrorCb?.(err),
    })
  }

  /**
   * Connect to a remote host and port.
   * Returns a promise that resolves when connected or rejects on error.
   */
  async connect(port: number, host: string): Promise<void> {
    if (this.closed) {
      throw new Error('Socket is closed')
    }

    return new Promise((resolve, reject) => {
      callbackManager.updateTcpHandler(
        this.id,
        'onConnect',
        (success, errorMessage) => {
          if (success) {
            this.remoteAddress = host
            this.remotePort = port
            resolve()
          } else {
            reject(new Error(errorMessage || 'Connection failed'))
          }
        },
      )
      __jstorrent_tcp_connect(this.id, host, port)
    })
  }

  /**
   * Send data to the remote peer.
   */
  send(data: Uint8Array): void {
    if (this.closed) return
    // Convert Uint8Array to ArrayBuffer for native binding
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer
    __jstorrent_tcp_send(this.id, buffer)
  }

  /**
   * Register a callback for incoming data.
   */
  onData(cb: (data: Uint8Array) => void): void {
    this.onDataCb = cb
  }

  /**
   * Register a callback for connection close.
   */
  onClose(cb: (hadError: boolean) => void): void {
    this.onCloseCb = cb
  }

  /**
   * Register a callback for errors.
   */
  onError(cb: (err: Error) => void): void {
    this.onErrorCb = cb
  }

  /**
   * Close the connection.
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    __jstorrent_tcp_close(this.id)

    // Fire close callback if not already fired
    if (!this.closeFired) {
      this.closeFired = true
      this.onCloseCb?.(false)
      callbackManager.unregisterTcp(this.id)
    }
  }

  /**
   * TLS upgrade is not supported in native mode.
   */
  async secure(): Promise<void> {
    throw new Error('TLS upgrade not supported in native mode')
  }
}
