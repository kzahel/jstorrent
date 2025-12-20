/**
 * Simple BitTorrent Tracker for Testing
 *
 * This is a lightweight, self-contained implementation of UDP and HTTP tracker
 * protocols (BEP 15 and BEP 3) for use in tests. It has no native dependencies
 * and replaces the problematic `bittorrent-tracker` npm package.
 *
 * This is Node-only test code and uses Node's native `dgram` and `http` modules.
 */

import * as dgram from 'dgram'
import * as http from 'http'
import { URL } from 'url'
import { Bencode } from '../../src/utils/bencode'

// BEP 15 Constants
const PROTOCOL_ID = 0x41727101980n
const ACTION_CONNECT = 0
const ACTION_ANNOUNCE = 1
const ACTION_SCRAPE = 2

interface Peer {
  ip: string
  port: number
  peerId: Buffer
  lastSeen: number
  seeding: boolean
}

interface Swarm {
  infoHash: string // hex string
  peers: Map<string, Peer> // key: "ip:port"
  complete: number // seeders
  incomplete: number // leechers
}

/**
 * Core data structure for managing peers and swarms
 */
class PeerStore {
  private swarms = new Map<string, Swarm>()

  announce(
    infoHash: Buffer,
    peer: Omit<Peer, 'lastSeen'>,
    event: 'started' | 'completed' | 'stopped' | '' = '',
  ): Peer[] {
    const key = infoHash.toString('hex')
    let swarm = this.swarms.get(key)
    if (!swarm) {
      swarm = { infoHash: key, peers: new Map(), complete: 0, incomplete: 0 }
      this.swarms.set(key, swarm)
    }

    const peerKey = `${peer.ip}:${peer.port}`

    if (event === 'stopped') {
      const existing = swarm.peers.get(peerKey)
      if (existing) {
        if (existing.seeding) {
          swarm.complete = Math.max(0, swarm.complete - 1)
        } else {
          swarm.incomplete = Math.max(0, swarm.incomplete - 1)
        }
        swarm.peers.delete(peerKey)
      }
    } else {
      const existing = swarm.peers.get(peerKey)
      const wasSeeding = existing?.seeding || false
      const isSeeding = event === 'completed' || peer.seeding

      // Update counts
      if (existing) {
        if (wasSeeding && !isSeeding) {
          swarm.complete--
          swarm.incomplete++
        } else if (!wasSeeding && isSeeding) {
          swarm.incomplete = Math.max(0, swarm.incomplete - 1)
          swarm.complete++
        }
      } else {
        // New peer
        if (isSeeding) {
          swarm.complete++
        } else {
          swarm.incomplete++
        }
      }

      swarm.peers.set(peerKey, {
        ...peer,
        seeding: isSeeding,
        lastSeen: Date.now(),
      })
    }

    // Return other peers (excluding the announcing peer)
    return Array.from(swarm.peers.values()).filter((p) => p.ip !== peer.ip || p.port !== peer.port)
  }

  scrape(infoHash: Buffer): { complete: number; incomplete: number; downloaded: number } {
    const swarm = this.swarms.get(infoHash.toString('hex'))
    return swarm
      ? { complete: swarm.complete, incomplete: swarm.incomplete, downloaded: 0 }
      : { complete: 0, incomplete: 0, downloaded: 0 }
  }

  getPeersForSwarm(infoHashHex: string): Array<{ ip: string; port: number; peerId: Buffer }> {
    const swarm = this.swarms.get(infoHashHex)
    if (!swarm) return []
    return Array.from(swarm.peers.values()).map((p) => ({
      ip: p.ip,
      port: p.port,
      peerId: p.peerId,
    }))
  }

  swarmCount(): number {
    return this.swarms.size
  }
}

/**
 * UDP Tracker Server (BEP 15)
 */
class UdpTrackerServer {
  private socket: dgram.Socket
  private connections = new Map<string, { id: bigint; expires: number }>()
  private peerStore: PeerStore

