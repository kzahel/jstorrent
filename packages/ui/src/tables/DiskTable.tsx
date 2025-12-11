import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'
import type { DiskJob, DiskQueueSnapshot } from '@jstorrent/engine'

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

function formatElapsed(job: DiskJob): string {
  if (!job.startedAt) return '-'
  const ms = Date.now() - job.startedAt
  // Show at 0.1s granularity
  const tenths = Math.floor(ms / 100) / 10
  return `${tenths.toFixed(1)}s`
}

const diskColumns: ColumnDef<DiskJob>[] = [
  {
    id: 'id',
    header: 'ID',
    getValue: (j) => String(j.id),
    width: 45,
    align: 'right',
  },
  {
    id: 'status',
    header: 'Status',
    getValue: (j) => j.status,
    width: 70,
  },
  {
    id: 'type',
    header: 'Type',
    getValue: (j) => j.type,
    width: 60,
  },
  {
    id: 'piece',
    header: 'Piece',
    getValue: (j) => String(j.pieceIndex),
    width: 60,
    align: 'right',
  },
  {
    id: 'files',
    header: 'Files',
    getValue: (j) => String(j.fileCount),
    width: 50,
    align: 'right',
  },
  {
    id: 'size',
    header: 'Size',
    getValue: (j) => formatBytes(j.size),
    width: 80,
    align: 'right',
  },
  {
    id: 'enqueued',
    header: 'Enqueued',
    getValue: (j) => formatTime(j.enqueuedAt),
    width: 90,
  },
  {
    id: 'started',
    header: 'Started',
    getValue: (j) => formatTime(j.startedAt),
    width: 90,
  },
  {
    id: 'elapsed',
    header: 'Elapsed',
    getValue: (j) => formatElapsed(j),
    width: 70,
    align: 'right',
  },
]

interface DiskQueueSource {
  getDiskQueueSnapshot(torrentHash: string): DiskQueueSnapshot | null
}

export interface DiskTableProps {
  source: DiskQueueSource
  torrentHash: string
}

export function DiskTable(props: DiskTableProps) {
  const getRows = (): DiskJob[] => {
    const snapshot = props.source.getDiskQueueSnapshot(props.torrentHash)
    if (!snapshot) return []
    // Running jobs first, then pending
    return [...snapshot.running, ...snapshot.pending]
  }

  return (
    <TableMount<DiskJob>
      getRows={getRows}
      getRowKey={(j) => String(j.id)}
      columns={diskColumns}
      storageKey="disk"
      rowHeight={24}
    />
  )
}
