import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BtEngine } from '../../src/core/bt-engine'
// import { Torrent } from '../../src/core/torrent'
import { ScopedNodeFileSystem } from '../../src/io/node/scoped-node-filesystem'
// @ts-expect-error - no types for bittorrent-tracker
import { Server } from 'bittorrent-tracker'
import path from 'path'
import fs from 'fs'
import os from 'os'
import * as crypto from 'crypto'
import * as net from 'net'
import { ISocketFactory, ITcpSocket, IUdpSocket } from '../../src/interfaces/socket'
import { PeerConnection } from '../../src/core/peer-connection'

class NodeTcpSocket implements ITcpSocket {
  private socket: net.Socket

  constructor(socket?: net.Socket) {
    this.socket = socket || new net.Socket()
  }

  connect(port: number, host: string): Promise<void> {
    return new Promise((resolve, _reject) => {
      this.socket.connect(port, host, () => {
        resolve()
      })
      this.socket.on('error', (_err) => {
        // If we haven't resolved yet, reject.
        // But connect might have returned.
        // For this simple impl, it's okay.
      })
    })
  }

  send(data: Uint8Array): void {
    this.socket.write(data)
  }

  onData(cb: (data: Uint8Array) => void): void {
    this.socket.on('data', (data) => {
      cb(new Uint8Array(data))
    })
  }

  onClose(cb: (hadError: boolean) => void): void {
    this.socket.on('close', cb)
  }

  onError(cb: (err: Error) => void): void {
    this.socket.on('error', cb)
  }

  close(): void {
    this.socket.destroy()
  }

  // Helper to get real address for verification
  get localPort() {
    return this.socket.localPort
  }
}

class NodeSocketFactory implements ISocketFactory {
  async createTcpSocket(host?: string, port?: number): Promise<ITcpSocket> {
    const socket = new NodeTcpSocket()
    if (host && port) {
      await socket.connect(port, host)
    }
    return socket
  }

  async createUdpSocket(_bindAddr?: string, _bindPort?: number): Promise<IUdpSocket> {
    throw new Error('UDP not implemented for this test')
  }

