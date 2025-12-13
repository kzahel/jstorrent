# Settings Infrastructure Migration

## Overview

Replace the ad-hoc settings scattered across localStorage, chrome.storage.sync, and various init functions with a unified `ISettingsStore` system featuring pub/sub, proper typing, and centralized effects.

**Goal:** One place to define settings, one interface to access them, subscribers react to changes automatically.

## Current State

Phase 1 is complete. The core infrastructure exists:
- `packages/engine/src/settings/` - schema, interface, base class, adapters
- `packages/client/src/settings/chrome-settings-store.ts` - chrome.storage adapter
- Tests passing

## Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Core infrastructure (schema, interface, adapters) | ✅ Done |
| 2 | Create settings singleton + React context | ✅ Done |
| 3 | Migrate UI settings reads to use store | ✅ Done |
| 4 | Migrate NotificationManager to use store | ✅ Done |
| 5 | Register settings effects (theme, rate limits) | ✅ Done |
| 6 | Update SettingsOverlay to use store | ✅ Done (merged with Phase 3) |
| 7 | Delete dead code | ✅ Done (merged with Phase 3) |

---

## Phase 2: Settings Singleton + React Context

Create the singleton instance and React context for UI components.

### 2.1 Create settings instance factory

**Create** `packages/client/src/settings/index.ts`:

```typescript
/**
 * Settings Module
 *
 * Creates and exports the appropriate settings store based on context.
 */

import { LocalStorageSettingsStore, type ISettingsStore } from '@jstorrent/engine'
import { ChromeStorageSettingsStore } from './chrome-settings-store'
import { getBridge } from '../chrome/extension-bridge'

let settingsStore: ISettingsStore | null = null

/**
 * Get or create the settings store singleton.
 * Must call init() on the returned store before using.
 */
export function getSettingsStore(): ISettingsStore {
  if (settingsStore) return settingsStore

  const bridge = getBridge()

  if (bridge.isDevMode) {
    // HMR / jstorrent.com - use localStorage
    const store = new LocalStorageSettingsStore()
    store.startListening()
    settingsStore = store
  } else {
    // Extension context - use chrome.storage
    const store = new ChromeStorageSettingsStore()
    store.startListening()
    settingsStore = store
  }

  return settingsStore
}

export { ChromeStorageSettingsStore } from './chrome-settings-store'
```

### 2.2 Create React context

**Create** `packages/client/src/context/SettingsContext.tsx`:

```typescript
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

  return (
    <SettingsContext.Provider value={{ store, settings, set, reset }}>
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
```

### 2.3 Initialize store in App.tsx

**Edit** `packages/client/src/App.tsx`:

Add imports at top:
```typescript
import { getSettingsStore } from './settings'
import { SettingsProvider } from './context/SettingsContext'
```

Add store initialization in App component (before other hooks):
```typescript
function App() {
  const [settingsReady, setSettingsReady] = useState(false)
  const [settingsStore] = useState(() => getSettingsStore())

  // Initialize settings store
  useEffect(() => {
    settingsStore.init().then(() => setSettingsReady(true))
  }, [settingsStore])

  // ... existing state ...

  if (!settingsReady) {
    return <div>Loading settings...</div>
  }

  return (
    <SettingsProvider store={settingsStore}>
      {/* existing JSX */}
    </SettingsProvider>
  )
}
```

### Verification

```bash
pnpm typecheck
pnpm test
```

Manually verify:
1. App loads without errors
2. Console shows no settings-related warnings

---

## Phase 3: Migrate UI Settings Reads

Replace `useAppSettings` hook usage with `useSettings`.

**Status:** ✅ Complete

**What was done:**
- Removed `useAppSettings` hook from App.tsx
- SettingsOverlay now uses `useSettings()` context internally
- Updated all setting keys to match new schema:
  - `keepAwakeWhileDownloading` → `keepAwake`
  - `notifyOnComplete` → `notifications.onTorrentComplete` (plus other notification settings)
  - Removed `ioWorkerThreads` (not in new schema)
- `@jstorrent/ui` now only exports theme utilities and maxFps cache functions
- engine-manager.ts now uses settings store directly

### 3.1 Update App.tsx to use new context

