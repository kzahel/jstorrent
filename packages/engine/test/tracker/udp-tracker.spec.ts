/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UdpTracker } from '../../src/tracker/udp-tracker'
import { IUdpSocket, ISocketFactory } from '../../src/interfaces/socket'

// Mock Socket
class MockUdpSocket implements IUdpSocket {
  public sentData: { data: Uint8Array; port: number; addr: string }[] = []
  public onMessageCb: ((src: { addr: string; port: number }, data: Uint8Array) => void) | null =
    null

  send = vi.fn((addr: string, port: number, data: Uint8Array) => {
    this.sentData.push({ data, port, addr })
  })
  onMessage(cb: (src: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.onMessageCb = cb
  }
  close() {}
  bind() {}

  // Helper to simulate incoming message
  emitMessage(data: Uint8Array) {
    if (this.onMessageCb) this.onMessageCb({ addr: '127.0.0.1', port: 0 }, data)
  }
}

class MockSocketFactory implements ISocketFactory {
  public socket = new MockUdpSocket()
  createTcpSocket = vi.fn(async (_host?: string, _port?: number) => {
    return {} as any
  })
  createUdpSocket = vi.fn(async (_bindAddr?: string, _bindPort?: number) => {
    return this.socket
  })
  createTcpServer = vi.fn().mockReturnValue({
    on: vi.fn(),
    listen: vi.fn(),
    address: vi.fn().mockReturnValue({ port: 0 }),
  })
  wrapTcpSocket = vi.fn()
}

describe('UdpTracker', () => {
  const announceUrl = 'udp://tracker.example.com:80'
  const infoHash = new Uint8Array(20).fill(1)
  const peerId = new Uint8Array(20).fill(2)
  let tracker: UdpTracker
  let factory: MockSocketFactory

  beforeEach(() => {
    factory = new MockSocketFactory()
    const mockEngine = {
      scopedLoggerFor: vi.fn().mockReturnValue({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }
    tracker = new UdpTracker(mockEngine as any, announceUrl, infoHash, peerId, factory)
  })

  it('should connect and announce', async () => {
    const announcePromise = tracker.announce('started')

    // Wait for connect request
    await new Promise((r) => setTimeout(r, 10))
    expect(factory.socket.sentData.length).toBe(1)

    // Verify connect request
    const connectReq = factory.socket.sentData[0].data
    const view = new DataView(connectReq.buffer)
    expect(view.getBigUint64(0, false)).toBe(0x41727101980n) // Protocol ID
    expect(view.getUint32(8, false)).toBe(0) // Action Connect
    const txId = view.getUint32(12, false)

    // Simulate connect response
    const connectResp = new Uint8Array(16)
    const respView = new DataView(connectResp.buffer)
    respView.setUint32(0, 0, false) // Action Connect
    respView.setUint32(4, txId, false) // Tx ID
    respView.setBigUint64(8, 0x1234567890n, false) // Connection ID
    factory.socket.emitMessage(connectResp)

    // Wait for announce request
    await new Promise((r) => setTimeout(r, 10))
    expect(factory.socket.sentData.length).toBe(2)

    // Verify announce request
    const announceReq = factory.socket.sentData[1].data
    const annView = new DataView(announceReq.buffer)
    expect(annView.getBigUint64(0, false)).toBe(0x1234567890n) // Connection ID
    expect(annView.getUint32(8, false)).toBe(1) // Action Announce
    const announceTxId = annView.getUint32(12, false) // Tx ID

    // Simulate announce response with peers
    const announceResp = new Uint8Array(26) // 20 header + 6 peer
    const annRespView = new DataView(announceResp.buffer)
    annRespView.setUint32(0, 1, false) // Action Announce
    annRespView.setUint32(4, announceTxId, false)
    annRespView.setUint32(8, 1800, false) // Interval
    annRespView.setUint32(12, 10, false) // Leechers
    annRespView.setUint32(16, 5, false) // Seeders

    // Peer: 1.2.3.4:8080
    announceResp.set([1, 2, 3, 4], 20)
    announceResp.set([0x1f, 0x90], 24)

    const peerSpy = vi.fn()
    tracker.on('peer', peerSpy)

    factory.socket.emitMessage(announceResp)

    await announcePromise

    expect(peerSpy).toHaveBeenCalledWith({ ip: '1.2.3.4', port: 8080 })
  })
})