  createTcpServer() {
    return {
      on: () => {},
      listen: () => {},
      address: () => ({ port: 0 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapTcpSocket(socket: any): ITcpSocket {
    return new NodeTcpSocket(socket)
  }
}

describe('Tracker Integration', () => {
  let trackerServer: Server
  let trackerPort: number
  let trackerUrl: string
  let clientA: BtEngine
  let clientB: BtEngine
  let tmpDir: string
  let serverA: net.Server
  let portA: number

  beforeAll(async () => {
    // Setup Tracker
    trackerServer = new Server({ http: true, udp: false, ws: false })

    await new Promise<void>((resolve) => {
      trackerServer.listen(0, () => {
        trackerPort = trackerServer.http.address().port
        trackerUrl = `http://127.0.0.1:${trackerPort}/announce`
        console.log(`Tracker listening on ${trackerUrl}`)
        resolve()
      })
    })

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jstorrent-test-'))

    // Setup Server for Client A to listen
    serverA = net.createServer()
    await new Promise<void>((resolve) => {
      serverA.listen(0, () => {
        portA = (serverA.address() as net.AddressInfo).port
        console.log(`Client A listening on port ${portA}`)
        resolve()
      })
    })
  })

  afterAll(() => {
    trackerServer.close()
    if (serverA) serverA.close()
    if (clientA) clientA.destroy()
    if (clientB) clientB.destroy()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should announce and discover peers', async () => {
    const infoHash = crypto.randomBytes(20)
    const infoHashHex = infoHash.toString('hex')

    // Setup Client A
    const socketFactoryA = new NodeSocketFactory()
    const fsA = new ScopedNodeFileSystem(path.join(tmpDir, 'A'))
    clientA = new BtEngine({
      downloadPath: path.join(tmpDir, 'A'),
      socketFactory: socketFactoryA,
      fileSystem: fsA,
      peerId: '-JS0001-AAAAAAAAAAAA',
      port: portA, // Announce the port we are listening on
    })

    // Setup Client B
    const socketFactoryB = new NodeSocketFactory()
    const fsB = new ScopedNodeFileSystem(path.join(tmpDir, 'B'))
    clientB = new BtEngine({
      downloadPath: path.join(tmpDir, 'B'),
      socketFactory: socketFactoryB,
      fileSystem: fsB,
      peerId: '-JS0001-BBBBBBBBBBBB',
    })

    const magnetLink = `magnet:?xt=urn:btih:${infoHashHex}&tr=${encodeURIComponent(trackerUrl)}`

    console.log('Adding torrent to Client A')
    const torrentA = await clientA.addTorrent(magnetLink)

    // Handle incoming connections for Client A
    serverA.on('connection', (socket) => {
      console.log('Client A received connection')
      const peerSocket = new NodeTcpSocket(socket)
      const peer = new PeerConnection(clientA, peerSocket)
      torrentA.addPeer(peer)

      // We need to handle handshake on A side too
      // PeerConnection handles it automatically if we set it up?
      // Torrent.addPeer sets up listeners.
      // But we need to send handshake if we accept connection?
      // Usually the initiator sends handshake first.
      // B connects to A. B sends handshake.
      // A receives handshake. A sends handshake back.
      // PeerConnection handles receiving handshake.
      // But does it send handshake back automatically?
      // In `Torrent.ts`:
      // peer.on('handshake', ...) -> if extensions, sendExtendedHandshake.
      // It does NOT seem to send Handshake back if it receives one.
      // Standard BitTorrent: Initiator sends Handshake. Receiver sends Handshake.
      // We need to ensure A sends handshake back.
      //
      // Let's check `Torrent.ts` `setupPeerListeners`:
      // peer.on('handshake', ...)
      // It does NOT call `peer.sendHandshake`.
      //
      // So we need to manually send handshake from A when we accept connection?
      // Or `PeerConnection` should handle it?
      // `PeerConnection` is low level.
      //
      // We should probably send handshake immediately when accepting connection?
      // Or wait for their handshake?
      // BitTorrent spec says order doesn't matter much, but usually simultaneous or initiator first.
      //
      // Let's send handshake from A immediately upon connection.
      peer.sendHandshake(torrentA.infoHash, clientA.peerId)
    })

    // Wait for A to announce
    const peerAAnnounced = new Promise<void>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackerServer.on('start', (_addr: any) => {
        resolve()
      })
    })

    await peerAAnnounced
    console.log('Client A announced')

    // Now add to Client B
    console.log('Adding torrent to Client B')
    const torrentB = await clientB.addTorrent(magnetLink)

    // Wait for B to connect to A and handshake to complete
    const handshakeComplete = new Promise<void>((resolve) => {
      // We can check if B has peers
      const check = setInterval(() => {
        if (torrentB.numPeers > 0) {
          // Check if handshake completed
          // We don't have easy access to peers list state from here without iterating
          // But `numPeers` increments when `addPeer` is called.
          // `addPeer` is called when tracker discovers peer.
          // Connection happens after.
          // Handshake happens after connection.
          //
          // We can listen to 'peer' event on torrentB? No, 'peer' event isn't emitted by Torrent for new peers.
          // But we can check `torrentB.peers[0].handshakeReceived`
          //
          // Actually, let's add a listener to torrentB for verification?
          // Torrent doesn't emit 'handshake'.
          //
          // Let's just wait for B to have 1 peer and that peer to have handshakeReceived = true
          // @ts-expect-error - accessing private property for test
          const peers = torrentB.peers
          if (peers.length > 0 && peers[0].handshakeReceived) {
            clearInterval(check)
            resolve()
          }
        }
      }, 100)
    })

    await handshakeComplete
    console.log('Handshake complete between A and B')

    // Verify
    // @ts-expect-error - accessing private property for test
    const peerB = torrentB.peers[0]
    if (peerB.peerId) {
      expect(Buffer.from(peerB.peerId).toString('hex')).toEqual(
        Buffer.from(clientA.peerId).toString('hex'),
      )
    }

    // @ts-expect-error - accessing private property for test
    const peersA = torrentA.peers
    expect(peersA.length).toBeGreaterThan(0)
    // We need to find the peer that corresponds to B.
    // Since A might have tried to connect to B (failed) and B connected to A (success).
    // There might be multiple peers or just one.
    // The one that handshook should be B.
    const peerA = peersA.find(
      (p: PeerConnection) =>
        p.peerId &&
        Buffer.from(p.peerId).toString('hex') === Buffer.from(clientB.peerId).toString('hex'),
    )
    expect(peerA).toBeDefined()
  })
})
