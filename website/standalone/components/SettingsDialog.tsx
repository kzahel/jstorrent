import { useState, useEffect } from 'react'
import type { ConfigHub } from '@jstorrent/engine'

interface SettingsDialogProps {
  configHub: ConfigHub
  onClose: () => void
}

export function SettingsDialog({ configHub, onClose }: SettingsDialogProps) {
  const [maxGlobalPeers, setMaxGlobalPeers] = useState(configHub.maxGlobalPeers.get())

  // Subscribe to config changes
  useEffect(() => {
    const unsubscribe = configHub.maxGlobalPeers.subscribe((value) => {
      setMaxGlobalPeers(value)
    })
    return unsubscribe
  }, [configHub])

  const updateMaxPeers = (value: number) => {
    setMaxGlobalPeers(value)
    configHub.set('maxGlobalPeers', value)
  }

  const openFolderPicker = () => {
    window.location.href = 'jstorrent://add-root'
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <div className="settings-row">
          <span className="settings-label">Max connections</span>
          <input
            type="number"
            className="settings-input"
            value={maxGlobalPeers}
            onChange={(e) => updateMaxPeers(parseInt(e.target.value) || 50)}
            min={1}
            max={200}
          />
        </div>

        <div className="settings-row">
          <span className="settings-label">Download folder</span>
          <button className="btn-primary" onClick={openFolderPicker}>
            Change
          </button>
        </div>

        <div className="settings-row">
          <span className="settings-label">Interface</span>
          <button
            className="btn-primary"
            onClick={() => {
              window.location.href = 'jstorrent://switch-ui?mode=full'
            }}
          >
            Switch to Full Interface
          </button>
        </div>

        <div className="settings-row">
          <span className="settings-label">Native UI</span>
          <button
            className="btn-primary"
            onClick={() => {
              window.location.href = 'jstorrent://switch-ui?mode=native'
            }}
          >
            Switch to Native Interface
          </button>
        </div>

        <div className="dialog-actions" style={{ marginTop: '20px' }}>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
