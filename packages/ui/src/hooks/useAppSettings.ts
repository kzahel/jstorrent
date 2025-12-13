import { useState, useCallback, useEffect } from 'react'
import { uiStorage } from '../storage/UIStorage'

const APP_SETTINGS_KEY = 'jstorrent:appSettings'

// ============ Schema Definition ============
// Single source of truth: type, default, and validation in one place

type BooleanSetting = { type: 'boolean'; default: boolean }
type NumberSetting = { type: 'number'; default: number; min?: number; max?: number }
type EnumSetting<T extends readonly string[]> = { type: 'enum'; values: T; default: T[number] }

const settingsSchema = {
  // General > Behavior
  keepAwakeWhileDownloading: { type: 'boolean', default: false } as BooleanSetting,
  notifyOnComplete: { type: 'boolean', default: true } as BooleanSetting,

  // Interface
  theme: {
    type: 'enum',
    values: ['system', 'dark', 'light'] as const,
    default: 'system',
  } as EnumSetting<readonly ['system', 'dark', 'light']>,
  maxFps: { type: 'number', default: 60, min: 0, max: 240 } as NumberSetting,

  // Network
  downloadSpeedLimit: { type: 'number', default: 0, min: 0 } as NumberSetting,
  uploadSpeedLimit: { type: 'number', default: 0, min: 0 } as NumberSetting,
  maxPeersPerTorrent: { type: 'number', default: 50, min: 1, max: 500 } as NumberSetting,
  maxGlobalPeers: { type: 'number', default: 200, min: 1, max: 2000 } as NumberSetting,
  listeningPort: { type: 'number', default: 6881, min: 1024, max: 65535 } as NumberSetting,

  // Advanced
  ioWorkerThreads: { type: 'number', default: 4, min: 1, max: 16 } as NumberSetting,
} as const

// ============ Type Derivation ============

type SettingsSchema = typeof settingsSchema

type InferSettingType<S> = S extends { type: 'boolean' }
  ? boolean
  : S extends { type: 'number' }
    ? number
    : S extends { type: 'enum'; values: readonly (infer V)[] }
      ? V
      : never

// Mutable version for runtime use (schema is const for type inference only)
export type AppSettings = {
  -readonly [K in keyof SettingsSchema]: InferSettingType<SettingsSchema[K]>
}

export type Theme = AppSettings['theme']
export type SettingsTab = 'general' | 'interface' | 'network' | 'advanced'

// ============ Schema Utilities ============

/** Get the schema for a specific setting (useful for UI validation) */
export function getSettingSchema<K extends keyof AppSettings>(key: K): SettingsSchema[K] {
  return settingsSchema[key]
}

/** Get default value for a setting */
export function getDefaultValue<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return settingsSchema[key].default as AppSettings[K]
}

/** Get all default settings */
function getDefaults(): AppSettings {
  const defaults: Record<string, unknown> = {}
  for (const key of Object.keys(settingsSchema)) {
    defaults[key] = settingsSchema[key as keyof SettingsSchema].default
  }
  return defaults as AppSettings
}

/** Validate and clamp a value according to its schema */
function validateValue(key: keyof AppSettings, value: unknown): unknown {
  const schema = settingsSchema[key]

  if (schema.type === 'boolean') {
    return typeof value === 'boolean' ? value : schema.default
  }

  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return schema.default
    }
    const min = schema.min ?? -Infinity
    const max = schema.max ?? Infinity
    return Math.max(min, Math.min(max, value))
  }

  // schema.type === 'enum'
  const values = schema.values as readonly unknown[]
  return values.includes(value) ? value : schema.default
}

/** Load and validate all settings from storage */
export function loadSettings(): AppSettings {
  const defaults = getDefaults()

  try {
    const raw = uiStorage.getItem(APP_SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, unknown>
      const validated: Record<string, unknown> = { ...defaults }

      for (const key of Object.keys(settingsSchema)) {
        if (key in saved) {
          validated[key] = validateValue(key as keyof AppSettings, saved[key])
        }
      }

      return validated as AppSettings
    }
  } catch {
    // Ignore parse errors, return defaults
  }

  return defaults
}

// Module-level cache for maxFps - avoids localStorage reads in RAF loops
let cachedMaxFps = 60

function saveSettings(settings: AppSettings): void {
  cachedMaxFps = settings.maxFps
  try {
    uiStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Ignore errors
  }
}

/** Get cached maxFps value (fast memory read, no localStorage) */
export function getMaxFps(): number {
  return cachedMaxFps
}

// Initialize cache on module load
cachedMaxFps = loadSettings().maxFps

// ============ React Hook ============

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
        // Validate on update too
        const validatedValue = validateValue(key, value)
        const updated = { ...prev, [key]: validatedValue } as AppSettings
        saveSettings(updated)
        return updated
      })
    },
    [],
  )

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettingsState((prev) => {
      const validated: Record<string, unknown> = { ...prev }
      for (const key of Object.keys(updates)) {
        if (key in settingsSchema) {
          validated[key] = validateValue(
            key as keyof AppSettings,
            updates[key as keyof AppSettings],
          )
        }
      }
      const result = validated as AppSettings
      saveSettings(result)
      return result
    })
  }, [])

  const resetToDefaults = useCallback(() => {
    const defaults = getDefaults()
    setSettingsState(defaults)
    saveSettings(defaults)
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

// ============ Theme Utilities ============

/** Apply theme by setting data-theme attribute on document */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement

  if (theme === 'system') {
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
