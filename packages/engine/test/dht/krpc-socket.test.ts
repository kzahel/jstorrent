/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KRPCSocket } from '../../src/dht/krpc-socket'
import { IUdpSocket, ISocketFactory } from '../../src/interfaces/socket'
import {
  encodePingQuery,
  encodePingResponse,
  encodeErrorResponse,
  KRPCErrorCode,
} from '../../src/dht/krpc-messages'
import { NODE_ID_BYTES } from '../../src/dht/constants'

// Mock UDP Socket
class MockUdpSocket implements IUdpSocket {
  public sentData: Array<{ addr: string; port: number; data: Uint8Array }> = []
  private messageCallback:
    | ((rinfo: { addr: string; port: number }, data: Uint8Array) => void)
    | null = null

  send(addr: string, port: number, data: Uint8Array): void {
    this.sentData.push({ addr, port, data: new Uint8Array(data) })
  }

  onMessage(cb: (rinfo: { addr: string; port: number }, data: Uint8Array) => void): void {
    this.messageCallback = cb
  }

  close(): void {
    this.messageCallback = null
  }

  async joinMulticast(_group: string): Promise<void> {}
  async leaveMulticast(_group: string): Promise<void> {}

  // Test helper: simulate incoming message
  emitMessage(data: Uint8Array, addr: string = '127.0.0.1', port: number = 6881): void {
    if (this.messageCallback) {
      this.messageCallback({ addr, port }, data)
    }
  }
}

// Mock Socket Factory
class MockSocketFactory implements ISocketFactory {
  public mockSocket = new MockUdpSocket()

  async createTcpSocket(_host?: string, _port?: number): Promise<any> {
    return {}
  }

  async createUdpSocket(_bindAddr?: string, _bindPort?: number): Promise<IUdpSocket> {
    return this.mockSocket
  }

  createTcpServer(): any {
    return {
      on: vi.fn(),
      listen: vi.fn(),
      address: vi.fn().mockReturnValue({ port: 0 }),
      close: vi.fn(),
    }
  }

  wrapTcpSocket(_socket: any): any {
    return {}
  }
}

describe('KRPCSocket', () => {
  let factory: MockSocketFactory
  let krpcSocket: KRPCSocket
  const nodeId = new Uint8Array(NODE_ID_BYTES).fill(0x11)

  beforeEach(async () => {
    vi.useFakeTimers()
    factory = new MockSocketFactory()
    krpcSocket = new KRPCSocket(factory, { timeout: 1000 })
    await krpcSocket.bind()
  })

  afterEach(() => {
    krpcSocket.close()
    vi.useRealTimers()
  })

  describe('bind', () => {
    it('creates UDP socket via factory', async () => {
      // Already bound in beforeEach
      expect(factory.mockSocket).toBeDefined()
    })

    it('throws if already bound', async () => {
      await expect(krpcSocket.bind()).rejects.toThrow('already bound')
    })
  })

  describe('query', () => {
    it('sends encoded query via IUdpSocket', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      // Start query (won't resolve until we send response)
      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      // Verify data was sent
      expect(factory.mockSocket.sentData.length).toBe(1)
      expect(factory.mockSocket.sentData[0].addr).toBe('192.168.1.1')
      expect(factory.mockSocket.sentData[0].port).toBe(6881)

      // Send response
      const responseData = encodePingResponse(transactionId, new Uint8Array(20).fill(0x22))
      factory.mockSocket.emitMessage(responseData, '192.168.1.1', 6881)

      const response = await queryPromise
      expect(response.y).toBe('r')
    })

    it('routes responses to transaction manager', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      // Send response
      const responseId = new Uint8Array(20).fill(0x22)
      const responseData = encodePingResponse(transactionId, responseId)
      factory.mockSocket.emitMessage(responseData)

      const response = await queryPromise
      expect(response.r.id).toEqual(responseId)
    })

    it('respects query timeout configuration', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      // Advance time past timeout
      vi.advanceTimersByTime(1100)

      await expect(queryPromise).rejects.toThrow('timed out')
    })
  })

  describe('incoming queries', () => {
    it('emits query event for incoming queries', async () => {
      const queryHandler = vi.fn()
      krpcSocket.on('query', queryHandler)

      // Simulate incoming ping query
      const transactionId = new Uint8Array([0xaa, 0xbb])
      const senderId = new Uint8Array(20).fill(0x33)
      const queryData = encodePingQuery(transactionId, senderId)

      factory.mockSocket.emitMessage(queryData, '10.0.0.1', 12345)

      expect(queryHandler).toHaveBeenCalledTimes(1)
      expect(queryHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          y: 'q',
          q: 'ping',
        }),
        { host: '10.0.0.1', port: 12345 },
      )
    })
  })

  describe('incoming errors', () => {
    it('rejects pending query with KRPC error', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      // Send error response
      const errorData = encodeErrorResponse(transactionId, KRPCErrorCode.PROTOCOL, 'Bad request')
      factory.mockSocket.emitMessage(errorData)

      await expect(queryPromise).rejects.toThrow('203')
    })
  })

  describe('send', () => {
    it('sends raw data for responses', () => {
      const responseData = encodePingResponse(new Uint8Array([0x01, 0x02]), nodeId)

      krpcSocket.send('192.168.1.1', 6881, responseData)

      expect(factory.mockSocket.sentData.length).toBe(1)
      expect(factory.mockSocket.sentData[0].data).toEqual(responseData)
    })

    it('throws if socket not bound', () => {
      const unboundSocket = new KRPCSocket(factory)

      expect(() => unboundSocket.send('127.0.0.1', 6881, new Uint8Array([]))).toThrow('not bound')
    })
  })

  describe('generateTransactionId', () => {
    it('generates unique transaction IDs', () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const id = krpcSocket.generateTransactionId()
        ids.add(Array.from(id).join(','))
      }

      expect(ids.size).toBe(100)
    })
  })

  describe('close', () => {
    it('cleans up socket and transactions', async () => {
      const transactionId = krpcSocket.generateTransactionId()
      const queryData = encodePingQuery(transactionId, nodeId)

      const queryPromise = krpcSocket.query('192.168.1.1', 6881, queryData, transactionId, 'ping')

      krpcSocket.close()

      await expect(queryPromise).rejects.toThrow()
      expect(krpcSocket.pendingCount()).toBe(0)
    })
  })

  describe('malformed messages', () => {
    it('ignores malformed incoming data', () => {
      const queryHandler = vi.fn()
      krpcSocket.on('query', queryHandler)

      // Send garbage data
      factory.mockSocket.emitMessage(new Uint8Array([0x00, 0x01, 0x02, 0x03]))

      expect(queryHandler).not.toHaveBeenCalled()
    })

    it('ignores responses with unknown transaction ID', () => {
      // Send response with unknown transaction ID
      const unknownTxId = new Uint8Array([0xff, 0xfe])
      const responseData = encodePingResponse(unknownTxId, nodeId)

      // Should not throw
      factory.mockSocket.emitMessage(responseData)

      expect(krpcSocket.pendingCount()).toBe(0)
    })
  })
})
