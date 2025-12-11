import { Torrent } from '@jstorrent/engine'
import type { DiskQueueSnapshot, DiskJob } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'

/** Disk job for display (excludes executor) */
type DiskJobDisplay = Omit<DiskJob, 'executor'>

/** Format timestamp as relative time */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  if (diff < 1000) return 'now'
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  return `${Math.floor(diff / 60000)}m ago`
}

/** Format duration in ms */
function formatDuration(startedAt?: number): string {
  if (!startedAt) return '-'
  const duration = Date.now() - startedAt
  if (duration < 1000) return `${duration}ms`
  return `${(duration / 1000).toFixed(1)}s`
}

/** Column definitions for disk queue table */
const diskJobColumns: ColumnDef<DiskJobDisplay>[] = [
  {
    id: 'id',
    header: 'ID',
    getValue: (job) => job.id,
    width: 150,
    minWidth: 100,
  },
  {
    id: 'type',
    header: 'Type',
    getValue: (job) => job.type.toUpperCase(),
    width: 70,
  },
  {
    id: 'status',
    header: 'Status',
    getValue: (job) => (job.startedAt ? 'Running' : 'Pending'),
    width: 80,
  },
  {
    id: 'file',
    header: 'File',
    getValue: (job) => job.filePath,
    width: 200,
    minWidth: 100,
  },
  {
    id: 'offset',
    header: 'Offset',
    getValue: (job) => formatBytes(job.offset),
    width: 90,
    align: 'right',
  },
  {
    id: 'length',
    header: 'Length',
    getValue: (job) => formatBytes(job.length),
    width: 90,
    align: 'right',
  },
  {
    id: 'enqueued',
    header: 'Enqueued',
    getValue: (job) => formatRelativeTime(job.enqueuedAt),
    width: 90,
    align: 'right',
  },
  {
    id: 'duration',
    header: 'Duration',
    getValue: (job) => formatDuration(job.startedAt),
    width: 90,
    align: 'right',
  },
]

/** Source interface for reading torrent data */
interface TorrentSource {
  getTorrent(hash: string): Torrent | undefined
}

export interface DiskTableProps {
  /** Source to read torrent from */
  source: TorrentSource
  /** Hash of the selected torrent */
  torrentHash: string
}

/**
 * Disk queue table for a single torrent.
 * Shows raw queue state (pending + running jobs).
 * When healthy, the table is empty - items appear when I/O is backed up.
 */
export function DiskTable(props: DiskTableProps) {
  const getTorrent = () => props.source.getTorrent(props.torrentHash) ?? null

  const getSnapshot = (): DiskQueueSnapshot | null => {
    const torrent = getTorrent()
    return torrent?.getDiskQueueSnapshot() ?? null
  }

  const getRows = (): DiskJobDisplay[] => {
    const snapshot = getSnapshot()
    if (!snapshot) return []

    // Combine running and pending jobs, running first
    return [...snapshot.running, ...snapshot.pending]
  }

  const snapshot = getSnapshot()

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Status bar */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          display: 'flex',
          gap: '16px',
        }}
      >
        <span>
          Running: <strong>{snapshot?.running.length ?? 0}</strong>
        </span>
        <span>
          Pending: <strong>{snapshot?.pending.length ?? 0}</strong>
        </span>
        {snapshot?.draining && (
          <span style={{ color: 'var(--warning-color, #f59e0b)' }}>Draining...</span>
        )}
        {snapshot?.partsLocked && <span>.parts locked</span>}
        {!snapshot && <span style={{ fontStyle: 'italic' }}>No queue initialized</span>}
      </div>

      {/* Table or empty state */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {getRows().length === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <span>Queue is empty</span>
            <span style={{ fontSize: '11px', opacity: 0.7 }}>
              Jobs appear here when disk I/O is backed up
            </span>
          </div>
        ) : (
          <TableMount<DiskJobDisplay>
            getRows={getRows}
            getRowKey={(job) => job.id}
            columns={diskJobColumns}
            storageKey="disk"
            rowHeight={24}
          />
        )}
      </div>
    </div>
  )
}
