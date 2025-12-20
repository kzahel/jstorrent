import { useState, useEffect } from 'react'

const EXTENSION_ID = 'dbokmlpefliilbjldladbimlcfgbolhk' // Local ID
const WEBSTORE_URL = `https://chromewebstore.google.com/detail/jstorrent/${EXTENSION_ID}`

// will be annoying to have to update this?
const TAG = 'v0.1.1'

const WINDOWS_INSTALLER = `https://github.com/kzahel/jstorrent/releases/download/native-${TAG}/jstorrent-native-host-install-windows-x86_64.exe`
const MACOS_INSTALLER = `https://github.com/kzahel/jstorrent/releases/download/native-${TAG}/jstorrent-native-host-install-macos-x86_64.pkg`

type Platform = 'windows' | 'mac' | 'linux'

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'mac'
  return 'linux'
}

function App() {
  const [copied, setCopied] = useState(false)
  const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(detectPlatform)

  useEffect(() => {
    // Check if extension is installed by trying to message it
    const checkExtension = () => {
      try {
        // @ts-expect-error - chrome is not defined in standard web types
        if (window.chrome && window.chrome.runtime) {
          // @ts-expect-error - sendMessage is valid
          window.chrome.runtime.sendMessage(EXTENSION_ID, { type: 'ping' }, (response: unknown) => {
            // @ts-expect-error - lastError is valid
            if (window.chrome.runtime.lastError) {
              setExtensionInstalled(false)
            } else {
              setExtensionInstalled(!!response)
            }
          })
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
        window.chrome.runtime.sendMessage(EXTENSION_ID, { type: 'launch-ping' }, (response: unknown) => {
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
      <h1>JSTorrent</h1>
      <p>
        Please visit the{' '}
        <a href="https://github.com/kzahel/jstorrent">GitHub Repository</a> for
        installation instructions.
      </p>

      {/* Extension status */}
      <div style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
        {extensionInstalled === true ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#4caf50', fontWeight: 'bold' }}>✓ JSTorrent is installed</span>
            <button onClick={handleLaunch} style={{ padding: '10px 20px', fontSize: '1.2rem' }}>
              Launch JSTorrent
            </button>
          </div>
        ) : extensionInstalled === false ? (
          <div>
            <p style={{ marginBottom: '0.5rem' }}>
              Extension not detected.{' '}
              <a href={WEBSTORE_URL} target="_blank" rel="noopener noreferrer">
                Install JSTorrent from Chrome Web Store
              </a>
            </p>
          </div>
        ) : (
          <p style={{ color: '#888' }}>Checking extension status...</p>
        )}
      </div>

      {/* Platform tabs */}
      <h2>Native Host Installation</h2>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button
          onClick={() => setSelectedPlatform('windows')}
          style={{
            padding: '8px 16px',
            background: selectedPlatform === 'windows' ? '#646cff' : '#333',
            border: 'none',
            borderRadius: '4px',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Windows
        </button>
        <button
          onClick={() => setSelectedPlatform('mac')}
          style={{
            padding: '8px 16px',
            background: selectedPlatform === 'mac' ? '#646cff' : '#333',
            border: 'none',
            borderRadius: '4px',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Mac
        </button>
        <button
          onClick={() => setSelectedPlatform('linux')}
          style={{
            padding: '8px 16px',
            background: selectedPlatform === 'linux' ? '#646cff' : '#333',
            border: 'none',
            borderRadius: '4px',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Linux
        </button>
      </div>

      {/* Platform-specific instructions */}
      {selectedPlatform === 'windows' && (
        <div>
          <p>Download and run the Windows installer:</p>
          <a
            href={WINDOWS_INSTALLER}
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              background: '#646cff',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
            }}
          >
            Download Windows Installer (.exe)
          </a>
        </div>
      )}

      {selectedPlatform === 'mac' && (
        <div>
          <p>Download and run the macOS installer:</p>
          <a
            href={MACOS_INSTALLER}
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              background: '#646cff',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
            }}
          >
            Download macOS Installer (.pkg)
          </a>
        </div>
      )}

      {selectedPlatform === 'linux' && (
        <div>
          <p>Run this command in your terminal:</p>
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
        </div>
      )}
    </div>
  )
}

export default App
