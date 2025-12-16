/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DHTNode } from '../../src/dht/dht-node'
import { IUdpSocket, ISocketFactory } from '../../src/interfaces/socket'
import {
  encodePingResponse,
  encodeFindNodeResponse,
  encodeGetPeersResponseWithPeers,
  encodeGetPeersResponseWithNodes,
  encodeAnnouncePeerResponse,
  encodeErrorResponse,
  KRPCErrorCode,
  decodeMessage,
  isQuery,
} from '../../src/dht/krpc-messages'
import { NODE_ID_BYTES } from '../../src/dht/constants'
import { DHTNodeInfo } from '../../src/dht/types'

// =============================================================================
// Mock UDP Socket
// =============================================================================

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

  /**
   * Simulate receiving a message from a remote node.
   */
  emitMessage(data: Uint8Array, addr: string = '127.0.0.1', port: number = 6881): void {
    if (this.messageCallback) {
      this.messageCallback({ addr, port }, data)
    }
  }

  /**
   * Get the last sent query's transaction ID.
   */
  getLastTransactionId(): Uint8Array | null {
    if (this.sentData.length === 0) return null
    const lastMsg = decodeMessage(this.sentData[this.sentData.length - 1].data)
    if (lastMsg && isQuery(lastMsg)) {
      return lastMsg.t
    }
    return null
  }

  /**
   * Clear sent data.
   */
  clear(): void {
    this.sentData = []
  }
}

// =============================================================================
// Mock Socket Factory
// =============================================================================

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

// =============================================================================
// Mock Hash Function
// =============================================================================

const mockHashFn = async (data: Uint8Array): Promise<Uint8Array> => {
  // Simple deterministic hash for testing
  let sum = 0
  for (const byte of data) {
    sum = (sum + byte) % 256
  }
  return new Uint8Array(20).fill(sum)
}

// =============================================================================
// Test Fixtures
// =============================================================================

const localNodeId = new Uint8Array(NODE_ID_BYTES).fill(0x11)
const remoteNodeId = new Uint8Array(NODE_ID_BYTES).fill(0x22)
const targetId = new Uint8Array(NODE_ID_BYTES).fill(0x33)
const infoHash = new Uint8Array(NODE_ID_BYTES).fill(0x44)

function createTestNode(factory: MockSocketFactory): DHTNode {
  return new DHTNode({
    nodeId: localNodeId,
    socketFactory: factory,
    krpcOptions: { timeout: 100 }, // Short timeout for tests
    hashFn: mockHashFn,
    skipMaintenance: true, // Skip maintenance timers for tests using fake timers
  })
}

// =============================================================================
// Tests
// =============================================================================

