import React from 'react'
import ReactDOM from 'react-dom/client'
import { useEffect, useState } from 'react'
import { LogViewer } from './components/LogViewer'

interface TorrentEvent {
  event: string
  timestamp: string
  [key: string]: unknown
}

export const App = () => {
  const [events, setEvents] = useState<TorrentEvent[]>([])
  const [activeTab, setActiveTab] = useState<'torrents' | 'logs'>('torrents')
  const [magnetInput, setMagnetInput] = useState('')

  const handleAddTorrent = () => {
    if (!magnetInput) return
    chrome.runtime.sendMessage({ type: 'ADD_TORRENT', magnet: magnetInput }, (response) => {
      console.log('Add torrent response:', response)
      setMagnetInput('')
    })
  }

  useEffect(() => {
    const handleMessage = (message: TorrentEvent) => {
      console.log('UI received message:', message)
      if (message.event === 'magnetAdded' || message.event === 'torrentAdded') {
        setEvents((prev) => [...prev, { ...message, timestamp: new Date().toISOString() }])
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])



  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      fontFamily: 'sans-serif'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid #ccc',
        display: 'flex',
        alignItems: 'center',
        gap: '20px'
      }}>
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
              cursor: 'pointer'
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
              cursor: 'pointer'
            }}
          >
            Logs
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'torrents' && (
          <div style={{ padding: '20px' }}>
            <h2>Torrents</h2>

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
              <button
                onClick={handleAddTorrent}
                style={{ padding: '8px 16px', cursor: 'pointer' }}
              >
                Add
              </button>
            </div>

            {events.length === 0 ? (
              <p>No torrents yet. Add a magnet link to get started.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {events.map((event, i) => (
                  <li
                    key={i}
                    style={{
                      border: '1px solid #ccc',
                      margin: '10px 0',
                      padding: '10px',
                      borderRadius: '4px',
                    }}
                  >
                    <div><strong>Event:</strong> {event.event}</div>
                    <div><strong>Time:</strong> {event.timestamp}</div>
                    <pre style={{ background: '#f0f0f0', padding: '10px', overflowX: 'auto' }}>
                      {JSON.stringify(event, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <LogViewer />
        )}
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
