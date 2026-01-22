import { useState } from 'react'
import { Torrent, TorrentFileInfo } from '@jstorrent/engine'
import { TableMount } from './mount'
import { ColumnDef } from './types'
import { formatBytes } from '../utils/format'
import { ContextMenu, ContextMenuItem } from '../components/ContextMenu'
import { ProgressBar } from './ProgressBar.solid'

/** Column definitions for file table */
const fileColumns: ColumnDef<TorrentFileInfo>[] = [
  {
    id: 'filename',
    header: 'Filename',
    getValue: (f) => f.filename,
    width: 200,
    minWidth: 100,
  },
  {
    id: 'folder',
    header: 'Folder',
    getValue: (f) => f.folder || '(root)',
    width: 250,
    minWidth: 100,
  },
  {
    id: 'extension',
    header: 'Ext',
    getValue: (f) => f.extension || '-',
    width: 70,
    minWidth: 40,
  },
  {
    id: 'index',
    header: 'Index',
    getValue: (f) => f.index,
    width: 50,
    align: 'right',
    defaultHidden: true,
  },
  {
    id: 'priority',
    header: 'Priority',
    getValue: (f) => (f.isSkipped ? 'Skip' : f.priority === 2 ? 'High' : 'Normal'),
    width: 70,
    align: 'center',
  },
  {
    id: 'name',
    header: 'Full Path',
    getValue: (f) => f.path,
    width: 350,
    minWidth: 150,
    defaultHidden: true,
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
    getValue: (f) => f.progress * 100, // Numeric for sorting
    width: 80,
    align: 'center',
    renderCell: (f) => ProgressBar({ progress: f.progress }),
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
  /** Called when user wants to open a file. If not provided, shows "not available" alert. */
  onOpenFile?: (torrentHash: string, file: TorrentFileInfo) => void
  /** Called when user wants to reveal a file in folder. If not provided, shows "not available" alert. */
  onRevealInFolder?: (torrentHash: string, file: TorrentFileInfo) => void
  /** Called when user wants to copy the file path. If not provided, shows "not available" alert. */
  onCopyFilePath?: (torrentHash: string, file: TorrentFileInfo) => void
  /** Called when user wants to change file priority. */
  onSetFilePriority?: (torrentHash: string, fileIndex: number, priority: number) => void
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

  const getContextMenuItems = (): ContextMenuItem[] => {
    // Get selected files to determine which options to enable
    const torrent = getTorrent()
    const selectedKeys = props.getSelectedKeys?.() ?? new Set<string>()
    const selectedFiles = torrent?.files.filter((f) => selectedKeys.has(String(f.index))) ?? []

    // Check if any selected files can be skipped or unskipped
    const canSkipAny = selectedFiles.some((f) => !f.isSkipped && !f.isComplete)
    const canUnskipAny = selectedFiles.some((f) => f.isSkipped)
    const canSetHighPriority = selectedFiles.some((f) => f.priority !== 2 && !f.isComplete)

    return [
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
      {
        id: 'copy-path',
        label: 'Copy File Path',
        icon: '📋',
      },
      { id: 'separator', label: '-' },
      {
        id: 'high-priority',
        label: 'High Priority',
        icon: '⬆️',
        disabled: !canSetHighPriority,
      },
      {
        id: 'skip',
        label: "Don't Download (Skip)",
        icon: '⏸️',
        disabled: !canSkipAny,
      },
      {
        id: 'unskip',
        label: 'Normal Priority',
        icon: '▶️',
        disabled: !canUnskipAny,
      },
    ]
  }

  const handleOpenFile = (file: TorrentFileInfo) => {
    if (props.onOpenFile) {
      props.onOpenFile(props.torrentHash, file)
    } else {
      alert(`Open file not available.\n\nPath: ${file.path}`)
    }
  }

  const handleRevealInFolder = (file: TorrentFileInfo) => {
    if (props.onRevealInFolder) {
      props.onRevealInFolder(props.torrentHash, file)
    } else {
      alert(`Reveal in folder not available.\n\nPath: ${file.path}`)
    }
  }

  const handleCopyFilePath = (file: TorrentFileInfo) => {
    if (props.onCopyFilePath) {
      props.onCopyFilePath(props.torrentHash, file)
    } else {
      alert(`Copy file path not available.\n\nPath: ${file.path}`)
    }
  }

  const handleSetFilePriorityForSelected = (priority: number) => {
    if (!props.onSetFilePriority) return

    const torrent = getTorrent()
    const selectedKeys = props.getSelectedKeys?.() ?? new Set<string>()
    const selectedFiles = torrent?.files.filter((f) => selectedKeys.has(String(f.index))) ?? []

    for (const file of selectedFiles) {
      // Skip completed files when trying to skip
      if (priority === 1 && file.isComplete) continue
      props.onSetFilePriority(props.torrentHash, file.index, priority)
    }
  }

  const handleContextMenuSelect = (id: string) => {
    if (!contextMenu) return
    const file = contextMenu.file

    switch (id) {
      case 'open':
        handleOpenFile(file)
        break
      case 'open-folder':
        handleRevealInFolder(file)
        break
      case 'copy-path':
        handleCopyFilePath(file)
        break
      case 'high-priority':
        handleSetFilePriorityForSelected(2) // 2 = high
        break
      case 'skip':
        handleSetFilePriorityForSelected(1) // 1 = skip
        break
      case 'unskip':
        handleSetFilePriorityForSelected(0) // 0 = normal
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
        getSelectedKeys={props.getSelectedKeys}
        onSelectionChange={props.onSelectionChange}
        onRowContextMenu={handleContextMenu}
        onRowDoubleClick={handleOpenFile}
        refreshKey={props.torrentHash}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onSelect={handleContextMenuSelect}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}
