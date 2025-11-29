# RingBufferLogger and Extension UI Integration

## Overview

Create a RingBufferLogger for the engine that the extension UI can subscribe to for displaying real-time logs. The engine already has `onLog` callback support - we need to build on this.

## Background

The engine already has:
- `LogEntry` interface in `src/logging/logger.ts`
- `onLog?: (entry: LogEntry) => void` in BtEngineOptions
- `LogStore` class (basic implementation, shifts array when full - inefficient)

We need:
1. Efficient ring buffer implementation
2. Subscription/listener support for UI updates
3. Filtering capability for UI display
4. Extension UI integration

## Task 1: Create RingBufferLogger

**Create file**: `packages/engine/src/logging/ring-buffer-logger.ts`

```typescript
import { LogEntry, LogLevel } from './logger'

export interface LogFilter {
  level?: LogLevel
  component?: string
  search?: string
}

type LogListener = (entry: LogEntry) => void

/**
 * Efficient circular buffer for storing log entries.
 * New entries overwrite oldest when buffer is full.
 */
export class RingBufferLogger {
  private buffer: (LogEntry | null)[]
  private head: number = 0  // Next write position
  private count: number = 0 // Number of entries (up to capacity)
  private listeners: Set<LogListener> = new Set()

  constructor(private capacity: number = 500) {
    this.buffer = new Array(capacity).fill(null)
  }

  /**
   * Add a log entry to the buffer.
   * Called by the onLog callback from BtEngine.
   */
  add(entry: LogEntry): void {
    this.buffer[this.head] = entry
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) {
      this.count++
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

  /**
   * Get all entries, optionally filtered.
   * Returns entries in chronological order (oldest first).
   */
  getEntries(filter?: LogFilter): LogEntry[] {
    const entries: LogEntry[] = []
    
    // Calculate start position (oldest entry)
    const start = this.count < this.capacity ? 0 : this.head
    
    for (let i = 0; i < this.count; i++) {
      const index = (start + i) % this.capacity
      const entry = this.buffer[index]
      if (entry && this.matchesFilter(entry, filter)) {
        entries.push(entry)
      }
    }
    
    return entries
  }

  /**
   * Get recent entries (newest first), with optional limit.
   */
  getRecent(limit: number = 50, filter?: LogFilter): LogEntry[] {
    const all = this.getEntries(filter)
    return all.slice(-limit).reverse()
  }

  /**
   * Subscribe to new log entries.
   * Returns unsubscribe function.
   */
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.buffer = new Array(this.capacity).fill(null)
    this.head = 0
    this.count = 0
  }

  /**
   * Get current entry count.
   */
  get size(): number {
    return this.count
  }

  private matchesFilter(entry: LogEntry, filter?: LogFilter): boolean {
    if (!filter) return true

    // Level filter
    if (filter.level) {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
      const minLevel = levels.indexOf(filter.level)
      const entryLevel = levels.indexOf(entry.level)
      if (entryLevel < minLevel) return false
    }

    // Component filter (check if message starts with component prefix)
    if (filter.component) {
      // Messages are prefixed like "[Client:abc1:Torrent[def2]]"
      if (!entry.message.toLowerCase().includes(filter.component.toLowerCase())) {
        return false
      }
    }

    // Search filter
    if (filter.search) {
      const searchLower = filter.search.toLowerCase()
      const messageLower = entry.message.toLowerCase()
      const argsStr = JSON.stringify(entry.args).toLowerCase()
      if (!messageLower.includes(searchLower) && !argsStr.includes(searchLower)) {
        return false
      }
    }

    return true
  }
}
```

## Task 2: Add Unit Tests

