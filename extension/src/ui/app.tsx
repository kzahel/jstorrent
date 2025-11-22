import React from 'react'
import ReactDOM from 'react-dom/client'

import { useEffect, useState } from 'react'

interface TorrentEvent {
  event: string
  timestamp: string
  [key: string]: unknown
}

export const App = () => {
  const [events, setEvents] = useState<TorrentEvent[]>([])

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
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>JSTorrent Extension</h1>
      <h2>Event Log</h2>
      {events.length === 0 ? (
        <p>No events yet. Launch from website to test.</p>
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
              <div>
                <strong>Event:</strong> {event.event}
              </div>
              <div>
                <strong>Time:</strong> {event.timestamp}
              </div>
              <pre style={{ background: '#f0f0f0', padding: '10px', overflowX: 'auto' }}>
                {JSON.stringify(event, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
