import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import * as net from 'net'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { Torrent } from '../../src/core/torrent'
import { PieceManager } from '../../src/core/piece-manager'
import { TorrentContentStorage } from '../../src/core/torrent-content-storage'
import { BitField } from '../../src/utils/bitfield'
import { NodeSocketFactory } from '../../src/io/node/node-socket'
// import { NodeFileSystem } from '../../src/io/node/node-filesystem'
import { NodeStorageHandle } from '../../src/io/node/node-storage-handle'
import { PeerConnection } from '../../src/core/peer-connection'
import { PeerWireProtocol, MessageType } from '../../src/protocol/wire-protocol'
import { MockEngine } from '../utils/mock-engine'

describe('Node.js Integration Download', () => {
  let server: net.Server
  let serverPort: number
  let tmpDir: string
  const infoHash = new Uint8Array(20).fill(1)
  const peerId = new Uint8Array(20).fill(2)
  const pieceData = new Uint8Array(16384).fill(0xaa) // 16KB piece

  beforeAll(async () => {
    // Setup temp dir
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jstorrent-test-'))

    // Setup mock peer server
    server = net.createServer((socket) => {
      // Handle handshake
      socket.once('data', (_data) => {
        // Assume valid handshake for test
        const handshake = PeerWireProtocol.createHandshake(infoHash, peerId)
        socket.write(handshake)

        // Send Unchoke
        socket.write(PeerWireProtocol.createMessage(MessageType.UNCHOKE))

        // Send Have (piece 0)
        const haveMsg = new Uint8Array(9)
        const view = new DataView(haveMsg.buffer)
        view.setUint32(0, 5, false) // length
        haveMsg[4] = MessageType.HAVE
        view.setUint32(5, 0, false) // index 0
        socket.write(haveMsg)

        // Handle requests
        socket.on('data', (chunk) => {
          // Simple parser for test
          let offset = 0
          while (offset < chunk.length) {
            if (chunk.length - offset < 4) break
            const view = new DataView(
              chunk.buffer,
              chunk.byteOffset + offset,
              chunk.byteLength - offset,
            )
            const len = view.getUint32(0, false)
            if (len === 0) {
              // Keep-alive
              offset += 4
              continue
            }
            if (chunk.length - offset < 4 + len) break // Incomplete

            const id = chunk[offset + 4]

            if (id === MessageType.REQUEST) {
              const pieceMsg = PeerWireProtocol.createPiece(0, 0, pieceData)
              socket.write(pieceMsg)
            }

            offset += 4 + len
          }
        })
      })
    })

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        serverPort = (server.address() as net.AddressInfo).port
        resolve()
      })
    })
  })

  afterAll(async () => {
    server.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it.skip('should download a piece from a local TCP peer', { timeout: 15000 }, async () => {
    const socketFactory = new NodeSocketFactory()
    // const fileSystem = new NodeFileSystem() // Not used directly anymore

    const storageHandle = new NodeStorageHandle('test', 'Downloads', tmpDir)
    const contentStorage = new TorrentContentStorage(storageHandle)
    const filePath = 'download.dat' // Relative path
    await contentStorage.open([{ path: filePath, length: 16384, offset: 0 }], 16384)

    const engine = new MockEngine()
    const pieceManager = new PieceManager(engine, 1, 16384, 16384) // 1 piece
    const bitfield = new BitField(1)
    const myPeerId = new Uint8Array(20).fill(3)

    const torrent = new Torrent(
      engine,
      infoHash,
      myPeerId,
      socketFactory,
      0,
      pieceManager,
      contentStorage,
      bitfield
    )

    // Connect to peer
    const socket = await socketFactory.createTcpSocket('127.0.0.1', serverPort)
    const peer = new PeerConnection(engine, socket)

    // We need to manually trigger handshake send in this setup as Torrent doesn't auto-connect yet
    // But Torrent.addPeer expects a connected peer (mostly)
    // But Torrent.addPeer expects a connected peer (mostly)
    torrent.addPeer(peer)
    peer.sendHandshake(infoHash, new Uint8Array(20).fill(3)) // Local peerId

    // Manually request piece to verify connectivity
    // Wait a bit for handshake to complete
    setTimeout(() => {
      peer.sendRequest(0, 0, 16384)
    }, 100)

    // Wait for piece completion
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 10000)
      torrent.on('piece', (index) => {
        if (index === 0) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    // Verify file content
    const content = await fs.readFile(path.join(tmpDir, filePath))
    expect(new Uint8Array(content)).toEqual(pieceData)

    // Cleanup
    peer.close()
  })
})
