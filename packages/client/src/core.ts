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

// React contexts
export { EngineProvider, useAdapter, useEngine } from './context/EngineContext'
export type { EngineProviderProps } from './context/EngineContext'
export { SettingsProvider, useSettings, useSettingSubscription } from './context/SettingsContext'

// Hooks
export { useEngineState, useTorrentState } from './hooks/useEngineState'

// App content (Chrome-free, callbacks optional)
export { AppContent } from './AppContent'
export type { AppContentProps, FileInfo } from './AppContent'
