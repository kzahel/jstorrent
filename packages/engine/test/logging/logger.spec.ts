import { describe, it, expect, vi } from 'vitest'
import {
    EngineComponent,
    ILoggingEngine,
    Logger,
    EngineLoggingConfig,
    createFilter,
    withScopeAndFiltering,
    randomClientId,
    defaultLogger
} from '../../src/logging/logger'

// Mock Logger to capture logs
class MockLogger implements Logger {
    logs: { level: string; message: string; args: any[] }[] = []

    debug(message: string, ...args: any[]) {
        this.logs.push({ level: 'debug', message, args })
    }
    info(message: string, ...args: any[]) {
        this.logs.push({ level: 'info', message, args })
    }
    warn(message: string, ...args: any[]) {
        this.logs.push({ level: 'warn', message, args })
    }
    error(message: string, ...args: any[]) {
        this.logs.push({ level: 'error', message, args })
    }
}

class TestClient implements ILoggingEngine {
    clientId: string
    rootLogger: Logger
    filterFn: any

    constructor(config: EngineLoggingConfig = { level: 'debug' }) {
        this.clientId = randomClientId()
        this.rootLogger = new MockLogger()
        this.filterFn = createFilter(config)
    }

    scopedLoggerFor(component: EngineComponent): Logger {
        return withScopeAndFiltering(this.rootLogger, component, this.filterFn)
    }
}

class TestTorrent extends EngineComponent {
    static logName = 'torrent'
    infoHash: string

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
    infoHash: string
    peerId: string

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

        const mockLogger = client.rootLogger as MockLogger
        expect(mockLogger.logs).toHaveLength(1)
        const log = mockLogger.logs[0]
        // log.message is the prefix now because of bind(prefix)
        // log.args[0] is the actual message
        expect(log.message).toContain(`t:deadbe`) // Prefix
        expect(log.args[0]).toBe('doing something')
    })

    it('should filter logs based on level', () => {
        const client = new TestClient({ level: 'warn' })
        const torrent = new TestTorrent(client, '123456')

            ; (torrent as any).logger.info('should not show')
            ; (torrent as any).logger.warn('should show')

        const mockLogger = client.rootLogger as MockLogger
        expect(mockLogger.logs).toHaveLength(1)
        expect(mockLogger.logs[0].args[0]).toBe('should show')
    })

    it('should filter logs based on component', () => {
        const client = new TestClient({ level: 'debug', excludeComponents: ['peer'] })
        const torrent = new TestTorrent(client, '123')
        const peer = new TestPeer(client, '123', 'peer1')

            ; (torrent as any).logger.info('torrent log')
            ; (peer as any).logger.info('peer log')

        const mockLogger = client.rootLogger as MockLogger
        expect(mockLogger.logs).toHaveLength(1)
        expect(mockLogger.logs[0].args[0]).toBe('torrent log')
    })

    it('should filter logs based on instance value', () => {
        const client = new TestClient({ level: 'debug', includeInstanceValues: ['allowed'] })
        const t1 = new TestTorrent(client, 'allowed')
        const t2 = new TestTorrent(client, 'blocked')

            ; (t1 as any).logger.info('t1')
            ; (t2 as any).logger.info('t2')

        const mockLogger = client.rootLogger as MockLogger
        expect(mockLogger.logs).toHaveLength(1)
        expect(mockLogger.logs[0].args[0]).toBe('t1')
    })

    it('should format logs with smart logger', () => {
        const logger = defaultLogger()

        // Mock console methods
        const originalInfo = console.info
        const infoSpy = vi.fn()
        console.info = infoSpy

        try {
            // defaultLogger is now just console, so it doesn't do prefixing by itself
            // prefixing is done by withScopeAndFiltering
            // But we can test withScopeAndFiltering with console as base

            // Let's create a dummy component
            const component = {
                getLogName: () => 'test',
                getStaticLogName: () => 'test',
                engineInstance: { clientId: 'abcdef123456' } as any,
                infoHash: new Uint8Array([0xde, 0xad, 0xbe, 0xef])
            }

            const scoped = withScopeAndFiltering(logger, component, () => true)

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
