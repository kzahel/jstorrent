# @jstorrent/ui

Presentational UI components for JSTorrent. High-performance virtualized tables using Solid.js, mountable from React.

## Architecture

```
React Shell (app.tsx)
    │
    ├── TorrentTable ──► TableMount ──► VirtualTable.solid.tsx
    │                         │
    └── DetailPane            └── Solid component with RAF loop
        ├── PeerTable              reads engine data every frame
        └── PieceTable
```

**Key principle:** React controls layout and which components exist. Solid controls live data display.

## File Conventions

- `*.tsx` - React components
- `*.solid.tsx` - Solid components (Vite routes these to solid-js compiler)

## Tables

All tables use a shared `VirtualTable.solid.tsx` core with different column definitions:

| Table | Data Source | Key |
|-------|-------------|-----|
| TorrentTable | `adapter.torrents` | `infoHashStr` |
| PeerTable | `torrent.peers` | `ip:port` |
| PieceTable | computed from `torrent.bitfield` | piece index |

### How RAF Updates Work

```tsx
// VirtualTable.solid.tsx
const [tick, forceUpdate] = createSignal({}, { equals: false })

const rows = () => {
  tick()  // Subscribe to RAF signal
  return props.getRows()  // Read fresh data from engine
}

onMount(() => {
  const loop = () => {
    forceUpdate({})  // Triggers re-read of rows()
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)
})
```

The signal must be **read** (not just set) for Solid to track dependencies.

### Column Config

Column visibility and widths persist to sessionStorage:

```
jstorrent:columns:torrents  → TorrentTable config
jstorrent:columns:peers     → PeerTable config
jstorrent:columns:pieces    → PieceTable config
```

## Components

### TorrentTable

```tsx
<TorrentTable
  source={adapter}              // Must have .torrents array
  selectedHashes={Set<string>}  // For highlight
  onSelectionChange={(hashes) => ...}
  onRowDoubleClick={(torrent) => ...}
/>
```

### DetailPane

```tsx
<DetailPane
  source={adapter}           // Must have .getTorrent(hash) method
  selectedHash={string|null} // Single selection only
/>
```

Shows tabs: Peers, Pieces, Files, Trackers

### TableMount (React → Solid bridge)

```tsx
<TableMount<T>
  getRows={() => data}        // Called every RAF frame
  getRowKey={(row) => string} // Unique key
  columns={ColumnDef<T>[]}    // Column definitions
  storageKey="name"           // For column config persistence
  rowHeight={28}              // Pixels
/>
```

## Adding a New Table

1. Create `packages/ui/src/tables/FooTable.tsx`:

```tsx
import { TableMount } from './mount'
import { ColumnDef } from './types'

const fooColumns: ColumnDef<FooData>[] = [
  { id: 'name', header: 'Name', getValue: (f) => f.name, width: 200 },
  // ...
]

export function FooTable(props: { source: FooSource }) {
  return (
    <TableMount<FooData>
      getRows={() => props.source.getFoos()}
      getRowKey={(f) => f.id}
      columns={fooColumns}
      storageKey="foos"
    />
  )
}
```

2. Export from `index.ts`
3. Add tab in `DetailPane.tsx`

## Utilities

```tsx
import { formatBytes, formatSpeed, formatPercent, formatDuration } from '@jstorrent/ui'

formatBytes(1536)      // "1.5 KB"
formatSpeed(1048576)   // "1.0 MB/s"
formatPercent(0.756)   // "75.6%"
```
