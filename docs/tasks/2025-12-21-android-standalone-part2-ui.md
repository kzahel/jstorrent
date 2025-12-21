# Android Standalone Part 2: UI & Build

**Status:** Ready for execution (after Part 1)  
**Depends on:** `2025-12-21-android-standalone-part1-kotlin.md`  
**Scope:** Standalone HTML/React UI, build configuration

---

## Prerequisites

Part 1 must be complete. Verify:
1. `window.KVBridge` and `window.RootsBridge` are available in WebView
2. `window.JSTORRENT_CONFIG` is injected on page load
3. StandaloneActivity routes correctly on non-Chromebook devices

---

## Context

Build a minimal "transmission-style" torrent client UI:
- Torrent list with progress
- Add button (magnet link input)
- Pause/resume/remove actions
- Download folder picker (SAF via existing AddRootActivity)
- Settings (connection limits)

**No detail pane, no file list, no peer view.** Keep it simple.

---

## Phase 4: Standalone UI

### 4.1 Create standalone directory

```bash
mkdir -p website/standalone/components
mkdir -p website/standalone/hooks
```

### 4.2 Create standalone.html

```html
<!-- website/standalone/standalone.html -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="#1a1a1a">
    <title>JSTorrent</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-tap-highlight-color: transparent;
        }
        html, body, #root {
            height: 100%;
            width: 100%;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #e0e0e0;
            overflow: hidden;
        }
        /* Prevent pull-to-refresh */
        body {
            overscroll-behavior: none;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="./standalone.tsx"></script>
</body>
</html>
```

### 4.3 Create standalone.tsx

```tsx
// website/standalone/standalone.tsx
import { createRoot } from 'react-dom/client'
import { StandaloneApp } from './App'
import './styles.css'

// Wait for either immediate config or callback
function init() {
  const root = createRoot(document.getElementById('root')!)
  root.render(<StandaloneApp />)
}

// Start immediately - App will wait for config internally
init()
```

### 4.4 Create styles.css

```css
/* website/standalone/styles.css */

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a1a;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #252525;
  border-bottom: 1px solid #333;
}

.header h1 {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 8px;
  background: #333;
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:active {
  background: #444;
}

/* Torrent List */
.torrent-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  text-align: center;
  padding: 20px;
}

.empty-state p {
  margin: 8px 0;
}

/* Torrent Row */
.torrent-row {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #2a2a2a;
}

.torrent-row:active {
  background: #252525;
}

.torrent-info {
  flex: 1;
  min-width: 0;
}

.torrent-name {
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.torrent-stats {
  font-size: 12px;
  color: #888;
  margin-top: 4px;
}

.progress-bar {
  height: 4px;
  background: #333;
  border-radius: 2px;
  margin-top: 8px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #4CAF50;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-fill.paused {
  background: #888;
}

.progress-fill.error {
  background: #f44336;
}

.torrent-actions {
  display: flex;
  gap: 4px;
  margin-left: 12px;
}

.torrent-actions button {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #888;
  font-size: 16px;
  cursor: pointer;
}

.torrent-actions button:active {
  background: #333;
  color: #fff;
}

/* Dialogs */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 100;
}

.dialog {
  background: #252525;
  border-radius: 12px;
  width: 100%;
  max-width: 400px;
  padding: 20px;
}

.dialog h2 {
  font-size: 18px;
  margin-bottom: 16px;
  color: #fff;
}

.dialog input[type="text"] {
  width: 100%;
  padding: 12px;
  border: 1px solid #444;
  border-radius: 8px;
  background: #1a1a1a;
  color: #fff;
  font-size: 14px;
  margin-bottom: 16px;
}

.dialog input[type="text"]:focus {
  outline: none;
  border-color: #4CAF50;
}

.dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.dialog-actions button {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.btn-cancel {
  background: #333;
  color: #fff;
}

.btn-primary {
  background: #4CAF50;
  color: #fff;
}

/* Folder prompt */
.folder-prompt {
  background: #2a2a2a;
  padding: 16px;
  margin: 12px;
  border-radius: 8px;
  text-align: center;
}

.folder-prompt p {
  color: #888;
  margin-bottom: 12px;
}

.folder-prompt button {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  background: #4CAF50;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

/* Loading state */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
}

/* Settings */
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #333;
}

.settings-row:last-child {
  border-bottom: none;
}

.settings-label {
  color: #fff;
}

.settings-value {
  color: #888;
}

.settings-input {
  width: 80px;
  padding: 8px;
  border: 1px solid #444;
  border-radius: 6px;
  background: #1a1a1a;
  color: #fff;
  text-align: right;
}
```

