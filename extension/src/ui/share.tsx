import { createRoot } from 'react-dom/client'
import { parseMagnet, ParsedMagnet } from '@jstorrent/engine'

function parseShareUrl(): { magnet: string; parsed: ParsedMagnet } | { error: string } {
  const hash = window.location.hash
  if (!hash.startsWith('#magnet=')) {
    return { error: 'No magnet link provided' }
  }
  try {
    const encoded = hash.slice(8)
    const magnetUri = decodeURIComponent(encoded)
    return { magnet: magnetUri, parsed: parseMagnet(magnetUri) }
  } catch {
    return { error: 'Invalid magnet link' }
  }
}

function SharePage() {
  const result = parseShareUrl()

  if ('error' in result) {
    return (
      <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
        <h1>JSTorrent Share</h1>
        <p style={{ color: 'var(--accent-error)' }}>{result.error}</p>
        <p>
          <a href="https://jstorrent.com">Visit jstorrent.com</a>
        </p>
      </div>
    )
  }

  const { magnet, parsed } = result

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif', maxWidth: '800px' }}>
      <h1>JSTorrent Share</h1>

      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ marginBottom: '8px' }}>{parsed.name || 'Unknown Torrent'}</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Info Hash: <code>{parsed.infoHash}</code>
        </p>
        {parsed.announce && parsed.announce.length > 0 && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            {parsed.announce.length} tracker{parsed.announce.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>Magnet Link</h3>
        <textarea
          readOnly
          value={magnet}
          style={{
            width: '100%',
            height: '80px',
            fontFamily: 'monospace',
            fontSize: '12px',
            padding: '8px',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            resize: 'vertical',
          }}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
      </div>

      <div style={{ marginBottom: '20px' }}>
        <a
          href={magnet}
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            background: 'var(--accent-primary)',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
            marginRight: '10px',
          }}
        >
          Open Magnet Link
        </a>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
        Download torrents with{' '}
        <a href="https://jstorrent.com" style={{ color: 'var(--accent-primary)' }}>
          jstorrent.com
        </a>
      </p>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<SharePage />)
