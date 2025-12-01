# JSTorrent Detail Pane Implementation Plan

## Overview

Add a detail pane below the torrent list with tabs for Peers, Pieces, Files, and Trackers. This plan implements Peers and Pieces tables first.

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ Header / Toolbar                                │
├─────────────────────────────────────────────────┤
│                                                 │
│ TorrentTable (existing)                         │
│                                                 │
├─────────────────────────────────────────────────┤
│ [Peers] [Pieces] [Files] [Trackers]   ← tabs    │
├─────────────────────────────────────────────────┤
│                                                 │
│ PeerTable / PieceTable / etc                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Phase 1: Export PeerConnection from Engine

### 1.1 Update packages/engine/src/index.ts

Add this export after the existing core exports (around line 7):

```ts
export { PeerConnection } from './core/peer-connection'
```

The full core section should look like:

```ts
// Core
export { BtEngine } from './core/bt-engine'
export { Torrent } from './core/torrent'
export { PeerConnection } from './core/peer-connection'
export { SessionPersistence } from './core/session-persistence'
export type { TorrentSessionData, TorrentStateData } from './core/session-persistence'
export { ConnectionTimingTracker } from './core/connection-timing'
export type { ConnectionTimingStats } from './core/connection-timing'
```

---

## Phase 2: Create PeerTable

### 2.1 Create packages/ui/src/tables/PeerTable.tsx

```tsx
import { PeerConnection, Torrent } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'

/**
 * Format peer flags (choking/interested states)
 * D = downloading from peer, U = uploading to peer
 * Characters: d/D = download, u/U = upload (lowercase = choked)
 */
function formatFlags(peer: PeerConnection): string {
  const flags: string[] = []
  
  // Download: are we interested and are they choking us?
  if (peer.amInterested) {
    flags.push(peer.peerChoking ? 'd' : 'D')
  }
  
  // Upload: are they interested and are we choking them?
  if (peer.peerInterested) {
    flags.push(peer.amChoking ? 'u' : 'U')
  }
  
  return flags.join(' ') || '-'
}

/**
 * Calculate peer's progress from their bitfield
 */
function getPeerProgress(peer: PeerConnection, torrent: Torrent): number {
  if (!peer.bitfield || torrent.piecesCount === 0) return 0
  const have = peer.bitfield.countSet()
  return have / torrent.piecesCount
}

/**
 * Parse client name from peer ID bytes
 */
function parseClientName(peerId: Uint8Array | undefined): string {
  if (!peerId) return '?'
  
  // Azureus-style: -XX0000-
  if (peerId[0] === 0x2d && peerId[7] === 0x2d) {
    const clientCode = String.fromCharCode(peerId[1], peerId[2])
    const version = String.fromCharCode(peerId[3], peerId[4], peerId[5], peerId[6])
    
    const clients: Record<string, string> = {
      'UT': 'µTorrent',
      'TR': 'Transmission',
      'DE': 'Deluge',
      'qB': 'qBittorrent',
      'AZ': 'Azureus',
      'LT': 'libtorrent',
      'lt': 'libtorrent',
      'JS': 'JSTorrent',
    }
    
    const name = clients[clientCode] || clientCode
    return `${name} ${version.replace(/0/g, '.').replace(/\.+$/, '')}`
  }
  
  // Shadow-style: first byte is client
  // Just show hex for unknown
  return Array.from(peerId.slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Column definitions - torrent is captured for progress calculation */
function createPeerColumns(getTorrent: () => Torrent | null): ColumnDef<PeerConnection>[] {
  return [
    {
      id: 'address',
      header: 'Address',
      getValue: (p) => `${p.remoteAddress ?? '?'}:${p.remotePort ?? '?'}`,
      width: 180,
    },
    {
      id: 'client',
      header: 'Client',
      getValue: (p) => parseClientName(p.peerId),
      width: 140,
    },
    {
      id: 'progress',
      header: '%',
      getValue: (p) => {
        const t = getTorrent()
        if (!t) return '-'
        const pct = getPeerProgress(p, t) * 100
        return pct >= 100 ? '100' : pct.toFixed(1)
      },
      width: 50,
      align: 'right',
    },
    {
      id: 'downSpeed',
      header: 'Down',
      getValue: (p) => p.downloadSpeed > 0 ? formatBytes(p.downloadSpeed) + '/s' : '-',
      width: 90,
      align: 'right',
    },
    {
      id: 'upSpeed',
      header: 'Up',
      getValue: (p) => p.uploadSpeed > 0 ? formatBytes(p.uploadSpeed) + '/s' : '-',
      width: 90,
      align: 'right',
    },
    {
      id: 'downloaded',
      header: 'Downloaded',
      getValue: (p) => p.downloaded > 0 ? formatBytes(p.downloaded) : '-',
      width: 90,
      align: 'right',
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      getValue: (p) => p.uploaded > 0 ? formatBytes(p.uploaded) : '-',
      width: 90,
      align: 'right',
    },
    {
      id: 'flags',
      header: 'Flags',
      getValue: (p) => formatFlags(p),
      width: 60,
      align: 'center',
    },
    {
      id: 'requests',
      header: 'Reqs',
      getValue: (p) => p.requestsPending || '-',
      width: 50,
      align: 'right',
    },
  ]
}

/** Source interface for reading torrent data */
interface TorrentSource {
  getTorrent(hash: string): Torrent | undefined
}

export interface PeerTableProps {
  /** Source to read torrent from */
  source: TorrentSource
  /** Hash of the selected torrent */
  torrentHash: string
}

/**
 * Virtualized peer table for a single torrent.
 */
export function PeerTable(props: PeerTableProps) {
  const getTorrent = () => props.source.getTorrent(props.torrentHash) ?? null
  const columns = createPeerColumns(getTorrent)
  
  return (
    <TableMount<PeerConnection>
      getRows={() => getTorrent()?.peers ?? []}
      getRowKey={(p) => `${p.remoteAddress}:${p.remotePort}`}
      columns={columns}
      storageKey="peers"
      rowHeight={24}
    />
  )
}
```

