# JSTorrent Files Table Guide

## Overview

Add a Files table to the DetailPane showing all files in the selected torrent with progress information and a context menu for file actions.

**Features:**
- Columns: Name, Size, Progress, Done
- Context menu: Open, Open Containing Folder (not implemented yet)
- Uses existing VirtualTable infrastructure
- Updates when pieces complete

**Existing infrastructure:**
- `TorrentFileInfo` class with `path`, `length`, `downloaded`, `progress`, `isComplete`
- `torrent.files` returns `TorrentFileInfo[]`
- `ContextMenu` component for right-click menus
- `TableMount` for React-Solid bridging

---

## Phase 1: Create FileTable Component

### 1.1 Create packages/ui/src/tables/FileTable.tsx

```tsx
import React, { useState } from 'react'
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

/** Extract filename from path */
function getFileName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
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
        getRowKey={(f) => f.path}
        columns={fileColumns}
        storageKey="files"
        rowHeight={24}
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
```

---

## Phase 2: Update DetailPane

### 2.1 Update packages/ui/src/components/DetailPane.tsx

Add the FileTable import at the top:

```tsx
import { FileTable } from '../tables/FileTable'
```

Replace the Files tab content. Find this section:

```tsx
{activeTab === 'files' && renderTorrentContent(
  <div style={{ padding: 20, color: 'var(--text-secondary)' }}>Files table coming soon</div>,
  'files'
)}
```

Replace with:

```tsx
{activeTab === 'files' && renderTorrentContent(
  <FileTable source={props.source} torrentHash={selectedHash!} />,
  'files'
)}
```

---

## Phase 3: Export FileTable

### 3.1 Update packages/ui/src/index.ts

Add the export:

```tsx
export { FileTable } from './tables/FileTable'
export type { FileTableProps } from './tables/FileTable'
```

---

## Phase 4: Verification

```bash
cd extension && pnpm dev:web
```

1. Open http://local.jstorrent.com:3001/src/ui/app.html
2. Add a torrent (preferably one with multiple files)
3. Select the torrent
4. Click the "Files" tab
5. Verify:
   - All files are listed with name, size, progress, done columns
   - Progress updates as pieces complete
   - Right-click shows context menu with "Open" and "Open Containing Folder"
   - Context menu items show "Coming soon" alert
   - Double-click also shows "Coming soon" alert
   - Column resize/reorder/hide works
   - Settings gear menu works

---

## Checklist

- [ ] Create `packages/ui/src/tables/FileTable.tsx`
- [ ] Update `DetailPane.tsx` to use FileTable
- [ ] Export FileTable from `packages/ui/src/index.ts`
- [ ] Verify table displays correctly
- [ ] Verify context menu appears on right-click
- [ ] Verify context menu items show alerts

---

## Future Enhancements

**Implement file actions:**
- Need native host support to open files/folders
- Add to adapter interface: `openFile(torrentHash: string, filePath: string)`
- Add to adapter interface: `openFolder(torrentHash: string, filePath: string)`

**File priority:**
- Add Priority column (High/Normal/Low/Skip)
- Context menu option to change priority
- Requires priority support in engine

**Progress bar visualization:**
- Render mini progress bar in the Progress column
- Could use inline SVG or CSS gradient

**Tree view:**
- Nested folder structure instead of flat paths
- Expand/collapse folders
- Would need significant refactoring

**File selection:**
- Track selected files
- Multi-select for batch priority changes
- Show selection state in UI
