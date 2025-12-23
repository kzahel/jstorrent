/**
 * Native UDP Socket
 *
 * Implements IUdpSocket using native bindings.
 */

import type { IUdpSocket } from '../../interfaces/socket'
import { callbackManager } from './callback-manager'
import './bindings.d.ts'

export class NativeUdpSocket implements IUdpSocket {
  private onMessageCb: ((src: { addr: string; port: number }, data: Uint8Array) => void) | null =
    null
  private closed = false

  constructor(private readonly id: number) {
    callbackManager.registerUdp(id, {
      onMessage: (src, data) => this.onMessageCb?.(src, data),
    })
  }

  /**
   * Send a UDP datagram to the specified address and port.
   */
  send(addr: string, port: number, data: Uint8Array): void {
    if (this.closed) return
    // Convert Uint8Array to ArrayBuffer for native binding
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer
    __jstorrent_udp_send(this.id, addr, port, buffer)
  }

  /**
   * Register a callback for incoming messages.
   */
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.onMessageCb = cb
  }

  /**
   * Close the socket.
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    __jstorrent_udp_close(this.id)
    callbackManager.unregisterUdp(this.id)
  }

  /**
   * Join a multicast group to receive multicast packets.
   */
  async joinMulticast(group: string): Promise<void> {
    if (this.closed) {
      throw new Error('Socket is closed')
    }
    __jstorrent_udp_join_multicast(this.id, group)
  }

  /**
   * Leave a multicast group.
   */
  async leaveMulticast(group: string): Promise<void> {
    if (this.closed) {
      throw new Error('Socket is closed')
    }
    __jstorrent_udp_leave_multicast(this.id, group)
  }
}
