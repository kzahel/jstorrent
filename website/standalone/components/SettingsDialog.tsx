import { useState, useEffect } from 'react'
import { JsBridgeSettingsStore } from '@jstorrent/engine/adapters/android'
import type { Settings } from '@jstorrent/engine'

interface SettingsDialogProps {
  onClose: () => void
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<Partial<Settings>>({})
  const [loading, setLoading] = useState(true)
  const [settingsStore] = useState(() => new JsBridgeSettingsStore())

  useEffect(() => {
    // Initialize store first (async), then get all settings
    settingsStore.init().then(() => {
      setSettings(settingsStore.getAll())
      setLoading(false)
    })
  }, [settingsStore])

  const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const updated = { ...settings, [key]: value }
    setSettings(updated)
    await settingsStore.set(key, value)
  }

  const openFolderPicker = () => {
    window.location.href = 'jstorrent://add-root'
  }

  if (loading) {
    return (
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog" onClick={(e) => e.stopPropagation()}>
          <h2>Settings</h2>
          <p>Loading...</p>
        </div>
      </div>
    )
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
            value={settings.maxGlobalPeers ?? 50}
            onChange={(e) => updateSetting('maxGlobalPeers', parseInt(e.target.value) || 50)}
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
