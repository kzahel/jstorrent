import { DisplayPeer, Torrent } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'

/**
 * Format peer flags (choking/interested states)
 * D = downloading from peer, U = uploading to peer
 * Characters: d/D = download, u/U = upload (lowercase = choked)
 * Returns empty string for connecting peers (no connection yet)
 */
function formatFlags(peer: DisplayPeer): string {
  if (!peer.connection) return ''

  const flags: string[] = []

  // Download: are we interested and are they choking us?
  if (peer.connection.amInterested) {
    flags.push(peer.connection.peerChoking ? 'd' : 'D')
  }

  // Upload: are they interested and are we choking them?
  if (peer.connection.peerInterested) {
    flags.push(peer.connection.amChoking ? 'u' : 'U')
  }

  return flags.join(' ')
}

/**
 * Calculate peer's progress from their bitfield
 * Returns 0 for connecting peers
 */
function getPeerProgress(peer: DisplayPeer, torrent: Torrent): number {
  if (!peer.connection?.bitfield || torrent.piecesCount === 0) return 0
  const have = peer.connection.bitfield.count()
  return have / torrent.piecesCount
}

/**
 * Parse client name from peer ID bytes
 */
function parseClientName(peer: DisplayPeer): string {
  const peerId = peer.connection?.peerId ?? peer.swarmPeer?.peerId
  if (!peerId) return ''

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
 * Format connection state for display
 */
function formatState(peer: DisplayPeer): string {
  return peer.state === 'connecting' ? 'Connecting...' : 'Connected'
}

/** Column definitions for DisplayPeer */
function createPeerColumns(getTorrent: () => Torrent | null): ColumnDef<DisplayPeer>[] {
  return [
    {
      id: 'state',
      header: 'State',
      getValue: (p) => formatState(p),
      width: 90,
    },
    {
      id: 'address',
      header: 'Address',
      getValue: (p) => `${p.ip}:${p.port}`,
      width: 180,
    },
    {
      id: 'client',
      header: 'Client',
      getValue: (p) => parseClientName(p),
      width: 140,
    },
    {
      id: 'progress',
      header: '%',
      getValue: (p) => {
        const t = getTorrent()
        if (!t || !p.connection) return ''
        const pct = getPeerProgress(p, t) * 100
        return pct >= 100 ? '100' : pct.toFixed(1)
      },
      width: 50,
      align: 'right',
    },
    {
      id: 'downSpeed',
      header: 'Down',
      getValue: (p) => {
        const speed = p.connection?.downloadSpeed ?? 0
        return speed > 0 ? formatBytes(speed) + '/s' : ''
      },
      width: 90,
      align: 'right',
    },
    {
      id: 'upSpeed',
      header: 'Up',
      getValue: (p) => {
        const speed = p.connection?.uploadSpeed ?? 0
        return speed > 0 ? formatBytes(speed) + '/s' : ''
      },
      width: 90,
      align: 'right',
    },
    {
      id: 'downloaded',
      header: 'Downloaded',
      getValue: (p) => {
        const dl = p.connection?.downloaded ?? 0
        return dl > 0 ? formatBytes(dl) : ''
      },
      width: 90,
      align: 'right',
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      getValue: (p) => {
        const up = p.connection?.uploaded ?? 0
        return up > 0 ? formatBytes(up) : ''
      },
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
      getValue: (p) => p.connection?.requestsPending || '',
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
  /** Get selected row keys (for Solid bridge) */
  getSelectedKeys?: () => Set<string>
  /** Called when selection changes */
  onSelectionChange?: (keys: Set<string>) => void
}

/**
 * Virtualized peer table for a single torrent.
 */
export function PeerTable(props: PeerTableProps) {
  const getTorrent = () => props.source.getTorrent(props.torrentHash) ?? null
  const columns = createPeerColumns(getTorrent)

  return (
    <TableMount<DisplayPeer>
      getRows={() => getTorrent()?.getDisplayPeers() ?? []}
      getRowKey={(p) => p.key}
      columns={columns}
      storageKey="peers"
      rowHeight={24}
      getSelectedKeys={props.getSelectedKeys}
      onSelectionChange={props.onSelectionChange}
    />
  )
}
