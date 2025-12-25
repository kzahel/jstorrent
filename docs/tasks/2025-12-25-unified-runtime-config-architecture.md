# ConfigHub: Unified Runtime Configuration Architecture

**Date:** December 2025  
**Status:** Approved  
**Related:** `docs/research/dynamic-runtime-configuration.md`

---

## Problem Statement

JSTorrent has a growing complexity problem with runtime configuration. Adding a new configurable setting requires touching ~6 layers:

1. **Schema definition** in `packages/engine/src/settings/schema.ts`
2. **Storage** via KV handlers in extension or SharedPreferences in Android
3. **UI component** in settings overlay
4. **Engine method** to apply the setting (e.g., `setRateLimits()`)
5. **Subscription wiring** in React hooks or engine manager
6. **For Android standalone**: JNI wrapper → Kotlin wrapper → engine command

The research doc `dynamic-runtime-configuration.md` captures real bugs from this complexity:
- Multiple instances of state stores with stale views
- Promise caching causing permanent failures
- Race conditions between engine startup and configuration availability
- Default callbacks silently returning wrong values

### Current Pain Points

**1. No Unified Pattern**

Settings fall into several categories with different handling:
- UI-only settings (theme, maxFps) → Only update cache/CSS
- Engine settings (rate limits, connection limits) → Call engine method
- Daemon/platform settings (storage roots) → Notify daemon + engine
- Restart-required settings (listening port) → Just persist, apply on restart

Each has subtly different wiring requirements.

**2. Duplicate Code Across Platforms**

Extension mode:
```
Settings Schema → KVSettingsStore → chrome.storage → SettingsContext → useSettingsSubscription → engineManager.setXxx() → engine.xxx
```

Android standalone:
```
Settings Schema → SharedPreferences → Compose ViewModel → engineController.xxx() → __jstorrent_cmd_xxx() → QuickJS → engine.xxx
```

The engine-level logic is identical, but the transport and wiring differ significantly.

**3. Settings vs Runtime State Conflated**

Two fundamentally different concerns use different systems:
- **Settings**: User preferences, persisted, UI-configurable (ISettingsStore)
- **Runtime state**: Daemon port, connection status, discovered values (scattered)

Both need reactive updates and the lazy getter pattern.

---

## Solution: ConfigHub

A centralized configuration manager that handles **all** reactive configuration - both user settings and runtime state.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Relationship to BtEngine | Separate, injected via options | Cleaner DI, can be created before engine, easier testing |
| Relationship to ISettingsStore | ConfigHub replaces it | One system, not two |
| UI-only settings | Go through ConfigHub | Uniform API, simpler mental model |
| Restart-required settings | Store in normal storage, track "pending" in-memory | No crashes, clear UX |
| Android standalone flow | Kotlin pushes to QuickJS | Kotlin is source of truth for Android |
| Notification granularity | Per-key with batch support | Efficient for single changes, coalescable for bulk |

### Scope

ConfigHub handles three categories:

| Category | Persisted | User-editable | Reactive | Examples |
|----------|-----------|---------------|----------|----------|
| **Settings** | Yes | Yes | Yes | `dhtEnabled`, `downloadSpeedLimit` |
| **Runtime** | No | No | Yes | `daemonPort`, `daemonConnected`, `externalIP` |
| **Storage** | Platform-specific | Yes | Yes | `storageRoots`, `defaultRootKey` |

All three share the same `ConfigValue<T>` interface with `get()`, `getLazy()`, and `subscribe()`.

---

## Core Interface

