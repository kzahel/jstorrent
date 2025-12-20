/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import {
  EngineComponent,
  ILoggingEngine,
  Logger,
  EngineLoggingConfig,
  createFilter,
  withScopeAndFiltering,
  randomClientId,
  LogEntry,
} from '../../src/logging/logger'

class TestClient implements ILoggingEngine {
  clientId: string
  filterFn: any
  logs: LogEntry[] = []

  constructor(config: EngineLoggingConfig = { level: 'debug' }) {
    this.clientId = randomClientId()
    this.filterFn = createFilter(config)
  }

  scopedLoggerFor(component: EngineComponent): Logger {
    return withScopeAndFiltering(component, this.filterFn, {
      onCapture: (entry) => this.logs.push(entry),
    })
  }
}

class TestTorrent extends EngineComponent {
  static logName = 'torrent'
  declare infoHash: string

  constructor(engine: ILoggingEngine, infoHash: string) {
    super(engine)
    this.infoHash = infoHash
    this.instanceLogName = `t:${infoHash.slice(0, 6)}`
  }

  doSomething() {
    this.logger.info('doing something')
  }
}

class TestPeer extends EngineComponent {
  static logName = 'peer'
  declare infoHash: string
  declare peerId: string

  constructor(engine: ILoggingEngine, infoHash: string, peerId: string) {
    super(engine)
    this.infoHash = infoHash
    this.peerId = peerId
  }

  connect() {
    this.logger.debug('connecting')
  }
}

describe('Logger System', () => {
  it('should log with correct scope and context', () => {
    const client = new TestClient()
    const torrent = new TestTorrent(client, 'deadbeefcafef00d')

    torrent.doSomething()

    expect(client.logs).toHaveLength(1)
    const log = client.logs[0]
    expect(log.message).toContain('doing something')
    expect(log.level).toBe('info')
  })

  it('should filter logs based on level', () => {
    const client = new TestClient({ level: 'warn' })
    const torrent = new TestTorrent(client, '123456')

    ;(torrent as any).logger.info('should not show')
    ;(torrent as any).logger.warn('should show')

    expect(client.logs).toHaveLength(1)
    expect(client.logs[0].message).toContain('should show')
  })

  it('should filter logs based on component', () => {
    const client = new TestClient({ level: 'debug', excludeComponents: ['peer'] })
    const torrent = new TestTorrent(client, '123')
    const peer = new TestPeer(client, '123', 'peer1')

    ;(torrent as any).logger.info('torrent log')
    ;(peer as any).logger.info('peer log')

    expect(client.logs).toHaveLength(1)
    expect(client.logs[0].message).toContain('torrent log')
  })

  it('should filter logs based on instance value', () => {
    const client = new TestClient({ level: 'debug', includeInstanceValues: ['allowed'] })
    const t1 = new TestTorrent(client, 'allowed')
    const t2 = new TestTorrent(client, 'blocked')

    ;(t1 as any).logger.info('t1')
    ;(t2 as any).logger.info('t2')

    expect(client.logs).toHaveLength(1)
    expect(client.logs[0].message).toContain('t1')
  })

  it('should format logs with smart logger', () => {
    // Mock console methods
    const originalInfo = console.info
    const infoSpy = vi.fn()
    console.info = infoSpy

    try {
      // Let's create a dummy component
      const component = {
        getLogName: () => 'test',
        getStaticLogName: () => 'test',
        engineInstance: { clientId: 'abcdef123456' } as any,
        infoHash: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
      }

      const scoped = withScopeAndFiltering(component, () => true)

      scoped.info('test message', { other: 'data' })

      expect(infoSpy).toHaveBeenCalled()
      const call = infoSpy.mock.calls[0]
      // call: [prefix, msg, ctx]
      const prefix = call[0]
      const msg = call[1]
      const ctx = call[2]

      expect(prefix).toContain('Client[abcd]:Test[dead]')
      expect(msg).toBe('test message')
      expect(ctx).toEqual({ other: 'data' })
    } finally {
      console.info = originalInfo
    }
  })
})
