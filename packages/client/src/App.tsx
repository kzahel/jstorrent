import React from 'react'
import { useState, useRef, useMemo } from 'react'
import { Torrent, generateMagnet } from '@jstorrent/engine'
import {
  TorrentTable,
  DetailPane,
  ContextMenu,
  DropdownMenu,
  ResizeHandle,
  usePersistedHeight,
  formatBytes,
  ContextMenuItem,
} from '@jstorrent/ui'
import { EngineProvider } from './context/EngineContext'
import { useEngineState } from './hooks/useEngineState'
import { engineManager } from './chrome/engine-manager'
import { DownloadRootsManager } from './components/DownloadRootsManager'

interface ContextMenuState {
  x: number
  y: number
  torrent: Torrent
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const { adapter, torrents, numConnections, globalStats, refresh } = useEngineState()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const {
    height: detailHeight,
    minHeight,
    maxHeight,
    updateHeight,
    persistHeight,
  } = usePersistedHeight({
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

  // Smart button states
  const hasSelection = selectedTorrents.size > 0
  const allStarted = hasSelection && selectedTorrentObjects.every((t) => t.userState !== 'stopped')
  const allStopped = hasSelection && selectedTorrentObjects.every((t) => t.userState === 'stopped')

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
      if (t.userState === 'stopped') {
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
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for non-secure contexts
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
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
    { id: 'start', label: 'Start', icon: '▶', disabled: allStarted },
    { id: 'stop', label: 'Stop', icon: '■', disabled: allStopped },
    { id: 'separator1', label: '', separator: true },
    { id: 'recheck', label: 'Re-verify Data', icon: '⟳' },
    { id: 'reset', label: 'Reset State', icon: '↺' },
    { id: 'separator2', label: '', separator: true },
    { id: 'copyMagnet', label: 'Copy Magnet Link', icon: '⎘' },
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
        height: '100vh',
        fontFamily: 'sans-serif',
      }}
    >
      {/* Header */}
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

        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => setActiveTab('torrents')}
            style={{
              padding: '6px 12px',
              background: activeTab === 'torrents' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'torrents' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Torrents
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '6px 12px',
              background: activeTab === 'settings' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'settings' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Settings
          </button>
        </div>

        <div style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '12px' }}>
          {torrents.length} torrents | {numConnections} peers | ↓{' '}
          {formatBytes(globalStats.totalDownloadRate)}/s | ↑{' '}
          {formatBytes(globalStats.totalUploadRate)}/s
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTab === 'torrents' && (
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
                disabled={!hasSelection || allStarted}
                style={{
                  padding: '0 10px',
                  cursor: hasSelection && !allStarted ? 'pointer' : 'default',
                  fontSize: '13px',
                  height: '26px',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  opacity: !hasSelection || allStarted ? 0.5 : 1,
                }}
                title="Start selected"
              >
                <span style={{ lineHeight: 1 }}>▶</span>
                <span>Start</span>
              </button>
              <button
                onClick={handleStopSelected}
                disabled={!hasSelection || allStopped}
                style={{
                  padding: '0 10px',
                  cursor: hasSelection && !allStopped ? 'pointer' : 'default',
                  fontSize: '13px',
                  height: '26px',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  opacity: !hasSelection || allStopped ? 0.5 : 1,
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
                    onRowDoubleClick={(torrent: Torrent) => {
                      if (torrent.userState === 'stopped') {
                        torrent.userStart()
                      } else {
                        torrent.userStop()
                      }
                    }}
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
                <DetailPane source={adapter} selectedHashes={selectedTorrents} />
              </div>
            </div>
          </>
        )}

        {activeTab === 'settings' && <DownloadRootsManager />}
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  React.useEffect(() => {
    engineManager
      .init()
      .then((eng) => {
        setEngine(eng)
        setLoading(false)
      })
      .catch((e) => {
        console.error('Failed to initialize engine:', e)
        setError(String(e))
        setLoading(false)
      })
  }, [])

  if (loading) return <div style={{ padding: '20px' }}>Loading...</div>
  if (error) return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>
  if (!engine) return <div style={{ padding: '20px' }}>Failed to initialize engine</div>

  return (
    <EngineProvider engine={engine}>
      <AppContent />
    </EngineProvider>
  )
}

export { App, AppContent }