```typescript
// packages/engine/src/config/config-hub.ts

export interface ConfigValue<T> {
  /** Current value */
  get(): T
  /** Callback-based getter for lazy evaluation (always returns fresh value) */
  getLazy(): () => T
  /** Subscribe to changes */
  subscribe(callback: (value: T, oldValue: T) => void): Unsubscribe
}

export interface ConfigHub {
  // === Settings (persisted, user-editable) ===
  
  // Rate limiting
  readonly downloadSpeedLimit: ConfigValue<number>  // 0 = unlimited
  readonly uploadSpeedLimit: ConfigValue<number>    // 0 = unlimited
  
  // Connection limits
  readonly maxPeersPerTorrent: ConfigValue<number>
  readonly maxGlobalPeers: ConfigValue<number>
  readonly maxUploadSlots: ConfigValue<number>
  
  // Protocol
  readonly encryptionPolicy: ConfigValue<EncryptionPolicy>
  readonly listeningPort: ConfigValue<number>  // restart-required
  
  // Features
  readonly dhtEnabled: ConfigValue<boolean>
  readonly upnpEnabled: ConfigValue<boolean>
  
  // Advanced
  readonly daemonOpsPerSecond: ConfigValue<number>
  readonly daemonOpsBurst: ConfigValue<number>
  
  // UI
  readonly theme: ConfigValue<'system' | 'dark' | 'light'>
  readonly maxFps: ConfigValue<number>
  readonly progressBarStyle: ConfigValue<'text' | 'bar'>
  
  // Notifications (extension-only, but uniform API)
  readonly notifyOnTorrentComplete: ConfigValue<boolean>
  readonly notifyOnAllComplete: ConfigValue<boolean>
  readonly notifyOnError: ConfigValue<boolean>
  
  // Behavior
  readonly keepAwake: ConfigValue<boolean>
  readonly preventBackgroundThrottling: ConfigValue<boolean>
  
  // Logging
  readonly loggingLevel: ConfigValue<LogLevel>
  // Per-component overrides...
  
  // === Runtime (ephemeral, discovered) ===
  
  readonly daemonPort: ConfigValue<number>
  readonly daemonHost: ConfigValue<string>  // '127.0.0.1' | '100.115.92.2'
  readonly daemonConnected: ConfigValue<boolean>
  readonly daemonVersion: ConfigValue<string | null>
  readonly externalIP: ConfigValue<string | null>  // from UPnP
  readonly upnpStatus: ConfigValue<UPnPStatus>
  readonly platformType: ConfigValue<'desktop' | 'chromeos' | 'android-standalone'>
  
  // === Storage ===
  
  readonly storageRoots: ConfigValue<StorageRoot[]>
  readonly defaultRootKey: ConfigValue<string | null>
  
  // === Mutation API ===
  
  /** Update a config value. Notifies subscribers. */
  set<K extends ConfigKey>(key: K, value: ConfigType[K]): void
  
  /** Batch update multiple values. Single coalesced notification per key. */
  batch(updates: Partial<ConfigType>): void
  
  /** Check if a key has pending changes (restart-required) */
  hasPendingChange(key: ConfigKey): boolean
  
  /** Get all pending changes */
  getPendingChanges(): Map<ConfigKey, unknown>
  
  // === Global subscription ===
  
  /** Subscribe to any change */
  subscribeAll(callback: (key: ConfigKey, value: unknown, oldValue: unknown) => void): Unsubscribe
  
  // === Lifecycle ===
  
  /** Initialize from storage. Must call before use. */
  init(): Promise<void>
  
  /** Persist any in-memory state. Call on shutdown. */
  flush(): Promise<void>
}
```

---

## Engine Integration

The engine takes a ConfigHub instead of individual options:

```typescript
// packages/engine/src/core/bt-engine.ts

export interface BtEngineOptions {
  config: ConfigHub
  socketFactory: ISocketFactory
  sessionStore?: ISessionStore
  hasher?: IHasher
  // Remove: maxConnections, maxPeers, port, encryptionPolicy, etc.
}

export class BtEngine {
  constructor(options: BtEngineOptions) {
    const { config } = options
    
    // Apply initial values
    this.bandwidthTracker.setDownloadLimit(config.downloadSpeedLimit.get())
    this.bandwidthTracker.setUploadLimit(config.uploadSpeedLimit.get())
    this.maxPeers = config.maxPeersPerTorrent.get()
    this.encryptionPolicy = config.encryptionPolicy.get()
    // ...
    
    // Subscribe to changes - automatic propagation, wired once
    config.downloadSpeedLimit.subscribe((limit) => {
      this.bandwidthTracker.setDownloadLimit(limit)
    })
    config.uploadSpeedLimit.subscribe((limit) => {
      this.bandwidthTracker.setUploadLimit(limit)
    })
    config.maxPeersPerTorrent.subscribe((max) => {
      this.maxPeers = max
    })
    config.dhtEnabled.subscribe(async (enabled) => {
      if (enabled) await this.enableDHT()
      else await this.disableDHT()
    })
    // ...
  }
}
```

