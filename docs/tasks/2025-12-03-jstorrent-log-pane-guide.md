# JSTorrent Log Pane Guide

## Overview

Add a "Logs" tab to the DetailPane showing engine logs in a virtualized table. Uses the existing VirtualTable infrastructure with event-driven updates.

**Features:**
- Level filter dropdown (Debug, Info, Warn, Error)
- Text search filter
- Clear button
- Auto-scroll when at bottom
- Row coloring by log level

---

## Phase 1: Update LogStore

### 1.1 Update packages/engine/src/logging/logger.ts

Replace the `LogEntry` interface and `LogStore` class:

```ts
export interface LogEntry {
  id: number
  timestamp: number
  level: LogLevel
  message: string
  args: unknown[]
}

type LogListener = (entry: LogEntry) => void

export class LogStore {
  private logs: LogEntry[] = []
  private maxLogs: number = 1000
  private nextId: number = 0
  private listeners: Set<LogListener> = new Set()

  add(level: LogLevel, message: string, args: unknown[]): void {
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      level,
      message,
      args,
    }
    this.logs.push(entry)

    // Bulk truncate when 50% over capacity
    if (this.logs.length > this.maxLogs * 1.5) {
      this.logs = this.logs.slice(-this.maxLogs)
    }

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(entry)
      } catch (e) {
        console.error('Log listener error:', e)
      }
    }
  }

  getEntries(): LogEntry[] {
    return this.logs
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  clear(): void {
    this.logs = []
    // Note: don't reset nextId to keep keys unique
  }

  get size(): number {
    return this.logs.length
  }
}

export const globalLogStore = new LogStore()
```

### 1.2 Delete RingBufferLogger

Delete the file `packages/engine/src/logging/ring-buffer-logger.ts`.

Update `packages/engine/src/index.ts` to remove any RingBufferLogger exports if present.

---

## Phase 2: Add LogStore to Adapter

### 2.1 Update packages/client/src/adapters/types.ts

Add to `EngineAdapter` interface:

```ts
import { BtEngine, Torrent, LogStore } from '@jstorrent/engine'

export interface EngineAdapter {
  // ... existing methods ...

  /** Get the log store for viewing logs */
  getLogStore(): LogStore
}
```

### 2.2 Update DirectEngineAdapter

```ts
import { BtEngine, Torrent, globalLogStore, LogStore } from '@jstorrent/engine'

export class DirectEngineAdapter implements EngineAdapter {
  // ... existing methods ...

  getLogStore(): LogStore {
    return globalLogStore
  }
}
```

### 2.3 Export LogStore from engine

In `packages/engine/src/index.ts`, ensure these are exported:

```ts
export { LogStore, LogEntry, LogLevel, globalLogStore } from './logging/logger'
```

---

## Phase 3: Create LogTable Component

### 3.1 Create packages/ui/src/tables/LogTable.solid.tsx

