/**
 * @jstorrent/client/core
 *
 * Chrome-free exports for standalone usage.
 * Import from '@jstorrent/client/core' to avoid Chrome type dependencies.
 */

// Adapters
export { DirectEngineAdapter } from './adapters/types'
export type { EngineAdapter } from './adapters/types'

// Types (Chrome-free)
export type { DaemonInfo, DownloadRoot } from './types'

// Engine Manager types (implementations are platform-specific)
export type { IEngineManager, StorageRoot, FileOperationResult } from './engine-manager/types'
// Note: AndroidStandaloneEngineManager is exported from '@jstorrent/client/android'

// React contexts
export { EngineProvider, useAdapter, useEngine } from './context/EngineContext'
export type { EngineProviderProps } from './context/EngineContext'
export {
  ConfigProvider,
  useConfig,
  useConfigValue,
  useConfigSubscription,
} from './context/ConfigContext'
export {
  EngineManagerProvider,
  useEngineManager,
  useFileOperations,
} from './context/EngineManagerContext'
export type { FileOperations } from './context/EngineManagerContext'

// Hooks
export { useEngineState, useTorrentState } from './hooks/useEngineState'
export { useConfigInit } from './hooks/useConfigInit'

// UI Components
export { AppShell } from './components/AppShell'
export { AppHeader } from './components/AppHeader'

// App content (Chrome-free, callbacks optional)
export { AppContent } from './AppContent'
export type { AppContentProps, FileInfo } from './AppContent'

// Settings overlay (platform-agnostic, uses EngineManagerContext)
export { SettingsOverlay } from './components/SettingsOverlay'