  constructor(peerStore: PeerStore) {
    this.peerStore = peerStore
    this.socket = dgram.createSocket('udp4')
  }

  async start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.socket.on('message', (msg, rinfo) => this.handleMessage(msg, rinfo))
      this.socket.on('error', reject)
      this.socket.bind(port, () => {
        const addr = this.socket.address() as { port: number; address: string }
        resolve(addr.port)
      })
    })
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
    if (msg.length < 16) return

    const action = msg.readUInt32BE(8)

    switch (action) {
      case ACTION_CONNECT:
        this.handleConnect(msg, rinfo)
        break
      case ACTION_ANNOUNCE:
        this.handleAnnounce(msg, rinfo)
        break
      case ACTION_SCRAPE:
        this.handleScrape(msg, rinfo)
        break
    }
  }

  private handleConnect(msg: Buffer, rinfo: dgram.RemoteInfo) {
    if (msg.length < 16) return

    const protocolId = msg.readBigUInt64BE(0)
    if (protocolId !== PROTOCOL_ID) return

    const transactionId = msg.readUInt32BE(12)
    const connectionId = BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000))

    // Store connection for validation
    this.connections.set(`${rinfo.address}:${rinfo.port}`, {
      id: connectionId,
      expires: Date.now() + 120000, // 2 minute expiry
    })

    const response = Buffer.alloc(16)
    response.writeUInt32BE(ACTION_CONNECT, 0)
    response.writeUInt32BE(transactionId, 4)
    response.writeBigUInt64BE(connectionId, 8)

    this.socket.send(response, rinfo.port, rinfo.address)
  }

  private handleAnnounce(msg: Buffer, rinfo: dgram.RemoteInfo) {
    if (msg.length < 98) return

    const transactionId = msg.readUInt32BE(12)
    const infoHash = msg.subarray(16, 36)
    const peerId = msg.subarray(36, 56)
    const left = msg.readBigUInt64BE(64)
    const eventCode = msg.readUInt32BE(80)
    const port = msg.readUInt16BE(96)

    const eventMap = ['', 'completed', 'started', 'stopped'] as const
    const event = eventMap[eventCode] || ''

    const peers = this.peerStore.announce(
      infoHash,
      {
        ip: rinfo.address,
        port: port || rinfo.port,
        peerId,
        seeding: left === 0n,
      },
      event,
    )

    // Build response
    const peerData = Buffer.alloc(peers.length * 6)
    peers.forEach((peer, i) => {
      const parts = peer.ip.split('.').map(Number)
      peerData.writeUInt8(parts[0], i * 6)
      peerData.writeUInt8(parts[1], i * 6 + 1)
      peerData.writeUInt8(parts[2], i * 6 + 2)
      peerData.writeUInt8(parts[3], i * 6 + 3)
      peerData.writeUInt16BE(peer.port, i * 6 + 4)
    })

    const response = Buffer.alloc(20 + peerData.length)
    response.writeUInt32BE(ACTION_ANNOUNCE, 0)
    response.writeUInt32BE(transactionId, 4)
    response.writeUInt32BE(1800, 8) // interval: 30 minutes

    const stats = this.peerStore.scrape(infoHash)
    response.writeUInt32BE(stats.incomplete, 12) // leechers
    response.writeUInt32BE(stats.complete, 16) // seeders
    peerData.copy(response, 20)

    this.socket.send(response, rinfo.port, rinfo.address)
  }

  private handleScrape(msg: Buffer, rinfo: dgram.RemoteInfo) {
    if (msg.length < 16) return

    const transactionId = msg.readUInt32BE(12)

    // Parse info_hashes (each is 20 bytes)
    const numHashes = Math.floor((msg.length - 16) / 20)
    const responseData: Buffer[] = []

    for (let i = 0; i < numHashes; i++) {
      const infoHash = msg.subarray(16 + i * 20, 16 + (i + 1) * 20)
      const stats = this.peerStore.scrape(infoHash)

      const buf = Buffer.alloc(12)
      buf.writeUInt32BE(stats.complete, 0)
      buf.writeUInt32BE(stats.downloaded, 4)
      buf.writeUInt32BE(stats.incomplete, 8)
      responseData.push(buf)
    }

    const totalLength = 8 + responseData.reduce((sum, buf) => sum + buf.length, 0)
    const response = Buffer.alloc(totalLength)
    response.writeUInt32BE(ACTION_SCRAPE, 0)
    response.writeUInt32BE(transactionId, 4)

    let offset = 8
    for (const data of responseData) {
      data.copy(response, offset)
      offset += data.length
    }

    this.socket.send(response, rinfo.port, rinfo.address)
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.close(() => resolve())
    })
  }
}

