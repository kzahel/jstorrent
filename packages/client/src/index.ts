// Adapters
export { DirectEngineAdapter } from './adapters/types'
export type { EngineAdapter } from './adapters/types'

// Chrome extension specific
export { engineManager } from './chrome/engine-manager'
export type { DaemonInfo, DownloadRoot } from './chrome/engine-manager'
export { getBridge } from './chrome/extension-bridge'
export { notificationBridge } from './chrome/notification-bridge'
export type { ProgressStats } from './chrome/notification-bridge'

// React integration
export { EngineProvider, useAdapter, useEngine } from './context/EngineContext'
export type { EngineProviderProps } from './context/EngineContext'
export { useEngineState, useTorrentState } from './hooks/useEngineState'
export { useSystemBridge } from './hooks/useSystemBridge'
export type {
  UseSystemBridgeConfig,
  UseSystemBridgeResult,
  ReadinessStatus,
  IndicatorColor,
} from './hooks/useSystemBridge'

// App
export { App, AppContent } from './App'

// Components
export { DownloadRootsManager } from './components/DownloadRootsManager'
export { SystemIndicator } from './components/SystemIndicator'
export type { SystemIndicatorProps } from './components/SystemIndicator'
export { SystemBridgePanel } from './components/SystemBridgePanel'
export type {
  SystemBridgePanelProps,
  DaemonBridgeState,
  VersionStatus,
  ConnectionStatus,
  Platform,
} from './components/SystemBridgePanel'