### 4.5 Create App.tsx

```tsx
// website/standalone/App.tsx
import { useState, useEffect, useCallback } from 'react'
import { useEngine } from './hooks/useEngine'
import { TorrentList } from './components/TorrentList'
import { AddTorrentDialog } from './components/AddTorrentDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { FolderPrompt } from './components/FolderPrompt'

declare global {
  interface Window {
    JSTORRENT_CONFIG?: { daemonUrl: string; platform: string }
    onJSTorrentConfig?: (config: { daemonUrl: string; platform: string }) => void
    handleMagnet?: (link: string) => void
    handleTorrentFile?: (name: string, base64: string) => void
  }
}

export function StandaloneApp() {
  const [config, setConfig] = useState(window.JSTORRENT_CONFIG || null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Wait for config injection
  useEffect(() => {
    if (window.JSTORRENT_CONFIG) {
      setConfig(window.JSTORRENT_CONFIG)
    } else {
      window.onJSTorrentConfig = (cfg) => {
        console.log('[App] Config received:', cfg)
        setConfig(cfg)
      }
    }
  }, [])

  if (!config) {
    return <div className="loading">Connecting...</div>
  }

  return (
    <StandaloneAppInner
      config={config}
      showAddDialog={showAddDialog}
      setShowAddDialog={setShowAddDialog}
      showSettings={showSettings}
      setShowSettings={setShowSettings}
    />
  )
}

interface StandaloneAppInnerProps {
  config: { daemonUrl: string; platform: string }
  showAddDialog: boolean
  setShowAddDialog: (show: boolean) => void
  showSettings: boolean
  setShowSettings: (show: boolean) => void
}

function StandaloneAppInner({
  config,
  showAddDialog,
  setShowAddDialog,
  showSettings,
  setShowSettings,
}: StandaloneAppInnerProps) {
  const { engine, torrents, isReady, hasDownloadRoot, error } = useEngine(config)

  // Set up global handlers for intents
  useEffect(() => {
    if (!engine) return

    window.handleMagnet = (link: string) => {
      console.log('[App] handleMagnet:', link)
      engine.addMagnet(link)
    }

    window.handleTorrentFile = (name: string, base64: string) => {
      console.log('[App] handleTorrentFile:', name)
      engine.addTorrentFromBase64(name, base64)
    }

    return () => {
      window.handleMagnet = undefined
      window.handleTorrentFile = undefined
    }
  }, [engine])

  const handlePause = useCallback(
    (id: string) => {
      engine?.pauseTorrent(id)
    },
    [engine]
  )

  const handleResume = useCallback(
    (id: string) => {
      engine?.resumeTorrent(id)
    },
    [engine]
  )

  const handleRemove = useCallback(
    (id: string) => {
      engine?.removeTorrent(id)
    },
    [engine]
  )

  const handleAddMagnet = useCallback(
    (magnet: string) => {
      engine?.addMagnet(magnet)
      setShowAddDialog(false)
    },
    [engine, setShowAddDialog]
  )

  if (error) {
    return (
      <div className="app">
        <div className="loading" style={{ color: '#f44336' }}>
          Error: {error}
        </div>
      </div>
    )
  }

  if (!isReady) {
    return (
      <div className="app">
        <div className="loading">Starting engine...</div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <h1>JSTorrent</h1>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => setShowAddDialog(true)} title="Add torrent">
            +
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
            ⚙
          </button>
        </div>
      </header>

      {!hasDownloadRoot && <FolderPrompt />}

      <TorrentList
        torrents={torrents}
        onPause={handlePause}
        onResume={handleResume}
        onRemove={handleRemove}
      />

      {showAddDialog && (
        <AddTorrentDialog onAdd={handleAddMagnet} onClose={() => setShowAddDialog(false)} />
      )}

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  )
}
```

### 4.6 Create hooks/useEngine.ts

