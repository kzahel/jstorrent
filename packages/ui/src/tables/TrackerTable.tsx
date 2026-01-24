import { TableMount } from './mount'
import { ColumnDef } from './types'
import type { TrackerStats } from '@jstorrent/engine'

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}

function formatTimeUntil(timestampMs: number | null): string {
  if (timestampMs === null) return '-'
  const now = Date.now()
  const diffMs = timestampMs - now
  if (diffMs <= 0) return 'now'
  const diffSec = Math.ceil(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ${diffSec % 60}s`
  const hours = Math.floor(diffSec / 3600)
  const mins = Math.floor((diffSec % 3600) / 60)
  return `${hours}h ${mins}m`
}

const trackerColumns: ColumnDef<TrackerStats>[] = [
  {
    id: 'url',
    header: 'URL',
    getValue: (t) => t.url,
    width: 300,
  },
  {
    id: 'type',
    header: 'Type',
    getValue: (t) => t.type,
    width: 50,
  },
  {
    id: 'status',
    header: 'Status',
    getValue: (t) => t.status,
    width: 80,
  },
  {
    id: 'seeders',
    header: 'Seeders',
    getValue: (t) => (t.seeders !== null ? String(t.seeders) : '-'),
    width: 60,
    align: 'right',
  },
  {
    id: 'leechers',
    header: 'Leechers',
    getValue: (t) => (t.leechers !== null ? String(t.leechers) : '-'),
    width: 65,
    align: 'right',
  },
  {
    id: 'lastPeers',
    header: 'Last Peers',
    getValue: (t) => String(t.lastPeersReceived),
    width: 70,
    align: 'right',
  },
  {
    id: 'uniquePeers',
    header: 'Unique Peers',
    getValue: (t) => String(t.uniquePeersDiscovered),
    width: 85,
    align: 'right',
  },
  {
    id: 'interval',
    header: 'Interval',
    getValue: (t) => formatInterval(t.interval),
    width: 65,
    align: 'right',
  },
  {
    id: 'nextAnnounce',
    header: 'Next Announce',
    getValue: (t) => formatTimeUntil(t.nextAnnounce),
    width: 90,
    align: 'right',
  },
  {
    id: 'error',
    header: 'Error',
    getValue: (t) => t.lastError ?? '',
    width: 200,
  },
]

interface TrackerSource {
  getTrackerStats(torrentHash: string): TrackerStats[]
}

export interface TrackerTableProps {
  source: TrackerSource
  torrentHash: string
  /** Get selected row keys (for Solid bridge) */
  getSelectedKeys?: () => Set<string>
  /** Called when selection changes */
  onSelectionChange?: (keys: Set<string>) => void
}

export function TrackerTable(props: TrackerTableProps) {
  const getRows = (): TrackerStats[] => {
    return props.source.getTrackerStats(props.torrentHash)
  }

  return (
    <TableMount<TrackerStats>
      getRows={getRows}
      getRowKey={(t) => t.url}
      columns={trackerColumns}
      storageKey="tracker"
      getSelectedKeys={props.getSelectedKeys}
      onSelectionChange={props.onSelectionChange}
      refreshKey={props.torrentHash}
    />
  )
}