---

## Storage Root Manager Integration

Storage roots become just another config value:

```typescript
// packages/engine/src/storage/storage-root-manager.ts

export class StorageRootManager {
  constructor(
    config: ConfigHub,
    createFs: (root: StorageRoot) => IFileSystem
  ) {
    // Initialize from current config
    this.syncRoots(config.storageRoots.get())
    this.defaultKey = config.defaultRootKey.get()
    
    // Auto-update when config changes
    config.storageRoots.subscribe((roots) => this.syncRoots(roots))
    config.defaultRootKey.subscribe((key) => { this.defaultKey = key })
  }
  
  private syncRoots(newRoots: StorageRoot[]): void {
    const newKeys = new Set(newRoots.map(r => r.key))
    
    // Add new roots
    for (const root of newRoots) {
      if (!this.roots.has(root.key)) {
        this.roots.set(root.key, root)
      }
    }
    
    // Remove old roots
    for (const key of this.roots.keys()) {
      if (!newKeys.has(key)) {
        this.roots.delete(key)
        this.fsCache.delete(key)
      }
    }
  }
}
```

---

## Platform Adapters

### Chrome Extension

```typescript
// packages/client/src/config/chrome-config-hub.ts

export class ChromeConfigHub implements ConfigHub {
  constructor(
    private storage: ChromeStorage,  // Wraps chrome.storage.sync + local
    private daemonBridge: DaemonBridge
  ) {}
  
  // Settings: backed by chrome.storage
  readonly downloadSpeedLimit = this.createSettingValue(
    'downloadSpeedLimit',
    'downloadSpeedLimitUnlimited'  // If true, return 0
  )
  
  readonly dhtEnabled = this.createSettingValue('dht.enabled')
  
  // Runtime: backed by DaemonBridge state
  readonly daemonPort = this.createRuntimeValue(
    () => this.daemonBridge.getPort(),
    (cb) => this.daemonBridge.onPortChanged(cb)
  )
  
  readonly daemonConnected = this.createRuntimeValue(
    () => this.daemonBridge.isConnected(),
    (cb) => this.daemonBridge.onConnectionChanged(cb)
  )
  
  // Storage roots: backed by DaemonBridge
  readonly storageRoots = this.createRuntimeValue(
    () => this.daemonBridge.getRoots(),
    (cb) => this.daemonBridge.onRootsChanged(cb)
  )
  
  // Notifications: settings with platform-specific side effects
  readonly notifyOnTorrentComplete = this.createSettingValueWithSideEffect(
    'notifications.onTorrentComplete',
    (enabled) => {
      // Broadcast to service worker
      chrome.runtime.sendMessage({ 
        type: 'CONFIG_CHANGED', 
        key: 'notifyOnTorrentComplete', 
        value: enabled 
      })
    }
  )
  
  private createSettingValue<T>(key: string, unlimitedKey?: string): ConfigValue<T> {
    return {
      get: () => {
        if (unlimitedKey && this.storage.get(unlimitedKey)) return 0 as T
        return this.storage.get(key) as T
      },
      getLazy: () => () => this.get(),
      subscribe: (cb) => {
        const unsubs = [this.storage.subscribe(key, () => cb(this.get(), ...))]
        if (unlimitedKey) {
          unsubs.push(this.storage.subscribe(unlimitedKey, () => cb(this.get(), ...)))
        }
        return () => unsubs.forEach(u => u())
      }
    }
  }
}
```

### Android Standalone (QuickJS)