```tsx
// website/standalone/hooks/useEngine.ts
import { useState, useEffect, useRef } from 'react'
import { BtEngine } from '@jstorrent/engine'
import {
  DaemonConnection,
  DaemonFileSystem,
  DaemonHasher,
} from '@jstorrent/engine/adapters/daemon'
import { JsBridgeSessionStore, JsBridgeSettingsStore } from '@jstorrent/engine/adapters/android'

export interface TorrentState {
  id: string
  infohash: string
  name: string
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  status: 'downloading' | 'seeding' | 'paused' | 'checking' | 'error' | 'queued'
  size: number
  downloaded: number
  uploaded: number
  peers: number
  seeds: number
  eta: number | null
}

interface UseEngineResult {
  engine: BtEngine | null
  torrents: TorrentState[]
  isReady: boolean
  hasDownloadRoot: boolean
  error: string | null
}

export function useEngine(config: { daemonUrl: string }): UseEngineResult {
  const [engine, setEngine] = useState<BtEngine | null>(null)
  const [torrents, setTorrents] = useState<TorrentState[]>([])
  const [isReady, setIsReady] = useState(false)
  const [hasDownloadRoot, setHasDownloadRoot] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const engineRef = useRef<BtEngine | null>(null)

  useEffect(() => {
    let mounted = true
    let pollInterval: ReturnType<typeof setInterval> | null = null

    async function initEngine() {
      try {
        console.log('[useEngine] Initializing with config:', config)

        // Check for download root
        const rootsAvailable = window.RootsBridge?.hasDownloadRoot() ?? false
        if (mounted) setHasDownloadRoot(rootsAvailable)

        // Get default root key for daemon operations
        const defaultRootKey = window.RootsBridge?.getDefaultRootKey() ?? 'default'

        // Create adapters
        const sessionStore = new JsBridgeSessionStore()
        const settingsStore = new JsBridgeSettingsStore()

        // Create engine with daemon adapters
        // Note: Adjust these imports/constructors based on actual engine API
        const eng = new BtEngine({
          sessionStore,
          settingsStore,
          daemonUrl: config.daemonUrl,
          defaultRootKey,
        })

        await eng.start()

        if (mounted) {
          engineRef.current = eng
          setEngine(eng)
          setIsReady(true)

          // Poll for state updates
          pollInterval = setInterval(() => {
            if (engineRef.current) {
              const states = engineRef.current.getTorrentStates()
              setTorrents(states)
            }
          }, 500)
        }
      } catch (err) {
        console.error('[useEngine] Failed to initialize:', err)
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to start engine')
        }
      }
    }

    initEngine()

    return () => {
      mounted = false
      if (pollInterval) clearInterval(pollInterval)
      if (engineRef.current) {
        engineRef.current.stop()
        engineRef.current = null
      }
    }
  }, [config.daemonUrl])

  // Watch for root changes
  useEffect(() => {
    const checkRoots = () => {
      const available = window.RootsBridge?.hasDownloadRoot() ?? false
      setHasDownloadRoot(available)
    }

    // Check periodically in case user adds a root
    const interval = setInterval(checkRoots, 2000)
    return () => clearInterval(interval)
  }, [])

  return { engine, torrents, isReady, hasDownloadRoot, error }
}
```

### 4.7 Create components/TorrentList.tsx

