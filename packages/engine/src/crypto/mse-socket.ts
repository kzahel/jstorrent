/**
 * MseSocket - ITcpSocket wrapper that handles MSE/PE encryption
 *
 * This wraps a raw socket and transparently handles:
 * - MSE handshake (if enabled)
 * - Ongoing encryption/decryption (if RC4 mode)
 *
 * Usage:
 *   const mseSocket = new MseSocket(rawSocket, options)
 *   await mseSocket.connect(port, host)
 *   // Now use like normal ITcpSocket - encryption is transparent
 */
import { ITcpSocket } from '../interfaces/socket'
import { MseHandshake, MseRole } from './mse-handshake'
import { RC4 } from './rc4'

export type EncryptionPolicy = 'disabled' | 'allow' | 'prefer' | 'required'

export interface MseSocketOptions {
  policy: EncryptionPolicy
  infoHash?: Uint8Array // For outgoing connections
  knownInfoHashes?: Uint8Array[] // For incoming connections
  sha1: (data: Uint8Array) => Promise<Uint8Array>
  getRandomBytes: (length: number) => Uint8Array
  onInfoHashRecovered?: (infoHash: Uint8Array) => void // For incoming
}

export class MseSocket implements ITcpSocket {
  private socket: ITcpSocket
  private options: MseSocketOptions
  private handshakeComplete = false
  private handshakePromise: Promise<void> | null = null
  private encrypt: RC4 | null = null
  private decrypt: RC4 | null = null
  private encrypted = false

  private onDataCb: ((data: Uint8Array) => void) | null = null
  private onCloseCb: ((hadError: boolean) => void) | null = null
  private onErrorCb: ((err: Error) => void) | null = null
  private bufferedData: Uint8Array[] = []

  // For handshake
  private handshake: MseHandshake | null = null

  remoteAddress?: string
  remotePort?: number

  constructor(socket: ITcpSocket, options: MseSocketOptions) {
    this.socket = socket
    this.options = options
    this.remoteAddress = socket.remoteAddress
    this.remotePort = socket.remotePort

    // Intercept socket events
    this.socket.onData((data) => this.handleData(data))
    this.socket.onClose((hadError) => this.onCloseCb?.(hadError))
    this.socket.onError((err) => this.onErrorCb?.(err))
  }

  async connect(port: number, host: string): Promise<void> {
    await this.socket.connect?.(port, host)

    if (this.options.policy === 'disabled') {
      this.handshakeComplete = true
      return
    }

    // Run MSE handshake as initiator
    this.handshakePromise = this.runHandshake('initiator')
    await this.handshakePromise
  }

  /**
   * Run MSE handshake on an already-connected socket.
   * Use this instead of connect() when the underlying socket is already connected.
   */
  async runHandshakeOnConnected(): Promise<void> {
    if (this.options.policy === 'disabled') {
      this.handshakeComplete = true
      return
    }

    // Run MSE handshake as initiator
    this.handshakePromise = this.runHandshake('initiator')
    await this.handshakePromise
  }

  /**
   * For incoming connections - call this after socket is accepted
   */
  async acceptConnection(): Promise<void> {
    if (this.options.policy === 'disabled') {
      this.handshakeComplete = true
      return
    }

    // Wait for first data to detect PE vs plain BT
    this.handshakePromise = this.runHandshake('responder')
    await this.handshakePromise
  }

  private async runHandshake(role: MseRole): Promise<void> {
    this.handshake = new MseHandshake({
      role,
      infoHash: this.options.infoHash,
      knownInfoHashes: this.options.knownInfoHashes,
      sha1: this.options.sha1,
      getRandomBytes: this.options.getRandomBytes,
    })

    const resultPromise = this.handshake.start((data) => this.socket.send(data))

    // Feed any buffered data to handshake
    for (const data of this.bufferedData) {
      this.handshake.onData(data, (d) => this.socket.send(d))
    }
    this.bufferedData = []

    const result = await resultPromise

    if (!result.success) {
      if (this.options.policy === 'required') {
        throw new Error(`MSE handshake failed: ${result.error}`)
      }
      // Fall back to plain connection
      this.handshakeComplete = true
      this.handshake = null
      return
    }

    // For 'required' policy, reject if connection is not encrypted
    // (e.g., peer sent plain BitTorrent handshake)
    if (this.options.policy === 'required' && !result.encrypted) {
      throw new Error('MSE handshake failed: encryption required but peer sent plain connection')
    }

    this.encrypted = result.encrypted
    this.encrypt = result.encrypt || null
    this.decrypt = result.decrypt || null
    this.handshakeComplete = true
    this.handshake = null

    // Notify about recovered info hash (for incoming)
    if (result.infoHash && this.options.onInfoHashRecovered) {
      this.options.onInfoHashRecovered(result.infoHash)
    }

    // Deliver any initial payload
    if (result.initialPayload && result.initialPayload.length > 0) {
      this.onDataCb?.(result.initialPayload)
    }
  }

  private handleData(data: Uint8Array): void {
    if (!this.handshakeComplete) {
      if (this.handshake) {
        // Feed to handshake
        this.handshake.onData(data, (d) => this.socket.send(d))
      } else {
        // Buffer during handshake setup
        this.bufferedData.push(data)
      }
      return
    }

    // Decrypt if encrypted
    if (this.encrypted && this.decrypt) {
      data = this.decrypt.process(data)
    }

    this.onDataCb?.(data)
  }

  send(data: Uint8Array): void {
    if (!this.handshakeComplete) {
      throw new Error('Cannot send before handshake complete')
    }

    // Encrypt if encrypted
    if (this.encrypted && this.encrypt) {
      data = this.encrypt.process(data)
    }

    this.socket.send(data)
  }

  onData(cb: (data: Uint8Array) => void): void {
    this.onDataCb = cb
  }

  onClose(cb: (hadError: boolean) => void): void {
    this.onCloseCb = cb
  }

  onError(cb: (err: Error) => void): void {
    this.onErrorCb = cb
  }

  close(): void {
    if (this.handshake) {
      this.handshake.cancel()
    }
    this.socket.close()
  }

  // Expose encryption state for debugging
  get isEncrypted(): boolean {
    return this.encrypted
  }
}
