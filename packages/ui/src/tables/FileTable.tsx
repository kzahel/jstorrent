import { useState } from 'react'
import { Torrent, TorrentFileInfo } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu'

/** Format progress as percentage */
function formatProgress(progress: number): string {
  const pct = progress * 100
  if (pct >= 100) return '100%'
  if (pct < 0.1) return '0%'
  return pct.toFixed(1) + '%'
}

/** Column definitions for file table */
const fileColumns: ColumnDef<TorrentFileInfo>[] = [
  {
    id: 'name',
    header: 'Name',
    getValue: (f) => f.path,
    width: 350,
    minWidth: 150,
  },
  {
    id: 'size',
    header: 'Size',
    getValue: (f) => formatBytes(f.length),
    width: 90,
    align: 'right',
  },
  {
    id: 'progress',
    header: 'Progress',
    getValue: (f) => formatProgress(f.progress),
    width: 80,
    align: 'right',
  },
  {
    id: 'done',
    header: 'Done',
    getValue: (f) => formatBytes(f.downloaded),
    width: 90,
    align: 'right',
  },
]

/** Context menu state */
interface FileContextMenuState {
  x: number
  y: number
  file: TorrentFileInfo
}

/** Source interface for reading torrent data */
interface TorrentSource {
  getTorrent(hash: string): Torrent | undefined
}

export interface FileTableProps {
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
 * Virtualized file table for a single torrent.
 */
export function FileTable(props: FileTableProps) {
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)

  const getTorrent = () => props.source.getTorrent(props.torrentHash) ?? null

  const handleContextMenu = (file: TorrentFileInfo, x: number, y: number) => {
    setContextMenu({ x, y, file })
  }

  const contextMenuItems: ContextMenuItem[] = [
    {
      id: 'open',
      label: 'Open',
      icon: '📄',
    },
    {
      id: 'open-folder',
      label: 'Open Containing Folder',
      icon: '📁',
    },
  ]

  const handleContextMenuSelect = (id: string) => {
    if (!contextMenu) return
    const file = contextMenu.file

    switch (id) {
      case 'open':
        // TODO: Implement file open via native host
        alert(`Open file: ${file.path}\n\nComing soon!`)
        break
      case 'open-folder':
        // TODO: Implement folder open via native host
        alert(`Open folder for: ${file.path}\n\nComing soon!`)
        break
    }
  }

  return (
    <>
      <TableMount<TorrentFileInfo>
        getRows={() => getTorrent()?.files ?? []}
        getRowKey={(f) => String(f.index)}
        columns={fileColumns}
        storageKey="files"
        rowHeight={24}
        getSelectedKeys={props.getSelectedKeys}
        onSelectionChange={props.onSelectionChange}
        onRowContextMenu={handleContextMenu}
        onRowDoubleClick={(file) => {
          // TODO: Implement file open via native host
          alert(`Open file: ${file.path}\n\nComing soon!`)
        }}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onSelect={handleContextMenuSelect}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
