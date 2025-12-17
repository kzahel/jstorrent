import { describe, it, expect } from 'vitest'
import { Bencode } from '../../src/utils/bencode'
import {
  // Encoding
  encodePingQuery,
  encodeFindNodeQuery,
  encodeGetPeersQuery,
  encodeAnnouncePeerQuery,
  encodePingResponse,
  encodeFindNodeResponse,
  encodeGetPeersResponseWithPeers,
  encodeGetPeersResponseWithNodes,
  encodeAnnouncePeerResponse,
  encodeErrorResponse,
  // Decoding
  decodeMessage,
  isQuery,
  isResponse,
  isError,
  // Compact encoding
  encodeCompactPeer,
  decodeCompactPeer,
  decodeCompactPeers,
  encodeCompactNode,
  encodeCompactNodes,
  decodeCompactNode,
  decodeCompactNodes,
  // Response helpers
  getResponseNodeId,
  getResponseNodes,
  getResponsePeers,
  getResponseToken,
  getQueryNodeId,
  getQueryTarget,
  getQueryInfoHash,
  getQueryToken,
  getQueryPort,
  getQueryImpliedPort,
  KRPCErrorCode,
} from '../../src/dht/krpc-messages'
import { NODE_ID_BYTES, COMPACT_PEER_BYTES, COMPACT_NODE_BYTES } from '../../src/dht/constants'

