# Full Engine State Dump API

## Overview

Add a `GET_STATE` message handler that returns the complete engine state - all torrents, their files, connected peers, known swarm, etc. This is a simple starting point for the UI; optimization (diffing, subscriptions) can come later.

## Task 1: Define State Types

**Create file**: `packages/engine/src/core/engine-state.ts`

```typescript
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
  id: string              // Peer ID hex (or IP:port if unknown)
  ip: string
  port: number
  client?: string         // Parsed client name from peer ID
  
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
  piecesHave: number      // How many pieces they have
  progress: number        // Their completion percentage
  
  // Flags (like uTorrent shows)
  flags: string           // e.g. "D U I K E" 
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
  downloaded?: number     // Tracker's "downloaded" count
  errorMessage?: string
}

/**
 * Build complete state snapshot from engine.
 */
export function getEngineState(engine: BtEngine): EngineStateSnapshot {
  return {
    timestamp: Date.now(),
    engine: getEngineInfo(engine),
    torrents: engine.torrents.map(t => getTorrentInfo(t, engine)),
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
    downloadRoots: roots.map(r => ({
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
    // TODO: Get actual rates from torrent
    // totalDownloadRate += t.downloadRate
    // totalUploadRate += t.uploadRate
    // totalDownloaded += t.downloaded
    // totalUploaded += t.uploaded
    
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
      files.push({
        index: i,
        path: f.path,
        name: f.name,
        size: f.length,
        downloadedSize: f.downloaded || 0,
        progress: f.length > 0 ? (f.downloaded || 0) / f.length : 0,
        priority: 'normal', // TODO: implement file priorities
      })
    }
  }
  
  // Get connected peers
  const peerInfos = torrent.getPeerInfo?.() || []
  const peers: PeerInfo[] = peerInfos.map(p => ({
    id: p.peerId || `${p.ip}:${p.port}`,
    ip: p.ip,
    port: p.port,
    client: parseClientName(p.peerId),
    connected: true,
    connectionType: p.incoming ? 'incoming' : 'outgoing',
    encryptionType: 'none',
    downloadRate: p.downloadRate || 0,
    uploadRate: p.uploadRate || 0,
    downloaded: p.downloaded || 0,
    uploaded: p.uploaded || 0,
    amChoking: p.amChoking ?? true,
    amInterested: p.amInterested ?? false,
    peerChoking: p.peerChoking ?? true,
    peerInterested: p.peerInterested ?? false,
    piecesHave: p.piecesHave || 0,
    progress: p.progress || 0,
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
    if (p.progress >= 1) {
      seeders++
    } else {
      leechers++
    }
  }
  
  return {
    infoHash,
    name: torrent.name || infoHash.slice(0, 8),
    state,
    progress: torrent.progress,
    
    totalSize: torrent.length || 0,
    downloadedSize: torrent.downloaded || 0,
    uploadedSize: torrent.uploaded || 0,
    
    downloadRate: 0, // TODO
    uploadRate: 0,   // TODO
    
    pieceCount: torrent.pieceManager?.getPieceCount() || 0,
    pieceLength: torrent.pieceLength || 0,
    completedPieces: torrent.pieceManager?.getCompletedCount?.() || 0,
    
    connectedPeers: torrent.numPeers,
    maxPeers: torrent.maxPeers,
    seeders,
    leechers,
    
    knownPeers: swarm.length,
    
    hasMetadata,
    isPrivate: torrent.isPrivate || false,
    createdAt: torrent.creationDate,
    addedAt: torrent.addedAt || Date.now(),
    completedAt: torrent.completedAt,
    
    storageRoot: engine.storageRootManager.getRootForTorrent(infoHash) || null,
    
    files,
    peers,
    swarm,
    trackers,
  }
}

function parseClientName(peerId?: string): string | undefined {
  if (!peerId) return undefined
  
  // Common peer ID formats:
  // -AZ5750- = Azureus/Vuze
  // -UT3500- = uTorrent
  // -TR2940- = Transmission
  // -qB4500- = qBittorrent
  // -lt0D80- = libtorrent (rasterbar)
  
  const clients: Record<string, string> = {
    'AZ': 'Azureus',
    'UT': 'µTorrent',
    'TR': 'Transmission',
    'qB': 'qBittorrent',
    'lt': 'libtorrent',
    'DE': 'Deluge',
    'BT': 'BitTorrent',
    'LT': 'libtorrent',
    'JS': 'JSTorrent',
  }
  
  if (peerId.startsWith('-') && peerId.length >= 8) {
    const clientCode = peerId.slice(1, 3)
    return clients[clientCode] || clientCode
  }
  
  return undefined
}

function buildPeerFlags(peer: any): string {
  const flags: string[] = []
  
  if (peer.downloading) flags.push('D')      // Downloading from peer
  if (peer.uploading) flags.push('U')        // Uploading to peer
  if (peer.amInterested) flags.push('I')     // We're interested
  if (peer.peerInterested) flags.push('i')   // Peer interested in us
  if (peer.amChoking) flags.push('C')        // We're choking them
  if (peer.peerChoking) flags.push('c')      // Peer choking us
  if (peer.incoming) flags.push('H')         // Incoming connection
  if (peer.encrypted) flags.push('E')        // Encrypted
  
  return flags.join(' ')
}
```

