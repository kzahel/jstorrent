import React from 'react'
import ReactDOM from 'react-dom/client'
import { useState } from 'react'
import { LogViewer } from './components/LogViewer'
import { DownloadRootsManager } from './components/DownloadRootsManager'
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
          borderBottom: '1px solid #ccc',
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
              background: activeTab === 'torrents' ? '#2196F3' : '#eee',
              color: activeTab === 'torrents' ? 'white' : 'black',
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
              background: activeTab === 'logs' ? '#2196F3' : '#eee',
              color: activeTab === 'logs' ? 'white' : 'black',
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
              background: activeTab === 'settings' ? '#2196F3' : '#eee',
              color: activeTab === 'settings' ? 'white' : 'black',
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
            {error && <p style={{ color: 'red' }}>Error: {error}</p>}

            {engine && (
              <>
                <div style={{ marginBottom: '16px', color: '#666' }}>
                  {torrents.length} torrents | {engine.numConnections} connections |{' '}
                  {formatBytes(globalStats.totalDownloadRate)}/s |{' '}
                  {formatBytes(globalStats.totalUploadRate)}/s
                </div>

                {torrents.length === 0 ? (
                  <p>No torrents. Add a magnet link to get started.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0 }}>
                    {torrents.map((torrent) => (
                      <li
                        key={Array.from(torrent.infoHash)
                          .map((b) => b.toString(16).padStart(2, '0'))
                          .join('')}
                        style={{
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          padding: '12px',
                          marginBottom: '8px',
                        }}
                      >
                        <div style={{ fontWeight: 'bold' }}>
                          {torrent.name || 'Loading metadata...'}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {torrent.activityState} | {(torrent.progress * 100).toFixed(1)}% |{' '}
                          {torrent.numPeers} peers | {torrent.files.length} files |{' '}
                          {formatBytes(torrent.contentStorage?.getTotalSize() || 0)}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {formatBytes(torrent.downloadSpeed)}/s |{' '}
                          {formatBytes(torrent.uploadSpeed)}/s
                        </div>
                        <div
                          style={{
                            height: '4px',
                            background: '#eee',
                            borderRadius: '2px',
                            marginTop: '8px',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${torrent.progress * 100}%`,
                              background:
                                torrent.activityState === 'seeding' ? '#4CAF50' : '#2196F3',
                              borderRadius: '2px',
                            }}
                          />
                        </div>
                      </li>
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
