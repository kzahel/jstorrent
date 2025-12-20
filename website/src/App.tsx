import { useState, useEffect } from 'react'

const EXTENSION_ID = 'dbokmlpefliilbjldladbimlcfgbolhk'
const WEBSTORE_URL = `https://chromewebstore.google.com/detail/jstorrent/${EXTENSION_ID}`

// Update this AND install.sh when releasing a new native version
const TAG = 'v0.1.4'

const WINDOWS_INSTALLER = `https://github.com/kzahel/jstorrent/releases/download/native-${TAG}/jstorrent-native-host-install-windows-x86_64.exe`
const MACOS_INSTALLER = `https://github.com/kzahel/jstorrent/releases/download/native-${TAG}/jstorrent-native-host-install-macos-x86_64.pkg`

type Platform = 'windows' | 'mac' | 'linux'

interface StatusResponse {
  ok: true
  installed: true
  extensionVersion: string
  platform: 'desktop' | 'chromeos'
  nativeHostConnected: boolean
  nativeHostVersion?: string
  hasEverConnected: boolean
  lastConnectedTime?: number
  installId: string
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'mac'
  return 'linux'
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}

function App() {
  const [copied, setCopied] = useState(false)
  const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(null)
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(detectPlatform)

  useEffect(() => {
    // Check extension status with comprehensive info
    const checkExtension = () => {
      try {
        // @ts-expect-error - chrome is not defined in standard web types
        if (window.chrome && window.chrome.runtime) {
          // @ts-expect-error - sendMessage is valid
          window.chrome.runtime.sendMessage(
            EXTENSION_ID,
            { type: 'status' },
            (response: StatusResponse | undefined) => {
              // @ts-expect-error - lastError is valid
              if (window.chrome.runtime.lastError || !response) {
                setExtensionInstalled(false)
                setStatus(null)
              } else {
                setExtensionInstalled(true)
                setStatus(response)
              }
            },
          )
        } else {
          setExtensionInstalled(false)
        }
      } catch {
        setExtensionInstalled(false)
      }
    }
    checkExtension()
  }, [])

  const copyToClipboard = () => {
    const command = 'curl -fsSL https://new.jstorrent.com/install.sh | bash'
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleLaunch = async () => {
    try {
      // @ts-expect-error - chrome is not defined in standard web types
      if (window.chrome && window.chrome.runtime) {
        // @ts-expect-error - sendMessage is valid
        window.chrome.runtime.sendMessage(
          EXTENSION_ID,
          { type: 'launch-ping' },
          (response: unknown) => {
            console.log('Extension response:', response)
          },
        )
      } else {
        console.warn('Chrome runtime not available')
      }
    } catch (e) {
      console.error('Failed to message extension:', e)
    }
  }

  return (
    <div className="container">
      <header className="header">
        <img src="/cook/JSTorrent/js-128.png" alt="JSTorrent" className="logo" />
        <h1>JSTorrent</h1>
        <p className="subtitle">A BitTorrent client for Chrome.</p>
        <p className="description">
          Download torrents directly in your browser. JSTorrent consists of a Chrome extension and a
          small native helper for fast file and network access. No admin privileges needed. Free and{' '}
          <a href="https://github.com/kzahel/jstorrent">open source</a>.
        </p>
      </header>

      {/* Extension section */}
      <section className="section">
        <h2>Extension</h2>
        {extensionInstalled === true ? (
          <>
            <div className="status-row success">
              <span className="status-indicator success" />
              <span>Installed</span>
              {status && <span className="text-muted">v{status.extensionVersion}</span>}
            </div>
            <button className="btn btn-primary btn-large" onClick={handleLaunch}>
              Launch JSTorrent
            </button>
          </>
        ) : extensionInstalled === false ? (
          <>
            <div className="status-row">
              <span className="status-indicator" />
              <span>Not detected</span>
            </div>
            <a
              href={WEBSTORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              Install from Chrome Web Store
            </a>
          </>
        ) : (
          <p className="text-muted">Checking...</p>
        )}
      </section>

      {/* Native Host section */}
      <section className="section">
        <h2>Native Host</h2>
        {status?.nativeHostConnected ? (
          <div className="status-row success">
            <span className="status-indicator success" />
            <span>Connected</span>
            {status.nativeHostVersion && (
              <span className="text-muted">v{status.nativeHostVersion}</span>
            )}
          </div>
        ) : status ? (
          <>
            <div className="status-row">
              <span className="status-indicator" />
              <span>Not connected</span>
            </div>
            {status.hasEverConnected && status.lastConnectedTime && (
              <p className="text-muted" style={{ marginBottom: '1rem' }}>
                Last connected: {formatTimestamp(status.lastConnectedTime)}
              </p>
            )}
          </>
        ) : extensionInstalled === false ? null : (
          <p className="text-muted">Checking...</p>
        )}

        <h3>Install Native Host</h3>
        <div className="tabs">
          <button
            className={`tab ${selectedPlatform === 'windows' ? 'active' : ''}`}
            onClick={() => setSelectedPlatform('windows')}
          >
            Windows
          </button>
          <button
            className={`tab ${selectedPlatform === 'mac' ? 'active' : ''}`}
            onClick={() => setSelectedPlatform('mac')}
          >
            Mac
          </button>
          <button
            className={`tab ${selectedPlatform === 'linux' ? 'active' : ''}`}
            onClick={() => setSelectedPlatform('linux')}
          >
            Linux
          </button>
        </div>

        <div className="tab-content">
          {selectedPlatform === 'windows' && (
            <>
              <p>Download and run the Windows installer:</p>
              <a href={WINDOWS_INSTALLER} className="btn btn-primary">
                Download for Windows ({TAG})
              </a>
            </>
          )}

          {selectedPlatform === 'mac' && (
            <>
              <p>Download and run the macOS installer:</p>
              <a href={MACOS_INSTALLER} className="btn btn-primary">
                Download for macOS ({TAG})
              </a>
            </>
          )}

          {selectedPlatform === 'linux' && (
            <>
              <p>Run this command in your terminal:</p>
              <div className="command-box">
                <code>curl -fsSL https://new.jstorrent.com/install.sh | bash</code>
                <button
                  className="copy-btn"
                  onClick={copyToClipboard}
                  aria-label="Copy to clipboard"
                >
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
            </>
          )}
        </div>
      </section>
    </div>
  )
}

export default App
