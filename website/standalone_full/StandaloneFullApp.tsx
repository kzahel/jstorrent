import { useState, useEffect, useRef, useCallback } from 'react'
import {
  BtEngine,
  DaemonConnection,
  DaemonSocketFactory,
  DaemonFileSystem,
  StorageRootManager,
} from '@jstorrent/engine'
import { JsBridgeSessionStore, JsBridgeSettingsStore } from '@jstorrent/engine/adapters/android'
import { AppContent, EngineProvider, SettingsProvider } from '@jstorrent/client/core'
import { formatBytes, applyTheme, setMaxFpsCache, setProgressBarStyleCache } from '@jstorrent/ui'

declare global {
  interface Window {
    JSTORRENT_CONFIG?: { daemonUrl: string; platform: string }
    onJSTorrentConfig?: (config: { daemonUrl: string; platform: string }) => void
    handleMagnet?: (link: string) => void
    handleTorrentFile?: (name: string, base64: string) => void
    RootsBridge?: {
      hasDownloadRoot(): boolean
      getDownloadRoots(): string
      getDefaultRootKey(): string | null
    }
    // Debug exports
    engine?: unknown
    daemonConnection?: unknown
  }
}

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

  return <StandaloneFullAppInner config={config} />
}

interface StandaloneFullAppInnerProps {
  config: { daemonUrl: string; platform: string }
}

function StandaloneFullAppInner({ config }: StandaloneFullAppInnerProps) {
  const [engine, setEngine] = useState<BtEngine | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Used to trigger periodic re-renders for stats
  const [, setStatsRevision] = useState(0)
  const engineRef = useRef<BtEngine | null>(null)
  const connectionRef = useRef<DaemonConnection | null>(null)

  // Settings store
  const [settingsStore] = useState(() => new JsBridgeSettingsStore())
  const [settingsReady, setSettingsReady] = useState(false)

  // Initialize settings
  useEffect(() => {
    settingsStore.init().then(() => setSettingsReady(true))
  }, [settingsStore])

  // Keep UI caches updated from settings
  useEffect(() => {
    if (!settingsReady) return

    setMaxFpsCache(settingsStore.get('maxFps'))
    setProgressBarStyleCache(settingsStore.get('progressBarStyle'))
    applyTheme(settingsStore.get('theme'))

    const unsubMaxFps = settingsStore.subscribe('maxFps', setMaxFpsCache)
    const unsubProgressBar = settingsStore.subscribe('progressBarStyle', setProgressBarStyleCache)
    const unsubTheme = settingsStore.subscribe('theme', applyTheme)

    return () => {
      unsubMaxFps()
      unsubProgressBar()
      unsubTheme()
    }
  }, [settingsStore, settingsReady])

  // Initialize engine
  useEffect(() => {
    if (!settingsReady) return

    let mounted = true

    async function initEngine() {
      try {
        console.log('[StandaloneFullApp] Initializing engine with config:', config)

        // Parse daemon URL to get port and auth token
        const url = new URL(config.daemonUrl)
        const port = parseInt(url.port) || 8765
        const authToken = url.searchParams.get('token') || ''

        // Connect to daemon
        const conn = await DaemonConnection.connect(port, authToken)
        await conn.connectWebSocket()
        connectionRef.current = conn

        // Set up storage roots from RootsBridge
        const storageRootManager = new StorageRootManager((root) => {
          return new DaemonFileSystem(conn, root.key)
        })

        // Add roots from bridge
        const rootsJson = window.RootsBridge?.getDownloadRoots()
        const roots: Array<{ key: string; label: string; path: string }> = rootsJson
          ? JSON.parse(rootsJson)
          : []
        for (const root of roots) {
          storageRootManager.addRoot(root)
        }

        // Set default root
        const defaultRootKey = window.RootsBridge?.getDefaultRootKey()
        if (defaultRootKey) {
          storageRootManager.setDefaultRoot(defaultRootKey)
        }

        // Create session store
        const sessionStore = new JsBridgeSessionStore()

        // Create engine
        const eng = new BtEngine({
          socketFactory: new DaemonSocketFactory(conn),
          storageRootManager,
          sessionStore,
          port: 6881,
          startSuspended: true,
        })

        if (mounted) {
          engineRef.current = eng
          setEngine(eng)

          // Debug exports
          window.engine = eng
          window.daemonConnection = conn

          // Restore session
          await eng.restoreSession()
          eng.resume()

          // Enable DHT for peer discovery (don't await - bootstrap can take a while)
          eng.setDHTEnabled(true).catch((err) => {
            console.error('[StandaloneFullApp] DHT failed to start:', err)
          })
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
      if (engineRef.current) {
        engineRef.current.destroy()
        engineRef.current = null
      }
      if (connectionRef.current) {
        connectionRef.current.close()
        connectionRef.current = null
      }
      window.engine = undefined
      window.daemonConnection = undefined
    }
  }, [config, settingsReady])

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

  // Stub callbacks for Chrome-specific features
  const handleOpenFile = useCallback(async (_torrentHash: string, file: { path: string }) => {
    console.warn('[StandaloneFullApp] Open file not implemented for Android:', file.path)
  }, [])

  const handleRevealInFolder = useCallback(async (_torrentHash: string, file: { path: string }) => {
    console.warn('[StandaloneFullApp] Reveal in folder not implemented for Android:', file.path)
  }, [])

  const handleCopyFilePath = useCallback(async (_torrentHash: string, file: { path: string }) => {
    // This might work with clipboard API
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Simple header */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ margin: 0, fontSize: '18px' }}>JSTorrent</h1>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
              {engine.torrents.length} torrents | {engine.numConnections} peers | ↓{' '}
              {formatBytes(engine.torrents.reduce((sum, t) => sum + t.downloadSpeed, 0))}/s | ↑{' '}
              {formatBytes(engine.torrents.reduce((sum, t) => sum + t.uploadSpeed, 0))}/s
            </span>
          </div>
        </div>

        {/* Main content - wrapped AppContent from extension */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <EngineProvider engine={engine}>
            <AppContent
              onOpenFile={handleOpenFile}
              onRevealInFolder={handleRevealInFolder}
              onCopyFilePath={handleCopyFilePath}
            />
          </EngineProvider>
        </div>
      </div>
    </SettingsProvider>
  )
}
