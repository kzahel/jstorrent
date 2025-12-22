import React from 'react'
import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { Torrent, generateMagnet } from '@jstorrent/engine'
import {
  TorrentTable,
  DetailPane,
  ContextMenu,
  ConfirmDialog,
  DropdownMenu,
  ResizeHandle,
  usePersistedUIState,
  formatBytes,
  ContextMenuItem,
  setMaxFpsCache,
  setProgressBarStyleCache,
  applyTheme,
} from '@jstorrent/ui'
import { EngineProvider } from './context/EngineContext'
import { SettingsProvider } from './context/SettingsContext'
import { getSettingsStore } from './settings'
import { useEngineState } from './hooks/useEngineState'
import { engineManager, DownloadRoot } from './chrome/engine-manager'
import { useIOBridgeState, ConnectionStatus } from './hooks/useIOBridgeState'
import { useSystemBridge } from './hooks/useSystemBridge'
import { SystemIndicator } from './components/SystemIndicator'
import { SystemBridgePanel } from './components/SystemBridgePanel'
import { SystemBridgePanelChromeos } from './components/SystemBridgePanelChromeos'
import { SettingsOverlay } from './components/SettingsOverlay'
import { useChromeOSBootstrap } from './hooks/useChromeOSBootstrap'
import { copyTextToClipboard } from './utils/clipboard'
import { notificationBridge } from './chrome/notification-bridge'

interface ContextMenuState {
  x: number
  y: number
  torrent: Torrent
}

export interface FileInfo {
  path: string
}

export interface AppContentProps {
  onOpenLoggingSettings?: () => void
  /** Override for opening files (for standalone mode) */
  onOpenFile?: (torrentHash: string, file: FileInfo) => Promise<void>
  /** Override for reveal in folder (for standalone mode) */
  onRevealInFolder?: (torrentHash: string, file: FileInfo) => Promise<void>
  /** Override for copying file path (for standalone mode) */
  onCopyFilePath?: (torrentHash: string, file: FileInfo) => Promise<void>
  /** Override for opening torrent folder from context menu (for standalone mode) */
  onOpenFolder?: (torrentHash: string) => Promise<void>
}

