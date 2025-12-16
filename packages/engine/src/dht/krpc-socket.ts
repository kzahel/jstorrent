/**
 * KRPC Socket
 *
 * Wraps IUdpSocket with KRPC message encoding/decoding and transaction management.
 * Emits 'query' events for incoming queries that need handling.
 */

import { EventEmitter } from '../utils/event-emitter'
import { IUdpSocket, ISocketFactory } from '../interfaces/socket'
import { TransactionManager } from './transaction-manager'
import {
  KRPCQuery,
  KRPCResponse,
  decodeMessage,
  isQuery,
  isResponse,
  isError,
} from './krpc-messages'
import { QUERY_TIMEOUT_MS } from './constants'

/**
 * Options for KRPCSocket.
 */
export interface KRPCSocketOptions {
  /** Query timeout in ms (default: 5000) */
  timeout?: number
  /** Bind address (default: '0.0.0.0') */
  bindAddr?: string
  /** Bind port (default: 0 for random) */
  bindPort?: number
}

/**
 * Events emitted by KRPCSocket.
 */
export interface KRPCSocketEvents {
  /**
   * Emitted when an incoming query is received.
   * Handler should process and send a response.
   */
  query: (query: KRPCQuery, rinfo: { host: string; port: number }) => void

  /**
   * Emitted on socket errors.
   */
  error: (err: Error) => void
}

/**
 * KRPC Socket for DHT communication.
 */
export class KRPCSocket extends EventEmitter {
  private socket: IUdpSocket | null = null
  private transactions: TransactionManager
  private socketFactory: ISocketFactory
  private options: Required<KRPCSocketOptions>

  constructor(socketFactory: ISocketFactory, options: KRPCSocketOptions = {}) {
    super()
    this.socketFactory = socketFactory
    this.options = {
      timeout: options.timeout ?? QUERY_TIMEOUT_MS,
      bindAddr: options.bindAddr ?? '0.0.0.0',
      bindPort: options.bindPort ?? 0,
    }
    this.transactions = new TransactionManager(this.options.timeout)
  }

  /**
   * Initialize the socket and start listening.
   */
  async bind(): Promise<void> {
    if (this.socket) {
      throw new Error('Socket already bound')
    }

    this.socket = await this.socketFactory.createUdpSocket(
      this.options.bindAddr,
      this.options.bindPort,
    )

    this.socket.onMessage((rinfo, data) => {
      this.handleMessage(data, rinfo)
    })
  }

  /**
   * Send a query and wait for response.
   *
   * @param host - Target host
   * @param port - Target port
   * @param data - Encoded KRPC query (must include transaction ID)
   * @param transactionId - Transaction ID used in the query
   * @param method - Query method name (for tracking)
   * @returns Promise resolving to the response or rejecting on error/timeout
   */
  query(
    host: string,
    port: number,
    data: Uint8Array,
    transactionId: Uint8Array,
    method: string,
  ): Promise<KRPCResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not bound'))
        return
      }

      this.transactions.track(transactionId, method, { host, port }, (err, response) => {
        if (err) {
          reject(err)
        } else {
          resolve(response as KRPCResponse)
        }
      })

      this.socket.send(host, port, data)
    })
  }

  /**
   * Send raw data (for responses).
   */
  send(host: string, port: number, data: Uint8Array): void {
    if (!this.socket) {
      throw new Error('Socket not bound')
    }
    this.socket.send(host, port, data)
  }

  /**
   * Generate a new transaction ID.
   */
  generateTransactionId(): Uint8Array {
    return this.transactions.generateTransactionId()
  }

  /**
   * Get the number of pending queries.
   */
  pendingCount(): number {
    return this.transactions.size()
  }

  /**
   * Get timeout configuration.
   */
  getTimeout(): number {
    return this.options.timeout
  }

  /**
   * Close the socket and clean up.
   */
  close(): void {
    this.transactions.destroy()
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }

  /**
   * Handle incoming UDP message.
   */
  private handleMessage(data: Uint8Array, rinfo: { addr: string; port: number }): void {
    const msg = decodeMessage(data)
    if (!msg) {
      // Invalid message - ignore
      return
    }

    if (isResponse(msg)) {
      // Route to pending query
      this.transactions.resolve(msg.t, msg)
    } else if (isError(msg)) {
      // Route error to pending query
      this.transactions.reject(msg.t, msg.e[0], msg.e[1])
    } else if (isQuery(msg)) {
      // Emit for handler to process
      this.emit('query', msg, { host: rinfo.addr, port: rinfo.port })
    }
  }
}
