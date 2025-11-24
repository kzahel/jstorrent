import * as readline from 'readline'
import { Torrent } from '../core/torrent'
import { PeerConnection } from '../core/peer-connection'
import { DiskManager } from '../core/disk-manager'
import { PieceManager } from '../core/piece-manager'
import { BitField } from '../utils/bitfield'
import { NodeSocketFactory, NodeTcpSocket } from '../io/node/node-socket'
// import { NodeFileSystem } from '../io/node/node-filesystem'
import { NodeStorageHandle } from '../io/node/node-storage-handle'
import { SessionManager } from '../core/session-manager'
import { StorageManager } from '../io/storage-manager'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as net from 'net'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

interface RpcCommand {
  id?: number | string
  cmd: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any
}

interface RpcResponse {
  id?: number | string
  ok: boolean
  error?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

// State
let downloadDir = '/tmp'
let listenPort = 0
const torrents: Map<string, Torrent> = new Map()
const socketFactory = new NodeSocketFactory()
// const fileSystem = new NodeFileSystem()

// Debug logger
const logFile = 'engine_debug.log'
import * as fsSync from 'fs'
function log(msg: string) {
  fsSync.appendFileSync(logFile, msg + '\n')
}
// Override console.error to log to file
console.error = log
log('Engine started')

process.on('uncaughtException', (err) => {
  log(`Uncaught Exception: ${err.message}\n${err.stack}`)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled Rejection at: ${promise} reason: ${reason}`)
  process.exit(1)
})

process.on('SIGTERM', async () => {
  log('Received SIGTERM, shutting down...')
  for (const torrent of torrents.values()) {
    await torrent.stop()
  }
  process.exit(0)
})

rl.on('line', async (line) => {
  if (!line.trim()) return

  let req: RpcCommand
  try {
    req = JSON.parse(line)
  } catch (_err) {
    console.error('Failed to parse JSON:', line)
    return
  }

  const response: RpcResponse = { id: req.id, ok: true }

  try {
    switch (req.cmd) {
      case 'init':
        listenPort = req.params.listen_port
        downloadDir = req.params.download_dir
        // Create download dir if not exists
        await fs.mkdir(downloadDir, { recursive: true })
        break

      case 'shutdown':
        console.error('Shutting down...')
        for (const torrent of torrents.values()) {
          await torrent.stop()
        }
        process.exit(0)
        break

      case 'add_torrent_file': {
        // const torrentPath = req.params.path
        // const torrentData = await fs.readFile(torrentPath)
        // TODO: Parse torrent file to get infoHash and pieces
        // For Phase 1 handshake test, we might mock or use a simple parser if available
        // But we need a real Torrent object to accept peers.

        // Mocking for Phase 1 Handshake Test since we don't have full .torrent parsing yet
        // In a real scenario we would use a bdecode parser here.
        // Let's assume the test passes info_hash in params for now or we parse it.
        // Actually, let's try to read the infoHash from params if provided, else fail.

        // Create storage manager and register default handle
        const storageManager = new StorageManager()
        const defaultHandle = new NodeStorageHandle('default', 'Downloads', downloadDir)
        storageManager.register(defaultHandle)

        // Create session storage handle (e.g. ~/.config/jstorrent/default)
        // For testing, we'll use a subdir in downloadDir for now to keep it self-contained
        const sessionDir = req.params.session_dir || path.join(downloadDir, '.session')
        await fs.mkdir(sessionDir, { recursive: true })
        const sessionHandle = new NodeStorageHandle('session', 'Session', sessionDir)

        const sessionManager = new SessionManager(
          // @ts-expect-error Client not fully implemented yet
          { torrents: [] },
          sessionHandle,
          // storageManager,
          { profile: 'default' },
        )
        await sessionManager.load()

        const infoHashHex = req.params.info_hash
        if (!infoHashHex) {
          throw new Error('info_hash param required for Phase 1')
        }
        const infoHash = new Uint8Array(Buffer.from(infoHashHex, 'hex'))

        // Parse metadata from params (mocking bdecode for now)
        const pieceLength = req.params.piece_length || 16384
        const totalLength = req.params.total_length || 16384
        const piecesCount = Math.ceil(totalLength / pieceLength)
        const lastPieceLength = totalLength % pieceLength || pieceLength

        const pieceManager = new PieceManager(piecesCount, pieceLength, lastPieceLength)
        const bitfield = new BitField(piecesCount)

        // Create storage handle for download dir
        // We use the downloadDir from init, or a default
        const storageHandle = new NodeStorageHandle('default', 'Downloads', downloadDir)
        const diskManager = new DiskManager(storageHandle)

        // Mock file list (single file)
        const fileName = req.params.name || 'test_payload.bin'
        const files = [
          {
            path: fileName,
            length: totalLength,
            offset: 0,
          },
        ]
        await diskManager.open(files, pieceLength)

        const torrent = new Torrent(infoHash, pieceManager, diskManager, bitfield)
        torrents.set(infoHashHex, torrent)

        // Start listening for peers?
        // The engine currently doesn't have a "Server" component exposed in Torrent class
        // The test harness might need to connect TO the engine or vice versa.
        // Usually the engine should listen.
        // For Phase 1, let's assume we just create the torrent and wait for incoming connections
        // But we need a TCP server.

        const server = socketFactory.createTcpServer()
        server.on('connection', (socket: net.Socket) => {
          console.error(`Incoming connection from ${socket.remoteAddress}:${socket.remotePort}`)
          const peer = new PeerConnection(new NodeTcpSocket(socket))
          torrent.addPeer(peer)
        })
        await new Promise<void>((resolve) => {
          server.listen(listenPort, '0.0.0.0', () => {
            resolve()
          })
        })
        const address = server.address() as net.AddressInfo
        response.port = address.port

        response.torrent_id = infoHashHex
        break
      }

      case 'add_peer': {
        const { info_hash, ip, port } = req.params
        console.error(`Adding peer ${ip}:${port} for ${info_hash}`)
        const torrent = torrents.get(info_hash)
        if (!torrent) {
          response.ok = false
          response.error = 'Torrent not found'
          break
        }

        const socket = await socketFactory.createTcpSocket(ip, port)
        const peer = new PeerConnection(socket)
        torrent.addPeer(peer)

        // Send handshake!
        // We need a peerId. Let's generate one globally or per session.
        // For now, generate a random one.
        const peerId = new Uint8Array(20)
        // -JS0001- + random
        const prefix = Buffer.from('-JS0001-', 'ascii')
        peerId.set(prefix)
        for (let i = 8; i < 20; i++) {
          peerId[i] = Math.floor(Math.random() * 256)
        }

        console.error(`Sending handshake with peerId: ${Buffer.from(peerId).toString('hex')}`)
        peer.sendHandshake(torrent.infoHash, peerId)
        break
      }

      case 'get_status':
        // Return status of all torrents
        response.torrents = {}
        for (const [id, torrent] of torrents) {
          // @ts-expect-error accessing private peers for status
          const peers = torrent.peers.length
          // @ts-expect-error accessing private peers
          const connected = torrent.peers.filter((p) => p.handshakeReceived).length
          response.torrents[id] = {
            num_peers: peers,
            num_connected: connected,
          }
        }
        break

      default:
        response.ok = false
        response.error = `Unknown command: ${req.cmd}`
    }
  } catch (err) {
    response.ok = false
    response.error = err instanceof Error ? err.message : String(err)
  }

  console.log(JSON.stringify(response))
})
