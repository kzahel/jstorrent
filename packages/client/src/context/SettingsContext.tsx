import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ISettingsStore, Settings, SettingKey } from '@jstorrent/engine'

interface SettingsContextValue {
  /** The underlying store (for subscriptions outside React) */
  store: ISettingsStore
  /** Current settings snapshot (triggers re-render on change) */
  settings: Settings
  /** Update a setting */
  set: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<void>
  /** Reset a setting to default */
  reset: <K extends SettingKey>(key: K) => Promise<void>
  /** Reset all settings to defaults */
  resetAll: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

interface SettingsProviderProps {
  store: ISettingsStore
  children: React.ReactNode
}

export function SettingsProvider({ store, children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<Settings>(() => store.getAll())

  useEffect(() => {
    // Subscribe to all changes and update React state
    const unsubscribe = store.subscribeAll(() => {
      setSettings(store.getAll())
    })
    return unsubscribe
  }, [store])

  const set = useCallback(
    async <K extends SettingKey>(key: K, value: Settings[K]) => {
      await store.set(key, value)
    },
    [store],
  )

  const reset = useCallback(
    async <K extends SettingKey>(key: K) => {
      await store.reset(key)
    },
    [store],
  )

  const resetAll = useCallback(async () => {
    await store.resetAll()
  }, [store])

  return (
    <SettingsContext.Provider value={{ store, settings, set, reset, resetAll }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return ctx
}

/**
 * Subscribe to a specific setting with a callback.
 * For use in effects that need to react to changes.
 */
export function useSettingSubscription<K extends SettingKey>(
  key: K,
  callback: (value: Settings[K], oldValue: Settings[K]) => void,
): void {
  const { store } = useSettings()

  useEffect(() => {
    return store.subscribe(key, callback)
  }, [store, key, callback])
}
