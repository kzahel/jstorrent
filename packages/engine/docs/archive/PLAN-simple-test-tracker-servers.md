# Implementation Plan: Simple Test Tracker

**Goal**: Replace the `bittorrent-tracker` npm dependency in tests with a lightweight, self-contained UDP/HTTP tracker implementation that has no native module dependencies.

**Problem**: The `bittorrent-tracker` package pulls in `@thaunknown/simple-peer` → `node-datachannel`, a native Node module that fails in CI with `ERR_DLOPEN_FAILED` ("Module did not self-register") due to Node ABI mismatches. We only need basic tracker functionality for tests, not WebRTC.

**Location**: `packages/engine/test/helpers/simple-tracker.ts`

---

## Background

### What a BitTorrent Tracker Does

A tracker maintains a mapping of `info_hash` → list of peers. Clients:

1. **Announce** themselves (I have info_hash X, my IP:port is Y, I'm seeding/leeching)
2. **Receive** a list of other peers who announced the same info_hash
3. **Optionally scrape** for swarm statistics

That's it. The tracker doesn't transfer any torrent data - it's just a peer discovery service.

### Protocols We Need

1. **UDP Tracker Protocol** (BEP 15) - Used by `udp-tracker-integration.spec.ts`
2. **HTTP Tracker Protocol** (BEP 3) - Used by `http-tracker-integration.spec.ts`

Both are simple request/response protocols. UDP uses a binary format; HTTP uses bencoded responses.

---

## Current Test Files Using `bittorrent-tracker`

```
packages/engine/test/tracker/udp-tracker-integration.spec.ts
packages/engine/test/tracker/http-tracker-integration.spec.ts  (if exists)
```

These tests import:
```typescript
// @ts-expect-error - bittorrent-tracker has no types
import { Server } from 'bittorrent-tracker'
```

---

## Implementation

### File: `packages/engine/test/helpers/simple-tracker.ts`

This single file should export:

```typescript
export class SimpleTracker {
  constructor(options?: { udpPort?: number; httpPort?: number })
  
  // Start the tracker (UDP and/or HTTP based on options)
  start(): Promise<{ udpPort?: number; httpPort?: number }>
  
  // Stop and clean up
  close(): Promise<void>
  
  // For test assertions - inspect internal state
  getPeers(infoHash: Buffer | string): PeerInfo[]
  getSwarmCount(): number
}

interface PeerInfo {
  ip: string
  port: number
  peerId: Buffer
}
```

### Part 1: Core Data Structure

```typescript
interface Peer {
  ip: string
  port: number
  peerId: Buffer
  lastSeen: number  // timestamp for cleanup
}

interface Swarm {
  infoHash: string  // hex string for map key
  peers: Map<string, Peer>  // key: "ip:port"
  complete: number   // seeders
  incomplete: number // leechers
}

class PeerStore {
  private swarms = new Map<string, Swarm>()
  
  announce(infoHash: Buffer, peer: Peer, event: 'started' | 'completed' | 'stopped' | ''): Peer[] {
    const key = infoHash.toString('hex')
    let swarm = this.swarms.get(key)
    if (!swarm) {
      swarm = { infoHash: key, peers: new Map(), complete: 0, incomplete: 0 }
      this.swarms.set(key, swarm)
    }
    
    const peerKey = `${peer.ip}:${peer.port}`
    
    if (event === 'stopped') {
      swarm.peers.delete(peerKey)
    } else {
      swarm.peers.set(peerKey, { ...peer, lastSeen: Date.now() })
      // Update complete/incomplete counts based on event
    }
    
    // Return other peers (excluding the announcing peer)
    return Array.from(swarm.peers.values()).filter(p => 
      p.ip !== peer.ip || p.port !== peer.port
    )
  }
  
  scrape(infoHash: Buffer): { complete: number; incomplete: number; downloaded: number } {
    const swarm = this.swarms.get(infoHash.toString('hex'))
    return swarm 
      ? { complete: swarm.complete, incomplete: swarm.incomplete, downloaded: 0 }
      : { complete: 0, incomplete: 0, downloaded: 0 }
  }
}
```

### Part 2: UDP Tracker Protocol (BEP 15)

Reference: https://www.bittorrent.org/beps/bep_0015.html

**Connection Flow:**
1. Client sends CONNECT request (get connection_id)
2. Client sends ANNOUNCE request (with connection_id)
3. Server responds with peer list

**Message Formats:**

```typescript
// Actions
const ACTION_CONNECT = 0
const ACTION_ANNOUNCE = 1
const ACTION_SCRAPE = 2
const ACTION_ERROR = 3

// Connect Request (16 bytes)
// offset | size | name
// 0      | 8    | protocol_id (0x41727101980)
// 8      | 4    | action (0 = connect)
// 12     | 4    | transaction_id

// Connect Response (16 bytes)
// 0      | 4    | action (0 = connect)
// 4      | 4    | transaction_id
// 8      | 8    | connection_id

// Announce Request (98 bytes min)
// 0      | 8    | connection_id
// 8      | 4    | action (1 = announce)
// 12     | 4    | transaction_id
// 16     | 20   | info_hash
// 36     | 20   | peer_id
// 56     | 8    | downloaded
// 64     | 8    | left
// 72     | 8    | uploaded
// 80     | 4    | event (0=none, 1=completed, 2=started, 3=stopped)
// 84     | 4    | IP address (0 = use sender IP)
// 88     | 4    | key
// 92     | 4    | num_want (-1 = default)
// 96     | 2    | port

// Announce Response (20+ bytes)
// 0      | 4    | action (1 = announce)
// 4      | 4    | transaction_id
// 8      | 4    | interval
// 12     | 4    | leechers
// 16     | 4    | seeders
// 20     | 6*n  | peers (each: 4 byte IP + 2 byte port)
```

**Implementation Sketch:**

```typescript
import * as dgram from 'dgram'

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
        resolve(this.socket.address().port)
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
    const protocolId = msg.readBigUInt64BE(0)
    if (protocolId !== 0x41727101980n) return
    
    const transactionId = msg.readUInt32BE(12)
    const connectionId = BigInt(Date.now()) // Simple: use timestamp
    
    // Store connection for validation
    this.connections.set(`${rinfo.address}:${rinfo.port}`, {
      id: connectionId,
      expires: Date.now() + 120000 // 2 minute expiry
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
    const eventCode = msg.readUInt32BE(80)
    const port = msg.readUInt16BE(96)
    
    const event = ['', 'completed', 'started', 'stopped'][eventCode] || ''
    
    const peers = this.peerStore.announce(infoHash, {
      ip: rinfo.address,
      port: port || rinfo.port,
      peerId,
      lastSeen: Date.now()
    }, event as any)
    
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
    response.writeUInt32BE(1800, 8)  // interval: 30 minutes
    response.writeUInt32BE(0, 12)    // leechers
    response.writeUInt32BE(peers.length, 16) // seeders
    peerData.copy(response, 20)
    
    this.socket.send(response, rinfo.port, rinfo.address)
  }
  
  private handleScrape(msg: Buffer, rinfo: dgram.RemoteInfo) {
    // Similar pattern - parse info_hashes, return stats
  }
  
  close(): Promise<void> {
    return new Promise(resolve => this.socket.close(resolve))
  }
}
```

### Part 3: HTTP Tracker Protocol (BEP 3)

Reference: https://www.bittorrent.org/beps/bep_0003.html (tracker section)

**Request:** `GET /announce?info_hash=...&peer_id=...&port=...&uploaded=...&downloaded=...&left=...&event=...`

**Response:** Bencoded dictionary:
```
{
  "interval": 1800,
  "peers": [
    { "peer id": "...", "ip": "...", "port": ... },
    ...
  ]
}
```

Or compact form (BEP 23): `"peers": <6 bytes per peer>`

**Implementation Sketch:**

```typescript
import * as http from 'http'
import { URL } from 'url'
import { Bencode } from '../../src/utils/bencode'  // Use engine's bencode

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
    // info_hash comes as raw bytes in query string - need to handle URL encoding
    const infoHashRaw = url.searchParams.get('info_hash')
    if (!infoHashRaw) {
      this.sendError(res, 'missing info_hash')
      return
    }
    
    // Decode URL-encoded binary info_hash
    const infoHash = Buffer.from(
      infoHashRaw.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => 
        String.fromCharCode(parseInt(hex, 16))
      ),
      'binary'
    )
    
    const peerId = Buffer.from(url.searchParams.get('peer_id') || '', 'binary')
    const port = parseInt(url.searchParams.get('port') || '0', 10)
    const event = url.searchParams.get('event') || ''
    const compact = url.searchParams.get('compact') === '1'
    
    // Get client IP
    const ip = (req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '')
    
    const peers = this.peerStore.announce(infoHash, {
      ip,
      port,
      peerId,
      lastSeen: Date.now()
    }, event as any)
    
    let response: any
    
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
        peers: peersBuf
      }
    } else {
      // Dictionary model
      response = {
        interval: 1800,
        peers: peers.map(p => ({
          'peer id': p.peerId,
          ip: p.ip,
          port: p.port
        }))
      }
    }
    
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(Bencode.encode(response))
  }
  
  private handleScrape(url: URL, res: http.ServerResponse) {
    // Similar - return stats for requested info_hashes
  }
  
  private sendError(res: http.ServerResponse, message: string) {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(Bencode.encode({ 'failure reason': message }))
  }
  
  close(): Promise<void> {
    return new Promise(resolve => this.server.close(() => resolve()))
  }
}
```

### Part 4: Combined SimpleTracker Class

```typescript
export interface SimpleTrackerOptions {
  udpPort?: number   // 0 = random, undefined = disabled
  httpPort?: number  // 0 = random, undefined = disabled
}

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
    await Promise.all([
      this.udpServer?.close(),
      this.httpServer?.close()
    ])
  }
  
  // Test inspection methods
  getPeers(infoHash: Buffer | string): Array<{ ip: string; port: number }> {
    const key = Buffer.isBuffer(infoHash) ? infoHash.toString('hex') : infoHash
    return this.peerStore.getPeersForSwarm(key)
  }
  
  getSwarmCount(): number {
    return this.peerStore.swarmCount()
  }
}
```

---

## Migration Steps

### Step 1: Create the Helper File

Create `packages/engine/test/helpers/simple-tracker.ts` with the implementation above.

### Step 2: Update UDP Tracker Integration Test

**Before:**
```typescript
import { Server } from 'bittorrent-tracker'

let tracker: any

beforeAll(async () => {
  tracker = new Server({ udp: true, http: false, ws: false })
  await new Promise<void>(resolve => tracker.listen(0, resolve))
})
```

**After:**
```typescript
import { SimpleTracker } from '../helpers/simple-tracker'

let tracker: SimpleTracker
let trackerPort: number

beforeAll(async () => {
  tracker = new SimpleTracker({ udpPort: 0 })
  const ports = await tracker.start()
  trackerPort = ports.udpPort!
})

afterAll(async () => {
  await tracker.close()
})
```

### Step 3: Update HTTP Tracker Integration Test (if exists)

Same pattern - replace `Server` import with `SimpleTracker`.

### Step 4: Remove bittorrent-tracker Dependency

```bash
cd packages/engine
pnpm remove bittorrent-tracker
```

This will also remove the transitive `@thaunknown/simple-peer` and `node-datachannel` dependencies.

### Step 5: Verify CI Passes

The `node-datachannel` native module error should be gone since we no longer depend on it.

---

## Test Scenarios to Verify

After implementation, these scenarios should work:

1. **Single client announce** - Client announces, gets empty peer list
2. **Two client discovery** - ClientA announces, ClientB announces, ClientB gets ClientA in peer list
3. **Stopped event** - Client sends stopped event, is removed from swarm
4. **Multiple swarms** - Different info_hashes maintain separate peer lists
5. **Scrape** - Returns correct seeder/leecher counts

---

## Files Changed

```
packages/engine/
├── test/
│   ├── helpers/
│   │   └── simple-tracker.ts     # NEW - ~300 lines
│   └── tracker/
│       ├── udp-tracker-integration.spec.ts   # MODIFIED - update imports
│       └── http-tracker-integration.spec.ts  # MODIFIED - update imports (if exists)
└── package.json                  # MODIFIED - remove bittorrent-tracker
```

---

## Estimated Effort

- **PeerStore + data structures**: 30 min
- **UDP protocol implementation**: 1-2 hours (binary parsing is fiddly)
- **HTTP protocol implementation**: 30-45 min (simpler, text-based)
- **Test migration**: 30 min
- **Debugging/testing**: 1 hour

**Total: 3-5 hours**

---

## Notes for Implementer

1. **This is Node-only test code** - Use Node's native `dgram` and `http` modules directly. There's no need to use the engine's `ISocketFactory` or other platform abstractions. This code will only ever run in Vitest under Node.js, never in a browser or through the daemon. Keep it simple.

2. **Use the engine's existing Bencode** - Import from `../../src/utils/bencode` rather than adding a dependency

2. **UDP protocol IDs are important** - The magic number `0x41727101980` must be exact or clients will reject the connection

3. **IPv6 considerations** - For simplicity, this implementation assumes IPv4. If tests need IPv6 support, the peer encoding format changes.

4. **Connection ID validation** - The UDP spec says connection IDs should expire after 2 minutes. For tests this doesn't matter much, but the skeleton includes it for correctness.

5. **Compact peer format** - Most modern clients request compact format (`compact=1`). The HTTP implementation should support both.

6. **Error handling** - Real trackers return bencoded error responses. Include `sendError()` helper for protocol compliance.

7. **The engine's UdpTracker class** - Look at `packages/engine/src/tracker/udp-tracker.ts` to understand what requests the engine sends. Match the expected response format.