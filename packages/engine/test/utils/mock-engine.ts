import { ILoggingEngine, Logger, EngineComponent, defaultLogger, createFilter, withScopeAndFiltering } from '../../src/logging/logger';

export class MockEngine implements ILoggingEngine {
    clientId = 'mock-client';
    rootLogger = defaultLogger();
    filterFn = createFilter({ level: 'debug' });

    scopedLoggerFor(component: EngineComponent): Logger {
        return withScopeAndFiltering(this.rootLogger, component, this.filterFn);
    }
}