```tsx
// website/standalone/components/TorrentList.tsx
import type { TorrentState } from '../hooks/useEngine'
import { formatBytes, formatSpeed, formatEta } from './format'

interface TorrentListProps {
  torrents: TorrentState[]
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRemove: (id: string) => void
}

export function TorrentList({ torrents, onPause, onResume, onRemove }: TorrentListProps) {
  if (torrents.length === 0) {
    return (
      <div className="empty-state">
        <p style={{ fontSize: '48px' }}>📥</p>
        <p>No torrents yet</p>
        <p style={{ fontSize: '12px' }}>Tap + to add a magnet link</p>
      </div>
    )
  }

  return (
    <div className="torrent-list">
      {torrents.map((t) => (
        <TorrentRow
          key={t.id}
          torrent={t}
          onPause={() => onPause(t.id)}
          onResume={() => onResume(t.id)}
          onRemove={() => onRemove(t.id)}
        />
      ))}
    </div>
  )
}

interface TorrentRowProps {
  torrent: TorrentState
  onPause: () => void
  onResume: () => void
  onRemove: () => void
}

function TorrentRow({ torrent, onPause, onResume, onRemove }: TorrentRowProps) {
  const { name, progress, downloadSpeed, uploadSpeed, status, size, eta, peers } = torrent
  const isPaused = status === 'paused'
  const isError = status === 'error'
  const isComplete = progress >= 1

  const statsText = isComplete
    ? `${formatBytes(size)} • Seeding • ↑${formatSpeed(uploadSpeed)}`
    : `${(progress * 100).toFixed(1)}% • ↓${formatSpeed(downloadSpeed)} • ${peers} peers${eta ? ` • ${formatEta(eta)}` : ''}`

  return (
    <div className="torrent-row">
      <div className="torrent-info">
        <div className="torrent-name">{name || 'Loading metadata...'}</div>
        <div className="torrent-stats">{statsText}</div>
        <div className="progress-bar">
          <div
            className={`progress-fill ${isPaused ? 'paused' : ''} ${isError ? 'error' : ''}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
      <div className="torrent-actions">
        {isPaused ? (
          <button onClick={onResume} title="Resume">
            ▶
          </button>
        ) : (
          <button onClick={onPause} title="Pause">
            ⏸
          </button>
        )}
        <button onClick={onRemove} title="Remove">
          ✕
        </button>
      </div>
    </div>
  )
}
```

### 4.8 Create components/format.ts

```typescript
// website/standalone/components/format.ts

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatEta(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return ''
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}
```

### 4.9 Create components/AddTorrentDialog.tsx

```tsx
// website/standalone/components/AddTorrentDialog.tsx
import { useState } from 'react'

interface AddTorrentDialogProps {
  onAdd: (magnet: string) => void
  onClose: () => void
}

