import { describe, it, expect } from 'vitest';
import {
    EngineComponent,
    ILoggingEngine,
    Logger,
    EngineLoggingConfig,
    createFilter,
    withScopeAndFiltering,
    randomClientId
} from '../../src/logging/logger';

// Mock Logger to capture logs
class MockLogger implements Logger {
    logs: { level: string; message: string; context: any }[] = [];

    debug(message: string, context?: object) {
        this.logs.push({ level: 'debug', message, context });
    }
    info(message: string, context?: object) {
        this.logs.push({ level: 'info', message, context });
    }
    warn(message: string, context?: object) {
        this.logs.push({ level: 'warn', message, context });
    }
    error(message: string, context?: object) {
        this.logs.push({ level: 'error', message, context });
    }
}

class TestClient implements ILoggingEngine {
    clientId: string;
    rootLogger: Logger;
    filterFn: any;

    constructor(config: EngineLoggingConfig = { level: 'debug' }) {
        this.clientId = randomClientId();
        this.rootLogger = new MockLogger();
        this.filterFn = createFilter(config);
    }

    scopedLoggerFor(component: EngineComponent): Logger {
        return withScopeAndFiltering(this.rootLogger, component, this.filterFn);
    }
}

class TestTorrent extends EngineComponent {
    static logName = 'torrent';
    infoHash: string;

    constructor(engine: ILoggingEngine, infoHash: string) {
        super(engine);
        this.infoHash = infoHash;
        this.instanceLogName = `t:${infoHash.slice(0, 6)}`;
    }

    doSomething() {
        this.logger.info('doing something');
    }
}

class TestPeer extends EngineComponent {
    static logName = 'peer';
    infoHash: string;
    peerId: string;

    constructor(engine: ILoggingEngine, infoHash: string, peerId: string) {
        super(engine);
        this.infoHash = infoHash;
        this.peerId = peerId;
    }

    connect() {
        this.logger.debug('connecting');
    }
}

describe('Logger System', () => {
    it('should log with correct scope and context', () => {
        const client = new TestClient();
        const torrent = new TestTorrent(client, 'deadbeefcafef00d');

        torrent.doSomething();

        const mockLogger = client.rootLogger as MockLogger;
        expect(mockLogger.logs).toHaveLength(1);
        const log = mockLogger.logs[0];
        expect(log.message).toBe('doing something');
        expect(log.context.component).toBe('torrent');
        expect(log.context.instanceKey).toBe('infoHash');
        expect(log.context.instanceValue).toBe('deadbeefcafef00d');
        expect(log.context.scope).toContain(`t:deadbe:${client.clientId}:deadbeefcafef00d`);
    });

    it('should filter logs based on level', () => {
        const client = new TestClient({ level: 'warn' });
        const torrent = new TestTorrent(client, '123456');

        (torrent as any).logger.info('should not show');
        (torrent as any).logger.warn('should show');

        const mockLogger = client.rootLogger as MockLogger;
        expect(mockLogger.logs).toHaveLength(1);
        expect(mockLogger.logs[0].message).toBe('should show');
    });

    it('should filter logs based on component', () => {
        const client = new TestClient({ level: 'debug', excludeComponents: ['peer'] });
        const torrent = new TestTorrent(client, '123');
        const peer = new TestPeer(client, '123', 'peer1');

        (torrent as any).logger.info('torrent log');
        (peer as any).logger.info('peer log');

        const mockLogger = client.rootLogger as MockLogger;
        expect(mockLogger.logs).toHaveLength(1);
        expect(mockLogger.logs[0].message).toBe('torrent log');
    });

    it('should filter logs based on instance value', () => {
        const client = new TestClient({ level: 'debug', includeInstanceValues: ['allowed'] });
        const t1 = new TestTorrent(client, 'allowed');
        const t2 = new TestTorrent(client, 'blocked');

        (t1 as any).logger.info('t1');
        (t2 as any).logger.info('t2');

        const mockLogger = client.rootLogger as MockLogger;
        expect(mockLogger.logs).toHaveLength(1);
        expect(mockLogger.logs[0].message).toBe('t1');
    });
});
