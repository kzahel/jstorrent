import React from 'react'
import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { Torrent, generateMagnet } from '@jstorrent/engine'
import {
  TorrentTable,
  DetailPane,
  ContextMenu,
  DropdownMenu,
  ResizeHandle,
  usePersistedUIState,
  formatBytes,
  ContextMenuItem,
  setMaxFpsCache,
  applyTheme,
} from '@jstorrent/ui'
import { EngineProvider } from './context/EngineContext'
import { SettingsProvider } from './context/SettingsContext'
import { getSettingsStore } from './settings'
import { useEngineState } from './hooks/useEngineState'
import { engineManager, DownloadRoot } from './chrome/engine-manager'
import { useIOBridgeState } from './hooks/useIOBridgeState'
import { useSystemBridge } from './hooks/useSystemBridge'
import { SystemIndicator } from './components/SystemIndicator'
import { SystemBridgePanel } from './components/SystemBridgePanel'
import { SettingsOverlay } from './components/SettingsOverlay'
import { copyTextToClipboard } from './utils/clipboard'

interface ContextMenuState {
  x: number
  y: number
  torrent: Torrent
}

function AppContent() {
  const [magnetInput, setMagnetInput] = useState('')
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const { adapter, torrents, refresh } = useEngineState()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    height: detailHeight,
    minHeight,
    maxHeight,
    updateHeight,
    persistHeight,
    activeTab: detailTab,
    setTab: setDetailTab,
  } = usePersistedUIState({
    minHeight: 100,
    maxHeightRatio: 0.6,
    defaultHeight: 250,
  })

  // Get selected torrent objects
  const selectedTorrentObjects = useMemo(() => {
    return [...selectedTorrents]
      .map((hash) => adapter.getTorrent(hash))
      .filter((t): t is Torrent => t !== undefined)
  }, [selectedTorrents, adapter, torrents])

  // Smart button states - consider error state as "effectively stopped"
  const hasSelection = selectedTorrents.size > 0
  const allEffectivelyStopped =
    hasSelection &&
    selectedTorrentObjects.every((t) => t.userState === 'stopped' || !!t.errorMessage)
  const allActive =
    hasSelection &&
    selectedTorrentObjects.every((t) => t.userState !== 'stopped' && !t.errorMessage)

  // --- Action handlers ---

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      await adapter.addTorrent(new Uint8Array(buffer))
    } catch (err) {
      console.error('Failed to add torrent file:', err)
    }
    e.target.value = ''
  }

  const handleAddTorrent = async () => {
    if (!magnetInput) {
      fileInputRef.current?.click()
      return
    }
    try {
      await adapter.addTorrent(magnetInput)
      setMagnetInput('')
    } catch (e) {
      console.error('Failed to add torrent:', e)
    }
  }

  const handleStartSelected = () => {
    for (const t of selectedTorrentObjects) {
      if (t.userState === 'stopped' || t.activityState === 'error') {
        t.userStart()
      }
    }
    refresh()
  }

  const handleStopSelected = () => {
    for (const t of selectedTorrentObjects) {
      if (t.userState !== 'stopped') {
        t.userStop()
      }
    }
    refresh()
  }

  const handleDeleteSelected = async () => {
    for (const t of selectedTorrentObjects) {
      await adapter.removeTorrent(t)
    }
    setSelectedTorrents(new Set())
  }

  const handleRecheckSelected = async () => {
    for (const t of selectedTorrentObjects) {
      await t.recheckData()
    }
  }

  const handleResetSelected = async () => {
    // Reset = remove + re-add in stopped state
    // Use original magnet URI if available (preserves non-standard query params like x.pe)
    for (const t of selectedTorrentObjects) {
      const magnet =
        t.magnetLink ??
        generateMagnet({
          infoHash: t.infoHashStr,
          name: t.name,
          announce: t.announce,
        })
      await adapter.removeTorrent(t)
      await adapter.addTorrent(magnet, { userState: 'stopped' })
    }
    setSelectedTorrents(new Set())
  }

  const handleCopyMagnet = async () => {
    // Use original magnet URI if available (preserves non-standard query params like x.pe)
    const magnets = selectedTorrentObjects.map(
      (t) =>
        t.magnetLink ??
        generateMagnet({
          infoHash: t.infoHashStr,
          name: t.name,
          announce: t.announce,
        }),
    )
    const text = magnets.join('\n')
    await copyTextToClipboard(text)
  }

  const handleShare = () => {
    if (selectedTorrentObjects.length === 0) return
    // Use original magnet URI if available (preserves non-standard query params like x.pe)
    const t = selectedTorrentObjects[0]
    const magnet =
      t.magnetLink ??
      generateMagnet({
        infoHash: t.infoHashStr,
        name: t.name,
        announce: t.announce,
      })
    const shareUrl = import.meta.env.SHARE_URL || 'https://jstorrent.com/share.html'
    window.open(`${shareUrl}#magnet=${encodeURIComponent(magnet)}`, '_blank')
  }

  // --- Menu items ---

  // Using Unicode symbols instead of emoji for consistent baseline alignment
  const moreMenuItems: ContextMenuItem[] = [
    { id: 'recheck', label: 'Re-verify Data', icon: '⟳' },
    { id: 'reset', label: 'Reset State', icon: '↺' },
    { id: 'separator1', label: '', separator: true },
    { id: 'copyMagnet', label: 'Copy Magnet Link', icon: '⎘' },
    { id: 'share', label: 'Share...', icon: '↗' },
  ]

  const contextMenuItems: ContextMenuItem[] = [
    { id: 'start', label: 'Start', icon: '▶', disabled: allActive },
    { id: 'stop', label: 'Stop', icon: '■', disabled: allEffectivelyStopped },
    { id: 'separator1', label: '', separator: true },
    { id: 'recheck', label: 'Re-verify Data', icon: '⟳' },
    { id: 'reset', label: 'Reset State', icon: '↺' },
    { id: 'separator2', label: '', separator: true },
    { id: 'copyMagnet', label: 'Copy Magnet Link', icon: '⎘' },
    { id: 'share', label: 'Share...', icon: '↗' },
    { id: 'separator3', label: '', separator: true },
    { id: 'remove', label: 'Remove', icon: '✕', danger: true },
  ]

  const handleMenuAction = (id: string) => {
    switch (id) {
      case 'start':
        handleStartSelected()
        break
      case 'stop':
        handleStopSelected()
        break
      case 'recheck':
        handleRecheckSelected()
        break
      case 'reset':
        handleResetSelected()
        break
      case 'copyMagnet':
        handleCopyMagnet()
        break
      case 'share':
        handleShare()
        break
      case 'remove':
        handleDeleteSelected()
        break
    }
  }

  const handleContextMenu = (torrent: Torrent, x: number, y: number) => {
    setContextMenu({ x, y, torrent })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <>
          {/* Toolbar */}
          <div
            style={{
              padding: '6px 16px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
            }}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".torrent"
              style={{ display: 'none' }}
            />
            <input
              id="magnet-input"
              type="text"
              value={magnetInput}
              onChange={(e) => setMagnetInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddTorrent()
              }}
              placeholder="Magnet link or URL"
              style={{
                flex: 1,
                padding: '0 8px',
                maxWidth: '350px',
                fontSize: '13px',
                height: '26px',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleAddTorrent}
              style={{
                padding: '0 10px',
                cursor: 'pointer',
                fontSize: '13px',
                height: '26px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              Add
            </button>

            <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }} />

            <button
              onClick={handleStartSelected}
              disabled={!hasSelection || allActive}
              style={{
                padding: '0 10px',
                cursor: hasSelection && !allActive ? 'pointer' : 'default',
                fontSize: '13px',
                height: '26px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: !hasSelection || allActive ? 0.5 : 1,
              }}
              title="Start selected"
            >
              <span style={{ lineHeight: 1 }}>▶</span>
              <span>Start</span>
            </button>
            <button
              onClick={handleStopSelected}
              disabled={!hasSelection || allEffectivelyStopped}
              style={{
                padding: '0 10px',
                cursor: hasSelection && !allEffectivelyStopped ? 'pointer' : 'default',
                fontSize: '13px',
                height: '26px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: !hasSelection || allEffectivelyStopped ? 0.5 : 1,
              }}
              title="Stop selected"
            >
              <span style={{ lineHeight: 1 }}>■</span>
              <span>Stop</span>
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={!hasSelection}
              style={{
                padding: '0 10px',
                cursor: hasSelection ? 'pointer' : 'default',
                fontSize: '13px',
                height: '26px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--accent-error)',
                opacity: hasSelection ? 1 : 0.5,
              }}
              title="Remove selected"
            >
              <span style={{ lineHeight: 1 }}>✕</span>
              <span>Remove</span>
            </button>

            <DropdownMenu
              label="More"
              items={moreMenuItems}
              onSelect={handleMenuAction}
              disabled={!hasSelection}
            />
          </div>

          {/* Main content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {/* Torrent table */}
            <div style={{ flex: 1, minHeight: 100, overflow: 'hidden' }}>
              {torrents.length === 0 ? (
                <div
                  style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}
                >
                  No torrents. Add a magnet link to get started.
                </div>
              ) : (
                <TorrentTable
                  source={adapter}
                  getSelectedHashes={() => selectedTorrents}
                  onSelectionChange={setSelectedTorrents}
                  onRowContextMenu={handleContextMenu}
                />
              )}
            </div>

            {/* Resize handle */}
            <ResizeHandle
              currentHeight={detailHeight}
              minHeight={minHeight}
              maxHeight={maxHeight}
              onResize={updateHeight}
              onResizeEnd={persistHeight}
            />

            {/* Detail pane */}
            <div style={{ height: detailHeight, flexShrink: 0, overflow: 'hidden' }}>
              <DetailPane
                source={adapter}
                selectedHashes={selectedTorrents}
                activeTab={detailTab}
                onTabChange={setDetailTab}
              />
            </div>
          </div>
        </>
      </div>

      {/* Context menu portal */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onSelect={handleMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

function App() {
  const [engine, setEngine] = useState<Awaited<ReturnType<typeof engineManager.init>> | null>(null)
  const [initError, setInitError] = useState<string | null>(null)
  const initStartedRef = useRef(false)
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

    // Subscribe to rate limit changes
    const unsubDownload = settingsStore.subscribe('downloadSpeedLimit', (value) => {
      engineManager.setRateLimits(value, settingsStore.get('uploadSpeedLimit'))
    })
    const unsubUpload = settingsStore.subscribe('uploadSpeedLimit', (value) => {
      engineManager.setRateLimits(settingsStore.get('downloadSpeedLimit'), value)
    })

    return () => {
      unsubDownload()
      unsubUpload()
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
  const handleNativeEvent = useCallback(
    (event: string, payload: unknown) => {
      if (engine) {
        engineManager.handleNativeEvent(event, payload)
      }
    },
    [engine],
  )

  // Subscribe to IOBridge state
  const {
    state: ioBridgeState,
    isConnected,
    hasEverConnected,
    retry,
    launch,
    cancel,
  } = useIOBridgeState({
    onNativeEvent: handleNativeEvent,
  })

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
    onDisconnect: () => {
      console.log('Disconnect requested')
    },
    onAddFolder: async () => {
      const root = await engineManager.pickDownloadFolder()
      if (root) {
        // Root will be added via daemon info update
      }
    },
    onSetDefaultRoot: async (key: string) => {
      setDefaultRootKey(key)
      if (engine) {
        await engineManager.setDefaultRoot(key)
      }
    },
  })

  // Initialize engine when connected (and not already initialized)
  useEffect(() => {
    if (isConnected && !engine && !initStartedRef.current && !initError) {
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
    }
  }, [isConnected, engine, initError])

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
          <h1 style={{ margin: 0, fontSize: '18px' }}>JSTorrent</h1>

          {/* System Bridge indicator */}
          <div style={{ position: 'relative' }}>
            <SystemIndicator
              label={systemBridge.readiness.indicator.label}
              color={systemBridge.readiness.indicator.color}
              pulse={systemBridge.readiness.pulse}
              onClick={systemBridge.togglePanel}
            />
            {systemBridge.panelOpen && (
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
                onDisconnect={() => console.log('Disconnect')}
                onAddFolder={async () => {
                  await engineManager.pickDownloadFolder()
                }}
                onSetDefaultRoot={(key) => {
                  setDefaultRootKey(key)
                  engineManager.setDefaultRoot(key)
                }}
                onCopyDebugInfo={systemBridge.copyDebugInfo}
                onClose={systemBridge.closePanel}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            )}
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
              <AppContent />
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
