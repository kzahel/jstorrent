import { BtEngine } from './bt-engine'
import { Torrent } from './torrent'
import { toHex } from '../utils/buffer'

/**
 * Complete snapshot of engine state for UI consumption.
 */
export interface EngineStateSnapshot {
  timestamp: number
  engine: EngineInfo
  torrents: TorrentInfo[]
  globalStats: GlobalStats
}

export interface EngineInfo {
  peerId: string
  port: number
  maxConnections: number
  currentConnections: number
  downloadRoots: RootInfo[]
  defaultRoot: string | null
}

export interface RootInfo {
  token: string
  label: string
  path: string
}

export interface GlobalStats {
  totalDownloadRate: number
  totalUploadRate: number
  totalDownloaded: number
  totalUploaded: number
  activeTorrents: number
  pausedTorrents: number
}

export interface TorrentInfo {
  infoHash: string
  name: string
  state: TorrentState
  progress: number

  // Size info
  totalSize: number
  downloadedSize: number
  uploadedSize: number

  // Rates
  downloadRate: number
  uploadRate: number

  // Pieces
  pieceCount: number
  pieceLength: number
  completedPieces: number

  // Peers
  connectedPeers: number
  maxPeers: number
  seeders: number
  leechers: number

  // Swarm (from tracker)
  knownPeers: number

  // Metadata
  hasMetadata: boolean
  isPrivate: boolean
  createdAt?: number
  addedAt: number
  completedAt?: number

  // Storage
  storageRoot: string | null

  // Files (only if metadata available)
  files: FileInfo[]

  // Connected peers detail
  peers: PeerInfo[]

  // Known swarm (tracker peers not yet connected)
  swarm: SwarmPeerInfo[]

  // Trackers
  trackers: TrackerInfo[]
}

export type TorrentState =
  | 'checking'
  | 'downloading_metadata'
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'error'
  | 'queued'

export interface FileInfo {
  index: number
  path: string
  name: string
  size: number
  downloadedSize: number
  progress: number
  priority: 'skip' | 'low' | 'normal' | 'high'
}

export interface PeerInfo {
  id: string // Peer ID hex (or IP:port if unknown)
  ip: string
  port: number
  client?: string // Parsed client name from peer ID

  // Connection state
  connected: boolean
  connectionType: 'incoming' | 'outgoing'
  encryptionType: 'none' | 'rc4' | 'plaintext'

  // Transfer
  downloadRate: number
  uploadRate: number
  downloaded: number
  uploaded: number

  // Choking state
  amChoking: boolean
  amInterested: boolean
  peerChoking: boolean
  peerInterested: boolean

  // Pieces
  piecesHave: number // How many pieces they have
  progress: number // Their completion percentage

  // Flags (like uTorrent shows)
  flags: string // e.g. "D U I K E"
}

export interface SwarmPeerInfo {
  ip: string
  port: number
  source: 'tracker' | 'dht' | 'pex' | 'manual'
  lastSeen?: number
}

export interface TrackerInfo {
  url: string
  status: 'working' | 'updating' | 'error' | 'disabled'
  lastAnnounce?: number
  nextAnnounce?: number
  seeders?: number
  leechers?: number
  downloaded?: number // Tracker's "downloaded" count
  errorMessage?: string
}

/**
 * Build complete state snapshot from engine.
 */
export function getEngineState(engine: BtEngine): EngineStateSnapshot {
  return {
    timestamp: Date.now(),
    engine: getEngineInfo(engine),
    torrents: engine.torrents.map((t) => getTorrentInfo(t, engine)),
    globalStats: getGlobalStats(engine),
  }
}

function getEngineInfo(engine: BtEngine): EngineInfo {
  const roots = engine.storageRootManager.getRoots()

  return {
    peerId: toHex(engine.peerId),
    port: engine.port,
    maxConnections: engine.maxConnections,
    currentConnections: engine.numConnections,
    downloadRoots: roots.map((r) => ({
      token: r.token,
      label: r.label,
      path: r.path,
    })),
    defaultRoot: engine.storageRootManager.getDefaultRoot() || null,
  }
}

function getGlobalStats(engine: BtEngine): GlobalStats {
  let totalDownloadRate = 0
  let totalUploadRate = 0
  let totalDownloaded = 0
  let totalUploaded = 0
  let activeTorrents = 0
  let pausedTorrents = 0

  for (const t of engine.torrents) {
    totalDownloadRate += t.downloadSpeed
    totalUploadRate += t.uploadSpeed
    totalDownloaded += t.totalDownloaded
    totalUploaded += t.totalUploaded

    if (t.isPaused) {
      pausedTorrents++
    } else {
      activeTorrents++
    }
  }

  return {
    totalDownloadRate,
    totalUploadRate,
    totalDownloaded,
    totalUploaded,
    activeTorrents,
    pausedTorrents,
  }
}