## Task 2: Export from Engine

**Update file**: `packages/engine/src/index.ts`

```typescript
// State
export { getEngineState } from './core/engine-state'
export type {
  EngineStateSnapshot,
  EngineInfo,
  TorrentInfo,
  TorrentState,
  FileInfo,
  PeerInfo,
  SwarmPeerInfo,
  TrackerInfo,
  GlobalStats,
  RootInfo,
} from './core/engine-state'
```

## Task 3: Add Missing Properties to Torrent

Some properties referenced in `getTorrentInfo` may not exist on Torrent. Add them:

**Update file**: `packages/engine/src/core/torrent.ts`

```typescript
export class Torrent extends EngineComponent {
  // ... existing properties ...
  
  // State
  public isPaused: boolean = false
  
  // Stats
  public downloaded: number = 0
  public uploaded: number = 0
  public downloadRate: number = 0
  public uploadRate: number = 0
  
  // Metadata
  public length: number = 0
  public pieceLength: number = 0
  public isPrivate: boolean = false
  public creationDate?: number
  public completedAt?: number
  
  // ... existing code ...
  
  get progress(): number {
    if (!this.pieceManager) return 0
    return this.pieceManager.getProgress()
  }
  
  get numPeers(): number {
    return this.peers.length
  }
}
```

## Task 4: Add getCompletedCount to PieceManager

**Update file**: `packages/engine/src/core/piece-manager.ts`

```typescript
getCompletedCount(): number {
  return this.completedPieces
}
```

## Task 5: Add getDefaultRoot to StorageRootManager

**Update file**: `packages/engine/src/storage/storage-root-manager.ts`

```typescript
getDefaultRoot(): string | undefined {
  return this.defaultRoot
}
```

## Task 6: Add Message Handler in Service Worker

**Update file**: `extension/src/sw.ts`

```typescript
import { getEngineState } from '@jstorrent/engine'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // ... existing handlers ...
  
  if (message.type === 'GET_STATE') {
    client.ensureDaemonReady().then(() => {
      if (!client.engine) {
        sendResponse({ error: 'Engine not initialized' })
        return
      }
      const state = getEngineState(client.engine)
      sendResponse({ state })
    }).catch(e => {
      sendResponse({ error: String(e) })
    })
    return true
  }
})
```

## Task 7: Create useEngineState Hook for UI

**Create file**: `extension/src/ui/hooks/useEngineState.ts`

