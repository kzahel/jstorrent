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

function formatPeerHints(hints: Array<{ ip: string; port: number }> | undefined): string {
  if (!hints || hints.length === 0) return '(none)'
  return hints.map((h) => `${h.ip}:${h.port}`).join(', ')
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
      ...(torrent.completedAt
        ? [{ label: 'Completed At', value: formatDate(torrent.completedAt) }]
        : []),
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
        value: persisted.magnetLink
          ? 'Magnet Link'
          : persisted.torrentFileBase64
            ? 'Torrent File'
            : 'Unknown',
      },
      ...(persisted.magnetLink
        ? [{ label: 'Magnet URL', value: persisted.magnetLink, copyable: true }]
        : []),
      { label: 'Share URL', value: shareUrl, copyable: true },
      {
        label: 'Peer Hints',
        value: formatPeerHints(torrent.magnetPeerHints),
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
        value: persisted.infoBuffer
          ? `true (${formatBytes(persisted.infoBuffer.length)})`
          : 'false',
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
  const groups = useMemo(() => buildTorrentInfo(torrent), [torrent])

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