**Create file**: `packages/engine/test/logging/ring-buffer-logger.spec.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RingBufferLogger } from '../../src/logging/ring-buffer-logger'
import { LogEntry } from '../../src/logging/logger'

function makeEntry(level: 'debug' | 'info' | 'warn' | 'error', message: string): LogEntry {
  return { timestamp: Date.now(), level, message, args: [] }
}

describe('RingBufferLogger', () => {
  let logger: RingBufferLogger

  beforeEach(() => {
    logger = new RingBufferLogger(5) // Small capacity for testing
  })

  it('should store entries', () => {
    logger.add(makeEntry('info', 'test message'))
    expect(logger.size).toBe(1)
    expect(logger.getEntries()).toHaveLength(1)
  })

  it('should return entries in chronological order', () => {
    logger.add(makeEntry('info', 'first'))
    logger.add(makeEntry('info', 'second'))
    logger.add(makeEntry('info', 'third'))

    const entries = logger.getEntries()
    expect(entries[0].message).toBe('first')
    expect(entries[1].message).toBe('second')
    expect(entries[2].message).toBe('third')
  })

  it('should wrap around when capacity is reached', () => {
    // Fill buffer
    for (let i = 0; i < 5; i++) {
      logger.add(makeEntry('info', `entry-${i}`))
    }
    expect(logger.size).toBe(5)

    // Add more - should overwrite oldest
    logger.add(makeEntry('info', 'entry-5'))
    logger.add(makeEntry('info', 'entry-6'))

    expect(logger.size).toBe(5)
    const entries = logger.getEntries()
    expect(entries[0].message).toBe('entry-2') // Oldest remaining
    expect(entries[4].message).toBe('entry-6') // Newest
  })

  it('should filter by level', () => {
    logger.add(makeEntry('debug', 'debug msg'))
    logger.add(makeEntry('info', 'info msg'))
    logger.add(makeEntry('warn', 'warn msg'))
    logger.add(makeEntry('error', 'error msg'))

    const warnAndAbove = logger.getEntries({ level: 'warn' })
    expect(warnAndAbove).toHaveLength(2)
    expect(warnAndAbove[0].level).toBe('warn')
    expect(warnAndAbove[1].level).toBe('error')
  })

  it('should filter by search term', () => {
    logger.add(makeEntry('info', 'connecting to peer'))
    logger.add(makeEntry('info', 'downloading piece'))
    logger.add(makeEntry('info', 'peer disconnected'))

    const peerLogs = logger.getEntries({ search: 'peer' })
    expect(peerLogs).toHaveLength(2)
  })

  it('should return recent entries in reverse order', () => {
    logger.add(makeEntry('info', 'first'))
    logger.add(makeEntry('info', 'second'))
    logger.add(makeEntry('info', 'third'))

    const recent = logger.getRecent(2)
    expect(recent).toHaveLength(2)
    expect(recent[0].message).toBe('third')  // Newest first
    expect(recent[1].message).toBe('second')
  })

  it('should notify subscribers on new entries', () => {
    const listener = vi.fn()
    logger.subscribe(listener)

    const entry = makeEntry('info', 'test')
    logger.add(entry)

    expect(listener).toHaveBeenCalledWith(entry)
  })

  it('should allow unsubscribing', () => {
    const listener = vi.fn()
    const unsubscribe = logger.subscribe(listener)

    logger.add(makeEntry('info', 'first'))
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    logger.add(makeEntry('info', 'second'))
    expect(listener).toHaveBeenCalledTimes(1) // Not called again
  })

  it('should handle listener errors gracefully', () => {
    const badListener = vi.fn(() => { throw new Error('oops') })
    const goodListener = vi.fn()

    logger.subscribe(badListener)
    logger.subscribe(goodListener)

    // Should not throw, and good listener should still be called
    expect(() => logger.add(makeEntry('info', 'test'))).not.toThrow()
    expect(goodListener).toHaveBeenCalled()
  })

  it('should clear all entries', () => {
    logger.add(makeEntry('info', 'test'))
    logger.add(makeEntry('info', 'test2'))
    expect(logger.size).toBe(2)

    logger.clear()
    expect(logger.size).toBe(0)
    expect(logger.getEntries()).toHaveLength(0)
  })
})
```

## Task 3: Export from Engine Package

