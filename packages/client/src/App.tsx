import { useState, useRef, useEffect, useCallback } from 'react'
import { formatBytes, setMaxFpsCache, setProgressBarStyleCache, applyTheme } from '@jstorrent/ui'
import { EngineProvider } from './context/EngineContext'
import { SettingsProvider } from './context/SettingsContext'
import { getSettingsStore } from './settings'
import { engineManager, DownloadRoot } from './chrome/engine-manager'
import { useIOBridgeState, ConnectionStatus } from './hooks/useIOBridgeState'
import { useSystemBridge } from './hooks/useSystemBridge'
import { SystemIndicator } from './components/SystemIndicator'
import { SystemBridgePanel } from './components/SystemBridgePanel'
import { SystemBridgePanelChromeos } from './components/SystemBridgePanelChromeos'
import { SettingsOverlay } from './components/SettingsOverlay'
import { useChromeOSBootstrap } from './hooks/useChromeOSBootstrap'
import { notificationBridge } from './chrome/notification-bridge'
import { AppContent } from './AppContent'

// Re-export types for backwards compatibility
export type { AppContentProps, FileInfo } from './AppContent'

/**
 * ChromeAppContent - Wrapper around AppContent that provides Chrome-specific callbacks.
 * Uses engineManager for file operations and notificationBridge for duplicate notifications.
 */
function ChromeAppContent({ onOpenLoggingSettings }: { onOpenLoggingSettings?: () => void }) {
  return (
    <AppContent
      onOpenLoggingSettings={onOpenLoggingSettings}
      onDuplicateTorrent={(name) => notificationBridge.onDuplicateTorrent(name)}
      onOpenFolder={async (torrentHash) => {
        const result = await engineManager.openTorrentFolder(torrentHash)
        if (!result.ok) {
          alert(`Failed to open folder: ${result.error}`)
        }
      }}
      onOpenFile={async (torrentHash, file) => {
        const result = await engineManager.openFile(torrentHash, file.path)
        if (!result.ok) {
          alert(`Failed to open file: ${result.error}`)
        }
      }}
      onRevealInFolder={async (torrentHash, file) => {
        const result = await engineManager.revealInFolder(torrentHash, file.path)
        if (!result.ok) {
          alert(`Failed to reveal in folder: ${result.error}`)
        }
      }}
      onCopyFilePath={async (torrentHash, file) => {
        const fullPath = engineManager.getFilePath(torrentHash, file.path)
        if (fullPath) {
          await navigator.clipboard.writeText(fullPath)
        } else {
          alert('Failed to get file path: storage root not found')
        }
      }}
      shareUrl={import.meta.env.SHARE_URL}
    />
  )
}