```typescript
import { useState, useEffect, useCallback } from 'react'
import type { EngineStateSnapshot } from '@jstorrent/engine'

export function useEngineState(pollInterval: number = 1000) {
  const [state, setState] = useState<EngineStateSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message || 'Unknown error')
        setLoading(false)
        return
      }
      
      if (response?.error) {
        setError(response.error)
      } else if (response?.state) {
        setState(response.state)
        setError(null)
      }
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    // Initial fetch
    refresh()
    
    // Poll for updates
    const interval = setInterval(refresh, pollInterval)
    
    return () => clearInterval(interval)
  }, [refresh, pollInterval])

  return { state, error, loading, refresh }
}
```

## Task 8: Example UI Usage

**Update file**: `extension/src/ui/app.tsx` (torrents tab)

```typescript
import { useEngineState } from './hooks/useEngineState'

// Inside App component:
const { state, error, loading } = useEngineState(1000)

// In the torrents tab:
{activeTab === 'torrents' && (
  <div style={{ padding: '20px' }}>
    {/* Add torrent input... */}
    
    {loading && <p>Loading...</p>}
    {error && <p style={{ color: 'red' }}>Error: {error}</p>}
    
    {state && (
      <>
        <div style={{ marginBottom: '16px', color: '#666' }}>
          {state.torrents.length} torrents | 
          {state.engine.currentConnections} connections |
          ↓ {formatBytes(state.globalStats.totalDownloadRate)}/s |
          ↑ {formatBytes(state.globalStats.totalUploadRate)}/s
        </div>
        
        {state.torrents.length === 0 ? (
          <p>No torrents. Add a magnet link to get started.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {state.torrents.map((torrent) => (
              <li key={torrent.infoHash} style={{
                border: '1px solid #ccc',
                borderRadius: '4px',
                padding: '12px',
                marginBottom: '8px',
              }}>
                <div style={{ fontWeight: 'bold' }}>{torrent.name}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  {torrent.state} | 
                  {(torrent.progress * 100).toFixed(1)}% |
                  {torrent.connectedPeers} peers |
                  {torrent.files.length} files
                </div>
                <div style={{
                  height: '4px',
                  background: '#eee',
                  borderRadius: '2px',
                  marginTop: '8px',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${torrent.progress * 100}%`,
                    background: torrent.state === 'seeding' ? '#4CAF50' : '#2196F3',
                    borderRadius: '2px',
                  }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </>
    )}
  </div>
)}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
```

## Verification

```bash
# Build engine
cd packages/engine
pnpm build

# Build extension
cd ../../extension
pnpm build
```

Manual test:
1. Load extension, open UI
2. Add a torrent
3. Should see torrent appear with progress bar
4. Open DevTools, run: `chrome.runtime.sendMessage({type: 'GET_STATE'}, r => console.log(r))`
5. Should see full state dump with torrent info, peers, files, etc.

## Future Optimizations

Once this works, consider:

1. **Diffing** - Only send changed data. Track version numbers, send patches.

2. **Subscriptions** - WebSocket-style push updates instead of polling.

3. **Selective queries** - `GET_STATE { torrents: true, peers: false }` to reduce payload.

4. **Pagination** - For swarm list which could be huge.

5. **Compression** - For large state dumps.

But start with the simple full dump - it's debuggable and you'll learn what the UI actually needs.

## Summary

**New files:**
- `packages/engine/src/core/engine-state.ts` - State snapshot types and builder
- `extension/src/ui/hooks/useEngineState.ts` - React hook for polling state

**Updated files:**
- `packages/engine/src/index.ts` - Export state types
- `packages/engine/src/core/torrent.ts` - Add missing properties
- `packages/engine/src/core/piece-manager.ts` - Add getCompletedCount
- `packages/engine/src/storage/storage-root-manager.ts` - Add getDefaultRoot
- `extension/src/sw.ts` - Add GET_STATE handler
- `extension/src/ui/app.tsx` - Display torrent list from state