**Update file**: `packages/engine/src/index.ts`

Add export for RingBufferLogger:

```typescript
// Logging
export type { Logger, LogEntry, LogLevel } from './logging/logger'
export { defaultLogger } from './logging/logger'
export { RingBufferLogger } from './logging/ring-buffer-logger'
export type { LogFilter } from './logging/ring-buffer-logger'
```

## Task 4: Update Extension Client to Use RingBufferLogger

**Update file**: `extension/src/lib/client.ts`

```typescript
import { INativeHostConnection, DaemonInfo } from './native-connection'
import { ISockets } from './sockets'
import {
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  BtEngine,
  StorageRootManager,
  MemorySessionStore,
  RingBufferLogger,
  LogEntry,
} from '@jstorrent/engine'

export class Client {
  private native: INativeHostConnection
  private sockets: ISockets | null = null
  public engine: BtEngine | undefined
  public ready = false
  public daemonInfo: DaemonInfo | undefined
  public logBuffer: RingBufferLogger = new RingBufferLogger(500)

  constructor(native: INativeHostConnection) {
    this.native = native
  }

  async ensureDaemonReady(): Promise<ISockets> {
    if (this.ready && this.sockets) return this.sockets

    console.log('Ensuring daemon is ready...')
    await this.native.connect()

    const installId = await this.getInstallId()

    // Send handshake to get DaemonInfo
    this.native.send({
      op: 'handshake',
      extensionId: chrome.runtime.id,
      installId,
      id: crypto.randomUUID(),
    })

    const daemonInfo = await this.waitForDaemonInfo()
    console.log('Received DaemonInfo:', daemonInfo)
    this.daemonInfo = daemonInfo

    const conn = new DaemonConnection(daemonInfo.port, daemonInfo.token)
    const factory = new DaemonSocketFactory(conn)
    const store = new MemorySessionStore()

    // Create StorageRootManager
    const srm = new StorageRootManager((root) => new DaemonFileSystem(conn, root.token))
    
    // TODO: Register actual roots from daemonInfo when available
    // For now, use a default root
    srm.addRoot({
      token: 'default',
      label: 'Downloads',
      path: '/downloads',
    })
    srm.setDefaultRoot('default')

    console.log('Components created', factory, srm, store)

    // Create engine with log callback
    this.engine = new BtEngine({
      socketFactory: factory,
      storageRootManager: srm,
      sessionStore: store,
      onLog: (entry: LogEntry) => {
        this.logBuffer.add(entry)
      },
    })

    console.log('Daemon Engine initialized')

    this.sockets = this.engine.socketFactory as unknown as ISockets
    this.ready = true

    return this.sockets!
  }

  // ... rest of the class unchanged
}
```

## Task 5: Create Log Viewer Component for Extension UI

**Create file**: `extension/src/ui/components/LogViewer.tsx`