/**
 * HTTP Tracker Server (BEP 3)
 */
class HttpTrackerServer {
  private server: http.Server
  private peerStore: PeerStore

  constructor(peerStore: PeerStore) {
    this.peerStore = peerStore
    this.server = http.createServer((req, res) => this.handleRequest(req, res))
  }

  async start(port = 0): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        const addr = this.server.address() as { port: number }
        resolve(addr.port)
      })
    })
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url!, `http://${req.headers.host}`)

    if (url.pathname === '/announce') {
      this.handleAnnounce(url, req, res)
    } else if (url.pathname === '/scrape') {
      this.handleScrape(url, res)
    } else {
      res.writeHead(404)
      res.end()
    }
  }

  private handleAnnounce(url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
    // Parse raw query string to avoid UTF-8 corruption of binary data
    const query = url.search.substring(1) // Remove leading '?'
    const params = this.parseQueryStringBinary(query)

    if (!params.info_hash) {
      this.sendError(res, 'missing info_hash')
      return
    }

    const infoHash = params.info_hash as Buffer
    const peerId = (params.peer_id as Buffer) || Buffer.alloc(20)

    const port = parseInt((params.port as string) || '0', 10)
    const left = parseInt((params.left as string) || '0', 10)
    const event = ((params.event as string) || '') as '' | 'started' | 'stopped' | 'completed'
    const compact = (params.compact as string) === '1'

    // Get client IP
    const ip = (req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '')

    const peers = this.peerStore.announce(
      infoHash,
      {
        ip,
        port,
        peerId,
        seeding: left === 0,
      },
      event,
    )

    let response: {
      interval: number
      peers: Buffer | Array<{ 'peer id': Buffer; ip: string; port: number }>
    }

    if (compact) {
      // BEP 23: compact peer list (6 bytes each)
      const peersBuf = Buffer.alloc(peers.length * 6)
      peers.forEach((peer, i) => {
        const parts = peer.ip.split('.').map(Number)
        peersBuf.writeUInt8(parts[0], i * 6)
        peersBuf.writeUInt8(parts[1], i * 6 + 1)
        peersBuf.writeUInt8(parts[2], i * 6 + 2)
        peersBuf.writeUInt8(parts[3], i * 6 + 3)
        peersBuf.writeUInt16BE(peer.port, i * 6 + 4)
      })
      response = {
        interval: 1800,
        peers: peersBuf,
      }
    } else {
      // Dictionary model
      response = {
        interval: 1800,
        peers: peers.map((p) => ({
          'peer id': p.peerId,
          ip: p.ip,
          port: p.port,
        })),
      }
    }

    const encoded = Bencode.encode(response)
    // CRITICAL: MinimalHttpClient requires explicit Content-Length and Connection: close
    // It does NOT support Transfer-Encoding: chunked or Content-Encoding
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Length': encoded.length.toString(),
      Connection: 'close',
    })
    res.end(Buffer.from(encoded))
  }

  private handleScrape(url: URL, res: http.ServerResponse) {
    // Parse raw query string to get all info_hash values
    const query = url.search.substring(1)
    const infoHashes: Buffer[] = []

    // Parse all info_hash parameters
    const pairs = query.split('&')
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) continue

      const key = pair.substring(0, eqIdx)
      if (key === 'info_hash') {
        const value = pair.substring(eqIdx + 1)
        const bytes: number[] = []
        let i = 0
        while (i < value.length) {
          if (value[i] === '%' && i + 2 < value.length) {
            const hex = value.substring(i + 1, i + 3)
            bytes.push(parseInt(hex, 16))
            i += 3
          } else {
            bytes.push(value.charCodeAt(i))
            i++
          }
        }
        infoHashes.push(Buffer.from(bytes))
      }
    }

    if (infoHashes.length === 0) {
      this.sendError(res, 'missing info_hash')
      return
    }

    const files: Record<string, { complete: number; downloaded: number; incomplete: number }> = {}

    for (const infoHash of infoHashes) {
      const stats = this.peerStore.scrape(infoHash)
      files[infoHash.toString('binary')] = {
        complete: stats.complete,
        downloaded: stats.downloaded,
        incomplete: stats.incomplete,
      }
    }

    const response = { files }
    const encoded = Bencode.encode(response)
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Length': encoded.length.toString(),
      Connection: 'close',
    })
    res.end(Buffer.from(encoded))
  }

  private decodeUrlEncodedBinary(str: string): Buffer {
    // Decode URL-encoded binary data
    const decoded = str.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    return Buffer.from(decoded, 'binary')
  }

  private parseQueryStringBinary(query: string): { [key: string]: Buffer | string } {
    const params: { [key: string]: Buffer | string } = {}
    const pairs = query.split('&')

    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) continue

      const key = pair.substring(0, eqIdx)
      const value = pair.substring(eqIdx + 1)

      // info_hash and peer_id are binary, decode them carefully
      if (key === 'info_hash' || key === 'peer_id') {
        const bytes: number[] = []
        let i = 0
        while (i < value.length) {
          if (value[i] === '%' && i + 2 < value.length) {
            const hex = value.substring(i + 1, i + 3)
            bytes.push(parseInt(hex, 16))
            i += 3
          } else {
            bytes.push(value.charCodeAt(i))
            i++
          }
        }
        params[key] = Buffer.from(bytes)
      } else {
        params[key] = decodeURIComponent(value)
      }
    }

    return params
  }

  private sendError(res: http.ServerResponse, message: string) {
    const encoded = Bencode.encode({ 'failure reason': message })
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Length': encoded.length.toString(),
      Connection: 'close',
    })
    res.end(Buffer.from(encoded))
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
    })
  }
}