---

## Phase 3: Create PieceTable

### 3.1 Create packages/ui/src/tables/PieceTable.tsx

```tsx
import { Torrent } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'

/**
 * Piece info derived from torrent state.
 * Not a real class - computed on-the-fly for display.
 */
export interface PieceInfo {
  index: number
  size: number
  state: 'have' | 'active' | 'missing'
  availability: number  // How many peers have this piece
}

/**
 * Compute piece info array from torrent.
 * Called every frame by the RAF loop.
 */
function computePieces(torrent: Torrent | null): PieceInfo[] {
  if (!torrent || torrent.piecesCount === 0) return []
  
  const bitfield = torrent.bitfield
  const pieces: PieceInfo[] = []
  
  // Build availability map from connected peers
  const availability = new Map<number, number>()
  for (const peer of torrent.peers) {
    if (peer.bitfield) {
      for (let i = 0; i < torrent.piecesCount; i++) {
        if (peer.bitfield.get(i)) {
          availability.set(i, (availability.get(i) ?? 0) + 1)
        }
      }
    }
  }
  
  for (let i = 0; i < torrent.piecesCount; i++) {
    const have = bitfield?.get(i) ?? false
    const isLast = i === torrent.piecesCount - 1
    const size = isLast ? torrent.lastPieceLength : torrent.pieceLength
    
    pieces.push({
      index: i,
      size,
      state: have ? 'have' : 'missing',  // TODO: detect 'active' from ActivePieceManager
      availability: availability.get(i) ?? 0,
    })
  }
  
  return pieces
}

/**
 * Column definitions for piece table.
 */
const pieceColumns: ColumnDef<PieceInfo>[] = [
  {
    id: 'index',
    header: '#',
    getValue: (p) => p.index,
    width: 60,
    align: 'right',
  },
  {
    id: 'size',
    header: 'Size',
    getValue: (p) => formatBytes(p.size),
    width: 80,
    align: 'right',
  },
  {
    id: 'state',
    header: 'State',
    getValue: (p) => p.state,
    width: 80,
  },
  {
    id: 'availability',
    header: 'Avail',
    getValue: (p) => p.availability || '-',
    width: 50,
    align: 'right',
  },
]

/** Source interface for reading torrent data */
interface TorrentSource {
  getTorrent(hash: string): Torrent | undefined
}

export interface PieceTableProps {
  /** Source to read torrent from */
  source: TorrentSource
  /** Hash of the selected torrent */
  torrentHash: string
}

/**
 * Virtualized piece table for a single torrent.
 * Can handle thousands of pieces efficiently.
 */
export function PieceTable(props: PieceTableProps) {
  const getTorrent = () => props.source.getTorrent(props.torrentHash) ?? null
  
  return (
    <TableMount<PieceInfo>
      getRows={() => computePieces(getTorrent())}
      getRowKey={(p) => String(p.index)}
      columns={pieceColumns}
      storageKey="pieces"
      rowHeight={24}
    />
  )
}
```