```typescript
import React, { useEffect, useState, useRef } from 'react'
import { LogEntry, LogLevel, LogFilter } from '@jstorrent/engine'

interface LogViewerProps {
  getLogBuffer: () => { 
    getRecent: (limit: number, filter?: LogFilter) => LogEntry[]
    subscribe: (listener: (entry: LogEntry) => void) => () => void 
  } | null
}

const levelColors: Record<LogLevel, string> = {
  debug: '#888',
  info: '#2196F3',
  warn: '#FF9800',
  error: '#F44336',
}

export const LogViewer: React.FC<LogViewerProps> = ({ getLogBuffer }) => {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<LogFilter>({ level: 'info' })
  const [autoScroll, setAutoScroll] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const logBuffer = getLogBuffer()
    if (!logBuffer) return

    // Load initial entries
    setEntries(logBuffer.getRecent(100, filter))

    // Subscribe to new entries
    const unsubscribe = logBuffer.subscribe((entry) => {
      setEntries((prev) => {
        // Check if entry matches filter
        if (filter.level) {
          const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
          if (levels.indexOf(entry.level) < levels.indexOf(filter.level)) {
            return prev
          }
        }
        // Keep last 100 entries
        const updated = [...prev, entry]
        if (updated.length > 100) {
          return updated.slice(-100)
        }
        return updated
      })
    })

    return unsubscribe
  }, [getLogBuffer, filter])

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [entries, autoScroll])

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts)
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      fractionalSecondDigits: 3 
    })
  }

  const formatArgs = (args: unknown[]): string => {
    if (args.length === 0) return ''
    return args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      }
      return String(arg)
    }).join(' ')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Controls */}
      <div style={{ 
        padding: '8px', 
        borderBottom: '1px solid #ccc',
        display: 'flex',
        gap: '16px',
        alignItems: 'center'
      }}>
        <label>
          Level:
          <select 
            value={filter.level || 'debug'} 
            onChange={(e) => setFilter({ ...filter, level: e.target.value as LogLevel })}
            style={{ marginLeft: '8px' }}
          >
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </label>
        
        <label>
          <input 
            type="checkbox" 
            checked={autoScroll} 
            onChange={(e) => setAutoScroll(e.target.checked)} 
          />
          Auto-scroll
        </label>

        <button onClick={() => setEntries([])}>Clear</button>
      </div>

      {/* Log entries */}
      <div 
        ref={containerRef}
        style={{ 
          flex: 1, 
          overflow: 'auto', 
          fontFamily: 'monospace', 
          fontSize: '12px',
          backgroundColor: '#1e1e1e',
          color: '#d4d4d4',
          padding: '8px'
        }}
      >
        {entries.length === 0 ? (
          <div style={{ color: '#888', padding: '16px' }}>
            No log entries yet...
          </div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} style={{ 
              padding: '2px 0',
              borderBottom: '1px solid #333'
            }}>
              <span style={{ color: '#888' }}>{formatTimestamp(entry.timestamp)}</span>
              {' '}
              <span style={{ 
                color: levelColors[entry.level],
                fontWeight: entry.level === 'error' ? 'bold' : 'normal'
              }}>
                [{entry.level.toUpperCase().padEnd(5)}]
              </span>
              {' '}
              <span>{entry.message}</span>
              {entry.args.length > 0 && (
                <span style={{ color: '#888' }}> {formatArgs(entry.args)}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

## Task 6: Integrate LogViewer into Extension App

**Update file**: `extension/src/ui/app.tsx`

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { useEffect, useState, useCallback } from 'react'
import { LogViewer } from './components/LogViewer'

interface TorrentEvent {
  event: string
  timestamp: string
  [key: string]: unknown
}

export const App = () => {
  const [events, setEvents] = useState<TorrentEvent[]>([])
  const [activeTab, setActiveTab] = useState<'torrents' | 'logs'>('logs')

  useEffect(() => {
    const handleMessage = (message: TorrentEvent) => {
      console.log('UI received message:', message)
      if (message.event === 'magnetAdded' || message.event === 'torrentAdded') {
        setEvents((prev) => [...prev, { ...message, timestamp: new Date().toISOString() }])
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  // Get log buffer from service worker client
  const getLogBuffer = useCallback(() => {
    // Access the service worker's client object
    // This requires the service worker to expose the client on self
    const sw = (navigator as any).serviceWorker?.controller
    if (!sw) {
      // Fallback: try to get from global if we're in the service worker context
      // @ts-expect-error - client may be exposed on self
      if (typeof self !== 'undefined' && self.client?.logBuffer) {
        // @ts-expect-error
        return self.client.logBuffer
      }
      return null
    }
    // For now, return null - we'll need to implement message passing
    // to get logs from service worker to UI
    return null
  }, [])

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100vh',
      fontFamily: 'sans-serif' 
    }}>
      {/* Header */}
      <div style={{ 
        padding: '12px 20px', 
        borderBottom: '1px solid #ccc',
        display: 'flex',
        alignItems: 'center',
        gap: '20px'
      }}>
        <h1 style={{ margin: 0, fontSize: '20px' }}>JSTorrent</h1>
        
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={() => setActiveTab('torrents')}
            style={{ 
              padding: '8px 16px',
              background: activeTab === 'torrents' ? '#2196F3' : '#eee',
              color: activeTab === 'torrents' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Torrents
          </button>
          <button 
            onClick={() => setActiveTab('logs')}
            style={{ 
              padding: '8px 16px',
              background: activeTab === 'logs' ? '#2196F3' : '#eee',
              color: activeTab === 'logs' ? 'white' : 'black',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Logs
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'torrents' && (
          <div style={{ padding: '20px' }}>
            <h2>Torrents</h2>
            {events.length === 0 ? (
              <p>No torrents yet. Add a magnet link to get started.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {events.map((event, i) => (
                  <li
                    key={i}
                    style={{
                      border: '1px solid #ccc',
                      margin: '10px 0',
                      padding: '10px',
                      borderRadius: '4px',
                    }}
                  >
                    <div><strong>Event:</strong> {event.event}</div>
                    <div><strong>Time:</strong> {event.timestamp}</div>
                    <pre style={{ background: '#f0f0f0', padding: '10px', overflowX: 'auto' }}>
                      {JSON.stringify(event, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <LogViewer getLogBuffer={getLogBuffer} />
        )}
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

## Task 7: Add Message Passing for Logs (Service Worker to UI)

The UI runs in a separate context from the service worker. We need message passing to get logs.

**Update file**: `extension/src/sw.ts` (or wherever the service worker is)

Add this after client is initialized:

```typescript
// Handle requests for log entries from UI
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_LOGS') {
    const entries = client.logBuffer.getRecent(message.limit || 100, message.filter)
    sendResponse({ entries })
    return true // Keep channel open for async response
  }
  
  if (message.type === 'SUBSCRIBE_LOGS') {
    // For real-time updates, we'll use a port
    // This is a simplified version - just return recent
    sendResponse({ ok: true })
    return true
  }
})

