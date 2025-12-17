/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handlePing,
  handleFindNode,
  handleGetPeers,
  handleAnnouncePeer,
  handleUnknownMethod,
  routeQuery,
  createQueryHandler,
  QueryHandlerDeps,
} from '../../src/dht/query-handlers'
import { RoutingTable } from '../../src/dht/routing-table'
import { TokenStore } from '../../src/dht/token-store'
import { PeerStore } from '../../src/dht/peer-store'
import { KRPCSocket } from '../../src/dht/krpc-socket'
import {
  KRPCQuery,
  decodeMessage,
  isResponse,
  isError,
  getResponseNodeId,
  getResponseNodes,
  getResponsePeers,
  getResponseToken,
} from '../../src/dht/krpc-messages'
import { NODE_ID_BYTES } from '../../src/dht/constants'
import { IUdpSocket, ISocketFactory } from '../../src/interfaces/socket'

// Mock hash function
const mockHashFn = async (data: Uint8Array): Promise<Uint8Array> => {
  let sum = 0
  for (const byte of data) {
    sum = (sum + byte) % 256
  }
  return new Uint8Array(20).fill(sum)
}

// Test fixtures
const localNodeId = new Uint8Array(NODE_ID_BYTES).fill(0x11)
const remoteNodeId = new Uint8Array(NODE_ID_BYTES).fill(0x22)
const targetId = new Uint8Array(NODE_ID_BYTES).fill(0x33)
const infoHash = new Uint8Array(NODE_ID_BYTES).fill(0x44)

function createMockQuery(method: string, args: Record<string, unknown>): KRPCQuery {
  return {
    t: new Uint8Array([0xaa, 0xbb]),
    y: 'q',
    q: method,
    a: args,
  }
}

function createDeps(): QueryHandlerDeps {
  return {
    nodeId: localNodeId,
    routingTable: new RoutingTable(localNodeId),
    tokenStore: new TokenStore({ hashFn: mockHashFn }),
    peerStore: new PeerStore(),
  }
}

