import * as readline from 'readline'
import * as net from 'net'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import { Torrent } from '../core/torrent'
import { PieceManager } from '../core/piece-manager'
import { TorrentContentStorage } from '../core/torrent-content-storage'
import { NodeStorageHandle } from '../io/node/node-storage-handle'
import { NodeSocketFactory, NodeTcpSocket } from '../io/node/node-socket'
import { PeerConnection } from '../core/peer-connection'
import { BitField } from '../utils/bitfield'
import { SessionManager } from '../core/session-manager'
import { StorageManager } from '../io/storage-manager'
import { Bencode } from '../utils/bencode'
import { TorrentFile } from '../core/torrent-file'
// import { NodeFileSystem } from '../io/node/node-filesystem'

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
let sessionManager: SessionManager

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
        // Create storage manager and register default handle
        const storageManager = new StorageManager()
        const defaultHandle = new NodeStorageHandle('default', 'Downloads', downloadDir)
        storageManager.register(defaultHandle)

        // Create session storage handle
        const sessionDir = req.params.session_dir || path.join(downloadDir, '.session')
        await fs.mkdir(sessionDir, { recursive: true })
        const sessionHandle = new NodeStorageHandle('session', 'Session', sessionDir)

        sessionManager = new SessionManager(
          // @ts-expect-error Client not fully implemented yet
          { torrents: [] },
          sessionHandle,
          storageManager,
          { profile: 'default' },
        )
        await sessionManager.load()

        const torrentPath = req.params.path
        if (!torrentPath) throw new Error('path param required')

        const torrentData = await fs.readFile(torrentPath)
        const torrentMeta = Bencode.decode(new Uint8Array(torrentData))

        // Calculate infoHash
        const infoBuffer = Bencode.getRawInfo(new Uint8Array(torrentData))
        if (!infoBuffer) throw new Error('Could not find info dict in torrent file')

        console.error(`REPL: Info buffer length: ${infoBuffer.length}`)
        const infoHash = new Uint8Array(await crypto.subtle.digest('SHA-1', infoBuffer))
        const infoHashHex = Buffer.from(infoHash).toString('hex')
        console.error(`REPL: Calculated infoHash: ${infoHashHex}`)

        const infoDict = torrentMeta['info']

        console.error(`REPL: Parsed torrent ${torrentPath}, infoHash: ${infoHashHex}`)

        // Parse metadata
        const pieceLength = infoDict['piece length']
        const piecesBlob = infoDict['pieces'] // Uint8Array
        const piecesCount = Math.floor(piecesBlob.length / 20)

        // Calculate total length
        let totalLength = 0
        const files: TorrentFile[] = []

        if (infoDict['files']) {
          // Multi-file
          let offset = 0
          for (const file of infoDict['files']) {
            const length = file['length']
            const pathParts = file['path'].map((p: Uint8Array) => new TextDecoder().decode(p))
            const filePath = path.join(...pathParts)
            files.push({
              path: filePath,
              length,
              offset,
            })
            offset += length
            totalLength += length
          }
        } else {
          // Single file
          const length = infoDict['length']
          const name = new TextDecoder().decode(infoDict['name'])
          files.push({
            path: name,
            length,
            offset: 0,
          })
          totalLength = length
        }

        const lastPieceLength = totalLength % pieceLength || pieceLength

        // Parse pieces
        const pieceHashes: Uint8Array[] = []
        for (let i = 0; i < piecesCount; i++) {
          const hash = piecesBlob.slice(i * 20, (i + 1) * 20)
          pieceHashes.push(hash)
        }

        // Load resume data
        let bitfield: BitField
        const resumeData = await sessionManager.loadTorrentResume(infoHashHex)
        if (resumeData) {
          console.error(`REPL: Loaded resume data for ${infoHashHex}`)
          bitfield = new BitField(new Uint8Array(Buffer.from(resumeData.bitfield, 'hex')))
        } else {
          bitfield = new BitField(piecesCount)
          if (req.params.seed_mode || req.params.files) {
            for (let i = 0; i < piecesCount; i++) {
              bitfield.set(i, true)
            }
          }
        }

        const pieceManager = new PieceManager(
          piecesCount,
          pieceLength,
          lastPieceLength,
          pieceHashes,
          bitfield,
        )

        // Create storage handle for download dir
        const storageHandle = new NodeStorageHandle('default', 'Downloads', downloadDir)
        const contentStorage = new TorrentContentStorage(storageHandle)

        // Mock file list
        let mockFiles = req.params.files
        if (!mockFiles) {
          const fileName = req.params.name || 'test_payload.bin'
          mockFiles = [
            {
              path: fileName,
              length: totalLength,
              offset: 0,
            },
          ]
        }
        await contentStorage.open(files.length > 0 ? files : mockFiles, pieceLength)

        const torrent = new Torrent(infoHash, pieceManager, contentStorage, bitfield)

        // Listen for verification to save resume data
        torrent.on('verified', (data: { bitfield: string }) => {
          sessionManager.saveTorrentResume(infoHashHex, { bitfield: data.bitfield })
        })

        torrents.set(infoHashHex, torrent)

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

      case 'save_resume_data': {
        const infoHashStr = req.params.info_hash
        console.error(`REPL: save_resume_data for ${infoHashStr}`)
        const torrent = torrents.get(infoHashStr)
        if (!torrent) throw new Error(`Torrent not found: ${infoHashStr}`)

        if (torrent.bitfield) {
          await sessionManager.saveTorrentResume(infoHashStr, {
            bitfield: torrent.bitfield.toHex(),
          })
        } else {
          console.error(`REPL: No bitfield to save for ${infoHashStr}`)
        }
        console.error(`REPL: Saved resume data for ${infoHashStr}`)
        break
      }

      case 'recheck_torrent': {
        const infoHashStr = req.params.info_hash
        console.error(`REPL: recheck_torrent for ${infoHashStr}`)
        const torrent = torrents.get(infoHashStr)
        if (!torrent) throw new Error(`Torrent not found: ${infoHashStr}`)

        // Run in background, don't await? Or await?
        // The user might want to know when it's done.
        // For now, we await it to keep the test simple.
        await torrent.recheckData()
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