**Edit** `packages/client/src/App.tsx`:

Remove:
```typescript
import {
  // ...
  useAppSettings,
  // ...
} from '@jstorrent/ui'
```

Remove:
```typescript
const {
  settings,
  activeTab: settingsTab,
  setActiveTab: setSettingsTab,
  updateSetting,
} = useAppSettings()
```

Replace with:
```typescript
const { settings, set: updateSetting } = useSettings()
const [settingsTab, setSettingsTab] = useState<'general' | 'interface' | 'network' | 'advanced'>('general')
```

Add import:
```typescript
import { useSettings } from './context/SettingsContext'
```

### 3.2 Update SettingsOverlay props

The SettingsOverlay currently receives settings as props. Update it to use context internally.

**Edit** `packages/client/src/components/SettingsOverlay.tsx`:

Change imports:
```typescript
import { useSettings } from '../context/SettingsContext'
import type { SettingKey, Settings } from '@jstorrent/engine'
```

Change props interface:
```typescript
interface SettingsOverlayProps {
  isOpen: boolean
  onClose: () => void
  activeTab: 'general' | 'interface' | 'network' | 'advanced'
  setActiveTab: (tab: 'general' | 'interface' | 'network' | 'advanced') => void
}
```

Inside component, get settings from context:
```typescript
export const SettingsOverlay: React.FC<SettingsOverlayProps> = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
}) => {
  const { settings, set: updateSetting } = useSettings()
  // ... rest of component
}
```

Update TabProps interface:
```typescript
interface TabProps {
  settings: Settings
  updateSetting: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<void>
}
```

### 3.3 Update maxFps cache

The `getMaxFps()` function in `packages/ui` reads from a module-level cache. Replace with subscription.

**Edit** `packages/client/src/App.tsx`:

After settings store init, add effect to keep the cache updated:
```typescript
import { setMaxFpsCache } from '@jstorrent/ui'

// Inside App, after settingsStore init:
useEffect(() => {
  // Initialize cache
  setMaxFpsCache(settingsStore.get('maxFps'))
  
  // Keep cache updated
  return settingsStore.subscribe('maxFps', (value) => {
    setMaxFpsCache(value)
  })
}, [settingsStore])
```

**Edit** `packages/ui/src/hooks/useAppSettings.ts`:

Add export for cache setter:
```typescript
/** Set cached maxFps value (called by settings store subscriber) */
export function setMaxFpsCache(fps: number): void {
  cachedMaxFps = fps
}
```

Update `packages/ui/src/index.ts` to export it:
```typescript
export { getMaxFps, setMaxFpsCache } from './hooks/useAppSettings'
```

### Verification

```bash
pnpm typecheck
pnpm test
```

Manually verify:
1. Settings dialog opens and shows current values
2. Changing theme updates immediately
3. Changing maxFps affects table render rate

---

## Phase 4: Migrate NotificationManager

Replace NotificationManager's separate settings with the unified store.

### 4.1 Update NotificationManager to accept store

**Edit** `extension/src/lib/notifications.ts`:

Remove the internal settings loading:
```typescript
// DELETE these:
const SETTINGS_KEY = 'notificationSettings'

export interface NotificationSettings { ... }  // DELETE
export const DEFAULT_NOTIFICATION_SETTINGS = { ... }  // DELETE

// In constructor, DELETE:
this.loadSettings()

// DELETE these methods:
async loadSettings(): Promise<void> { ... }
async saveSettings(settings: Partial<NotificationSettings>): Promise<void> { ... }
getSettings(): NotificationSettings { ... }
```

Replace with store-based approach:
```typescript
import type { ISettingsStore } from '@jstorrent/engine'

export class NotificationManager {
  private store: ISettingsStore
  private uiVisible: boolean = true
  private progressNotificationActive: boolean = false
  private lastProgressStats: ProgressStats | null = null

  constructor(store: ISettingsStore) {
    this.store = store
    this.setupClickHandler()
  }

  // Update all settings reads to use store:
  // this.settings.onTorrentComplete -> this.store.get('notifications.onTorrentComplete')
  // this.settings.onAllComplete -> this.store.get('notifications.onAllComplete')
  // this.settings.onError -> this.store.get('notifications.onError')
  // this.settings.progressWhenBackgrounded -> this.store.get('notifications.progressWhenBackgrounded')
}
```

