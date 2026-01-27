import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from 'react'
import type { ConfigHub, ConfigKey, ConfigType, getConfigDefault } from '@jstorrent/engine'

interface ConfigContextValue {
  /** The ConfigHub instance */
  config: ConfigHub
  /** Reset a single key to its default value */
  reset: <K extends ConfigKey>(key: K) => void
  /** Reset all settings to their default values */
  resetAll: () => void
}

const ConfigContext = createContext<ConfigContextValue | null>(null)

interface ConfigProviderProps {
  config: ConfigHub
  children: React.ReactNode
  /** Function to get default value for a key (injected to avoid bundling schema in client) */
  getDefault: typeof getConfigDefault
}

/** All setting keys that can be reset */
const SETTING_KEYS: ConfigKey[] = [
  'downloadSpeedLimit',
  'uploadSpeedLimit',
  'maxPeersPerTorrent',
  'maxGlobalPeers',
  'maxUploadSlots',
  'maxPipelineDepth',
  'encryptionPolicy',
  'listeningPort',
  'dhtEnabled',
  'upnpEnabled',
  'daemonOpsPerSecond',
  'daemonOpsBurst',
  'theme',
  'maxFps',
  'progressBarStyle',
  'uiScale',
  'pieceViewMode',
  'notifyOnTorrentComplete',
  'notifyOnAllComplete',
  'notifyOnError',
  'notifyProgressWhenBackgrounded',
  'keepAwake',
  'preventBackgroundThrottling',
  'loggingLevel',
  'loggingLevelClient',
  'loggingLevelTorrent',
  'loggingLevelPeer',
  'loggingLevelActivePieces',
  'loggingLevelContentStorage',
  'loggingLevelPartsFile',
  'loggingLevelTrackerManager',
  'loggingLevelHttpTracker',
  'loggingLevelUdpTracker',
  'loggingLevelDht',
]

/**
 * ConfigProvider - Provides ConfigHub access to React components.
 *
 * Unlike SettingsProvider (which maintains a snapshot), this exposes
 * ConfigHub directly. Components should use useConfigValue() to subscribe
 * to specific keys and trigger re-renders.
 */
export function ConfigProvider({ config, children, getDefault }: ConfigProviderProps) {
  const reset = useCallback(
    <K extends ConfigKey>(key: K) => {
      const defaultValue = getDefault(key)
      config.set(key, defaultValue)
    },
    [config, getDefault],
  )

  const resetAll = useCallback(() => {
    // Reset all setting keys to their defaults
    for (const key of SETTING_KEYS) {
      config.set(key, getDefault(key))
    }
  }, [config, getDefault])

  const value = useMemo(
    () => ({
      config,
      reset,
      resetAll,
    }),
    [config, reset, resetAll],
  )

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

/**
 * useConfig - Returns the ConfigHub and reset functions.
 *
 * For reading values reactively, use useConfigValue() instead.
 */
export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext)
  if (!ctx) {
    throw new Error('useConfig must be used within ConfigProvider')
  }
  return ctx
}

/**
 * useConfigValue - Subscribe to a single config key and re-render on changes.
 *
 * Returns [value, setValue] tuple similar to useState.
 * Uses useSyncExternalStore for proper React 18 external store integration.
 */
export function useConfigValue<K extends ConfigKey>(
  key: K,
): [ConfigType[K], (value: ConfigType[K]) => void] {
  const { config } = useConfig()
  const configValue = config[key]

  // useSyncExternalStore is the proper way to subscribe to external stores
  const value = useSyncExternalStore(
    // subscribe function
    (onStoreChange) => configValue.subscribe(onStoreChange),
    // getSnapshot function
    () => configValue.get() as ConfigType[K],
  )

  const setter = useCallback(
    (newValue: ConfigType[K]) => {
      config.set(key, newValue)
    },
    [config, key],
  )

  return [value, setter]
}

/**
 * useConfigSubscription - Subscribe to a config key with a callback.
 *
 * For use in effects that need to react to changes without re-rendering.
 */
export function useConfigSubscription<K extends ConfigKey>(
  key: K,
  callback: (value: ConfigType[K], oldValue: ConfigType[K]) => void,
): void {
  const { config } = useConfig()

  useEffect(() => {
    const configValue = config[key]
    return configValue.subscribe((newVal, oldVal) => {
      callback(newVal as ConfigType[K], oldVal as ConfigType[K])
    })
  }, [config, key, callback])
}