// Forward new log entries to UI via broadcast
client.logBuffer.subscribe((entry) => {
  chrome.runtime.sendMessage({ type: 'LOG_ENTRY', entry }).catch(() => {
    // UI might not be open, ignore errors
  })
})
```

**Update LogViewer to use message passing**:

```typescript
// In LogViewer.tsx, update the useEffect:

useEffect(() => {
  // Request initial logs
  chrome.runtime.sendMessage(
    { type: 'GET_LOGS', limit: 100, filter },
    (response) => {
      if (response?.entries) {
        setEntries(response.entries.reverse()) // Reverse to show newest last
      }
    }
  )

  // Listen for new log entries
  const handleMessage = (message: any) => {
    if (message.type === 'LOG_ENTRY') {
      setEntries((prev) => {
        const updated = [...prev, message.entry]
        if (updated.length > 100) {
          return updated.slice(-100)
        }
        return updated
      })
    }
  }

  chrome.runtime.onMessage.addListener(handleMessage)
  return () => chrome.runtime.onMessage.removeListener(handleMessage)
}, [filter])
```

## Verification

After completing all tasks:

```bash
# Run engine tests
cd packages/engine
pnpm test

# Build extension
cd ../extension
pnpm build

# Run extension e2e tests
pnpm test:e2e
```

Then manually test:
1. Load extension in Chrome
2. Open extension popup/page
3. Click "Logs" tab
4. Add a torrent via magnet link
5. Verify logs appear in real-time

## Summary of Files

**New files:**
- `packages/engine/src/logging/ring-buffer-logger.ts`
- `packages/engine/test/logging/ring-buffer-logger.spec.ts`
- `extension/src/ui/components/LogViewer.tsx`

**Modified files:**
- `packages/engine/src/index.ts` (add exports)
- `extension/src/lib/client.ts` (add logBuffer)
- `extension/src/ui/app.tsx` (add tabs and LogViewer)
- `extension/src/sw.ts` (add message handlers)
