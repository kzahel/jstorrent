import React from 'react'
import ReactDOM from 'react-dom/client'
import { useState } from 'react'
import { Torrent } from '@jstorrent/engine'
import { LogViewer } from './components/LogViewer'
import { DownloadRootsManager } from './components/DownloadRootsManager'
import { TorrentItem } from './components/TorrentItem'
import { EngineProvider } from './context/EngineContext'
import { useEngineState } from './hooks/useEngineState'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<'torrents' | 'logs' | 'settings'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')
  const { engine, loading, error, torrents, globalStats } = useEngineState()

  const handleAddTorrent = async () => {
    if (!magnetInput || !engine) return
    try {
      await engine.addTorrent(magnetInput)
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
    if (!engine) return
    await engine.removeTorrent(torrent)
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
            onClick={() => setActiveTab('logs')}
            style={{
              padding: '8px 16px',
              background: activeTab === 'logs' ? 'var(--accent-primary)' : 'var(--button-bg)',
              color: activeTab === 'logs' ? 'white' : 'var(--button-text)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Logs
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

            {loading && <p>Loading...</p>}
            {error && <p style={{ color: 'var(--accent-error)' }}>Error: {error}</p>}

            {engine && (
              <>
                <div style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                  {torrents.length} torrents | {engine.numConnections} connections |{' '}
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
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'logs' && <LogViewer />}

        {activeTab === 'settings' && <DownloadRootsManager />}
      </div>
    </div>
  )
}

export const App = () => {
  return (
    <EngineProvider>
      <AppContent />
    </EngineProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