### 4.2 Update SW to create store and pass to NotificationManager

**Edit** `extension/src/sw.ts`:

Add imports:
```typescript
import { ChromeStorageSettingsStore } from '@jstorrent/client'
```

Create store before NotificationManager:
```typescript
// Initialize settings store
const settingsStore = new ChromeStorageSettingsStore()

// Initialize notification manager with store
let notificationManager: NotificationManager | null = null

// Init async
;(async () => {
  await settingsStore.init()
  settingsStore.startListening()
  notificationManager = new NotificationManager(settingsStore)
})()
```

Update notification message handlers to check if manager exists:
```typescript
function handleNotificationMessage(message: NotificationMessage): void {
  if (!notificationManager) return
  // ... rest of handler
}
```

### Verification

```bash
pnpm typecheck
pnpm test
```

Manually verify:
1. Notification settings changes in UI affect actual notifications
2. Completing a download shows/hides notification based on setting

---

## Phase 5: Register Settings Effects

Create centralized effect registration for settings that need to apply changes to the engine.

### 5.1 Create effects module

**Create** `packages/client/src/settings/effects.ts`:

```typescript
/**
 * Settings Effects
 *
 * Registers subscribers that apply settings changes to the engine and other systems.
 */

import type { ISettingsStore } from '@jstorrent/engine'
import { engineManager } from '../chrome/engine-manager'
import { applyTheme } from '@jstorrent/ui'

/**
 * Register all settings effects.
 * Call once after settings store and engine are initialized.
 * Returns cleanup function.
 */
export function registerSettingsEffects(store: ISettingsStore): () => void {
  const unsubscribers: Array<() => void> = []

  // Rate limits
  unsubscribers.push(
    store.subscribe('downloadSpeedLimit', (download) => {
      const upload = store.get('uploadSpeedLimit')
      engineManager.setRateLimits(download, upload)
    }),
  )
  unsubscribers.push(
    store.subscribe('uploadSpeedLimit', (upload) => {
      const download = store.get('downloadSpeedLimit')
      engineManager.setRateLimits(download, upload)
    }),
  )

  // Connection limits
  unsubscribers.push(
    store.subscribe('maxPeersPerTorrent', (perTorrent) => {
      const global = store.get('maxGlobalPeers')
      engineManager.setConnectionLimits(perTorrent, global)
    }),
  )
  unsubscribers.push(
    store.subscribe('maxGlobalPeers', (global) => {
      const perTorrent = store.get('maxPeersPerTorrent')
      engineManager.setConnectionLimits(perTorrent, global)
    }),
  )

  // Theme
  unsubscribers.push(
    store.subscribe('theme', (theme) => {
      applyTheme(theme)
    }),
  )

  // Apply initial values
  applyTheme(store.get('theme'))

  return () => {
    for (const unsub of unsubscribers) {
      unsub()
    }
  }
}
```

### 5.2 Register effects in App.tsx

**Edit** `packages/client/src/App.tsx`:

Add import:
```typescript
import { registerSettingsEffects } from './settings/effects'
```

After engine initialization succeeds, register effects:
```typescript
useEffect(() => {
  if (isConnected && !engine && !initStartedRef.current && !initError) {
    initStartedRef.current = true
    engineManager
      .init()
      .then((eng) => {
        setEngine(eng)
        // Register settings effects now that engine is ready
        registerSettingsEffects(settingsStore)
        // ... rest of existing code
      })
      // ...
  }
}, [isConnected, engine, initError, settingsStore])
```

### 5.3 Remove manual effect calls from SettingsOverlay

**Edit** `packages/client/src/components/SettingsOverlay.tsx`:

In NetworkTab, remove the manual engine calls:
```typescript
// BEFORE:
const handleDownloadLimitChange = (v: number) => {
  updateSetting('downloadSpeedLimit', v)
  engineManager.setRateLimits(v, settings.uploadSpeedLimit)
}

// AFTER:
const handleDownloadLimitChange = (v: number) => {
  updateSetting('downloadSpeedLimit', v)
  // Effect handles applying to engine
}
```