describe('DHTNode Outgoing Queries', () => {
  let factory: MockSocketFactory
  let dhtNode: DHTNode

  beforeEach(async () => {
    vi.useFakeTimers()
    factory = new MockSocketFactory()
    dhtNode = createTestNode(factory)
    await dhtNode.start()
  })

  afterEach(() => {
    dhtNode.stop()
    vi.useRealTimers()
  })

  // ===========================================================================
  // ping() Tests
  // ===========================================================================

  describe('ping()', () => {
    it('returns true on response', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start ping
      const pingPromise = dhtNode.ping(remoteNode)

      // Simulate response
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodePingResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await pingPromise
      expect(result).toBe(true)
    })

    it('returns false on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start ping
      const pingPromise = dhtNode.ping(remoteNode)

      // Advance past timeout without sending response
      vi.advanceTimersByTime(200)

      const result = await pingPromise
      expect(result).toBe(false)
    })

    it('updates routing table on success', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start ping
      const pingPromise = dhtNode.ping(remoteNode)

      // Simulate response with node ID
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodePingResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await pingPromise

      // Check routing table was updated
      const nodes = dhtNode.getAllNodes()
      const found = nodes.find((n) => n.host === remoteNode.host && n.port === remoteNode.port)
      expect(found).toBeDefined()
      expect(found!.id).toEqual(remoteNodeId)
    })

    it('does not update routing table on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const initialCount = dhtNode.getNodeCount()

      // Start ping
      const pingPromise = dhtNode.ping(remoteNode)

      // Advance past timeout
      vi.advanceTimersByTime(200)

      await pingPromise

      // Routing table should not have changed
      expect(dhtNode.getNodeCount()).toBe(initialCount)
    })

    it('throws if node not started', async () => {
      const newNode = new DHTNode({
        nodeId: localNodeId,
        socketFactory: factory,
        hashFn: mockHashFn,
      })

      await expect(newNode.ping({ host: '127.0.0.1', port: 6881 })).rejects.toThrow('not started')
    })
  })

  // ===========================================================================
  // findNode() Tests
  // ===========================================================================

  describe('findNode()', () => {
    it('decodes compact node info from response', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Create some nodes to return in response
      const responseNodes: DHTNodeInfo[] = [
        { id: new Uint8Array(20).fill(0x30), host: '10.0.0.1', port: 6881 },
        { id: new Uint8Array(20).fill(0x31), host: '10.0.0.2', port: 6882 },
        { id: new Uint8Array(20).fill(0x32), host: '10.0.0.3', port: 6883 },
      ]

      // Start find_node
      const findPromise = dhtNode.findNode(remoteNode, targetId)

      // Simulate response
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeFindNodeResponse(txId, remoteNodeId, responseNodes)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await findPromise

      // Verify decoded nodes
      expect(result.length).toBe(3)
      expect(result[0].host).toBe('10.0.0.1')
      expect(result[0].port).toBe(6881)
      expect(result[1].host).toBe('10.0.0.2')
      expect(result[2].host).toBe('10.0.0.3')
    })

    it('adds responding node to routing table', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start find_node
      const findPromise = dhtNode.findNode(remoteNode, targetId)

      // Simulate response
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeFindNodeResponse(txId, remoteNodeId, [])
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await findPromise

      // Check responding node was added to routing table
      const nodes = dhtNode.getAllNodes()
      const found = nodes.find((n) => n.host === remoteNode.host)
      expect(found).toBeDefined()
      expect(found!.id).toEqual(remoteNodeId)
    })

    it('returns empty array on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start find_node
      const findPromise = dhtNode.findNode(remoteNode, targetId)

      // Advance past timeout
      vi.advanceTimersByTime(200)

      const result = await findPromise
      expect(result).toEqual([])
    })

    it('returns empty array on error response', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      // Start find_node
      const findPromise = dhtNode.findNode(remoteNode, targetId)

      // Simulate error response
      const txId = factory.mockSocket.getLastTransactionId()!
      const errorData = encodeErrorResponse(txId, KRPCErrorCode.SERVER, 'Server error')
      factory.mockSocket.emitMessage(errorData, remoteNode.host, remoteNode.port)

      const result = await findPromise
      expect(result).toEqual([])
    })

    it('validates target length', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const invalidTarget = new Uint8Array(10) // Wrong length

      await expect(dhtNode.findNode(remoteNode, invalidTarget)).rejects.toThrow('20 bytes')
    })
  })

  // ===========================================================================
  // getPeers() Tests
  // ===========================================================================

  describe('getPeers()', () => {
    it('returns peers when values present', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testPeers = [
        { host: '10.0.0.1', port: 6881 },
        { host: '10.0.0.2', port: 6882 },
      ]
      const testToken = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])

      // Start get_peers
      const getPeersPromise = dhtNode.getPeers(remoteNode, infoHash)

      // Simulate response with peers
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeGetPeersResponseWithPeers(txId, remoteNodeId, testToken, testPeers)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await getPeersPromise

      expect(result).not.toBeNull()
      expect(result!.peers).toBeDefined()
      expect(result!.peers!.length).toBe(2)
      expect(result!.peers![0].host).toBe('10.0.0.1')
      expect(result!.peers![1].host).toBe('10.0.0.2')
    })

    it('returns nodes when nodes present', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testNodes: DHTNodeInfo[] = [
        { id: new Uint8Array(20).fill(0x50), host: '10.0.0.1', port: 6881 },
        { id: new Uint8Array(20).fill(0x51), host: '10.0.0.2', port: 6882 },
      ]
      const testToken = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])

      // Start get_peers
      const getPeersPromise = dhtNode.getPeers(remoteNode, infoHash)

      // Simulate response with nodes (no peers)
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeGetPeersResponseWithNodes(txId, remoteNodeId, testToken, testNodes)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await getPeersPromise

      expect(result).not.toBeNull()
      expect(result!.nodes).toBeDefined()
      expect(result!.nodes!.length).toBe(2)
      expect(result!.nodes![0].host).toBe('10.0.0.1')
      expect(result!.nodes![1].host).toBe('10.0.0.2')
    })

    it('always returns token', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

      // Test with peers response
      const getPeersPromise1 = dhtNode.getPeers(remoteNode, infoHash)
      const txId1 = factory.mockSocket.getLastTransactionId()!
      const responseData1 = encodeGetPeersResponseWithPeers(txId1, remoteNodeId, testToken, [
        { host: '10.0.0.1', port: 6881 },
      ])
      factory.mockSocket.emitMessage(responseData1, remoteNode.host, remoteNode.port)

      const result1 = await getPeersPromise1
      expect(result1!.token).toEqual(testToken)

      // Test with nodes response
      factory.mockSocket.clear()
      const getPeersPromise2 = dhtNode.getPeers(remoteNode, infoHash)
      const txId2 = factory.mockSocket.getLastTransactionId()!
      const responseData2 = encodeGetPeersResponseWithNodes(txId2, remoteNodeId, testToken, [])
      factory.mockSocket.emitMessage(responseData2, remoteNode.host, remoteNode.port)

      const result2 = await getPeersPromise2
      expect(result2!.token).toEqual(testToken)
    })

    it('returns null on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }

      const getPeersPromise = dhtNode.getPeers(remoteNode, infoHash)

      // Advance past timeout
      vi.advanceTimersByTime(200)

      const result = await getPeersPromise
      expect(result).toBeNull()
    })

    it('adds responding node to routing table', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb])

      const getPeersPromise = dhtNode.getPeers(remoteNode, infoHash)

      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeGetPeersResponseWithNodes(txId, remoteNodeId, testToken, [])
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await getPeersPromise

      // Check responding node was added
      const nodes = dhtNode.getAllNodes()
      const found = nodes.find((n) => n.host === remoteNode.host)
      expect(found).toBeDefined()
    })

    it('validates info_hash length', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const invalidInfoHash = new Uint8Array(10)

      await expect(dhtNode.getPeers(remoteNode, invalidInfoHash)).rejects.toThrow('20 bytes')
    })
  })

  // ===========================================================================
  // announcePeer() Tests
  // ===========================================================================

  describe('announcePeer()', () => {
    it('returns true on success', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb, 0xcc])
      const testPort = 51413

      const announcePromise = dhtNode.announcePeer(remoteNode, infoHash, testPort, testToken)

      // Simulate successful response
      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeAnnouncePeerResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      const result = await announcePromise
      expect(result).toBe(true)
    })

    it('returns false on error response', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const invalidToken = new Uint8Array([0xff, 0xfe, 0xfd])
      const testPort = 51413

      const announcePromise = dhtNode.announcePeer(remoteNode, infoHash, testPort, invalidToken)

      // Simulate error response (bad token)
      const txId = factory.mockSocket.getLastTransactionId()!
      const errorData = encodeErrorResponse(txId, KRPCErrorCode.PROTOCOL, 'Invalid token')
      factory.mockSocket.emitMessage(errorData, remoteNode.host, remoteNode.port)

      const result = await announcePromise
      expect(result).toBe(false)
    })

    it('returns false on timeout', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb])
      const testPort = 51413

      const announcePromise = dhtNode.announcePeer(remoteNode, infoHash, testPort, testToken)

      // Advance past timeout
      vi.advanceTimersByTime(200)

      const result = await announcePromise
      expect(result).toBe(false)
    })

    it('sends correct query data', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb, 0xcc])
      const testPort = 51413

      dhtNode.announcePeer(remoteNode, infoHash, testPort, testToken)

      // Verify sent data
      expect(factory.mockSocket.sentData.length).toBe(1)
      expect(factory.mockSocket.sentData[0].addr).toBe(remoteNode.host)
      expect(factory.mockSocket.sentData[0].port).toBe(remoteNode.port)

      // Decode and verify query contents
      const sentMsg = decodeMessage(factory.mockSocket.sentData[0].data)
      expect(sentMsg).not.toBeNull()
      expect(isQuery(sentMsg!)).toBe(true)
      const query = sentMsg as any
      expect(query.q).toBe('announce_peer')
      expect(query.a.info_hash).toEqual(infoHash)
      expect(query.a.port).toBe(testPort)
      expect(query.a.token).toEqual(testToken)
    })

    it('sends implied_port flag when requested', async () => {
      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb])
      const testPort = 51413

      dhtNode.announcePeer(remoteNode, infoHash, testPort, testToken, true)

      const sentMsg = decodeMessage(factory.mockSocket.sentData[0].data)
      const query = sentMsg as any
      expect(query.a.implied_port).toBe(1)
    })

    it('updates routing table on success', async () => {
      const remoteNode = { host: '192.168.1.100', port: 6881 }
      const testToken = new Uint8Array([0xaa, 0xbb])
      const testPort = 51413

      const announcePromise = dhtNode.announcePeer(remoteNode, infoHash, testPort, testToken)

      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodeAnnouncePeerResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await announcePromise

      // Check responding node was added
      const nodes = dhtNode.getAllNodes()
      const found = nodes.find((n) => n.host === remoteNode.host)
      expect(found).toBeDefined()
    })
  })

  // ===========================================================================
  // General DHTNode Tests
  // ===========================================================================

  describe('DHTNode lifecycle', () => {
    it('can start and stop', async () => {
      const node = new DHTNode({
        socketFactory: new MockSocketFactory(),
        hashFn: mockHashFn,
        skipMaintenance: true,
      })

      expect(node.ready).toBe(false)

      await node.start()
      expect(node.ready).toBe(true)

      node.stop()
      expect(node.ready).toBe(false)
    })

    it('throws if started twice', async () => {
      await expect(dhtNode.start()).rejects.toThrow('already started')
    })

    it('generates node ID if not provided', async () => {
      const node = new DHTNode({
        socketFactory: new MockSocketFactory(),
        hashFn: mockHashFn,
      })

      expect(node.nodeId.length).toBe(NODE_ID_BYTES)
      // Should be random, not all zeros
      expect(node.nodeId.some((b) => b !== 0)).toBe(true)

      node.stop()
    })

    it('validates provided node ID length', () => {
      expect(
        () =>
          new DHTNode({
            nodeId: new Uint8Array(10), // Wrong length
            socketFactory: new MockSocketFactory(),
            hashFn: mockHashFn,
          }),
      ).toThrow('20 bytes')
    })

    it('exposes nodeIdHex getter', () => {
      expect(dhtNode.nodeIdHex).toBe('1111111111111111111111111111111111111111')
    })
  })

  describe('utility methods', () => {
    it('addNode() adds to routing table', () => {
      const node: DHTNodeInfo = {
        id: new Uint8Array(20).fill(0x50),
        host: '10.0.0.1',
        port: 6881,
      }

      const result = dhtNode.addNode(node)
      expect(result).toBe(true)
      expect(dhtNode.getNodeCount()).toBe(1)
    })

    it('getClosestNodes() returns nodes sorted by distance', () => {
      // Add some nodes
      const nodes: DHTNodeInfo[] = [
        { id: new Uint8Array(20).fill(0x20), host: '10.0.0.1', port: 6881 },
        { id: new Uint8Array(20).fill(0x30), host: '10.0.0.2', port: 6882 },
        { id: new Uint8Array(20).fill(0x40), host: '10.0.0.3', port: 6883 },
      ]
      for (const node of nodes) {
        dhtNode.addNode(node)
      }

      const closest = dhtNode.getClosestNodes(targetId, 2)
      expect(closest.length).toBe(2)
    })
  })

  describe('events', () => {
    it('emits nodeAdded when routing table adds node', async () => {
      const nodeAddedHandler = vi.fn()
      dhtNode.on('nodeAdded', nodeAddedHandler)

      const remoteNode = { host: '192.168.1.1', port: 6881 }
      const pingPromise = dhtNode.ping(remoteNode)

      const txId = factory.mockSocket.getLastTransactionId()!
      const responseData = encodePingResponse(txId, remoteNodeId)
      factory.mockSocket.emitMessage(responseData, remoteNode.host, remoteNode.port)

      await pingPromise

      expect(nodeAddedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          host: remoteNode.host,
          port: remoteNode.port,
        }),
      )
    })

    it('emits ready when started', async () => {
      const readyHandler = vi.fn()
      const node = new DHTNode({
        socketFactory: new MockSocketFactory(),
        hashFn: mockHashFn,
        skipMaintenance: true,
      })
      node.on('ready', readyHandler)

      await node.start()

      expect(readyHandler).toHaveBeenCalled()

      node.stop()
    })
  })
})
