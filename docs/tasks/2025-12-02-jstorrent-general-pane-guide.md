# JSTorrent General Pane Guide

## Overview

Add a "General" tab to the DetailPane showing comprehensive debug information about the selected torrent. This is a static snapshot - data is captured when you select the torrent and doesn't update in real-time.

**Design principles:**
- Monospace font for easy scanning
- Simple key-value pairs grouped by category
- Copy buttons for hashes/URLs
- Scrollable when content overflows
- No live updates (static snapshot)

---

## Implementation

### 1. Create packages/ui/src/components/GeneralPane.tsx

```tsx
import React, { useMemo } from 'react'
import { Torrent, generateMagnet } from '@jstorrent/engine'
import { formatBytes } from '../utils/format'

export interface GeneralPaneProps {
  torrent: Torrent
}

interface InfoRow {
  label: string
  value: string
  copyable?: boolean
}

interface InfoGroup {
  title: string
  rows: InfoRow[]
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

function formatPeerHints(hints: Array<{ host: string; port: number }> | undefined): string {
  if (!hints || hints.length === 0) return '(none)'
  return hints.map((h) => `${h.host}:${h.port}`).join(', ')
}

function buildTorrentInfo(torrent: Torrent): InfoGroup[] {
  const persisted = torrent.getPersistedState()
  const groups: InfoGroup[] = []

  // Identity
  groups.push({
    title: 'Identity',
    rows: [
      { label: 'Info Hash', value: torrent.infoHashStr, copyable: true },
      { label: 'Name', value: torrent.name },
      ...(torrent._magnetDisplayName && torrent._magnetDisplayName !== torrent.name
        ? [{ label: 'Magnet Name', value: torrent._magnetDisplayName }]
        : []),
    ],
  })

  // State
  groups.push({
    title: 'State',
    rows: [
      { label: 'User State', value: torrent.userState },
      { label: 'Activity State', value: torrent.activityState },
      {
        label: 'Progress',
        value: `${(torrent.progress * 100).toFixed(1)}% (${torrent.completedPiecesCount} / ${torrent.piecesCount} pieces)`,
      },
      { label: 'Has Metadata', value: torrent.hasMetadata ? 'true' : 'false' },
      { label: 'Is Private', value: torrent.isPrivate ? 'true' : 'false' },
      ...(torrent.errorMessage ? [{ label: 'Error', value: torrent.errorMessage }] : []),
    ],
  })

  // Storage
  const totalSize = torrent.contentStorage?.getTotalSize() ?? 0
  groups.push({
    title: 'Storage',
    rows: [
      { label: 'Total Size', value: formatBytes(totalSize) },
      { label: 'Piece Length', value: formatBytes(torrent.pieceLength) },
      { label: 'Piece Count', value: String(torrent.piecesCount) },
      { label: 'File Count', value: String(torrent.files.length) },
      // TODO: Storage root requires engine access
      // { label: 'Storage Root', value: '...' },
    ],
  })

  // Timestamps
  groups.push({
    title: 'Timestamps',
    rows: [
      { label: 'Added At', value: formatDate(torrent.addedAt) },
      ...(torrent.completedAt ? [{ label: 'Completed At', value: formatDate(torrent.completedAt) }] : []),
      ...(torrent.creationDate
        ? [{ label: 'Torrent Created', value: formatDate(torrent.creationDate * 1000) }]
        : []),
    ],
  })

  // Origin
  const shareUrl = generateMagnet({
    infoHash: torrent.infoHashStr,
    name: torrent.name,
    announce: torrent.announce,
  })

  groups.push({
    title: 'Origin',
    rows: [
      {
        label: 'Origin Type',
        value: persisted.magnetLink ? 'Magnet Link' : persisted.torrentFileBase64 ? 'Torrent File' : 'Unknown',
      },
      ...(persisted.magnetLink
        ? [{ label: 'Magnet URL', value: persisted.magnetLink, copyable: true }]
        : []),
      { label: 'Share URL', value: shareUrl, copyable: true },
      {
        label: 'Peer Hints',
        value: formatPeerHints((torrent as any).magnetPeerHints),
      },
    ],
  })

  // Trackers
  if (torrent.announce.length > 0) {
    groups.push({
      title: 'Trackers',
      rows: torrent.announce.map((url, i) => ({
        label: `Tracker ${i + 1}`,
        value: url,
      })),
    })
  }

  // Persistence (debug info)
  groups.push({
    title: 'Persistence',
    rows: [
      { label: 'Has Torrent File', value: persisted.torrentFileBase64 ? 'true' : 'false' },
      {
        label: 'Has Info Buffer',
        value: persisted.infoBuffer ? `true (${formatBytes(persisted.infoBuffer.length)})` : 'false',
      },
      {
        label: 'Bitfield',
        value: `${torrent.piecesCount} bits, ${torrent.completedPiecesCount} set`,
      },
      { label: 'Total Downloaded', value: formatBytes(persisted.totalDownloaded) },
      { label: 'Total Uploaded', value: formatBytes(persisted.totalUploaded) },
      ...(torrent.queuePosition !== undefined
        ? [{ label: 'Queue Position', value: String(torrent.queuePosition) }]
        : []),
    ],
  })

  return groups
}

const containerStyle: React.CSSProperties = {
  height: '100%',
  overflow: 'auto',
  padding: '12px 16px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: '12px',
  lineHeight: '1.5',
}

const groupStyle: React.CSSProperties = {
  marginBottom: '16px',
}

const groupTitleStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  marginBottom: '6px',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  padding: '2px 0',
  gap: '12px',
}

const labelStyle: React.CSSProperties = {
  width: '140px',
  flexShrink: 0,
  color: 'var(--text-secondary)',
}

const valueStyle: React.CSSProperties = {
  flex: 1,
  wordBreak: 'break-all',
  color: 'var(--text-primary)',
}

const copyButtonStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '10px',
  marginLeft: '8px',
  cursor: 'pointer',
  background: 'var(--button-bg)',
  border: '1px solid var(--border-color)',
  borderRadius: '3px',
  color: 'var(--text-secondary)',
  flexShrink: 0,
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Fallback for non-secure contexts
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <button style={copyButtonStyle} onClick={handleCopy} title="Copy to clipboard">
      {copied ? '✓' : 'copy'}
    </button>
  )
}

export function GeneralPane({ torrent }: GeneralPaneProps) {
  // Build info once when torrent changes (static snapshot)
  const groups = useMemo(() => buildTorrentInfo(torrent), [torrent.infoHashStr])

  return (
    <div style={containerStyle}>
      {groups.map((group) => (
        <div key={group.title} style={groupStyle}>
          <div style={groupTitleStyle}>── {group.title} ──</div>
          {group.rows.map((row) => (
            <div key={row.label} style={rowStyle}>
              <span style={labelStyle}>{row.label}</span>
              <span style={valueStyle}>
                {row.value}
                {row.copyable && <CopyButton text={row.value} />}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
```