---

## Phase 4: Create DetailPane Component

### 4.1 Create packages/ui/src/components/DetailPane.tsx

```tsx
import React, { useState } from 'react'
import { Torrent } from '@jstorrent/engine'
import { PeerTable } from '../tables/PeerTable'
import { PieceTable } from '../tables/PieceTable'

export type DetailTab = 'peers' | 'pieces' | 'files' | 'trackers'

/** Source interface matching adapter shape */
interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
}

export interface DetailPaneProps {
  /** Source to read torrent data from */
  source: TorrentSource
  /** Currently selected torrent hash (null = none selected) */
  selectedHash: string | null
}

const tabStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderBottom: '2px solid transparent',
  background: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  color: 'var(--text-secondary)',
}

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  color: 'var(--text-primary)',
  borderBottomColor: 'var(--accent-primary)',
}

/**
 * Detail pane showing info about the selected torrent.
 */
export function DetailPane(props: DetailPaneProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('peers')
  
  if (!props.selectedHash) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
      }}>
        Select a torrent to view details
      </div>
    )
  }
  
  const torrent = props.source.getTorrent(props.selectedHash)
  if (!torrent) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
      }}>
        Torrent not found
      </div>
    )
  }
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
      }}>
        <button
          style={activeTab === 'peers' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('peers')}
        >
          Peers ({torrent.numPeers})
        </button>
        <button
          style={activeTab === 'pieces' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('pieces')}
        >
          Pieces ({torrent.completedPiecesCount}/{torrent.piecesCount})
        </button>
        <button
          style={activeTab === 'files' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('files')}
        >
          Files ({torrent.files.length})
        </button>
        <button
          style={activeTab === 'trackers' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('trackers')}
        >
          Trackers
        </button>
      </div>
      
      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === 'peers' && (
          <PeerTable source={props.source} torrentHash={props.selectedHash} />
        )}
        {activeTab === 'pieces' && (
          <PieceTable source={props.source} torrentHash={props.selectedHash} />
        )}
        {activeTab === 'files' && (
          <div style={{ padding: 20, color: 'var(--text-secondary)' }}>
            Files table coming soon
          </div>
        )}
        {activeTab === 'trackers' && (
          <div style={{ padding: 20, color: 'var(--text-secondary)' }}>
            Trackers table coming soon
          </div>
        )}
      </div>
    </div>
  )
}
```

---

## Phase 5: Update Adapter Types

### 5.1 Update packages/client/src/adapters/types.ts

Add `getTorrent` method to the adapter interface. Find the `EngineAdapter` interface and add:

```ts
/** Get a specific torrent by info hash */
getTorrent(hash: string): Torrent | undefined
```

### 5.2 Update DirectEngineAdapter (if it exists) or the adapter implementation

In whatever file implements the adapter (likely `packages/client/src/adapters/direct.ts` or similar, or it might be inline in `engine-manager.ts`), add:

```ts
getTorrent(hash: string): Torrent | undefined {
  return this.torrents.find(t => t.infoHashStr === hash)
}
```

If the adapter is created inline in `engine-manager.ts`, find where the adapter object is created and add the method there.

Check `packages/client/src/chrome/engine-manager.ts` for where the adapter is created and add:

```ts
getTorrent: (hash: string) => engine.torrents.find(t => t.infoHashStr === hash),
```

---

## Phase 6: Update UI Exports

### 6.1 Update packages/ui/src/index.ts

```ts
// Components
export { TorrentItem } from './components/TorrentItem'
export type { TorrentItemProps } from './components/TorrentItem'
export { DetailPane } from './components/DetailPane'
export type { DetailTab, DetailPaneProps } from './components/DetailPane'

// Tables
export { TorrentTable, torrentColumns } from './tables/TorrentTable'
export { PeerTable } from './tables/PeerTable'
export { PieceTable } from './tables/PieceTable'
export type { PieceInfo } from './tables/PieceTable'
export { TableMount } from './tables/mount'
export type { ColumnDef, ColumnConfig, TableMountProps } from './tables/types'

// Utils
export * from './utils/format'
```