function getTorrentInfo(torrent: Torrent, engine: BtEngine): TorrentInfo {
  const infoHash = toHex(torrent.infoHash)
  const hasMetadata = !!torrent.pieceManager

  // Determine state
  let state: TorrentState = 'downloading'
  if (!hasMetadata) {
    state = 'downloading_metadata'
  } else if (torrent.progress >= 1) {
    state = 'seeding'
  } else if (torrent.isPaused) {
    state = 'paused'
  }

  // Get file info
  const files: FileInfo[] = []
  if (hasMetadata && torrent.files) {
    for (let i = 0; i < torrent.files.length; i++) {
      const f = torrent.files[i]
      // Extract filename from path
      const pathParts = f.path.split('/')
      const fileName = pathParts[pathParts.length - 1] || f.path
      files.push({
        index: i,
        path: f.path,
        name: fileName,
        size: f.length,
        downloadedSize: f.downloaded || 0,
        progress: f.length > 0 ? (f.downloaded || 0) / f.length : 0,
        priority: 'normal', // TODO: implement file priorities
      })
    }
  }

  // Get connected peers
  const peerInfos = torrent.getPeerInfo?.() || []
  const peers: PeerInfo[] = peerInfos
    .filter((p) => p.ip && p.port) // Filter out peers without IP/port
    .map((p) => ({
      id: p.peerId || `${p.ip}:${p.port}`,
      ip: p.ip!,
      port: p.port!,
      client: parseClientName(p.peerId),
      connected: true,
      connectionType: 'outgoing' as const, // TODO: track incoming vs outgoing
      encryptionType: 'none' as const,
      downloadRate: p.downloadSpeed || 0,
      uploadRate: p.uploadSpeed || 0,
      downloaded: p.downloaded || 0,
      uploaded: p.uploaded || 0,
      amChoking: true, // TODO: get from peer state
      amInterested: false,
      peerChoking: p.choking ?? true,
      peerInterested: p.interested ?? false,
      piecesHave: 0, // TODO: get from peer bitfield
      progress: p.percent || 0,
      flags: buildPeerFlags(p),
    }))

  // Get swarm (known but not connected peers)
  const swarm: SwarmPeerInfo[] = []
  // TODO: Get from tracker manager's peer list

  // Get trackers
  const trackers: TrackerInfo[] = []
  if (torrent.trackerManager) {
    // TODO: Get tracker status from tracker manager
    for (const url of torrent.announce) {
      trackers.push({
        url,
        status: 'working',
      })
    }
  }

  // Count seeders/leechers from connected peers
  let seeders = 0
  let leechers = 0
  for (const p of peerInfos) {
    if (p.percent >= 1) {
      seeders++
    } else {
      leechers++
    }
  }

  // Get total size from content storage
  const totalSize = torrent.contentStorage?.getTotalSize() || 0

  // Get storage root
  const storageRoot = engine.storageRootManager.getRootForTorrent(infoHash)

  return {
    infoHash,
    name: torrent.name || infoHash.slice(0, 8),
    state,
    progress: torrent.progress,

    totalSize,
    downloadedSize: torrent.totalDownloaded,
    uploadedSize: torrent.totalUploaded,

    downloadRate: torrent.downloadSpeed,
    uploadRate: torrent.uploadSpeed,

    pieceCount: torrent.pieceManager?.getPieceCount() || 0,
    pieceLength: torrent.pieceManager?.getPieceLength(0) || 0,
    completedPieces: torrent.pieceManager?.getCompletedCount() || 0,

    connectedPeers: torrent.numPeers,
    maxPeers: torrent.maxPeers,
    seeders,
    leechers,

    knownPeers: swarm.length,

    hasMetadata,
    isPrivate: torrent.isPrivate || false,
    createdAt: torrent.creationDate,
    addedAt: torrent.addedAt,
    completedAt: torrent.completedAt,

    storageRoot: storageRoot?.token || null,

    files,
    peers,
    swarm,
    trackers,
  }
}

function parseClientName(peerId?: string | null): string | undefined {
  if (!peerId) return undefined

  // Common peer ID formats:
  // -AZ5750- = Azureus/Vuze
  // -UT3500- = uTorrent
  // -TR2940- = Transmission
  // -qB4500- = qBittorrent
  // -lt0D80- = libtorrent (rasterbar)

  const clients: Record<string, string> = {
    AZ: 'Azureus',
    UT: 'µTorrent',
    TR: 'Transmission',
    qB: 'qBittorrent',
    lt: 'libtorrent',
    DE: 'Deluge',
    BT: 'BitTorrent',
    LT: 'libtorrent',
    JS: 'JSTorrent',
  }

  if (peerId.startsWith('-') && peerId.length >= 8) {
    const clientCode = peerId.slice(1, 3)
    return clients[clientCode] || clientCode
  }

  return undefined
}

interface PeerData {
  downloadSpeed?: number
  uploadSpeed?: number
  choking?: boolean
  interested?: boolean
}

function buildPeerFlags(peer: PeerData): string {
  const flags: string[] = []

  if ((peer.downloadSpeed || 0) > 0) flags.push('D') // Downloading from peer
  if ((peer.uploadSpeed || 0) > 0) flags.push('U') // Uploading to peer
  if (peer.interested) flags.push('i') // Peer interested in us
  if (peer.choking) flags.push('c') // Peer choking us

  return flags.join(' ')
}
