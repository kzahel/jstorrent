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