---

## Phase 7: Update App Layout

### 7.1 Update extension/src/ui/app.tsx

Replace the entire file with:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { useState, useRef } from 'react'
import { Torrent } from '@jstorrent/engine'
import { TorrentTable, DetailPane, formatBytes } from '@jstorrent/ui'
import { EngineProvider, useEngineState, engineManager } from '@jstorrent/client'
import { DownloadRootsManager } from './components/DownloadRootsManager'

function AppContent() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set())
  const { adapter, torrents, numConnections, globalStats } = useEngineState()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Get single selected hash for detail pane
  const selectedHash = selectedTorrents.size === 1 
    ? [...selectedTorrents][0] 
    : null

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      await adapter.addTorrent(new Uint8Array(buffer))
    } catch (err) {
      console.error('Failed to add torrent file:', err)
    }
    e.target.value = ''
  }

  const handleAddTorrent = async () => {
    if (!magnetInput) {
      fileInputRef.current?.click()
      return
    }

    try {
      await adapter.addTorrent(magnetInput)
      setMagnetInput('')
    } catch (e) {
      console.error('Failed to add torrent:', e)
    }
  }

  const handleDeleteSelected = async () => {
    for (const hash of selectedTorrents) {
      const torrent = torrents.find((t) => t.infoHashStr === hash)
      if (torrent) {
        await adapter.removeTorrent(torrent)
      }
    }
    setSelectedTorrents(new Set())
  }

  const handleStartSelected = () => {
    for (const hash of selectedTorrents) {
      const torrent = torrents.find((t) => t.infoHashStr === hash)
      if (torrent && torrent.userState === 'stopped') {
        torrent.userStart()
      }
    }
  }

  const handleStopSelected = () => {
    for (const hash of selectedTorrents) {
      const torrent = torrents.find((t) => t.infoHashStr === hash)
      if (torrent && torrent.userState !== 'stopped') {
        torrent.userStop()
      }
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '18px' }}>JSTorrent</h1>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setActiveTab('torrents')}
            style={{
              padding: '6px 12px',
              background: activeTab === 'torrents' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'torrents' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Torrents
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '6px 12px',
              background: activeTab === 'settings' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'settings' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Settings
          </button>
        </div>

        {/* Stats - moved to header */}
        <div style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '12px' }}>
          {torrents.length} torrents | {numConnections} peers |{' '}
          ↓ {formatBytes(globalStats.totalDownloadRate)}/s |{' '}
          ↑ {formatBytes(globalStats.totalUploadRate)}/s
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTab === 'torrents' && (
          <>
            {/* Toolbar */}
            <div
              style={{
                padding: '6px 16px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                gap: '6px',
                alignItems: 'center',
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".torrent"
                style={{ display: 'none' }}
              />
              <input
                type="text"
                value={magnetInput}
                onChange={(e) => setMagnetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddTorrent()
                  }
                }}
                placeholder="Magnet link or URL"
                style={{ flex: 1, padding: '4px 8px', maxWidth: '350px', fontSize: '13px' }}
              />
              <button 
                onClick={handleAddTorrent} 
                style={{ padding: '4px 10px', cursor: 'pointer', fontSize: '13px' }}
              >
                Add
              </button>
              <div style={{ width: '1px', height: '18px', background: 'var(--border-color)' }} />
              <button
                onClick={handleStartSelected}
                disabled={selectedTorrents.size === 0}
                style={{ padding: '4px 10px', cursor: 'pointer', fontSize: '13px' }}
                title="Start selected"
              >
                ▶ Start
              </button>
              <button
                onClick={handleStopSelected}
                disabled={selectedTorrents.size === 0}
                style={{ padding: '4px 10px', cursor: 'pointer', fontSize: '13px' }}
                title="Stop selected"
              >
                ⏸ Stop
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedTorrents.size === 0}
                style={{ 
                  padding: '4px 10px', 
                  cursor: 'pointer', 
                  fontSize: '13px',
                  color: 'var(--accent-error)' 
                }}
                title="Remove selected"
              >
                ✕ Remove
              </button>
            </div>

            {/* Main content: Torrent table + Detail pane */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {/* Torrent table - top half */}
              <div style={{ flex: 1, minHeight: 150, borderBottom: '1px solid var(--border-color)' }}>
                {torrents.length === 0 ? (
                  <div
                    style={{ 
                      padding: '40px', 
                      textAlign: 'center', 
                      color: 'var(--text-secondary)' 
                    }}
                  >
                    No torrents. Add a magnet link to get started.
                  </div>
                ) : (
                  <TorrentTable
                    source={adapter}
                    selectedHashes={selectedTorrents}
                    onSelectionChange={setSelectedTorrents}
                    onRowDoubleClick={(torrent: Torrent) => {
                      if (torrent.userState === 'stopped') {
                        torrent.userStart()
                      } else {
                        torrent.userStop()
                      }
                    }}
                  />
                )}
              </div>

              {/* Detail pane - bottom half */}
              <div style={{ height: 250, minHeight: 100 }}>
                <DetailPane
                  source={adapter}
                  selectedHash={selectedHash}
                />
              </div>
            </div>
          </>
        )}

        {activeTab === 'settings' && <DownloadRootsManager />}
      </div>
    </div>
  )
}

