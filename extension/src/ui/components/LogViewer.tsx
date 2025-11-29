import React, { useEffect, useState, useRef } from 'react'
import { LogEntry, LogLevel, LogFilter } from '@jstorrent/engine'


const levelColors: Record<LogLevel, string> = {
    debug: '#888',
    info: '#2196F3',
    warn: '#FF9800',
    error: '#F44336',
}

export const LogViewer: React.FC = () => {
    const [entries, setEntries] = useState<LogEntry[]>([])
    const [filter, setFilter] = useState<LogFilter>({ level: 'info' })
    const [autoScroll, setAutoScroll] = useState(true)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // Check if we are in a context that supports message passing (e.g. popup/page)
        // or if we have direct access to the buffer (e.g. debugging)
        // For now, we'll try message passing first as per plan

        const fetchLogs = () => {
            chrome.runtime.sendMessage(
                { type: 'GET_LOGS', limit: 100, filter },
                (response) => {
                    if (chrome.runtime.lastError) {
                        // Ignore - might be no listener yet
                        return
                    }
                    if (response?.entries) {
                        setEntries(response.entries.reverse())
                    }
                }
            )
        }

        fetchLogs()
        const interval = setInterval(fetchLogs, 1000) // Fallback polling if no subscription

        const handleMessage = (message: { type: string; entry: LogEntry }) => {
            if (message.type === 'LOG_ENTRY') {
                setEntries((prev) => {
                    // Check filter
                    if (filter.level) {
                        const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
                        if (levels.indexOf(message.entry.level) < levels.indexOf(filter.level)) {
                            return prev
                        }
                    }

                    const updated = [...prev, message.entry]
                    if (updated.length > 100) {
                        return updated.slice(-100)
                    }
                    return updated
                })
            }
        }

        chrome.runtime.onMessage.addListener(handleMessage)

        return () => {
            clearInterval(interval)
            chrome.runtime.onMessage.removeListener(handleMessage)
        }
    }, [filter])

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
        }) + '.' + date.getMilliseconds().toString().padStart(3, '0')
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
