import { useState, useEffect, useCallback } from 'react'
import { JsBridgeSettingsStore } from '@jstorrent/engine/adapters/android'
import {
  AppContent,
  AppShell,
  AppHeader,
  SettingsOverlay,
  EngineProvider,
  EngineManagerProvider,
  SettingsProvider,
  useSettingsInit,
} from '@jstorrent/client/core'
import { AndroidStandaloneEngineManager } from '@jstorrent/client/android'
import type { BtEngine } from '@jstorrent/engine'

declare global {
  interface Window {
    JSTORRENT_CONFIG?: { daemonUrl: string; platform: string }
    onJSTorrentConfig?: (config: { daemonUrl: string; platform: string }) => void
    handleMagnet?: (link: string) => void
    handleTorrentFile?: (name: string, base64: string) => void
  }
}

// Create engine manager singleton (will be configured when config is available)
const engineManager = new AndroidStandaloneEngineManager()

export function StandaloneFullApp() {
  const [config, setConfig] = useState(window.JSTORRENT_CONFIG || null)

  // Set up callback for config injection (only if not already available)
  useEffect(() => {
    // Config already available from initial state, no need to do anything
    if (config) return

    // Set up callback for async config injection from Android WebView
    window.onJSTorrentConfig = (cfg) => {
      console.log('[StandaloneFullApp] Config received:', cfg)
      setConfig(cfg)
    }

    return () => {
      window.onJSTorrentConfig = undefined
    }
  }, [config])

  if (!config) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#e0e0e0' }}>Connecting...</div>
    )
  }

  // Configure engine manager with the received config
  engineManager.setConfig(config)

  return <StandaloneFullAppInner />
}

function StandaloneFullAppInner() {
  const [engine, setEngine] = useState<BtEngine | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Used to trigger periodic re-renders for stats
  const [, setStatsRevision] = useState(0)

  // Settings store and overlay state
  const [settingsStore] = useState(() => new JsBridgeSettingsStore())
  const settingsReady = useSettingsInit(settingsStore)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'general' | 'interface' | 'network' | 'advanced'>(
    'general',
  )

  // Initialize engine using AndroidStandaloneEngineManager
  useEffect(() => {
    if (!settingsReady) return

    let mounted = true

    async function initEngine() {
      try {
        console.log('[StandaloneFullApp] Initializing engine via AndroidStandaloneEngineManager')
        const eng = await engineManager.init()

        if (mounted) {
          setEngine(eng)
        }
      } catch (err) {
        console.error('[StandaloneFullApp] Failed to initialize:', err)
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to start engine')
        }
      }
    }

    initEngine()

    return () => {
      mounted = false
      // Note: Don't shutdown the engine manager here since the singleton
      // may be reused if the component remounts
    }
  }, [settingsReady])

  // Periodic stats refresh
  useEffect(() => {
    if (!engine) return
    const interval = setInterval(() => setStatsRevision((n) => n + 1), 1000)
    return () => clearInterval(interval)
  }, [engine])

  // Set up global handlers for intents
  useEffect(() => {
    if (!engine) return

    window.handleMagnet = (link: string) => {
      console.log('[StandaloneFullApp] handleMagnet:', link)
      engine.addTorrent(link).catch(console.error)
    }

    window.handleTorrentFile = (_name: string, base64: string) => {
      console.log('[StandaloneFullApp] handleTorrentFile')
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      engine.addTorrent(bytes).catch(console.error)
    }

    return () => {
      window.handleMagnet = undefined
      window.handleTorrentFile = undefined
    }
  }, [engine])

  // Stub callbacks for Chrome-specific features (not available on Android)
  const handleOpenFile = useCallback(async (_torrentHash: string, file: { path: string }) => {
    console.warn('[StandaloneFullApp] Open file not implemented for Android:', file.path)
  }, [])

  const handleRevealInFolder = useCallback(async (_torrentHash: string, file: { path: string }) => {
    console.warn('[StandaloneFullApp] Reveal in folder not implemented for Android:', file.path)
  }, [])

  const handleCopyFilePath = useCallback(async (_torrentHash: string, file: { path: string }) => {
    try {
      await navigator.clipboard.writeText(file.path)
      console.log('[StandaloneFullApp] Copied path to clipboard:', file.path)
    } catch (err) {
      console.warn('[StandaloneFullApp] Failed to copy path:', err)
    }
  }, [])

  // Wait for settings to load
  if (!settingsReady) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#e0e0e0' }}>
        Loading settings...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#f44336' }}>Error: {error}</div>
    )
  }

  if (!engine) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#e0e0e0' }}>
        Starting engine...
      </div>
    )
  }

  return (
    <SettingsProvider store={settingsStore}>
      <EngineManagerProvider manager={engineManager}>
        <AppShell
          header={
            <AppHeader
              engine={engine}
              isConnected={true}
              onSettingsClick={() => setSettingsOpen(true)}
              logoSrc="/js-32.png"
              // No onBugReportClick - hide bug report on Android
            />
          }
        >
          <EngineProvider engine={engine}>
            <AppContent
              onOpenFile={handleOpenFile}
              onRevealInFolder={handleRevealInFolder}
              onCopyFilePath={handleCopyFilePath}
            />
          </EngineProvider>
        </AppShell>

        {/* Settings overlay - Download Locations section hidden since supportsFileOperations=false */}
        <SettingsOverlay
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          activeTab={settingsTab}
          setActiveTab={setSettingsTab}
        />
      </EngineManagerProvider>
    </SettingsProvider>
  )
}
