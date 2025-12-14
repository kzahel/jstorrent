/* eslint-disable @typescript-eslint/ban-ts-comment, react-hooks/refs */
// @ts-nocheck - Solid JSX is handled by vite-plugin-solid, not tsc
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
  return (
    date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) +
    '.' +
    String(date.getMilliseconds()).padStart(3, '0')
  )
}

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return ''
  try {
    return ' ' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
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

    // Scroll to bottom on initial mount (when switching to this tab)
    requestAnimationFrame(() => {
      if (containerRef) {
        containerRef.scrollTop = containerRef.scrollHeight
      }
    })
  })

  const filteredEntries = createMemo(() => {
    const level = levelFilter()
    const search = searchFilter().toLowerCase()
    const minPriority = LEVEL_PRIORITY[level]

    return entries().filter((entry) => {
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
      case 'error':
        return 'var(--log-error-bg, #ffebee)'
      case 'warn':
        return 'var(--log-warn-bg, #fff3e0)'
      default:
        return 'transparent'
    }
  }

  const levelTextColor = (level: LogLevel): string => {
    switch (level) {
      case 'error':
        return 'var(--log-error-text, #c62828)'
      case 'warn':
        return 'var(--log-warn-text, #ef6c00)'
      case 'debug':
        return 'var(--log-debug-text, #9e9e9e)'
      default:
        return 'var(--text-primary)'
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', 'flex-direction': 'column' }}>
      {/* Filter bar */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          padding: '8px 12px',
          'border-bottom': '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          'align-items': 'center',
          'flex-shrink': 0,
        }}
      >
        <label
          style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'font-size': '12px' }}
        >
          Level:
          <select
            value={levelFilter()}
            onChange={(e) => setLevelFilter(e.target.value as LogLevel)}
            style={{
              padding: '4px 8px',
              'border-radius': '4px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              'font-size': '12px',
            }}
          >
            <For each={LEVELS}>
              {(level) => (
                <option value={level}>{level.charAt(0).toUpperCase() + level.slice(1)}</option>
              )}
            </For>
          </select>
        </label>

        <label
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '6px',
            'font-size': '12px',
            flex: 1,
          }}
        >
          Search:
          <input
            type="text"
            value={searchFilter()}
            onInput={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter messages..."
            style={{
              padding: '4px 8px',
              'border-radius': '4px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              'font-size': '12px',
              flex: 1,
              'max-width': '300px',
            }}
          />
        </label>

        <button
          onClick={handleClear}
          style={{
            padding: '4px 12px',
            'border-radius': '4px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            'font-size': '12px',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>

        <span style={{ 'font-size': '11px', color: 'var(--text-secondary)' }}>
          {filteredEntries().length} / {entries().length}
        </span>
      </div>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          'border-bottom': '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          'font-size': '11px',
          'font-weight': 600,
          color: 'var(--text-secondary)',
          'flex-shrink': 0,
        }}
      >
        <div style={{ width: '85px', padding: '6px 8px', 'flex-shrink': 0 }}>Time</div>
        <div style={{ width: '55px', padding: '6px 8px', 'flex-shrink': 0 }}>Level</div>
        <div style={{ flex: 1, padding: '6px 8px' }}>Message</div>
      </div>

      {/* Virtualized rows */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          'font-family': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          'font-size': '11px',
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
                  'align-items': 'center',
                  'border-bottom': '1px solid var(--border-color-subtle, #eee)',
                  background: levelColor(entry.level),
                }}
              >
                <div
                  style={{
                    width: '85px',
                    padding: '0 8px',
                    'flex-shrink': 0,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {formatTime(entry.timestamp)}
                </div>
                <div
                  style={{
                    width: '55px',
                    padding: '0 8px',
                    'flex-shrink': 0,
                    'font-weight': 500,
                    'text-transform': 'uppercase',
                    color: levelTextColor(entry.level),
                  }}
                >
                  {entry.level}
                </div>
                <div
                  style={{
                    flex: 1,
                    padding: '0 8px',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'white-space': 'nowrap',
                    color: levelTextColor(entry.level),
                  }}
                >
                  {entry.message}
                  {formatArgs(entry.args)}
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