Remove all `engineManager.setRateLimits()` and `engineManager.setConnectionLimits()` calls from the settings UI.

### Verification

```bash
pnpm typecheck
pnpm test
```

Manually verify:
1. Changing rate limit in settings affects actual download speed
2. Changing theme in settings updates UI immediately

---

## Phase 6: Update SettingsOverlay UI

Update the settings UI to use new setting keys and expose all notification settings.

### 6.1 Fix notification settings section

**Edit** `packages/client/src/components/SettingsOverlay.tsx`:

In GeneralTab, update the Behavior section:
```typescript
<Section title="Notifications">
  <ToggleRow
    label="Notify when torrent completes"
    sublabel="Show notification when a single download finishes"
    checked={settings['notifications.onTorrentComplete']}
    onChange={(v) => updateSetting('notifications.onTorrentComplete', v)}
  />
  <ToggleRow
    label="Notify when all complete"
    sublabel="Show notification when all downloads finish"
    checked={settings['notifications.onAllComplete']}
    onChange={(v) => updateSetting('notifications.onAllComplete', v)}
  />
  <ToggleRow
    label="Notify on errors"
    sublabel="Show notification when a download fails"
    checked={settings['notifications.onError']}
    onChange={(v) => updateSetting('notifications.onError', v)}
  />
  <ToggleRow
    label="Show progress when backgrounded"
    sublabel="Persistent notification with download progress when UI is hidden"
    checked={settings['notifications.progressWhenBackgrounded']}
    onChange={(v) => updateSetting('notifications.progressWhenBackgrounded', v)}
  />
</Section>

<Section title="Behavior">
  <ToggleRow
    label="Keep system awake while downloading"
    sublabel="Prevents sleep during active downloads (requires permission)"
    checked={settings.keepAwake}
    onChange={(v) => updateSetting('keepAwake', v)}
  />
</Section>
```

### Verification

```bash
pnpm typecheck
pnpm test
```

Manually verify:
1. All 4 notification toggles appear in settings
2. Toggling them affects notification behavior

---

## Phase 7: Delete Dead Code

Remove the old settings infrastructure.

### 7.1 Clean up useAppSettings

**Edit** `packages/ui/src/hooks/useAppSettings.ts`:

Keep only:
- `getMaxFps()` function
- `setMaxFpsCache()` function  
- `cachedMaxFps` variable
- `applyTheme()` function
- `getEffectiveTheme()` function
- Theme type export

Delete:
- `settingsSchema` (moved to engine)
- `AppSettings` type (use `Settings` from engine)
- `loadSettings()` function
- `saveSettings()` function
- `useAppSettings()` hook
- All the schema-related type utilities

### 7.2 Update ui package exports

**Edit** `packages/ui/src/index.ts`:

Remove exports for deleted items. Keep:
```typescript
export { getMaxFps, setMaxFpsCache, applyTheme, getEffectiveTheme } from './hooks/useAppSettings'
export type { Theme } from './hooks/useAppSettings'
```

### 7.3 Delete old notification settings

The NotificationSettings interface and DEFAULT_NOTIFICATION_SETTINGS were already removed in Phase 4.

### 7.4 Remove unused imports

Search for and remove any remaining imports of:
- `loadSettings` from `@jstorrent/ui`
- `useAppSettings` from `@jstorrent/ui`
- `AppSettings` type from `@jstorrent/ui`

### Verification

```bash
pnpm typecheck
pnpm test
pnpm lint
```

---

## Summary

After all phases complete:

1. **Single schema** in `packages/engine/src/settings/schema.ts` defines all settings
2. **Single interface** `ISettingsStore` used everywhere
3. **Adapters** handle storage backend (localStorage for dev, chrome.storage for extension)
4. **Pub/sub** automatically applies changes via registered effects
5. **React context** provides settings to UI components
6. **No more** scattered init code, duplicate settings, or dead code

Settings flow:
```
User changes setting in UI
    ↓
store.set('key', value)
    ↓
Cache updated + subscribers notified
    ↓
Effect applies change (e.g., engineManager.setRateLimits)
    ↓
Storage persisted async
```
