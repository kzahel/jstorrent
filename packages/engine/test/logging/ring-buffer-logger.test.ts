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
    expect(recent[0].message).toBe('third') // Newest first
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
    const badListener = vi.fn(() => {
      throw new Error('oops')
    })
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
