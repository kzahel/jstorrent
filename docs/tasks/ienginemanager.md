# IEngineManager Refactor - Summary for Continuation

## Status: 90% Complete

The core infrastructure is complete. Only `StandaloneFullApp.tsx` needs to be updated to use the new shared components.

---

## What Was Accomplished

### New Files Created

| File | Purpose |
|------|---------|
| `packages/client/src/engine-manager/types.ts` | `IEngineManager` interface + `StorageRoot`, `FileOperationResult` types |
| `packages/client/src/engine-manager/chrome-extension-engine-manager.ts` | Chrome extension implementation (moved/renamed from `chrome/engine-manager.ts`) |
| `packages/client/src/engine-manager/android-standalone-engine-manager.ts` | Android WebView implementation using JS bridges |
| `packages/client/src/engine-manager/index.ts` | Exports for engine manager package |
| `packages/client/src/context/EngineManagerContext.tsx` | React context with `EngineManagerProvider`, `useEngineManager()`, `useFileOperations()` |
| `packages/client/src/hooks/useSettingsInit.ts` | Hook for settings initialization + subscriptions |
| `packages/client/src/components/AppShell.tsx` | Outer layout component (flex column, 100vh) |
| `packages/client/src/components/AppHeader.tsx` | Header with logo, title, slots, stats, buttons |

### Modified Files

| File | Change |
|------|--------|
| `packages/client/src/components/SettingsOverlay.tsx` | Uses `useEngineManager()` context; `supportsFileOperations` prop hides download folder UI |
| `packages/client/src/App.tsx` | Wrapped with `EngineManagerProvider` |
| `packages/client/src/core.ts` | Exports new components, hooks, types |
| `packages/client/src/chrome/engine-manager.ts` | Re-exports from new location for backwards compatibility |

---

## Key Design Decisions

1. **`IEngineManager` interface**: Platform-agnostic contract for engine lifecycle, settings, storage roots, and optional file operations.

2. **`supportsFileOperations` flag**:
   - `true` for `ChromeExtensionEngineManager` (has native file access via system-bridge)
   - `false` for `AndroidStandaloneEngineManager` (no file ops in WebView)
   - Used to conditionally hide Download Locations UI in SettingsOverlay

3. **Context-based access**: Components use `useEngineManager()` instead of direct singleton imports, enabling different implementations per platform.

4. **Optional file operation methods**: `openFile?`, `revealInFolder?`, `openTorrentFolder?`, `pickDownloadFolder?`, `removeDownloadRoot?` - only implemented on Chrome.

5. **Root picker mechanism**: Uses WebSocket broadcast (`ROOTS_CHANGED`) rather than direct callback return. Both platforms fire-and-forget the picker action.

---

## Remaining Work: Refactor StandaloneFullApp.tsx

**File**: `website/standalone_full/StandaloneFullApp.tsx`

### What Needs to Be Done

1. **Create engine manager instance**:
   ```typescript
   import { AndroidStandaloneEngineManager } from '@jstorrent/client/core'

   const engineManager = new AndroidStandaloneEngineManager()
   // Set config when JSTORRENT_CONFIG is available
   ```

2. **Wrap with providers**:
   ```tsx
   <EngineManagerProvider manager={engineManager}>
     <SettingsProvider store={settingsStore}>
       {/* app content */}
     </SettingsProvider>
   </EngineManagerProvider>
   ```

3. **Use shared UI components**:
   ```tsx
   import { AppShell, AppHeader, SettingsOverlay, useSettingsInit } from '@jstorrent/client/core'

   <AppShell
     header={
       <AppHeader
         engine={engine}
         isConnected={isConnected}
         logoSrc="/path/to/logo.png"
         onSettingsClick={() => setShowSettings(true)}
       />
     }
   >
     <AppContent ... />
   </AppShell>
   ```

4. **Add SettingsOverlay**:
   ```tsx
   {showSettings && (
     <SettingsOverlay onClose={() => setShowSettings(false)} />
   )}
   ```

5. **Use `useSettingsInit` hook** for settings store initialization.

### Current StandaloneFullApp Structure

The file currently:
- Creates its own header inline (missing logo, missing Settings button)
- Uses `JsBridgeSettingsStore` directly
- Has `AppContent` but duplicates layout structure
- Doesn't have access to shared components

### After Refactor

- Uses `AndroidStandaloneEngineManager` for engine lifecycle
- Uses `AppShell` + `AppHeader` for consistent UI
- Shows Settings button that opens `SettingsOverlay`
- Download folder section hidden (since `supportsFileOperations = false`)

---

## Testing Checklist

After completing the refactor:

1. `pnpm run typecheck` - Verify types
2. `pnpm run test` - Run all tests (791 engine, 13 UI, 12 extension should pass)
3. `pnpm run lint` - Check lint (some pre-existing warnings exist)
4. `pnpm format:fix` - Fix formatting last

---

## Reference: IEngineManager Interface

```typescript
export interface IEngineManager {
  readonly engine: BtEngine | null
  readonly logStore: LogStore
  readonly supportsFileOperations: boolean

  // Lifecycle
  init(): Promise<BtEngine>
  shutdown(): void
  reset(): void

  // Settings
  setRateLimits(downloadLimit: number, uploadLimit: number): void
  setConnectionLimits(maxPeersPerTorrent: number, maxGlobalPeers: number, maxUploadSlots: number): void
  setDaemonRateLimit(opsPerSecond: number, burstSize: number): void
  setEncryptionPolicy(policy: 'disabled' | 'allow' | 'prefer' | 'required'): void
  setDHTEnabled(enabled: boolean): Promise<void>
  setUPnPEnabled(enabled: boolean): Promise<void>
  setLoggingConfig(config: EngineLoggingConfig): void

  // Storage roots
  getRoots(): StorageRoot[]
  getDefaultRootKey(): Promise<string | null>
  setDefaultRoot(key: string): Promise<void>

  // Optional file operations (Chrome only)
  openFile?(torrentHash: string, filePath: string): Promise<FileOperationResult>
  revealInFolder?(torrentHash: string, filePath: string): Promise<FileOperationResult>
  openTorrentFolder?(torrentHash: string): Promise<FileOperationResult>
  getFilePath?(torrentHash: string, filePath: string): string | null
  pickDownloadFolder?(): Promise<StorageRoot | null>
  removeDownloadRoot?(key: string): Promise<boolean>

  // Native events
  handleNativeEvent(event: string, payload: unknown): Promise<void>
}
```
