import { useState } from 'react'

function App() {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    const command = 'curl -fsSL https://new.jstorrent.com/install.sh | bash'
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleLaunch = async () => {
    const EXTENSION_ID = 'bnceafpojmnimbnhamaeedgomdcgnbjk' // Local ID
    try {
      // @ts-expect-error - chrome is not defined in standard web types
      if (window.chrome && window.chrome.runtime) {
        // @ts-expect-error - sendMessage is valid
        window.chrome.runtime.sendMessage(EXTENSION_ID, { type: 'launch-ping' }, (response) => {
          console.log('Extension response:', response)
        })
      } else {
        console.warn('Chrome runtime not available')
      }
    } catch (e) {
      console.error('Failed to message extension:', e)
    }
  }

  return (
    <div className="container">
      <h1>JSTorrent Native Host</h1>
      <p>
        Please visit the{' '}
        <a href="https://github.com/kzahel/jstorrent-monorepo/releases">GitHub Repository</a> for
        installation instructions.
      </p>
      <p>To install on Linux:</p>
      <div className="command-box">
        <code>curl -fsSL https://new.jstorrent.com/install.sh | bash</code>
        <button className="copy-btn" onClick={copyToClipboard} aria-label="Copy to clipboard">
          <svg
            viewBox="0 0 16 16"
            version="1.1"
            style={{ width: 16, height: 16, fill: 'currentColor' }}
          >
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path>
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
          </svg>
        </button>
        {copied && <div className="tooltip show">Copied!</div>}
      </div>

      <div style={{ marginTop: '2rem' }}>
        <button onClick={handleLaunch} style={{ padding: '10px 20px', fontSize: '1.2rem' }}>
          Launch JSTorrent
        </button>
      </div>
    </div>
  )
}

export default App