describe('KRPC Messages', () => {
  // Test data
  const transactionId = new Uint8Array([0xaa, 0xbb])
  const nodeId = new Uint8Array(NODE_ID_BYTES).fill(0x11)
  const targetId = new Uint8Array(NODE_ID_BYTES).fill(0x22)
  const infoHash = new Uint8Array(NODE_ID_BYTES).fill(0x33)
  const token = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

  describe('Encoding Queries', () => {
    describe('encodePingQuery', () => {
      it('encodes ping query correctly', () => {
        const encoded = encodePingQuery(transactionId, nodeId)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.y)).toBe('q')
        expect(new TextDecoder().decode(decoded.q)).toBe('ping')
        expect(decoded.a.id).toEqual(nodeId)
      })

      it('includes client version', () => {
        const encoded = encodePingQuery(transactionId, nodeId)
        const decoded = Bencode.decode(encoded)

        expect(decoded.v).toBeDefined()
        expect(decoded.v.length).toBe(4) // "JS01"
      })
    })

    describe('encodeFindNodeQuery', () => {
      it('encodes find_node with target', () => {
        const encoded = encodeFindNodeQuery(transactionId, nodeId, targetId)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.q)).toBe('find_node')
        expect(decoded.a.id).toEqual(nodeId)
        expect(decoded.a.target).toEqual(targetId)
      })
    })

    describe('encodeGetPeersQuery', () => {
      it('encodes get_peers with info_hash', () => {
        const encoded = encodeGetPeersQuery(transactionId, nodeId, infoHash)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.q)).toBe('get_peers')
        expect(decoded.a.id).toEqual(nodeId)
        expect(decoded.a.info_hash).toEqual(infoHash)
      })
    })

    describe('encodeAnnouncePeerQuery', () => {
      it('encodes announce_peer with token and port', () => {
        const port = 6881
        const encoded = encodeAnnouncePeerQuery(transactionId, nodeId, infoHash, port, token, false)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.q)).toBe('announce_peer')
        expect(decoded.a.id).toEqual(nodeId)
        expect(decoded.a.info_hash).toEqual(infoHash)
        expect(decoded.a.port).toBe(port)
        expect(decoded.a.token).toEqual(token)
        expect(decoded.a.implied_port).toBe(0)
      })

      it('sets implied_port when requested', () => {
        const encoded = encodeAnnouncePeerQuery(transactionId, nodeId, infoHash, 6881, token, true)
        const decoded = Bencode.decode(encoded)

        expect(decoded.a.implied_port).toBe(1)
      })
    })
  })

  describe('Encoding Responses', () => {
    describe('encodePingResponse', () => {
      it('encodes ping response correctly', () => {
        const encoded = encodePingResponse(transactionId, nodeId)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.y)).toBe('r')
        expect(decoded.r.id).toEqual(nodeId)
      })
    })

    describe('encodeFindNodeResponse', () => {
      it('encodes find_node response with nodes', () => {
        const nodes = [
          { id: new Uint8Array(20).fill(0x01), host: '192.168.1.1', port: 6881 },
          { id: new Uint8Array(20).fill(0x02), host: '192.168.1.2', port: 6882 },
        ]
        const encoded = encodeFindNodeResponse(transactionId, nodeId, nodes)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(decoded.r.id).toEqual(nodeId)
        expect(decoded.r.nodes.length).toBe(nodes.length * COMPACT_NODE_BYTES)
      })
    })

    describe('encodeGetPeersResponseWithPeers', () => {
      it('encodes get_peers response with peers', () => {
        const peers = [
          { host: '1.2.3.4', port: 8080 },
          { host: '5.6.7.8', port: 9090 },
        ]
        const encoded = encodeGetPeersResponseWithPeers(transactionId, nodeId, token, peers)
        const decoded = Bencode.decode(encoded)

        expect(decoded.r.id).toEqual(nodeId)
        expect(decoded.r.token).toEqual(token)
        expect(Array.isArray(decoded.r.values)).toBe(true)
        expect(decoded.r.values.length).toBe(2)
      })
    })

    describe('encodeGetPeersResponseWithNodes', () => {
      it('encodes get_peers response with nodes', () => {
        const nodes = [{ id: new Uint8Array(20).fill(0x01), host: '192.168.1.1', port: 6881 }]
        const encoded = encodeGetPeersResponseWithNodes(transactionId, nodeId, token, nodes)
        const decoded = Bencode.decode(encoded)

        expect(decoded.r.id).toEqual(nodeId)
        expect(decoded.r.token).toEqual(token)
        expect(decoded.r.nodes).toBeDefined()
        expect(decoded.r.values).toBeUndefined()
      })
    })

    describe('encodeAnnouncePeerResponse', () => {
      it('encodes announce_peer response correctly', () => {
        const encoded = encodeAnnouncePeerResponse(transactionId, nodeId)
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.y)).toBe('r')
        expect(decoded.r.id).toEqual(nodeId)
      })
    })

    describe('encodeErrorResponse', () => {
      it('encodes error response correctly', () => {
        const encoded = encodeErrorResponse(transactionId, KRPCErrorCode.PROTOCOL, 'Bad token')
        const decoded = Bencode.decode(encoded)

        expect(decoded.t).toEqual(transactionId)
        expect(new TextDecoder().decode(decoded.y)).toBe('e')
        expect(Array.isArray(decoded.e)).toBe(true)
        expect(decoded.e[0]).toBe(203)
      })
    })
  })

  describe('Decoding Messages', () => {
    describe('decodeMessage', () => {
      it('decodes response extracting r dict', () => {
        const encoded = encodePingResponse(transactionId, nodeId)
        const msg = decodeMessage(encoded)

        expect(msg).not.toBeNull()
        expect(isResponse(msg!)).toBe(true)
        if (isResponse(msg!)) {
          expect(msg.r.id).toEqual(nodeId)
        }
      })

      it('decodes error extracting code and message', () => {
        const encoded = encodeErrorResponse(transactionId, 201, 'Generic Error')
        const msg = decodeMessage(encoded)

        expect(msg).not.toBeNull()
        expect(isError(msg!)).toBe(true)
        if (isError(msg!)) {
          expect(msg.e[0]).toBe(201)
          expect(msg.e[1]).toBe('Generic Error')
        }
      })

      it('decodes query messages', () => {
        const encoded = encodePingQuery(transactionId, nodeId)
        const msg = decodeMessage(encoded)

        expect(msg).not.toBeNull()
        expect(isQuery(msg!)).toBe(true)
        if (isQuery(msg!)) {
          expect(msg.q).toBe('ping')
        }
      })

      it('handles malformed input gracefully (returns null)', () => {
        expect(decodeMessage(new Uint8Array([]))).toBeNull()
        expect(decodeMessage(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull()
        expect(decodeMessage(new Uint8Array([0x64, 0x65]))).toBeNull() // "de" - empty dict
      })

      it('handles missing required fields', () => {
        // Message without 't' field
        const noT = Bencode.encode({ y: 'r', r: { id: nodeId } })
        expect(decodeMessage(noT)).toBeNull()

        // Message without 'y' field
        const noY = Bencode.encode({ t: transactionId, r: { id: nodeId } })
        expect(decodeMessage(noY)).toBeNull()
      })
    })
  })

  describe('Compact Encoding', () => {
    describe('encodeCompactPeer / decodeCompactPeer', () => {
      it('roundtrips peer correctly', () => {
        const peer = { host: '192.168.1.100', port: 51413 }
        const encoded = encodeCompactPeer(peer)

        expect(encoded.length).toBe(COMPACT_PEER_BYTES)

        const decoded = decodeCompactPeer(encoded)
        expect(decoded).toEqual(peer)
      })

      it('encodes IP in network byte order', () => {
        const peer = { host: '1.2.3.4', port: 256 }
        const encoded = encodeCompactPeer(peer)

        expect(encoded[0]).toBe(1)
        expect(encoded[1]).toBe(2)
        expect(encoded[2]).toBe(3)
        expect(encoded[3]).toBe(4)
      })

      it('encodes port in network byte order (big-endian)', () => {
        const peer = { host: '0.0.0.0', port: 0x1234 }
        const encoded = encodeCompactPeer(peer)

        expect(encoded[4]).toBe(0x12)
        expect(encoded[5]).toBe(0x34)
      })

      it('returns null for invalid data length', () => {
        expect(decodeCompactPeer(new Uint8Array(5))).toBeNull()
      })

      it('returns null for port 0', () => {
        const data = new Uint8Array([1, 2, 3, 4, 0, 0])
        expect(decodeCompactPeer(data)).toBeNull()
      })
    })

    describe('decodeCompactPeers', () => {
      it('decodes array of compact peer Uint8Arrays', () => {
        const peers = [
          { host: '1.2.3.4', port: 8080 },
          { host: '5.6.7.8', port: 9090 },
        ]
        const values = peers.map((p) => encodeCompactPeer(p))

        const decoded = decodeCompactPeers(values)
        expect(decoded).toEqual(peers)
      })

      it('skips invalid entries', () => {
        const validPeer = encodeCompactPeer({ host: '1.2.3.4', port: 8080 })
        const values = [
          validPeer,
          new Uint8Array([1, 2, 3]), // too short
          'not a uint8array', // wrong type
        ]

        const decoded = decodeCompactPeers(values)
        expect(decoded.length).toBe(1)
      })
    })

    describe('encodeCompactNode / decodeCompactNode', () => {
      it('decodes compact node info (26 bytes -> DHTNode)', () => {
        const node = {
          id: new Uint8Array(20).fill(0xab),
          host: '10.20.30.40',
          port: 6881,
        }
        const encoded = encodeCompactNode(node)

        expect(encoded.length).toBe(COMPACT_NODE_BYTES)

        const decoded = decodeCompactNode(encoded)
        expect(decoded).not.toBeNull()
        expect(decoded!.id).toEqual(node.id)
        expect(decoded!.host).toBe(node.host)
        expect(decoded!.port).toBe(node.port)
      })

      it('returns null for invalid data length', () => {
        expect(decodeCompactNode(new Uint8Array(25))).toBeNull()
      })
    })

    describe('encodeCompactNodes / decodeCompactNodes', () => {
      it('encodes/decodes multiple nodes', () => {
        const nodes = [
          { id: new Uint8Array(20).fill(0x01), host: '1.1.1.1', port: 1111 },
          { id: new Uint8Array(20).fill(0x02), host: '2.2.2.2', port: 2222 },
          { id: new Uint8Array(20).fill(0x03), host: '3.3.3.3', port: 3333 },
        ]

        const encoded = encodeCompactNodes(nodes)
        expect(encoded.length).toBe(nodes.length * COMPACT_NODE_BYTES)

        const decoded = decodeCompactNodes(encoded)
        expect(decoded.length).toBe(nodes.length)

        for (let i = 0; i < nodes.length; i++) {
          expect(decoded[i].id).toEqual(nodes[i].id)
          expect(decoded[i].host).toBe(nodes[i].host)
          expect(decoded[i].port).toBe(nodes[i].port)
        }
      })

      it('handles partial data (ignores incomplete nodes)', () => {
        const nodes = [{ id: new Uint8Array(20).fill(0x01), host: '1.1.1.1', port: 1111 }]
        const encoded = encodeCompactNodes(nodes)

        // Add 10 extra bytes (incomplete second node)
        const partial = new Uint8Array(encoded.length + 10)
        partial.set(encoded)

        const decoded = decodeCompactNodes(partial)
        expect(decoded.length).toBe(1)
      })
    })
  })

  describe('Response Parsing Helpers', () => {
    it('getResponseNodeId extracts node ID', () => {
      const encoded = encodePingResponse(transactionId, nodeId)
      const msg = decodeMessage(encoded)

      expect(isResponse(msg!)).toBe(true)
      const id = getResponseNodeId(msg as ReturnType<typeof decodeMessage> & { y: 'r' })
      expect(id).toEqual(nodeId)
    })

    it('getResponseNodes extracts nodes array', () => {
      const nodes = [
        { id: new Uint8Array(20).fill(0x01), host: '1.1.1.1', port: 1111 },
        { id: new Uint8Array(20).fill(0x02), host: '2.2.2.2', port: 2222 },
      ]
      const encoded = encodeFindNodeResponse(transactionId, nodeId, nodes)
      const msg = decodeMessage(encoded)

      const decoded = getResponseNodes(msg as ReturnType<typeof decodeMessage> & { y: 'r' })
      expect(decoded.length).toBe(2)
    })

    it('getResponsePeers extracts peers array', () => {
      const peers = [
        { host: '1.2.3.4', port: 8080 },
        { host: '5.6.7.8', port: 9090 },
      ]
      const encoded = encodeGetPeersResponseWithPeers(transactionId, nodeId, token, peers)
      const msg = decodeMessage(encoded)

      const decoded = getResponsePeers(msg as ReturnType<typeof decodeMessage> & { y: 'r' })
      expect(decoded).toEqual(peers)
    })

    it('getResponseToken extracts token', () => {
      const encoded = encodeGetPeersResponseWithNodes(transactionId, nodeId, token, [])
      const msg = decodeMessage(encoded)

      const decoded = getResponseToken(msg as ReturnType<typeof decodeMessage> & { y: 'r' })
      expect(decoded).toEqual(token)
    })
  })

  describe('Query Parsing Helpers', () => {
    it('getQueryNodeId extracts sender node ID', () => {
      const encoded = encodePingQuery(transactionId, nodeId)
      const msg = decodeMessage(encoded)

      expect(isQuery(msg!)).toBe(true)
      const id = getQueryNodeId(msg as ReturnType<typeof decodeMessage> & { y: 'q' })
      expect(id).toEqual(nodeId)
    })

    it('getQueryTarget extracts find_node target', () => {
      const encoded = encodeFindNodeQuery(transactionId, nodeId, targetId)
      const msg = decodeMessage(encoded)

      const target = getQueryTarget(msg as ReturnType<typeof decodeMessage> & { y: 'q' })
      expect(target).toEqual(targetId)
    })

    it('getQueryInfoHash extracts info_hash', () => {
      const encoded = encodeGetPeersQuery(transactionId, nodeId, infoHash)
      const msg = decodeMessage(encoded)

      const hash = getQueryInfoHash(msg as ReturnType<typeof decodeMessage> & { y: 'q' })
      expect(hash).toEqual(infoHash)
    })

    it('getQueryToken extracts announce_peer token', () => {
      const encoded = encodeAnnouncePeerQuery(transactionId, nodeId, infoHash, 6881, token)
      const msg = decodeMessage(encoded)

      const decoded = getQueryToken(msg as ReturnType<typeof decodeMessage> & { y: 'q' })
      expect(decoded).toEqual(token)
    })

    it('getQueryPort extracts announce_peer port', () => {
      const encoded = encodeAnnouncePeerQuery(transactionId, nodeId, infoHash, 6881, token)
      const msg = decodeMessage(encoded)

      const port = getQueryPort(msg as ReturnType<typeof decodeMessage> & { y: 'q' })
      expect(port).toBe(6881)
    })

    it('getQueryImpliedPort detects implied_port flag', () => {
      const withImplied = encodeAnnouncePeerQuery(
        transactionId,
        nodeId,
        infoHash,
        6881,
        token,
        true,
      )
      const withoutImplied = encodeAnnouncePeerQuery(
        transactionId,
        nodeId,
        infoHash,
        6881,
        token,
        false,
      )

      const msgWith = decodeMessage(withImplied)
      const msgWithout = decodeMessage(withoutImplied)

      expect(getQueryImpliedPort(msgWith as ReturnType<typeof decodeMessage> & { y: 'q' })).toBe(
        true,
      )
      expect(getQueryImpliedPort(msgWithout as ReturnType<typeof decodeMessage> & { y: 'q' })).toBe(
        false,
      )
    })
  })
})
