import {
  ILoggingEngine,
  Logger,
  EngineComponent,
  createFilter,
  withScopeAndFiltering,
  globalLogStore,
} from '../../src/logging/logger'

export class MockEngine implements ILoggingEngine {
  clientId = 'mock-client'
  filterFn = createFilter({ level: 'debug' })

  scopedLoggerFor(component: EngineComponent): Logger {
    return withScopeAndFiltering(component, this.filterFn, {
      onCapture: (entry) => globalLogStore.add(entry.level, entry.message, entry.args),
    })
  }
}
