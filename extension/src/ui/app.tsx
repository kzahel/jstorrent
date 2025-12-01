import React from 'react'
import ReactDOM from 'react-dom/client'
import { useState, useRef } from 'react'
import { Torrent, generateMagnet, createTorrentBuffer } from '@jstorrent/engine'
import { TorrentItem, formatBytes } from '@jstorrent/ui'
import { EngineProvider, useEngineState, engineManager } from '@jstorrent/client'
import { DownloadRootsManager } from './components/DownloadRootsManager'

function AppContent() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')
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

  const handleStartTorrent = (torrent: Torrent) => {
    torrent.userStart()
  }

  const handleStopTorrent = (torrent: Torrent) => {
    torrent.userStop()
  }

  const handleDeleteTorrent = async (torrent: Torrent) => {
    await adapter.removeTorrent(torrent)
  }

  const handleRecheckTorrent = async (torrent: Torrent) => {
    await torrent.recheckData()
  }

  const handleResetTorrent = async (torrent: Torrent) => {
    const metadataRaw = torrent.metadataRaw
    let torrentData: string | Uint8Array

    if (metadataRaw) {
      torrentData = createTorrentBuffer({
        metadataRaw,
        announce: torrent.announce,
      })
    } else {
      torrentData = generateMagnet({
        infoHash: torrent.infoHashStr,
        name: torrent.name,
        announce: torrent.announce,
      })
    }

    await adapter.removeTorrent(torrent)
    await adapter.addTorrent(torrentData, { userState: 'stopped' })
  }

  const handleShareTorrent = (torrent: Torrent) => {
    const magnetUri = generateMagnet({
      infoHash: torrent.infoHashStr,
      name: torrent.name,
      announce: torrent.announce,
    })
    const shareUrl = `${import.meta.env.SHARE_URL}#magnet=${encodeURIComponent(magnetUri)}`
    window.open(shareUrl, '_blank')
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
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'torrents' && (
          <div style={{ padding: '20px' }}>
            <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
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
                style={{ flex: 1, padding: '8px' }}
              />
              <button onClick={handleAddTorrent} style={{ padding: '8px 16px', cursor: 'pointer' }}>
                Add
              </button>
            </div>

            <div style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
              {torrents.length} torrents | {numConnections} connections |{' '}
              {formatBytes(globalStats.totalDownloadRate)}/s |{' '}
              {formatBytes(globalStats.totalUploadRate)}/s
            </div>

            {torrents.length === 0 ? (
              <p>No torrents. Add a magnet link to get started.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {torrents.map((torrent) => (
                  <TorrentItem
                    key={torrent.infoHashStr}
                    torrent={torrent}
                    onStart={handleStartTorrent}
                    onStop={handleStopTorrent}
                    onDelete={handleDeleteTorrent}
                    onRecheck={handleRecheckTorrent}
                    onReset={handleResetTorrent}
                    onShare={handleShareTorrent}
                  />
                ))}
              </ul>
            )}
          </div>
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