---

### 2. Update packages/ui/src/components/DetailPane.tsx

#### 2.1 Add import

```tsx
import { GeneralPane } from './GeneralPane'
```

#### 2.2 Update DetailTab type

```tsx
export type DetailTab = 'peers' | 'pieces' | 'files' | 'general'
```

#### 2.3 Add the General tab button

In the tab bar section, add a General button. Place it after Files or wherever feels natural:

```tsx
<button
  style={activeTab === 'general' ? activeTabStyle : tabStyle}
  onClick={() => setActiveTab('general')}
>
  General
</button>
```

#### 2.4 Add the General tab content

In the tab content section:

```tsx
{activeTab === 'general' && <GeneralPane torrent={torrent} />}
```

---

### 3. Update packages/ui/src/index.ts

Add the export:

```tsx
export { GeneralPane } from './components/GeneralPane'
export type { GeneralPaneProps } from './components/GeneralPane'
```

---

### 4. Full updated DetailPane.tsx

For reference, here's what the complete file should look like:

```tsx
import React, { useState } from 'react'
import { Torrent } from '@jstorrent/engine'
import { PeerTable } from '../tables/PeerTable'
import { PieceTable } from '../tables/PieceTable'
import { GeneralPane } from './GeneralPane'

export type DetailTab = 'peers' | 'pieces' | 'files' | 'general'

/** Source interface matching adapter shape */
interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
}

export interface DetailPaneProps {
  /** Source to read torrent data from */
  source: TorrentSource
  /** Selected hashes - empty Set means none, Set with 1 item shows details, Set with 2+ shows count */
  selectedHashes: Set<string>
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

const emptyStateStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-secondary)',
}

/**
 * Detail pane showing info about the selected torrent.
 */
export function DetailPane(props: DetailPaneProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('peers')

  // No selection
  if (props.selectedHashes.size === 0) {
    return <div style={emptyStateStyle}>Select a torrent to view details</div>
  }

  // Multi-selection
  if (props.selectedHashes.size > 1) {
    return <div style={emptyStateStyle}>{props.selectedHashes.size} torrents selected</div>
  }

  // Single selection - show details
  const selectedHash = [...props.selectedHashes][0]
  const torrent = props.source.getTorrent(selectedHash)

  if (!torrent) {
    return <div style={emptyStateStyle}>Torrent not found</div>
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}
      >
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
          style={activeTab === 'general' ? activeTabStyle : tabStyle}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === 'peers' && <PeerTable source={props.source} torrentHash={selectedHash} />}
        {activeTab === 'pieces' && <PieceTable source={props.source} torrentHash={selectedHash} />}
        {activeTab === 'files' && (
          <div style={{ padding: 20, color: 'var(--text-secondary)' }}>Files table coming soon</div>
        )}
        {activeTab === 'general' && <GeneralPane torrent={torrent} />}
      </div>
    </div>
  )
}
```

---

## Verification

```bash
cd extension && pnpm dev:web
```

1. Open http://local.jstorrent.com:3001/src/ui/app.html
2. Add a torrent (magnet link or file)
3. Select the torrent
4. Click the "General" tab in the detail pane
5. Verify all sections display:
   - Identity (hash, name)
   - State (user state, activity, progress)
   - Storage (size, piece info)
   - Timestamps (added, completed)
   - Origin (type, magnet URL, share URL, peer hints)
   - Trackers (if any)
   - Persistence (debug info)
6. Test copy buttons work for hash, magnet URL, share URL
7. Test scrolling if content overflows

---

## Checklist

- [ ] Create GeneralPane.tsx
- [ ] Add GeneralPane import to DetailPane.tsx
- [ ] Update DetailTab type to include 'general'
- [ ] Add General tab button
- [ ] Add General tab content
- [ ] Export GeneralPane from index.ts
- [ ] Test in browser

---

## Future Enhancements

**Storage root display:**
Currently commented out because it requires engine access. Options:
1. Add `getStorageRoot()` method to Torrent that fetches from engine
2. Pass engine/adapter to GeneralPane
3. Add storage root info to TorrentPersistedState

**Additional debug info:**
- Connection stats (avg connect time, success rate)
- Swarm stats (IPv4 vs IPv6 peers)
- Tracker response details
- Active piece states

**Refresh button:**
Add a "Refresh" button to re-capture the snapshot without changing selection.
