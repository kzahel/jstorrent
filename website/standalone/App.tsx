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
    // Debug exports
    engine?: unknown
    daemonConnection?: unknown
  }
}

export function StandaloneApp() {
  const [config, setConfig] = useState(window.JSTORRENT_CONFIG || null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Set up callback for config injection (only if not already available)
  useEffect(() => {
    // Config already available from initial state, no need to do anything
    if (config) return

    // Set up callback for async config injection from Android WebView
    window.onJSTorrentConfig = (cfg) => {
      console.log('[App] Config received:', cfg)
      setConfig(cfg)
    }

    return () => {
      window.onJSTorrentConfig = undefined
    }
  }, [config])

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
  const {
    addMagnet,
    pauseTorrent,
    resumeTorrent,
    removeTorrent,
    torrents,
    isReady,
    hasDownloadRoot,
    error,
    engine,
    connection,
  } = useEngine(config)

  // Expose engine and connection on window for debugging
  useEffect(() => {
    window.engine = engine
    window.daemonConnection = connection
    return () => {
      window.engine = undefined
      window.daemonConnection = undefined
    }
  }, [engine, connection])

  // Set up global handlers for intents
  useEffect(() => {
    if (!isReady) return

    window.handleMagnet = (link: string) => {
      console.log('[App] handleMagnet:', link)
      addMagnet(link)
    }

    window.handleTorrentFile = (_name: string, base64: string) => {
      console.log('[App] handleTorrentFile')
      // Decode base64 and add torrent
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      // TODO: Add torrent from bytes when API supports it
    }

    return () => {
      window.handleMagnet = undefined
      window.handleTorrentFile = undefined
    }
  }, [isReady, addMagnet])

  const handlePause = useCallback(
    (id: string) => {
      pauseTorrent(id)
    },
    [pauseTorrent],
  )

  const handleResume = useCallback(
    (id: string) => {
      resumeTorrent(id)
    },
    [resumeTorrent],
  )

  const handleRemove = useCallback(
    (id: string) => {
      removeTorrent(id)
    },
    [removeTorrent],
  )

  const handleAddMagnet = useCallback(
    (magnet: string) => {
      addMagnet(magnet)
      setShowAddDialog(false)
    },
    [addMagnet, setShowAddDialog],
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