```typescript
// packages/engine/src/adapters/native/native-config-hub.ts

export class NativeConfigHub implements ConfigHub {
  private values = new Map<ConfigKey, unknown>()
  private subscribers = new Map<ConfigKey, Set<(value: unknown, old: unknown) => void>>()
  
  constructor(initialValues: Partial<ConfigType>) {
    // Kotlin passes initial values from SharedPreferences
    for (const [key, value] of Object.entries(initialValues)) {
      this.values.set(key as ConfigKey, value)
    }
  }
  
  // All ConfigValue implementations read from the values map
  readonly downloadSpeedLimit = this.createValue('downloadSpeedLimit')
  readonly storageRoots = this.createValue('storageRoots')
  // ...
  
  // Kotlin calls this when config changes (push model)
  set<K extends ConfigKey>(key: K, value: ConfigType[K]): void {
    const oldValue = this.values.get(key)
    this.values.set(key, value)
    this.notifySubscribers(key, value, oldValue)
  }
  
  private createValue<T>(key: ConfigKey): ConfigValue<T> {
    return {
      get: () => this.values.get(key) as T,
      getLazy: () => () => this.values.get(key) as T,
      subscribe: (cb) => {
        let subs = this.subscribers.get(key)
        if (!subs) {
          subs = new Set()
          this.subscribers.set(key, subs)
        }
        subs.add(cb as (value: unknown, old: unknown) => void)
        return () => subs!.delete(cb as (value: unknown, old: unknown) => void)
      }
    }
  }
}

// Exposed to Kotlin via global function
;(globalThis as any).__jstorrent_config_set = (key: string, valueJson: string) => {
  const value = JSON.parse(valueJson)
  nativeConfigHub.set(key as ConfigKey, value)
}
```

### Kotlin Side (Android)

```kotlin
// android/quickjs-engine/src/main/kotlin/com/jstorrent/quickjs/ConfigBridge.kt

class ConfigBridge(
    private val runtime: QuickJSRuntime,
    private val prefs: SharedPreferences
) {
    // Push config change to QuickJS
    fun set(key: String, value: Any) {
        val json = gson.toJson(value)
        runtime.evaluate("__jstorrent_config_set('$key', '$json')")
        
        // Persist if it's a setting (not runtime state)
        if (isPersistedKey(key)) {
            prefs.edit().putString("config:$key", json).apply()
        }
    }
    
    // Called when user changes setting in Compose UI
    fun onSettingChanged(key: String, value: Any) {
        set(key, value)
    }
    
    // Called when storage root added via SAF picker
    fun onRootAdded(root: StorageRoot) {
        val currentRoots = getCurrentRoots()
        set("storageRoots", currentRoots + root)
    }
}
```

---

## Restart-Required Settings

For settings like `listeningPort` that require engine restart:

```typescript
// In ConfigHub implementation
set<K extends ConfigKey>(key: K, value: ConfigType[K]): void {
  if (this.isRestartRequired(key) && this.engineRunning) {
    // Store the new value (persisted)
    this.storage.set(key, value)
    // Track as pending (in-memory only)
    this.pendingChanges.set(key, value)
    // Notify UI that restart is needed
    this.emit('pendingChange', key, value)
    // Don't notify engine subscribers - value not applied yet
  } else {
    this.storage.set(key, value)
    this.notifySubscribers(key, value, oldValue)
  }
}

hasPendingChange(key: ConfigKey): boolean {
  return this.pendingChanges.has(key)
}

// UI can show banner: "Listening port changed. Restart to apply."
// On restart, pendingChanges is empty, fresh values loaded from storage
```

---

## Before/After: DHT Toggle Example

**Before (6 touch points):**

```typescript
// 1. schema.ts
'dht.enabled': { type: 'boolean', storage: 'sync', default: true }

// 2. SettingsOverlay.tsx
<Toggle checked={settings['dht.enabled']} onChange={(v) => set('dht.enabled', v)} />

// 3. chrome-extension-engine-manager.ts - initial apply
this.setDHTEnabled(settingsStore.get('dht.enabled')).catch(...)

// 4. chrome-extension-engine-manager.ts - method
async setDHTEnabled(enabled: boolean): Promise<void> {
  if (!this.engine) return
  await this.engine.setDHTEnabled(enabled)
}

// 5. App.tsx - subscription wiring
useEffect(() => {
  return settingsStore.subscribe('dht.enabled', (enabled) => {
    engineManager.setDHTEnabled(enabled)
  })
}, [])

// 6. bt-engine.ts
async setDHTEnabled(enabled: boolean): Promise<void> { ... }
```

**After (3 touch points):**

```typescript
// 1. config-schema.ts (defines key, type, default, metadata)
dhtEnabled: { type: 'boolean', default: true, storage: 'sync' }

// 2. SettingsOverlay.tsx (unchanged pattern)
<Toggle checked={config.dhtEnabled.get()} onChange={(v) => config.set('dhtEnabled', v)} />

// 3. bt-engine.ts constructor (subscription wired once)
config.dhtEnabled.subscribe(async (enabled) => {
  if (enabled) await this.enableDHT()
  else await this.disableDHT()
})
```