function AppContent({
  onOpenLoggingSettings,
  onOpenFile: onOpenFileProp,
  onRevealInFolder: onRevealInFolderProp,
  onCopyFilePath: onCopyFilePathProp,
  onOpenFolder: onOpenFolderProp,
}: AppContentProps) {
  const [magnetInput, setMagnetInput] = useState('')
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set())

  // Selection change handler - refreshKey in detail tables handles immediate updates
  const handleSelectionChange = useCallback((keys: Set<string>) => {
    setSelectedTorrents(keys)
  }, [])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [confirmRemoveAll, setConfirmRemoveAll] = useState<Torrent[] | null>(null)
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
    maxHeightRatio: 0.85,
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
  const anyChecking =
    hasSelection && selectedTorrentObjects.some((t) => t.activityState === 'checking')

  // --- Action handlers ---

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const result = await adapter.addTorrent(new Uint8Array(buffer))

      if (result.isDuplicate && result.torrent) {
        notificationBridge.onDuplicateTorrent(result.torrent.name || 'Torrent')
      }
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
      const result = await adapter.addTorrent(magnetInput)
      setMagnetInput('')

      if (result.isDuplicate && result.torrent) {
        notificationBridge.onDuplicateTorrent(result.torrent.name || 'Torrent')
      }
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
    // Reset torrent state (progress, stats, file priorities) while preserving metadata
    for (const t of selectedTorrentObjects) {
      await adapter.resetTorrent(t)
    }
    setSelectedTorrents(new Set())
  }

  const handleRemoveWithDataRequest = () => {
    if (selectedTorrentObjects.length > 0) {
      setConfirmRemoveAll(selectedTorrentObjects)
    }
  }

  const handleRemoveWithDataConfirm = async () => {
    if (!confirmRemoveAll) return
    const errors: string[] = []
    for (const t of confirmRemoveAll) {
      const result = await adapter.removeTorrentWithData(t)
      errors.push(...result.errors)
    }
    setConfirmRemoveAll(null)
    setSelectedTorrents(new Set())
    if (errors.length > 0) {
      alert(
        `Some files could not be deleted:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more` : ''}`,
      )
    }
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
    { id: 'recheck', label: 'Re-verify Data', icon: '⟳', disabled: anyChecking },
    { id: 'reset', label: 'Reset State', icon: '↺', disabled: anyChecking },
    { id: 'separator1', label: '', separator: true },
    { id: 'copyMagnet', label: 'Copy Magnet Link', icon: '⎘' },
    { id: 'share', label: 'Share...', icon: '↗' },
    { id: 'separator2', label: '', separator: true },
    { id: 'removeWithData', label: 'Remove All Data', icon: '⊗', danger: true },
  ]

  const contextMenuItems: ContextMenuItem[] = [
    { id: 'start', label: 'Start', icon: '▶', disabled: allActive || anyChecking },
    { id: 'stop', label: 'Stop', icon: '■', disabled: allEffectivelyStopped || anyChecking },
    { id: 'separator1', label: '', separator: true },
    { id: 'openFolder', label: 'Open Folder', icon: '📁' },
    { id: 'recheck', label: 'Re-verify Data', icon: '⟳', disabled: anyChecking },
    { id: 'reset', label: 'Reset State', icon: '↺', disabled: anyChecking },
    { id: 'separator2', label: '', separator: true },
    { id: 'copyMagnet', label: 'Copy Magnet Link', icon: '⎘' },
    { id: 'share', label: 'Share...', icon: '↗' },
    { id: 'separator3', label: '', separator: true },
    { id: 'remove', label: 'Remove', icon: '✕', danger: true },
    { id: 'removeWithData', label: 'Remove All Data', icon: '⊗', danger: true },
  ]

  const handleOpenFolder = async () => {
    for (const t of selectedTorrentObjects) {
      if (onOpenFolderProp) {
        await onOpenFolderProp(t.infoHashStr)
      } else {
        const result = await engineManager.openTorrentFolder(t.infoHashStr)
        if (!result.ok) {
          alert(`Failed to open folder: ${result.error}`)
          break
        }
      }
    }
  }

  const handleMenuAction = (id: string) => {
    switch (id) {
      case 'start':
        handleStartSelected()
        break
      case 'stop':
        handleStopSelected()
        break
      case 'openFolder':
        handleOpenFolder()
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
      case 'removeWithData':
        handleRemoveWithDataRequest()
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
              disabled={!hasSelection || allActive || anyChecking}
              style={{
                padding: '0 10px',
                cursor: hasSelection && !allActive && !anyChecking ? 'pointer' : 'default',
                fontSize: '13px',
                height: '26px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: !hasSelection || allActive || anyChecking ? 0.5 : 1,
              }}
              title="Start selected"
            >
              <span style={{ lineHeight: 1 }}>▶</span>
              <span>Start</span>
            </button>
            <button
              onClick={handleStopSelected}
              disabled={!hasSelection || allEffectivelyStopped || anyChecking}
              style={{
                padding: '0 10px',
                cursor:
                  hasSelection && !allEffectivelyStopped && !anyChecking ? 'pointer' : 'default',
                fontSize: '13px',
                height: '26px',
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: !hasSelection || allEffectivelyStopped || anyChecking ? 0.5 : 1,
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
                  onSelectionChange={handleSelectionChange}
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
                onOpenFile={async (torrentHash, file) => {
                  if (onOpenFileProp) {
                    await onOpenFileProp(torrentHash, file)
                  } else {
                    const result = await engineManager.openFile(torrentHash, file.path)
                    if (!result.ok) {
                      alert(`Failed to open file: ${result.error}`)
                    }
                  }
                }}
                onRevealInFolder={async (torrentHash, file) => {
                  if (onRevealInFolderProp) {
                    await onRevealInFolderProp(torrentHash, file)
                  } else {
                    const result = await engineManager.revealInFolder(torrentHash, file.path)
                    if (!result.ok) {
                      alert(`Failed to reveal in folder: ${result.error}`)
                    }
                  }
                }}
                onCopyFilePath={async (torrentHash, file) => {
                  if (onCopyFilePathProp) {
                    await onCopyFilePathProp(torrentHash, file)
                  } else {
                    const fullPath = engineManager.getFilePath(torrentHash, file.path)
                    if (fullPath) {
                      await copyTextToClipboard(fullPath)
                    } else {
                      alert('Failed to get file path: storage root not found')
                    }
                  }
                }}
                onSetFilePriority={(torrentHash, fileIndex, priority) => {
                  const torrent = adapter.getTorrent(torrentHash)
                  if (torrent) {
                    torrent.setFilePriority(fileIndex, priority)
                  }
                }}
                onOpenLoggingSettings={onOpenLoggingSettings}
              />
            </div>
          </div>
        </>
      </div>

      {/* Remove All Data confirmation dialog */}
      {confirmRemoveAll && (
        <ConfirmDialog
          title="Remove All Data"
          message={`Permanently delete ${
            confirmRemoveAll.length === 1
              ? `"${confirmRemoveAll[0].name}"`
              : `${confirmRemoveAll.length} torrents`
          } and ALL downloaded files? This cannot be undone.`}
          confirmLabel="Delete Everything"
          danger
          onConfirm={handleRemoveWithDataConfirm}
          onCancel={() => setConfirmRemoveAll(null)}
        />
      )}

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
              <AppContent onOpenLoggingSettings={handleOpenLoggingSettings} />
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
