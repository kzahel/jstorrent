import React from 'react'
import ReactDOM from 'react-dom/client'
import { useState, useRef } from 'react'
import { Torrent } from '@jstorrent/engine'
import { TorrentTable, formatBytes } from '@jstorrent/ui'
import { EngineProvider, useEngineState, engineManager } from '@jstorrent/client'
import { DownloadRootsManager } from './components/DownloadRootsManager'

function AppContent() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set())
  const { adapter, torrents, numConnections, globalStats } = useEngineState()
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleDeleteSelected = async () => {
    for (const hash of selectedTorrents) {
      const torrent = torrents.find((t) => t.infoHashStr === hash)
      if (torrent) {
        await adapter.removeTorrent(torrent)
      }
    }
    setSelectedTorrents(new Set())
  }

  const handleStartSelected = () => {
    for (const hash of selectedTorrents) {
      const torrent = torrents.find((t) => t.infoHashStr === hash)
      if (torrent && torrent.userState === 'stopped') {
        torrent.userStart()
      }
    }
  }

  const handleStopSelected = () => {
    for (const hash of selectedTorrents) {
      const torrent = torrents.find((t) => t.infoHashStr === hash)
      if (torrent && torrent.userState !== 'stopped') {
        torrent.userStop()
      }
    }
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
          padding: '12px 20px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '20px' }}>JSTorrent</h1>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setActiveTab('torrents')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'torrents' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'torrents' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Torrents
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'settings' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'settings' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeTab === 'torrents' && (
          <>
            {/* Toolbar */}
            <div
              style={{
                padding: '8px 20px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                gap: '8px',
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
                type="text"
                value={magnetInput}
                onChange={(e) => setMagnetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddTorrent()
                  }
                }}
                placeholder="Enter magnet link or URL"
                style={{ flex: 1, padding: '6px 8px', maxWidth: '400px' }}
              />
              <button onClick={handleAddTorrent} style={{ padding: '6px 12px', cursor: 'pointer' }}>
                Add
              </button>
              <div style={{ width: '1px', height: '20px', background: 'var(--border-color)' }} />
              <button
                onClick={handleStartSelected}
                disabled={selectedTorrents.size === 0}
                style={{ padding: '6px 12px', cursor: 'pointer' }}
                title="Start selected"
              >
                Start
              </button>
              <button
                onClick={handleStopSelected}
                disabled={selectedTorrents.size === 0}
                style={{ padding: '6px 12px', cursor: 'pointer' }}
                title="Stop selected"
              >
                Stop
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedTorrents.size === 0}
                style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--accent-error)' }}
                title="Remove selected"
              >
                Remove
              </button>
              <div style={{ marginLeft: 'auto', color: 'var(--text-secondary)', fontSize: '13px' }}>
                {torrents.length} torrents | {numConnections} connections | ↓{' '}
                {formatBytes(globalStats.totalDownloadRate)}/s | ↑{' '}
                {formatBytes(globalStats.totalUploadRate)}/s
              </div>
            </div>

            {/* Table */}
            <div style={{ flex: 1, minHeight: 0 }}>
              {torrents.length === 0 ? (
                <div
                  style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}
                >
                  No torrents. Add a magnet link to get started.
                </div>
              ) : (
                <TorrentTable
                  source={adapter}
                  selectedHashes={selectedTorrents}
                  onSelectionChange={setSelectedTorrents}
                  onRowDoubleClick={(torrent: Torrent) => {
                    if (torrent.userState === 'stopped') {
                      torrent.userStart()
                    } else {
                      torrent.userStop()
                    }
                  }}
                />
              )}
            </div>
          </>
        )}

        {activeTab === 'settings' && <DownloadRootsManager />}
      </div>
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

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading...</div>
  }

  if (error) {
    return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>
  }

  if (!engine) {
    return <div style={{ padding: '20px' }}>Failed to initialize engine</div>
  }

  return (
    <EngineProvider engine={engine}>
      <AppContent />
    </EngineProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