function App() {
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof engineManager.init>> | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const initStartedRef = useRef(false)
  const indicatorRef = useRef<HTMLButtonElement>(null)
  const [defaultRootKey, setDefaultRootKey] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Force re-render for stats updates (engine object is mutable)
  const [statsRevision, forceUpdate] = useState(0)

  // Settings store initialization
  const [settingsReady, setSettingsReady] = useState(false)
  const [settingsStore] = useState(() => getSettingsStore())

  useEffect(() => {
    settingsStore.init().then(() => setSettingsReady(true))
  }, [settingsStore])

  // Keep maxFps cache updated from settings store
  useEffect(() => {
    if (!settingsReady) return

    // Initialize cache
    setMaxFpsCache(settingsStore.get('maxFps'))

    // Keep cache updated
    return settingsStore.subscribe('maxFps', (value) => {
      setMaxFpsCache(value)
    })
  }, [settingsStore, settingsReady])

  // Keep progressBarStyle cache updated from settings store
  useEffect(() => {
    if (!settingsReady) return

    // Initialize cache
    setProgressBarStyleCache(settingsStore.get('progressBarStyle'))

    // Keep cache updated
    return settingsStore.subscribe('progressBarStyle', (value) => {
      setProgressBarStyleCache(value)
    })
  }, [settingsStore, settingsReady])

  // Apply theme from settings store
  useEffect(() => {
    if (!settingsReady) return

    // Apply initial theme
    applyTheme(settingsStore.get('theme'))

    // Keep theme updated
    return settingsStore.subscribe('theme', (value) => {
      applyTheme(value)
    })
  }, [settingsStore, settingsReady])

  // Apply rate limits from settings store
  useEffect(() => {
    if (!settingsReady) return

    // Helper to get effective rate limit (0 if unlimited, otherwise the value)
    const getEffectiveDownloadLimit = () =>
      settingsStore.get('downloadSpeedLimitUnlimited') ? 0 : settingsStore.get('downloadSpeedLimit')
    const getEffectiveUploadLimit = () =>
      settingsStore.get('uploadSpeedLimitUnlimited') ? 0 : settingsStore.get('uploadSpeedLimit')

    // Subscribe to rate limit changes (both value and unlimited flag)
    const unsubDownload = settingsStore.subscribe('downloadSpeedLimit', () => {
      engineManager.setRateLimits(getEffectiveDownloadLimit(), getEffectiveUploadLimit())
    })
    const unsubDownloadUnlimited = settingsStore.subscribe('downloadSpeedLimitUnlimited', () => {
      engineManager.setRateLimits(getEffectiveDownloadLimit(), getEffectiveUploadLimit())
    })
    const unsubUpload = settingsStore.subscribe('uploadSpeedLimit', () => {
      engineManager.setRateLimits(getEffectiveDownloadLimit(), getEffectiveUploadLimit())
    })
    const unsubUploadUnlimited = settingsStore.subscribe('uploadSpeedLimitUnlimited', () => {
      engineManager.setRateLimits(getEffectiveDownloadLimit(), getEffectiveUploadLimit())
    })

    return () => {
      unsubDownload()
      unsubDownloadUnlimited()
      unsubUpload()
      unsubUploadUnlimited()
    }
  }, [settingsStore, settingsReady])

  // Apply connection limits from settings store
  useEffect(() => {
    if (!settingsReady) return

    // Subscribe to connection limit changes
    const unsubPerTorrent = settingsStore.subscribe('maxPeersPerTorrent', (value) => {
      engineManager.setConnectionLimits(
        value,
        settingsStore.get('maxGlobalPeers'),
        settingsStore.get('maxUploadSlots'),
      )
    })
    const unsubGlobal = settingsStore.subscribe('maxGlobalPeers', (value) => {
      engineManager.setConnectionLimits(
        settingsStore.get('maxPeersPerTorrent'),
        value,
        settingsStore.get('maxUploadSlots'),
      )
    })
    const unsubUploadSlots = settingsStore.subscribe('maxUploadSlots', (value) => {
      engineManager.setConnectionLimits(
        settingsStore.get('maxPeersPerTorrent'),
        settingsStore.get('maxGlobalPeers'),
        value,
      )
    })

    return () => {
      unsubPerTorrent()
      unsubGlobal()
      unsubUploadSlots()
    }
  }, [settingsStore, settingsReady])

  // Apply UPnP setting from settings store
  useEffect(() => {
    if (!settingsReady || !engine) return

    // Apply initial value
    engineManager.setUPnPEnabled(settingsStore.get('upnp.enabled'))

    // Subscribe to changes
    return settingsStore.subscribe('upnp.enabled', (enabled) => {
      engineManager.setUPnPEnabled(enabled)
    })
  }, [settingsStore, settingsReady, engine])

  // Apply logging settings from settings store
  useEffect(() => {
    if (!settingsReady || !engine) return

    // Helper to build logging config from settings
    const buildLoggingConfig = () => {
      const level = settingsStore.get('logging.level')
      const componentLevels: Record<string, 'debug' | 'info' | 'warn' | 'error'> = {}

      // Component names that have per-component settings
      const components = [
        'client',
        'torrent',
        'peer',
        'active-pieces',
        'content-storage',
        'parts-file',
        'tracker-manager',
        'http-tracker',
        'udp-tracker',
        'dht',
      ] as const

      for (const comp of components) {
        const key = `logging.level.${comp}` as const
        const value = settingsStore.get(key)
        if (value !== 'default') {
          componentLevels[comp] = value
        }
      }

      return { level, componentLevels }
    }

    // Apply initial value
    engineManager.setLoggingConfig(buildLoggingConfig())

    // Subscribe to all logging settings changes
    const unsubscribes = [
      settingsStore.subscribe('logging.level', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.client', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.torrent', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.peer', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.active-pieces', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.content-storage', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.parts-file', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.tracker-manager', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.http-tracker', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.udp-tracker', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
      settingsStore.subscribe('logging.level.dht', () => {
        engineManager.setLoggingConfig(buildLoggingConfig())
      }),
    ]

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [settingsStore, settingsReady, engine])

  // Periodic refresh for header stats (engine object is mutable)
  useEffect(() => {
    if (!engine) return
    const interval = setInterval(() => forceUpdate((n) => n + 1), 1000)
    return () => clearInterval(interval)
  }, [engine])

  // Update tab title with transfer rates (every 5 seconds)
  useEffect(() => {
    if (!engine) {
      document.title = 'JSTorrent'
      return
    }
    // Only update title every 5th tick (5 seconds)
    if (statsRevision % 5 !== 0) return
    const downRate = engine.torrents.reduce((sum, t) => sum + t.downloadSpeed, 0)
    const upRate = engine.torrents.reduce((sum, t) => sum + t.uploadSpeed, 0)
    if (downRate > 0 || upRate > 0) {
      document.title = `JSTorrent - ↓${formatBytes(downRate)}/s ↑${formatBytes(upRate)}/s`
    } else {
      document.title = 'JSTorrent'
    }
  }, [engine, statsRevision])

  // Settings tab state (settings themselves come from context)
  const [settingsTab, setSettingsTab] = useState<'general' | 'interface' | 'network' | 'advanced'>(
    'general',
  )

  // Handle native events from SW port
  // Always forward to engineManager - it queues events if engine not ready yet
  const handleNativeEvent = useCallback((event: string, payload: unknown) => {
    engineManager.handleNativeEvent(event, payload)
  }, [])

  // Open logging settings (memoized to prevent LogTable remounts)
  const handleOpenLoggingSettings = useCallback(() => {
    setSettingsTab('advanced')
    setSettingsOpen(true)
  }, [])

  // Subscribe to IOBridge state
  const {
    state: ioBridgeState,
    isConnected,
    hasEverConnected,
    retry,
    launch,
    cancel,
    chromeosBootstrapState,
    chromeosHasEverConnected,
  } = useIOBridgeState({
    onNativeEvent: handleNativeEvent,
  })

  // ChromeOS bootstrap action callbacks
  const chromeosBootstrap = useChromeOSBootstrap()

  // Track previous status to detect transitions
  const prevStatusRef = useRef<ConnectionStatus | null>(null)

  // Reset engine when daemon disconnects so we can reinitialize with fresh connection info
  useEffect(() => {
    const currentStatus = ioBridgeState.status
    const prevStatus = prevStatusRef.current

    // Detect transition from connected to disconnected
    if (prevStatus === 'connected' && currentStatus === 'disconnected') {
      console.log('[App] Daemon disconnected, resetting engine for reconnection')
      engineManager.reset()
      // Defer state updates to next microtask to avoid cascading renders
      queueMicrotask(() => {
        setEngine(null)
        setInitError(null)
      })
    }

    prevStatusRef.current = currentStatus
  }, [ioBridgeState.status])

  // Get roots from connected state
  const roots: DownloadRoot[] =
    ioBridgeState.status === 'connected' ? (ioBridgeState.roots ?? []) : []

  // Check if there are pending torrents (torrents added but not downloading)
  const hasPendingTorrents = engine
    ? engine.torrents.some((t) => t.userState === 'active' && !t.hasMetadata)
    : false

  // System bridge hook for UI state (panel, readiness indicator)
  const systemBridge = useSystemBridge({
    state: ioBridgeState as Parameters<typeof useSystemBridge>[0]['state'],
    roots,
    defaultRootKey,
    hasPendingTorrents,
    onRetry: retry,
    onLaunch: launch,
    onCancel: cancel,
    onAddFolder: async () => {
      const existingRoots = roots.length
      const root = await engineManager.pickDownloadFolder()
      if (root) {
        // If this is the first root, set it as default
        if (existingRoots === 0) {
          setDefaultRootKey(root.key)
          await engineManager.setDefaultRoot(root.key)
        }
      }
    },
    onSetDefaultRoot: async (key: string) => {
      setDefaultRootKey(key)
      if (engine) {
        await engineManager.setDefaultRoot(key)
      }
    },
  })

  // Initialize engine when connected
  // Uses engineManager.engine as source of truth to handle reconnection scenarios
  useEffect(() => {
    if (!isConnected) {
      // Daemon disconnected - reset init flag to allow re-init on reconnect
      if (initStartedRef.current) {
        console.log('[App] Daemon disconnected, will re-init on reconnect')
        initStartedRef.current = false
      }
      return
    }

    // Wait for settings to be loaded before initializing engine
    if (!settingsReady) {
      return
    }

    // Skip if engine already exists or init already started
    if (engineManager.engine || initStartedRef.current || initError) {
      return
    }

    // Initialize engine
    initStartedRef.current = true
    engineManager
      .init()
      .then((eng) => {
        setEngine(eng)
        // Set default root from engine (getDefaultRoot returns the key string)
        const currentDefault = eng.storageRootManager.getDefaultRoot()
        if (currentDefault) {
          setDefaultRootKey(currentDefault)
        }
      })
      .catch((e) => {
        console.error('Failed to initialize engine:', e)
        setInitError(String(e))
        initStartedRef.current = false // Allow retry on error
      })
  }, [isConnected, initError, settingsReady])

  // Wait for settings to load
  if (!settingsReady) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading settings...</div>
  }

  // Always render - show indicator even when not connected
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
        {/* Header with System Bridge indicator */}
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
            <img
              src="../../icons/js-32.png"
              alt="JSTorrent"
              style={{ width: '24px', height: '24px' }}
            />
            <h1 style={{ margin: 0, fontSize: '18px' }}>JSTorrent</h1>
          </div>

          {/* System Bridge indicator */}
          <div style={{ position: 'relative' }}>
            <SystemIndicator
              ref={indicatorRef}
              label={systemBridge.readiness.indicator.label}
              color={systemBridge.readiness.indicator.color}
              pulse={systemBridge.readiness.pulse}
              onClick={systemBridge.togglePanel}
            />
            {systemBridge.panelOpen &&
              (ioBridgeState.platform === 'chromeos' && chromeosBootstrapState ? (
                <SystemBridgePanelChromeos
                  state={chromeosBootstrapState}
                  daemonVersion={systemBridge.daemonVersion}
                  roots={roots}
                  defaultRootKey={defaultRootKey}
                  hasEverConnected={chromeosHasEverConnected}
                  onClose={systemBridge.closePanel}
                  onLaunch={chromeosBootstrap.openIntent}
                  onResetPairing={chromeosBootstrap.resetPairing}
                  onAddFolder={async () => {
                    const existingRoots = engineManager.getRoots().length
                    const root = await engineManager.pickDownloadFolder()
                    if (root) {
                      if (existingRoots === 0) {
                        setDefaultRootKey(root.key)
                        await engineManager.setDefaultRoot(root.key)
                      }
                    }
                  }}
                  onOpenSettings={() => setSettingsOpen(true)}
                  anchorRef={indicatorRef}
                />
              ) : (
                <SystemBridgePanel
                  state={ioBridgeState as Parameters<typeof SystemBridgePanel>[0]['state']}
                  versionStatus={systemBridge.versionStatus}
                  daemonVersion={systemBridge.daemonVersion}
                  roots={roots}
                  defaultRootKey={defaultRootKey}
                  hasEverConnected={hasEverConnected}
                  onRetry={retry}
                  onLaunch={launch}
                  onCancel={cancel}
                  onAddFolder={async () => {
                    const existingRoots = engineManager.getRoots().length
                    const root = await engineManager.pickDownloadFolder()
                    if (root) {
                      if (existingRoots === 0) {
                        setDefaultRootKey(root.key)
                        await engineManager.setDefaultRoot(root.key)
                      }
                    }
                  }}
                  onSetDefaultRoot={(key) => {
                    setDefaultRootKey(key)
                    engineManager.setDefaultRoot(key)
                  }}
                  onClose={systemBridge.closePanel}
                  onOpenSettings={() => setSettingsOpen(true)}
                  anchorRef={indicatorRef}
                />
              ))}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
              {engine ? (
                <>
                  {engine.torrents.length} torrents | {engine.numConnections} peers | ↓{' '}
                  {formatBytes(engine.torrents.reduce((sum, t) => sum + t.downloadSpeed, 0))}/s | ↑{' '}
                  {formatBytes(engine.torrents.reduce((sum, t) => sum + t.uploadSpeed, 0))}/s
                </>
              ) : isConnected ? (
                'Initializing...'
              ) : (
                'Not connected'
              )}
            </span>
            <button
              onClick={() => window.open(systemBridge.getBugReportUrl(), '_blank')}
              style={{
                background: 'var(--button-bg)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
                padding: '6px 12px',
                fontSize: '13px',
                color: 'var(--text-primary)',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title="Report a bug on GitHub"
            >
              <span style={{ fontSize: '14px' }}>&#x1F41B;</span>
              Report Bug
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              style={{
                background: 'var(--button-bg)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
                padding: '6px 12px',
                fontSize: '13px',
                color: 'var(--text-primary)',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span style={{ fontSize: '16px' }}>⚙</span>
              Settings
            </button>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {engine ? (
            <EngineProvider engine={engine}>
              <ChromeAppContent onOpenLoggingSettings={handleOpenLoggingSettings} />
            </EngineProvider>
          ) : initError ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <div style={{ color: 'var(--accent-error)', marginBottom: '16px' }}>
                Failed to initialize: {initError}
              </div>
              <button
                onClick={() => {
                  setInitError(null)
                  retry()
                }}
              >
                Retry
              </button>
            </div>
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              {ioBridgeState.status === 'connecting' && 'Connecting to daemon...'}
              {ioBridgeState.status === 'disconnected' &&
                (ioBridgeState.platform === 'chromeos'
                  ? 'Click the indicator above to launch the companion app.'
                  : 'Click the indicator above to set up JSTorrent.')}
              {ioBridgeState.status === 'connected' && !engine && 'Initializing engine...'}
            </div>
          )}
        </div>

        {/* Settings overlay */}
        <SettingsOverlay
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          activeTab={settingsTab}
          setActiveTab={setSettingsTab}
        />
      </div>
    </SettingsProvider>
  )
}

export { App, AppContent }