```tsx
/** @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup, createMemo, For } from 'solid-js'
import type { LogEntry, LogLevel, LogStore } from '@jstorrent/engine'

export interface LogTableProps {
  logStore: LogStore
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + '.' + String(date.getMilliseconds()).padStart(3, '0')
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return ''
  try {
    return ' ' + args.map(a => 
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ')
  } catch {
    return ''
  }
}

const ROW_HEIGHT = 22

export function LogTable(props: LogTableProps) {
  const [entries, setEntries] = createSignal<LogEntry[]>(props.logStore.getEntries())
  const [levelFilter, setLevelFilter] = createSignal<LogLevel>('info')
  const [searchFilter, setSearchFilter] = createSignal('')
  const [scrollTop, setScrollTop] = createSignal(0)
  
  let containerRef: HTMLDivElement | undefined
  let wasAtBottom = true

  // Subscribe to new logs
  onMount(() => {
    const unsubscribe = props.logStore.subscribe(() => {
      // Check if scrolled to bottom before updating
      if (containerRef) {
        const { scrollTop, scrollHeight, clientHeight } = containerRef
        wasAtBottom = scrollTop + clientHeight >= scrollHeight - 10
      }
      
      setEntries([...props.logStore.getEntries()])
      
      // Auto-scroll if was at bottom
      if (wasAtBottom && containerRef) {
        requestAnimationFrame(() => {
          if (containerRef) {
            containerRef.scrollTop = containerRef.scrollHeight
          }
        })
      }
    })
    onCleanup(unsubscribe)
  })

  const filteredEntries = createMemo(() => {
    const level = levelFilter()
    const search = searchFilter().toLowerCase()
    const minPriority = LEVEL_PRIORITY[level]

    return entries().filter(entry => {
      if (LEVEL_PRIORITY[entry.level] < minPriority) return false
      if (search && !entry.message.toLowerCase().includes(search)) return false
      return true
    })
  })

  // Virtual scrolling
  const visibleRange = createMemo(() => {
    const filtered = filteredEntries()
    const top = scrollTop()
    const viewportHeight = containerRef?.clientHeight ?? 400
    
    const startIndex = Math.floor(top / ROW_HEIGHT)
    const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 1
    const endIndex = Math.min(startIndex + visibleCount, filtered.length)
    
    return { startIndex, endIndex, totalHeight: filtered.length * ROW_HEIGHT }
  })

  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement
    setScrollTop(target.scrollTop)
  }

  const handleClear = () => {
    props.logStore.clear()
    setEntries([])
  }

  const levelColor = (level: LogLevel): string => {
    switch (level) {
      case 'error': return 'var(--log-error-bg, #ffebee)'
      case 'warn': return 'var(--log-warn-bg, #fff3e0)'
      default: return 'transparent'
    }
  }

  const levelTextColor = (level: LogLevel): string => {
    switch (level) {
      case 'error': return 'var(--log-error-text, #c62828)'
      case 'warn': return 'var(--log-warn-text, #ef6c00)'
      case 'debug': return 'var(--log-debug-text, #9e9e9e)'
      default: return 'var(--text-primary)'
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', "flex-direction": 'column' }}>
      {/* Filter bar */}
      <div style={{
        display: 'flex',
        gap: '12px',
        padding: '8px 12px',
        "border-bottom": '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        "align-items": 'center',
        "flex-shrink": 0,
      }}>
        <label style={{ display: 'flex', "align-items": 'center', gap: '6px', "font-size": '12px' }}>
          Level:
          <select
            value={levelFilter()}
            onChange={(e) => setLevelFilter(e.target.value as LogLevel)}
            style={{
              padding: '4px 8px',
              "border-radius": '4px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              "font-size": '12px',
            }}
          >
            <For each={LEVELS}>
              {(level) => (
                <option value={level}>{level.charAt(0).toUpperCase() + level.slice(1)}</option>
              )}
            </For>
          </select>
        </label>

        <label style={{ display: 'flex', "align-items": 'center', gap: '6px', "font-size": '12px', flex: 1 }}>
          Search:
          <input
            type="text"
            value={searchFilter()}
            onInput={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter messages..."
            style={{
              padding: '4px 8px',
              "border-radius": '4px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              "font-size": '12px',
              flex: 1,
              "max-width": '300px',
            }}
          />
        </label>

        <button
          onClick={handleClear}
          style={{
            padding: '4px 12px',
            "border-radius": '4px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            "font-size": '12px',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>

        <span style={{ "font-size": '11px', color: 'var(--text-secondary)' }}>
          {filteredEntries().length} / {entries().length}
        </span>
      </div>

      {/* Header */}
      <div style={{
        display: 'flex',
        "border-bottom": '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        "font-size": '11px',
        "font-weight": 600,
        color: 'var(--text-secondary)',
        "flex-shrink": 0,
      }}>
        <div style={{ width: '85px', padding: '6px 8px', "flex-shrink": 0 }}>Time</div>
        <div style={{ width: '55px', padding: '6px 8px', "flex-shrink": 0 }}>Level</div>
        <div style={{ flex: 1, padding: '6px 8px' }}>Message</div>
      </div>

      {/* Virtualized rows */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          "font-family": 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          "font-size": '11px',
        }}
      >
        <div style={{ height: `${visibleRange().totalHeight}px`, position: 'relative' }}>
          <For each={filteredEntries().slice(visibleRange().startIndex, visibleRange().endIndex)}>
            {(entry, index) => (
              <div
                style={{
                  position: 'absolute',
                  top: `${(visibleRange().startIndex + index()) * ROW_HEIGHT}px`,
                  left: 0,
                  right: 0,
                  height: `${ROW_HEIGHT}px`,
                  display: 'flex',
                  "align-items": 'center',
                  "border-bottom": '1px solid var(--border-color-subtle, #eee)',
                  background: levelColor(entry.level),
                }}
              >
                <div style={{
                  width: '85px',
                  padding: '0 8px',
                  "flex-shrink": 0,
                  color: 'var(--text-secondary)',
                }}>
                  {formatTime(entry.timestamp)}
                </div>
                <div style={{
                  width: '55px',
                  padding: '0 8px',
                  "flex-shrink": 0,
                  "font-weight": 500,
                  "text-transform": 'uppercase',
                  color: levelTextColor(entry.level),
                }}>
                  {entry.level}
                </div>
                <div style={{
                  flex: 1,
                  padding: '0 8px',
                  overflow: 'hidden',
                  "text-overflow": 'ellipsis',
                  "white-space": 'nowrap',
                  color: levelTextColor(entry.level),
                }}>
                  {entry.message}{formatArgs(entry.args)}
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
```

---

## Phase 4: Create React Wrapper