describe('QueryHandlers', () => {
  let deps: QueryHandlerDeps
  const rinfo = { host: '192.168.1.100', port: 6881 }

  beforeEach(() => {
    deps = createDeps()
  })

  describe('handlePing', () => {
    it('responds with own node ID', async () => {
      const query = createMockQuery('ping', { id: remoteNodeId })

      const result = await handlePing(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(msg).not.toBeNull()
      expect(isResponse(msg!)).toBe(true)
      expect(getResponseNodeId(msg as any)).toEqual(localNodeId)
    })

    it('returns node for routing table', async () => {
      const query = createMockQuery('ping', { id: remoteNodeId })

      const result = await handlePing(query, rinfo, deps)

      expect(result.node).toBeDefined()
      expect(result.node!.id).toEqual(remoteNodeId)
      expect(result.node!.host).toBe(rinfo.host)
      expect(result.node!.port).toBe(rinfo.port)
    })

    it('returns error for missing id', async () => {
      const query = createMockQuery('ping', {})

      const result = await handlePing(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
      expect((msg as any).e[0]).toBe(203) // PROTOCOL error
    })
  })

  describe('handleFindNode', () => {
    it('responds with closest nodes from routing table', async () => {
      // Add some nodes to routing table
      const nodes = [
        { id: new Uint8Array(20).fill(0x30), host: '10.0.0.1', port: 6881 },
        { id: new Uint8Array(20).fill(0x31), host: '10.0.0.2', port: 6882 },
        { id: new Uint8Array(20).fill(0x32), host: '10.0.0.3', port: 6883 },
      ]
      for (const node of nodes) {
        deps.routingTable.addNode(node)
      }

      const query = createMockQuery('find_node', { id: remoteNodeId, target: targetId })

      const result = await handleFindNode(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
      expect(getResponseNodeId(msg as any)).toEqual(localNodeId)

      const responseNodes = getResponseNodes(msg as any)
      expect(responseNodes.length).toBeGreaterThan(0)
    })

    it('returns node for routing table', async () => {
      const query = createMockQuery('find_node', { id: remoteNodeId, target: targetId })

      const result = await handleFindNode(query, rinfo, deps)

      expect(result.node).toBeDefined()
      expect(result.node!.id).toEqual(remoteNodeId)
    })

    it('returns error for missing target', async () => {
      const query = createMockQuery('find_node', { id: remoteNodeId })

      const result = await handleFindNode(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
    })
  })

  describe('handleGetPeers', () => {
    it('responds with token', async () => {
      const query = createMockQuery('get_peers', { id: remoteNodeId, info_hash: infoHash })

      const result = await handleGetPeers(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
      expect(getResponseToken(msg as any)).not.toBeNull()
    })

    it('responds with peers when known', async () => {
      // Add some peers to peer store
      deps.peerStore.addPeer(infoHash, { host: '10.0.0.1', port: 6881 })
      deps.peerStore.addPeer(infoHash, { host: '10.0.0.2', port: 6882 })

      const query = createMockQuery('get_peers', { id: remoteNodeId, info_hash: infoHash })

      const result = await handleGetPeers(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)

      const peers = getResponsePeers(msg as any)
      expect(peers.length).toBe(2)
    })

    it('responds with closest nodes when no peers', async () => {
      // Add nodes to routing table but no peers
      deps.routingTable.addNode({
        id: new Uint8Array(20).fill(0x50),
        host: '10.0.0.1',
        port: 6881,
      })

      const query = createMockQuery('get_peers', { id: remoteNodeId, info_hash: infoHash })

      const result = await handleGetPeers(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)

      const peers = getResponsePeers(msg as any)
      expect(peers.length).toBe(0)

      const nodes = getResponseNodes(msg as any)
      expect(nodes.length).toBeGreaterThan(0)
    })

    it('returns error for missing info_hash', async () => {
      const query = createMockQuery('get_peers', { id: remoteNodeId })

      const result = await handleGetPeers(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
    })
  })

  describe('handleAnnouncePeer', () => {
    it('stores peer on valid announce', async () => {
      // First get a valid token
      const token = await deps.tokenStore.generate(rinfo.host)

      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881,
        token: token,
      })

      const result = await handleAnnouncePeer(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)

      // Verify peer was stored
      const peers = deps.peerStore.getPeers(infoHash)
      expect(peers.length).toBe(1)
      expect(peers[0].host).toBe(rinfo.host)
      expect(peers[0].port).toBe(6881)
    })

    it('uses UDP source port with implied_port', async () => {
      const token = await deps.tokenStore.generate(rinfo.host)

      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881, // Should be ignored
        implied_port: 1,
        token: token,
      })

      const result = await handleAnnouncePeer(query, { host: rinfo.host, port: 12345 }, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)

      // Verify peer was stored with source port
      const peers = deps.peerStore.getPeers(infoHash)
      expect(peers[0].port).toBe(12345)
    })

    it('rejects invalid token with error 203', async () => {
      const invalidToken = new Uint8Array(20).fill(0xff)

      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881,
        token: invalidToken,
      })

      const result = await handleAnnouncePeer(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
      expect((msg as any).e[0]).toBe(203) // PROTOCOL error
    })

    it('rejects missing token', async () => {
      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881,
      })

      const result = await handleAnnouncePeer(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
    })

    it('rejects missing port when implied_port not set', async () => {
      const token = await deps.tokenStore.generate(rinfo.host)

      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        token: token,
        // No port and no implied_port
      })

      const result = await handleAnnouncePeer(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
    })
  })

  describe('handleUnknownMethod', () => {
    it('returns error 204 for unknown method', () => {
      const query = createMockQuery('unknown_method', { id: remoteNodeId })

      const result = handleUnknownMethod(query)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
      expect((msg as any).e[0]).toBe(204) // METHOD_UNKNOWN
    })
  })

  describe('routeQuery', () => {
    it('routes ping to handlePing', async () => {
      const query = createMockQuery('ping', { id: remoteNodeId })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
    })

    it('routes find_node to handleFindNode', async () => {
      const query = createMockQuery('find_node', { id: remoteNodeId, target: targetId })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
    })

    it('routes get_peers to handleGetPeers', async () => {
      const query = createMockQuery('get_peers', { id: remoteNodeId, info_hash: infoHash })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
    })

    it('routes announce_peer to handleAnnouncePeer', async () => {
      const token = await deps.tokenStore.generate(rinfo.host)
      const query = createMockQuery('announce_peer', {
        id: remoteNodeId,
        info_hash: infoHash,
        port: 6881,
        token: token,
      })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isResponse(msg!)).toBe(true)
    })

    it('routes unknown method to handleUnknownMethod', async () => {
      const query = createMockQuery('foobar', { id: remoteNodeId })
      const result = await routeQuery(query, rinfo, deps)

      const msg = decodeMessage(result.response)
      expect(isError(msg!)).toBe(true)
      expect((msg as any).e[0]).toBe(204)
    })
  })

  describe('createQueryHandler', () => {
    // Mock UDP socket
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

      close(): void {}
      async joinMulticast(_group: string): Promise<void> {}
      async leaveMulticast(_group: string): Promise<void> {}

      emitMessage(data: Uint8Array, addr: string = '127.0.0.1', port: number = 6881): void {
        if (this.messageCallback) {
          this.messageCallback({ addr, port }, data)
        }
      }
    }

    class MockSocketFactory implements ISocketFactory {
      public mockSocket = new MockUdpSocket()

      async createTcpSocket(): Promise<any> {
        return {}
      }

      async createUdpSocket(): Promise<IUdpSocket> {
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

    it('sends response back to sender', async () => {
      const factory = new MockSocketFactory()
      const socket = new KRPCSocket(factory)
      await socket.bind()

      const handler = createQueryHandler(socket, deps)
      const query = createMockQuery('ping', { id: remoteNodeId })

      await handler(query, rinfo)

      // Allow async operations to complete
      await new Promise((r) => setTimeout(r, 0))

      expect(factory.mockSocket.sentData.length).toBe(1)
      expect(factory.mockSocket.sentData[0].addr).toBe(rinfo.host)
      expect(factory.mockSocket.sentData[0].port).toBe(rinfo.port)

      socket.close()
    })

    it('adds valid node to routing table', async () => {
      const factory = new MockSocketFactory()
      const socket = new KRPCSocket(factory)
      await socket.bind()

      const handler = createQueryHandler(socket, deps)
      const query = createMockQuery('ping', { id: remoteNodeId })

      await handler(query, rinfo)

      // Allow async operations to complete
      await new Promise((r) => setTimeout(r, 0))

      const nodes = deps.routingTable.getAllNodes()
      expect(nodes.find((n) => n.host === rinfo.host)).toBeDefined()

      socket.close()
    })
  })
})
