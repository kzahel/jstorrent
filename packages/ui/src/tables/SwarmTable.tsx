import type { SwarmPeer, Torrent } from '@jstorrent/engine'
import { addressKey } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'

/**
 * Format timestamp as relative time or absolute
 */
function formatTime(ts: number | null): string {
  if (!ts) return '-'
  const now = Date.now()
  const diff = now - ts
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return new Date(ts).toLocaleDateString()
}

/**
 * Parse client name from peer ID bytes
 */
function parseClientName(peerId: Uint8Array | null): string {
  if (!peerId) return '-'

  // Azureus-style: -XX0000-
  if (peerId[0] === 0x2d && peerId[7] === 0x2d) {
    const clientCode = String.fromCharCode(peerId[1], peerId[2])
    const version = String.fromCharCode(peerId[3], peerId[4], peerId[5], peerId[6])

    const clients: Record<string, string> = {
      UT: 'µTorrent',
      TR: 'Transmission',
      DE: 'Deluge',
      qB: 'qBittorrent',
      AZ: 'Azureus',
      LT: 'libtorrent',
      lt: 'libtorrent',
      JS: 'JSTorrent',
    }

    const name = clients[clientCode] || clientCode
    return `${name} ${version.replace(/0/g, '.').replace(/\.+$/, '')}`
  }

  // Shadow-style: first byte is client
  // Just show hex for unknown
  return Array.from(peerId.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Format peer ID as hex string
 */
function formatPeerId(peerId: Uint8Array | null): string {
  if (!peerId) return '-'
  return Array.from(peerId)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Column definitions for swarm table */
const swarmColumns: ColumnDef<SwarmPeer>[] = [
  // Default visible columns
  {
    id: 'address',
    header: 'Address',
    getValue: (p) => addressKey(p),
    width: 180,
  },
  {
    id: 'state',
    header: 'State',
    getValue: (p) => p.state,
    width: 90,
  },
  {
    id: 'client',
    header: 'Client',
    getValue: (p) => p.clientName || parseClientName(p.peerId),
    width: 140,
  },
  {
    id: 'source',
    header: 'Source',
    getValue: (p) => p.source,
    width: 80,
  },
  {
    id: 'downloaded',
    header: 'Downloaded',
    getValue: (p) => (p.totalDownloaded > 0 ? formatBytes(p.totalDownloaded) : '-'),
    width: 90,
    align: 'right',
  },
  {
    id: 'uploaded',
    header: 'Uploaded',
    getValue: (p) => (p.totalUploaded > 0 ? formatBytes(p.totalUploaded) : '-'),
    width: 90,
    align: 'right',
  },
  // Default hidden columns
  {
    id: 'family',
    header: 'Family',
    getValue: (p) => p.family,
    width: 60,
    defaultHidden: true,
  },
  {
    id: 'port',
    header: 'Port',
    getValue: (p) => p.port,
    width: 60,
    align: 'right',
    defaultHidden: true,
  },
  {
    id: 'discoveredAt',
    header: 'Discovered',
    getValue: (p) => formatTime(p.discoveredAt),
    width: 100,
    defaultHidden: true,
  },
  {
    id: 'connectAttempts',
    header: 'Attempts',
    getValue: (p) => p.connectAttempts || '-',
    width: 70,
    align: 'right',
  },
  {
    id: 'connectFailures',
    header: 'Failures',
    getValue: (p) => p.connectFailures || '-',
    width: 70,
    align: 'right',
  },
  {
    id: 'lastAttempt',
    header: 'Last Attempt',
    getValue: (p) => formatTime(p.lastConnectAttempt),
    width: 100,
  },
  {
    id: 'lastSuccess',
    header: 'Last Success',
    getValue: (p) => formatTime(p.lastConnectSuccess),
    width: 100,
    defaultHidden: true,
  },
  {
    id: 'lastError',
    header: 'Last Error',
    getValue: (p) => p.lastConnectError || '-',
    width: 150,
    defaultHidden: true,
  },
  {
    id: 'quickDisconnects',
    header: 'Quick DCs',
    getValue: (p) => p.quickDisconnects || '-',
    width: 70,
    align: 'right',
    defaultHidden: true,
  },
  {
    id: 'lastDisconnect',
    header: 'Last DC',
    getValue: (p) => formatTime(p.lastDisconnect),
    width: 100,
    defaultHidden: true,
  },
  {
    id: 'banReason',
    header: 'Ban Reason',
    getValue: (p) => p.banReason || '-',
    width: 150,
    defaultHidden: true,
  },
  {
    id: 'suspiciousPort',
    header: 'Sus. Port',
    getValue: (p) => (p.suspiciousPort ? 'Yes' : '-'),
    width: 70,
    align: 'center',
    defaultHidden: true,
  },
  {
    id: 'peerId',
    header: 'Peer ID',
    getValue: (p) => formatPeerId(p.peerId),
    width: 180,
    defaultHidden: true,
  },
]

/** Source interface for reading torrent data */
interface TorrentSource {
  getTorrent(hash: string): Torrent | undefined
}

export interface SwarmTableProps {
  /** Source to read torrent from */
  source: TorrentSource
  /** Hash of the selected torrent */
  torrentHash: string
  /** Get selected row keys (for Solid bridge) */
  getSelectedKeys?: () => Set<string>
  /** Called when selection changes */
  onSelectionChange?: (keys: Set<string>) => void
}

/**
 * Virtualized swarm table showing all known peers for a torrent.
 * Unlike PeerTable which shows only connected peers, this shows all peers
 * in the swarm including idle, connecting, failed, and banned peers.
 */
export function SwarmTable(props: SwarmTableProps) {
  const getTorrent = () => props.source.getTorrent(props.torrentHash) ?? null

  return (
    <TableMount<SwarmPeer>
      getRows={() => getTorrent()?.swarmPeersArray ?? []}
      getRowKey={(p) => addressKey(p)}
      columns={swarmColumns}
      storageKey="swarm"
      rowHeight={24}
      getSelectedKeys={props.getSelectedKeys}
      onSelectionChange={props.onSelectionChange}
    />
  )
}