function App() {
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof engineManager.init>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  React.useEffect(() => {
    engineManager
      .init()
      .then((eng) => {
        setEngine(eng)
        setLoading(false)
      })
      .catch((e) => {
        console.error('Failed to initialize engine:', e)
        setError(String(e))
        setLoading(false)
      })
  }, [])

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading...</div>
  }

  if (error) {
    return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>
  }

  if (!engine) {
    return <div style={{ padding: '20px' }}>Failed to initialize engine</div>
  }

  return (
    <EngineProvider engine={engine}>
      <AppContent />
    </EngineProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

---

## Phase 8: Verification

```bash
# 1. Install dependencies (should be no new ones needed)
pnpm install

# 2. Typecheck
pnpm -r typecheck

# 3. Start dev server
cd extension && pnpm dev:web

# 4. Open http://local.jstorrent.com:3001/src/ui/app.html

# 5. Verify:
#    - Add a torrent
#    - Click to select it → detail pane shows
#    - Peers tab shows connected peers with live speed updates
#    - Pieces tab shows all pieces with have/missing state
#    - Click different torrents → detail pane updates
#    - Multi-select (ctrl+click) → detail pane shows "Select a torrent"
```

---

## Checklist

### Phase 1: Engine Export
- [ ] Add `export { PeerConnection }` to packages/engine/src/index.ts

### Phase 2: PeerTable
- [ ] Create packages/ui/src/tables/PeerTable.tsx

### Phase 3: PieceTable
- [ ] Create packages/ui/src/tables/PieceTable.tsx

### Phase 4: DetailPane
- [ ] Create packages/ui/src/components/DetailPane.tsx

### Phase 5: Adapter Types
- [ ] Add `getTorrent(hash: string)` to adapter interface
- [ ] Implement `getTorrent` in engine-manager.ts adapter

### Phase 6: UI Exports
- [ ] Update packages/ui/src/index.ts with new exports

### Phase 7: App Layout
- [ ] Replace extension/src/ui/app.tsx with split layout

### Phase 8: Verification
- [ ] pnpm install succeeds
- [ ] pnpm -r typecheck passes
- [ ] Dev server starts
- [ ] Torrent selection shows detail pane
- [ ] Peers table updates in real-time
- [ ] Pieces table shows correct states
- [ ] Multi-select hides detail pane

---

## Troubleshooting

**If DetailPane doesn't get updated selection:**
The `selectedHash` derivation in app.tsx should work, but if there are closure issues, use the ref pattern:

```tsx
const selectedHashRef = useRef(selectedHash)
selectedHashRef.current = selectedHash

<DetailPane
  source={adapter}
  getSelectedHash={() => selectedHashRef.current}
/>
```

And update DetailPane to use `props.getSelectedHash()` instead of `props.selectedHash`.

**If PeerTable shows stale data:**
The RAF loop in VirtualTable.solid.tsx should handle this, but verify `getRows` is returning fresh data each call. The `getTorrent()` call should happen inside the `getRows` callback.

**If pieces show wrong count:**
Make sure `torrent.piecesCount` is populated. For magnet links, this won't be available until metadata is fetched.
