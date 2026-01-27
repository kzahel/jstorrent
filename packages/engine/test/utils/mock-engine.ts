import {
  ILoggingEngine,
  Logger,
  EngineComponent,
  createFilter,
  withScopeAndFiltering,
  globalLogStore,
} from '../../src/logging/logger'
import { BandwidthTracker } from '../../src/core/bandwidth-tracker'

export class MockEngine implements ILoggingEngine {
  clientId = 'mock-client'
  filterFn = createFilter({ level: 'debug' })
  bandwidthTracker = new BandwidthTracker()
  listeningPort = 6881

  /** Process incoming data immediately (no tick-aligned batching) for test convenience */
  autoDrainBuffers = true

  scopedLoggerFor(component: EngineComponent): Logger {
    return withScopeAndFiltering(component, this.filterFn, {
      onCapture: (entry) => globalLogStore.add(entry.level, entry.message, entry.args),
    })
  }
}