### 4.1 Create packages/ui/src/tables/LogTableWrapper.tsx

```tsx
import React, { useRef, useEffect, useState } from 'react'
import { render } from 'solid-js/web'
import { LogTable } from './LogTable.solid'
import type { LogStore } from '@jstorrent/engine'

export interface LogTableWrapperProps {
  logStore: LogStore
}

export function LogTableWrapper({ logStore }: LogTableWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return

    const dispose = render(
      () => <LogTable logStore={logStore} />,
      containerRef.current
    )
    setMounted(true)

    return () => dispose()
  }, [logStore])

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        width: '100%',
        opacity: mounted ? 1 : 0,
      }}
    />
  )
}
```

---

## Phase 5: Add Log Tab to DetailPane

### 5.1 Update packages/ui/src/components/DetailPane.tsx

Add import:

```tsx
import { LogTableWrapper } from '../tables/LogTableWrapper'
```

Update DetailTab type:

```tsx
export type DetailTab = 'peers' | 'pieces' | 'files' | 'general' | 'logs'
```

Update TorrentSource interface to include log store access:

```tsx
import type { LogStore } from '@jstorrent/engine'

interface TorrentSource {
  readonly torrents: Torrent[]
  getTorrent(hash: string): Torrent | undefined
  getLogStore(): LogStore
}
```

Add the Logs tab button after General:

```tsx
<button
  style={activeTab === 'logs' ? activeTabStyle : tabStyle}
  onClick={() => setActiveTab('logs')}
>
  Logs
</button>
```

Add the Logs tab content:

```tsx
{activeTab === 'logs' && <LogTableWrapper logStore={props.source.getLogStore()} />}
```

---

## Phase 6: Add CSS Variables

Add to `packages/ui/src/styles.css`:

```css
:root {
  /* Log level colors */
  --log-error-bg: #ffebee;
  --log-error-text: #c62828;
  --log-warn-bg: #fff3e0;
  --log-warn-text: #ef6c00;
  --log-debug-text: #9e9e9e;
  --border-color-subtle: #f0f0f0;
}

/* Dark mode overrides if you have them */
@media (prefers-color-scheme: dark) {
  :root {
    --log-error-bg: #2d1f1f;
    --log-error-text: #ff8a80;
    --log-warn-bg: #2d2a1f;
    --log-warn-text: #ffb74d;
    --log-debug-text: #757575;
    --border-color-subtle: #333;
  }
}
```

---

## Phase 7: Update Exports

### 7.1 Update packages/ui/src/index.ts

```tsx
export { LogTable } from './tables/LogTable.solid'
export { LogTableWrapper } from './tables/LogTableWrapper'
```

---

## Verification

```bash
cd extension && pnpm dev:web
```

1. Open http://local.jstorrent.com:3001/src/ui/app.html
2. Add a torrent
3. Select the torrent
4. Click the "Logs" tab
5. Verify:
   - Logs appear and scroll
   - Level dropdown filters correctly
   - Search filters messages
   - Clear button wipes logs
   - Auto-scroll works when at bottom
   - Scrolling up disables auto-scroll
   - Error rows have red tint
   - Warning rows have orange tint

---

## Checklist

### Phase 1: Update LogStore
- [ ] Add `id` field to LogEntry
- [ ] Replace LogStore with bulk-truncate version
- [ ] Add `subscribe()` method
- [ ] Delete ring-buffer-logger.ts

### Phase 2: Add to Adapter
- [ ] Add `getLogStore()` to EngineAdapter interface
- [ ] Implement in DirectEngineAdapter
- [ ] Export LogStore types from engine

### Phase 3: Create LogTable
- [ ] Create LogTable.solid.tsx with virtualization

### Phase 4: Create Wrapper
- [ ] Create LogTableWrapper.tsx for React integration

### Phase 5: Add to DetailPane
- [ ] Update DetailTab type
- [ ] Update TorrentSource interface
- [ ] Add Logs tab button
- [ ] Add Logs tab content

### Phase 6: Styling
- [ ] Add log level CSS variables

### Phase 7: Exports
- [ ] Export LogTable and LogTableWrapper

---

## Notes

**Log Tab vs Torrent Selection:**
The Logs tab shows all engine logs, not torrent-specific logs. It shows regardless of torrent selection. This is different from other tabs that show torrent-specific data.

If torrent-specific log filtering is desired later, we can filter by parsing the `[Torrent:hash]` prefix in messages or by enriching LogEntry with structured component data.

**Performance:**
- LogStore caps at 1000 entries with bulk truncation
- Virtual scrolling only renders ~20-30 visible rows
- Event-driven updates (no polling)
- Filtering is memoized

**Future Enhancements:**
- Component filter dropdown (requires enriching LogEntry)
- Copy log entry to clipboard
- Export logs to file
- Torrent-specific log filtering
