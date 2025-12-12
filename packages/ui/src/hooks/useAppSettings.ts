import { useState, useCallback, useEffect } from 'react'
import { uiStorage } from '../storage/UIStorage'

const APP_SETTINGS_KEY = 'jstorrent:appSettings'

export type Theme = 'system' | 'dark' | 'light'
export type SettingsTab = 'general' | 'interface' | 'network' | 'advanced'

export interface AppSettings {
  // General > Behavior
  keepAwakeWhileDownloading: boolean
  notifyOnComplete: boolean

  // Interface
  theme: Theme
  maxFps: number // 1, 20, 30, 60, 120, 240, 0 = unlimited

  // Network (bytes/sec, 0 = unlimited)
  downloadSpeedLimit: number
  uploadSpeedLimit: number
  maxPeersPerTorrent: number
  maxGlobalPeers: number
  listeningPort: number

  // Advanced
  ioWorkerThreads: number
}

const DEFAULT_SETTINGS: AppSettings = {
  // General > Behavior
  keepAwakeWhileDownloading: false,
  notifyOnComplete: true,

  // Interface
  theme: 'system',
  maxFps: 60,

  // Network
  downloadSpeedLimit: 0, // unlimited
  uploadSpeedLimit: 0, // unlimited
  maxPeersPerTorrent: 50,
  maxGlobalPeers: 200,
  listeningPort: 6881,

  // Advanced
  ioWorkerThreads: 4,
}

export function loadSettings(): AppSettings {
  try {
    const raw = uiStorage.getItem(APP_SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppSettings>
      return { ...DEFAULT_SETTINGS, ...saved }
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(settings: AppSettings): void {
  try {
    uiStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Ignore errors
  }
}

export function useAppSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(loadSettings)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  // Apply theme to document
  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettingsState((prev) => {
        const updated = { ...prev, [key]: value }
        saveSettings(updated)
        return updated
      })
    },
    [],
  )

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettingsState((prev) => {
      const updated = { ...prev, ...updates }
      saveSettings(updated)
      return updated
    })
  }, [])

  const resetToDefaults = useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS)
    saveSettings(DEFAULT_SETTINGS)
  }, [])

  return {
    settings,
    activeTab,
    setActiveTab,
    updateSetting,
    updateSettings,
    resetToDefaults,
  }
}

/** Apply theme by setting data-theme attribute on document */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement

  if (theme === 'system') {
    // Use system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

/** Get current effective theme (resolves 'system' to actual theme) */
export function getEffectiveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}