Steps 3-5 from "before" completely disappear. No passthrough methods, no manual subscription wiring in hooks.

---

## File Structure

```
packages/engine/src/config/
  index.ts                 # Public exports
  config-hub.ts            # ConfigHub interface
  config-schema.ts         # All keys, types, defaults, metadata
  config-value.ts          # ConfigValue<T> implementation helpers
  base-config-hub.ts       # Abstract base with common logic
  memory-config-hub.ts     # In-memory implementation for tests

packages/client/src/config/
  index.ts                 # Public exports  
  chrome-config-hub.ts     # Extension adapter
  chrome-storage.ts        # Wrapper around chrome.storage.sync/local

packages/engine/src/adapters/native/
  native-config-hub.ts     # Android standalone adapter
```

---

## Migration Phases

### Phase 1: Core Infrastructure

**Goal:** ConfigHub interface and test implementation working.

1. Create `packages/engine/src/config/` directory
2. Define `ConfigHub` interface and `ConfigValue<T>` 
3. Define config schema with all keys and metadata
4. Implement `MemoryConfigHub` for tests
5. Add unit tests for ConfigHub behavior

**Verification:** All new tests pass, no changes to existing code yet.

### Phase 2: Engine Integration

**Goal:** BtEngine accepts ConfigHub, subscribes to changes.

1. Add `config?: ConfigHub` to `BtEngineOptions`
2. If `config` provided, use it; otherwise fall back to existing options (backward compat)
3. Wire subscriptions in engine constructor for: rate limits, connection limits, encryption, DHT, UPnP
4. Update `StorageRootManager` to optionally accept ConfigHub
5. Update engine presets to create MemoryConfigHub for tests

**Verification:** Existing tests still pass. New tests verify ConfigHub → engine propagation.

### Phase 3: Chrome Extension Adapter

**Goal:** Extension uses ConfigHub, removes manual wiring.

1. Create `ChromeConfigHub` implementing the interface
2. Wire to existing chrome.storage (reuse storage keys for migration)
3. Wire to DaemonBridge for runtime values and storage roots
4. Update `ChromeExtensionEngineManager` to create and use ConfigHub
5. Remove manual `setRateLimits()`, `setConnectionLimits()`, etc. calls
6. Remove subscription wiring in hooks/effects
7. Update `SettingsContext` to use ConfigHub (or replace entirely)

**Verification:** Extension works exactly as before. Settings changes propagate. No regressions.

### Phase 4: Android Standalone Adapter

**Goal:** Android standalone uses ConfigHub.

1. Create `NativeConfigHub` 
2. Add `__jstorrent_config_set()` global function
3. Create Kotlin `ConfigBridge` class
4. Update `EngineController` to use ConfigBridge
5. Wire Compose UI settings to ConfigBridge
6. Remove old `__jstorrent_cmd_add_root()` etc. commands (consolidate to config)

**Verification:** Android standalone settings work. Root addition works.

### Phase 5: Cleanup

**Goal:** Remove deprecated code, single path everywhere.

1. Remove `ISettingsStore` and related classes
2. Remove deprecated engine setter methods (`setConnectionLimits`, etc.)
3. Remove old settings schema (consolidated into config schema)
4. Update all documentation
5. Remove backward-compat code paths in engine

**Verification:** All tests pass. Codebase is simpler.

---

## Success Criteria

1. **Adding a new config key requires changes in ≤3 files** (schema, platform adapter if needed, UI)
2. **No manual subscription wiring** in engine manager, hooks, or App.tsx
3. **Storage root updates "just work"** - same pattern as any other config
4. **Unit tests can mock all configuration** via single MemoryConfigHub
5. **Same ConfigHub interface** works for extension, ChromeOS, and Android standalone
6. **Runtime state accessible uniformly** - `config.daemonPort.get()` works everywhere

---

## References

- `docs/research/dynamic-runtime-configuration.md` - Bug case studies that motivated this
- `packages/engine/src/settings/schema.ts` - Current settings system (to be replaced)
- `packages/client/src/engine-manager/chrome-extension-engine-manager.ts` - Current wiring (to be simplified)
