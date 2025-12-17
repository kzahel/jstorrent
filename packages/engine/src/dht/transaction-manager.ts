/**
 * Transaction Manager for KRPC
 *
 * Tracks pending queries and routes responses to callbacks.
 * Handles timeouts for unresponsive nodes.
 */

import { QUERY_TIMEOUT_MS } from './constants'

/**
 * Pending query state.
 */
export interface PendingQuery {
  /** 2-byte transaction ID */
  transactionId: Uint8Array
  /** Query method (ping, find_node, etc.) */
  method: string
  /** Target node address */
  target: { host: string; port: number }
  /** Time query was sent */
  sentAt: number
  /** Callback for response or error */
  callback: (err: Error | null, response: unknown) => void
  /** Timeout handle */
  timeoutHandle: ReturnType<typeof setTimeout>
}

/**
 * Transaction Manager for tracking KRPC queries.
 */
export class TransactionManager {
  /** Map of transaction ID (hex) to pending query */
  private pending: Map<string, PendingQuery> = new Map()

  /** Counter for generating unique transaction IDs */
  private counter: number = Math.floor(Math.random() * 0xffff)

  /** Timeout duration in ms */
  private readonly timeoutMs: number

  constructor(timeoutMs: number = QUERY_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs
  }

  /**
   * Generate a unique 2-byte transaction ID.
   */
  generateTransactionId(): Uint8Array {
    this.counter = (this.counter + 1) & 0xffff
    const id = new Uint8Array(2)
    id[0] = (this.counter >> 8) & 0xff
    id[1] = this.counter & 0xff
    return id
  }

  /**
   * Track a new pending query.
   *
   * @param transactionId - The transaction ID
   * @param method - Query method name
   * @param target - Target node address
   * @param callback - Callback to invoke on response or timeout
   */
  track(
    transactionId: Uint8Array,
    method: string,
    target: { host: string; port: number },
    callback: (err: Error | null, response: unknown) => void,
  ): void {
    const key = this.idToKey(transactionId)

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(key)
    }, this.timeoutMs)

    const pending: PendingQuery = {
      transactionId,
      method,
      target,
      sentAt: Date.now(),
      callback,
      timeoutHandle,
    }

    this.pending.set(key, pending)
  }

  /**
   * Handle a response by resolving the corresponding query.
   *
   * @param transactionId - Transaction ID from response
   * @param response - The response object
   * @returns true if a pending query was found, false otherwise
   */
  resolve(transactionId: Uint8Array, response: unknown): boolean {
    const key = this.idToKey(transactionId)
    const pending = this.pending.get(key)

    if (!pending) {
      // Unknown transaction ID - ignore
      return false
    }

    // Clean up
    clearTimeout(pending.timeoutHandle)
    this.pending.delete(key)

    // Invoke callback with response
    pending.callback(null, response)
    return true
  }

  /**
   * Handle an error response.
   *
   * @param transactionId - Transaction ID from error
   * @param code - Error code
   * @param message - Error message
   * @returns true if a pending query was found, false otherwise
   */
  reject(transactionId: Uint8Array, code: number, message: string): boolean {
    const key = this.idToKey(transactionId)
    const pending = this.pending.get(key)

    if (!pending) {
      return false
    }

    // Clean up
    clearTimeout(pending.timeoutHandle)
    this.pending.delete(key)

    // Invoke callback with error
    pending.callback(new Error(`KRPC error ${code}: ${message}`), null)
    return true
  }

  /**
   * Get a pending query by transaction ID.
   */
  get(transactionId: Uint8Array): PendingQuery | undefined {
    return this.pending.get(this.idToKey(transactionId))
  }

  /**
   * Get the number of pending queries.
   */
  size(): number {
    return this.pending.size
  }

  /**
   * Clean up all pending queries (call on shutdown).
   */
  destroy(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutHandle)
      pending.callback(new Error('Transaction manager destroyed'), null)
    }
    this.pending.clear()
  }

  /**
   * Handle timeout for a query.
   */
  private handleTimeout(key: string): void {
    const pending = this.pending.get(key)
    if (!pending) return

    this.pending.delete(key)
    pending.callback(new Error('Query timed out'), null)
  }

  /**
   * Convert transaction ID to map key.
   */
  private idToKey(id: Uint8Array): string {
    return Array.from(id)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
