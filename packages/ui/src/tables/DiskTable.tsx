import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'
import type { DiskJob, DiskQueueSnapshot } from '@jstorrent/engine'

function formatDuration(job: DiskJob): string {
  if (!job.startedAt) return '-'
  const ms = Date.now() - job.startedAt
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatStatus(job: DiskJob): string {
  return job.status === 'running' ? '▶' : '⏳'
}

const diskColumns: ColumnDef<DiskJob>[] = [
  {
    id: 'status',
    header: '',
    getValue: (j) => formatStatus(j),
    width: 30,
    align: 'center',
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
    id: 'time',
    header: 'Time',
    getValue: (j) => formatDuration(j),
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