export function AddTorrentDialog({ onAdd, onClose }: AddTorrentDialogProps) {
  const [magnet, setMagnet] = useState('')

  const handleSubmit = () => {
    const trimmed = magnet.trim()
    if (trimmed.startsWith('magnet:')) {
      onAdd(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Add Torrent</h2>
        <input
          type="text"
          placeholder="Paste magnet link..."
          value={magnet}
          onChange={(e) => setMagnet(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <div className="dialog-actions">
          <button className="btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!magnet.trim().startsWith('magnet:')}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
```

### 4.10 Create components/FolderPrompt.tsx

```tsx
// website/standalone/components/FolderPrompt.tsx

export function FolderPrompt() {
  const openFolderPicker = () => {
    // Trigger SAF picker via internal intent
    window.location.href = 'jstorrent://add-root'
  }

  return (
    <div className="folder-prompt">
      <p>Select a download folder to get started</p>
      <button onClick={openFolderPicker}>Choose Folder</button>
    </div>
  )
}
```

### 4.11 Create components/SettingsDialog.tsx

```tsx
// website/standalone/components/SettingsDialog.tsx
import { useState, useEffect } from 'react'
import { JsBridgeSettingsStore, type Settings } from '@jstorrent/engine/adapters/android'

interface SettingsDialogProps {
  onClose: () => void
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const settingsStore = new JsBridgeSettingsStore()

  useEffect(() => {
    settingsStore.getSettings().then((s) => {
      setSettings(s ?? {})
      setLoading(false)
    })
  }, [])

  const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const updated = { ...settings, [key]: value }
    setSettings(updated)
    await settingsStore.saveSettings(updated)
  }

  const openFolderPicker = () => {
    window.location.href = 'jstorrent://add-root'
  }

  if (loading) {
    return (
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <h2>Settings</h2>
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-row">
          <span className="settings-label">Max connections</span>
          <input
            type="number"
            className="settings-input"
            value={settings.maxConnections ?? 50}
            onChange={(e) => updateSetting('maxConnections', parseInt(e.target.value) || 50)}
            min={1}
            max={200}
          />
        </div>

        <div className="settings-row">
          <span className="settings-label">Download folder</span>
          <button className="btn-primary" onClick={openFolderPicker}>
            Change
          </button>
        </div>

        <div className="dialog-actions" style={{ marginTop: '20px' }}>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
```

### ⚠️ CHECKPOINT 4

Before proceeding:
1. All component files exist in `website/standalone/`
2. Run `pnpm typecheck` - resolve any type errors
3. May need to adjust imports based on actual engine API

---

## Phase 5: Vite Configuration

Add standalone as a build entry point.

### 5.1 Update website vite config

Check existing config first:

```bash
cat website/vite.config.ts
```

Then add standalone entry:

```typescript
// website/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        standalone: resolve(__dirname, 'standalone/standalone.html'),
      },
    },
  },
  server: {
    port: 3001,
    host: true, // Allow external access for Android emulator
  },
})
```

### 5.2 Add path alias for engine adapters

If not already configured, add path resolution:

```typescript
// Add to vite.config.ts
resolve: {
  alias: {
    '@jstorrent/engine': resolve(__dirname, '../packages/engine/src'),
  },
},
```

### ⚠️ CHECKPOINT 5

Test dev server:
1. Run `cd website && pnpm dev`
2. Open `http://localhost:3001/standalone/standalone.html` in browser
3. Should see "Connecting..." or error about missing bridges (expected outside WebView)

---

## Phase 6: Production Build & Assets

### 6.1 Update Android build to include assets

Add gradle configuration to copy built assets:

```kotlin
// android-io-daemon/app/build.gradle.kts

// Add task to copy website build output
tasks.register<Copy>("copyStandaloneAssets") {
    from("${rootProject.projectDir}/../website/dist/standalone")
    into("src/main/assets/standalone")
    dependsOn(":website:build") // If you have a gradle task for website
}

// Or for manual workflow, just document:
// 1. cd website && pnpm build
// 2. cp -r dist/standalone android-io-daemon/app/src/main/assets/
```

### 6.2 Create assets directory

```bash
mkdir -p android-io-daemon/app/src/main/assets/standalone
```

### 6.3 Add .gitkeep or document build step

Either:
- Add built assets to git (simple, larger repo)
- Add to .gitignore and document build step (smaller repo, CI builds)

Recommended: Document build step in README:

```markdown
## Building Standalone Assets

For release builds, copy the built standalone UI to assets:

```bash
cd website
pnpm build
cp -r dist/standalone ../android-io-daemon/app/src/main/assets/
```
```

### ⚠️ CHECKPOINT 6

Full integration test:
1. Build website: `cd website && pnpm build`
2. Copy assets: `cp -r dist/standalone ../android-io-daemon/app/src/main/assets/`
3. Build APK: `cd android-io-daemon && ./gradlew assembleDebug`
4. Install on Android emulator (not Chromebook image)
5. App should launch with WebView UI
6. Test: Add magnet, see progress, pause/resume

---

## Debugging Tips

### WebView debugging

Enable Chrome DevTools for WebView:

```kotlin
// In StandaloneActivity.onCreate(), add:
if (BuildConfig.DEBUG) {
    WebView.setWebContentsDebuggingEnabled(true)
}
```

Then in Chrome on desktop: `chrome://inspect` → find your WebView

### Common issues

1. **"KVBridge not available"** - Page loaded before bridges injected. Check WebView setup order.

2. **"Failed to connect to daemon"** - IoDaemonService not started, or wrong port. Check logcat.

3. **CORS errors** - Shouldn't happen with file:// or localhost. If loading from dev server, ensure `host: true` in vite config.

4. **Blank screen** - Check console for JS errors via chrome://inspect

---

## Files Created

**New files:**
- `website/standalone/standalone.html`
- `website/standalone/standalone.tsx`
- `website/standalone/styles.css`
- `website/standalone/App.tsx`
- `website/standalone/hooks/useEngine.ts`
- `website/standalone/components/TorrentList.tsx`
- `website/standalone/components/AddTorrentDialog.tsx`
- `website/standalone/components/FolderPrompt.tsx`
- `website/standalone/components/SettingsDialog.tsx`
- `website/standalone/components/format.ts`

**Modified files:**
- `website/vite.config.ts` - Add standalone entry
- `android-io-daemon/app/build.gradle.kts` - Asset copying (optional)

---

## Known Limitations

Document for users:

1. **Foreground only** - Downloads pause when app is backgrounded
2. **No detail view** - Just torrent list, no file/peer details
3. **No file selection** - Downloads all files in torrent
4. **Battery usage** - Keeping app open uses more battery than native apps

These are intentional for MVP scope. A future React Native version would address background downloads.