/**
 * Options for SimpleTracker
 */
export interface SimpleTrackerOptions {
  udpPort?: number // 0 = random, undefined = disabled
  httpPort?: number // 0 = random, undefined = disabled
}

/**
 * Combined tracker server supporting both UDP and HTTP protocols
 */
export class SimpleTracker {
  private peerStore = new PeerStore()
  private udpServer?: UdpTrackerServer
  private httpServer?: HttpTrackerServer

  constructor(private options: SimpleTrackerOptions = {}) {}

  async start(): Promise<{ udpPort?: number; httpPort?: number }> {
    const result: { udpPort?: number; httpPort?: number } = {}

    if (this.options.udpPort !== undefined) {
      this.udpServer = new UdpTrackerServer(this.peerStore)
      result.udpPort = await this.udpServer.start(this.options.udpPort)
    }

    if (this.options.httpPort !== undefined) {
      this.httpServer = new HttpTrackerServer(this.peerStore)
      result.httpPort = await this.httpServer.start(this.options.httpPort)
    }

    return result
  }

  async close(): Promise<void> {
    await Promise.all([this.udpServer?.close(), this.httpServer?.close()])
  }

  // Test inspection methods
  getPeers(infoHash: Buffer | string): Array<{ ip: string; port: number; peerId: Buffer }> {
    const key = Buffer.isBuffer(infoHash) ? infoHash.toString('hex') : infoHash
    return this.peerStore.getPeersForSwarm(key)
  }

  getSwarmCount(): number {
    return this.peerStore.swarmCount()
  }
}
