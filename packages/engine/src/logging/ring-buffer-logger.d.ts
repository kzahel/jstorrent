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
export declare class RingBufferLogger {
  private capacity
  private buffer
  private head
  private count
  private listeners
  constructor(capacity?: number)
  /**
   * Add a log entry to the buffer.
   * Called by the onLog callback from BtEngine.
   */
  add(entry: LogEntry): void
  /**
   * Get all entries, optionally filtered.
   * Returns entries in chronological order (oldest first).
   */
  getEntries(filter?: LogFilter): LogEntry[]
  /**
   * Get recent entries (newest first), with optional limit.
   */
  getRecent(limit?: number, filter?: LogFilter): LogEntry[]
  /**
   * Subscribe to new log entries.
   * Returns unsubscribe function.
   */
  subscribe(listener: LogListener): () => void
  /**
   * Clear all entries.
   */
  clear(): void
  /**
   * Get current entry count.
   */
  get size(): number
  private matchesFilter
}
export {}
//# sourceMappingURL=ring-buffer-logger.d.ts.map
