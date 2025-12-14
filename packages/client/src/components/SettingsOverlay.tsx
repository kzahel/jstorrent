import React, { useEffect, useState } from 'react'
import { engineManager } from '../chrome/engine-manager'
import { useSettings } from '../context/SettingsContext'
import type { Settings, SettingKey } from '@jstorrent/engine'

type SettingsTab = 'general' | 'interface' | 'network' | 'advanced'
type Theme = 'system' | 'dark' | 'light'
type ProgressBarStyle = 'text' | 'bar'

const PROGRESS_BAR_STYLES: { value: ProgressBarStyle; label: string }[] = [
  { value: 'text', label: 'Text Only' },
  { value: 'bar', label: 'Progress Bar' },
]

interface DownloadRoot {
  key: string
  label: string
  path: string
}

interface SettingsOverlayProps {
  isOpen: boolean
  onClose: () => void
  activeTab: SettingsTab
  setActiveTab: (tab: SettingsTab) => void
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'interface', label: 'Interface' },
  { id: 'network', label: 'Network' },
  { id: 'advanced', label: 'Advanced' },
]

const FPS_OPTIONS = [1, 5, 10, 20, 30, 60, 120, 240, 0] // 0 = unlimited

export const SettingsOverlay: React.FC<SettingsOverlayProps> = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
}) => {
  const { settings, set: updateSetting } = useSettings()
  // Download roots state
  const [roots, setRoots] = useState<DownloadRoot[]>([])
  const [defaultKey, setDefaultKey] = useState<string | null>(null)
  const [loadingRoots, setLoadingRoots] = useState(true)
  const [addingRoot, setAddingRoot] = useState(false)

  // Load roots when overlay opens
  useEffect(() => {
    if (isOpen) {
      const doLoad = async () => {
        setLoadingRoots(true)
        const loadedRoots = engineManager.getRoots()
        const loadedDefaultKey = await engineManager.getDefaultRootKey()
        setRoots(loadedRoots)
        setDefaultKey(loadedDefaultKey)
        setLoadingRoots(false)
      }
      void doLoad()
    }
  }, [isOpen])

  const reloadRoots = async () => {
    setLoadingRoots(true)
    const loadedRoots = engineManager.getRoots()
    const loadedDefaultKey = await engineManager.getDefaultRootKey()
    setRoots(loadedRoots)
    setDefaultKey(loadedDefaultKey)
    setLoadingRoots(false)
  }

  const handleAddRoot = async () => {
    setAddingRoot(true)
    const root = await engineManager.pickDownloadFolder()
    setAddingRoot(false)
    if (root) {
      await reloadRoots()
      // If this is the first root, set it as default
      if (roots.length === 0) {
        await handleSetDefault(root.key)
      }
    }
  }

  const handleSetDefault = async (key: string) => {
    await engineManager.setDefaultRoot(key)
    setDefaultKey(key)
  }

  const handleRemoveRoot = async (key: string) => {
    const root = roots.find((r) => r.key === key)
    const confirmed = window.confirm(
      `Remove download location "${root?.label || key}"?\n\n` +
        'Existing downloads using this location will need to be moved or removed.',
    )
    if (!confirmed) return

    const success = await engineManager.removeDownloadRoot(key)
    if (success) {
      await reloadRoots()
    } else {
      alert('Failed to remove download location.')
    }
  }

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>Settings</h2>
          <button style={styles.closeButton} onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        {/* Content area with sidebar */}
        <div style={styles.content}>
          {/* Left sidebar with tabs */}
          <div style={styles.sidebar}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                style={{
                  ...styles.tabButton,
                  ...(activeTab === tab.id ? styles.tabButtonActive : {}),
                }}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right content area */}
          <div style={styles.tabContent}>
            {activeTab === 'general' && (
              <GeneralTab
                roots={roots}
                defaultKey={defaultKey}
                loadingRoots={loadingRoots}
                addingRoot={addingRoot}
                onAddRoot={handleAddRoot}
                onSetDefault={handleSetDefault}
                onRemoveRoot={handleRemoveRoot}
                settings={settings}
                updateSetting={updateSetting}
              />
            )}
            {activeTab === 'interface' && (
              <InterfaceTab settings={settings} updateSetting={updateSetting} />
            )}
            {activeTab === 'network' && (
              <NetworkTab settings={settings} updateSetting={updateSetting} />
            )}
            {activeTab === 'advanced' && (
              <AdvancedTab settings={settings} updateSetting={updateSetting} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ Tab Components ============

interface TabProps {
  settings: Settings
  updateSetting: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<void>
}

interface GeneralTabProps extends TabProps {
  roots: DownloadRoot[]
  defaultKey: string | null
  loadingRoots: boolean
  addingRoot: boolean
  onAddRoot: () => void
  onSetDefault: (key: string) => void
  onRemoveRoot: (key: string) => void
}

const GeneralTab: React.FC<GeneralTabProps> = ({
  roots,
  defaultKey,
  loadingRoots,
  addingRoot,
  onAddRoot,
  onSetDefault,
  onRemoveRoot,
  settings,
  updateSetting,
}) => {
  // Handle keepAwake toggle with permission request
  const handleKeepAwakeChange = async (enabled: boolean) => {
    if (enabled) {
      // Request power permission before enabling
      try {
        const granted = await chrome.permissions.request({ permissions: ['power'] })
        if (granted) {
          updateSetting('keepAwake', true)
        }
        // If denied, toggle stays off (no action needed)
      } catch (e) {
        console.error('Failed to request power permission:', e)
      }
    } else {
      updateSetting('keepAwake', false)
    }
  }

  return (
    <div>
      <Section title="Download Locations">
        {loadingRoots ? (
          <div style={{ color: 'var(--text-secondary)' }}>Loading...</div>
        ) : roots.length === 0 ? (
          <div style={styles.warning}>
            <strong>No download location configured</strong>
            <p style={{ margin: '8px 0 0 0' }}>
              You need to select a download folder before you can add torrents.
            </p>
          </div>
        ) : (
          <>
            <div style={styles.fieldRow}>
              <span>Default</span>
              <select
                value={defaultKey ?? ''}
                onChange={(e) => onSetDefault(e.target.value)}
                style={styles.select}
              >
                {roots.map((root) => (
                  <option key={root.key} value={root.key}>
                    {root.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {roots.map((root) => (
                <div key={root.key} style={styles.rootItem}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div>{root.label}</div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {root.path}
                    </div>
                  </div>
                  <button
                    style={{ ...styles.iconButton, color: 'var(--accent-error, #ef4444)' }}
                    onClick={() => onRemoveRoot(root.key)}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <button onClick={onAddRoot} disabled={addingRoot} style={styles.addButton}>
          {addingRoot ? 'Selecting...' : '+ Add Download Location'}
        </button>
      </Section>

      <Section title="Notifications">
        <ToggleRow
          label="Notify when torrent completes"
          sublabel="Show notification when a single download finishes"
          checked={settings['notifications.onTorrentComplete']}
          onChange={(v) => updateSetting('notifications.onTorrentComplete', v)}
        />
        <ToggleRow
          label="Notify when all complete"
          sublabel="Show notification when all downloads finish"
          checked={settings['notifications.onAllComplete']}
          onChange={(v) => updateSetting('notifications.onAllComplete', v)}
        />
        <ToggleRow
          label="Notify on errors"
          sublabel="Show notification when a download fails"
          checked={settings['notifications.onError']}
          onChange={(v) => updateSetting('notifications.onError', v)}
        />
        <ToggleRow
          label="Show progress when backgrounded"
          sublabel="Persistent notification with download progress when UI is hidden"
          checked={settings['notifications.progressWhenBackgrounded']}
          onChange={(v) => updateSetting('notifications.progressWhenBackgrounded', v)}
        />
      </Section>

      <Section title="Behavior">
        <ToggleRow
          label="Keep system awake while downloading"
          sublabel="Prevents sleep during active downloads (requires permission)"
          checked={settings.keepAwake}
          onChange={handleKeepAwakeChange}
        />
      </Section>
    </div>
  )
}

const InterfaceTab: React.FC<TabProps> = ({ settings, updateSetting }) => (
  <div>
    <Section title="Appearance">
      <div style={styles.fieldRow}>
        <span>Theme</span>
        <div style={styles.radioGroup}>
          {(['system', 'dark', 'light'] as Theme[]).map((theme) => (
            <label key={theme} style={styles.radioLabel}>
              <input
                type="radio"
                name="theme"
                checked={settings.theme === theme}
                onChange={() => updateSetting('theme', theme)}
              />
              {theme.charAt(0).toUpperCase() + theme.slice(1)}
            </label>
          ))}
        </div>
      </div>
      <div style={styles.fieldRow}>
        <span>Progress Bar Style</span>
        <select
          value={settings.progressBarStyle}
          onChange={(e) => updateSetting('progressBarStyle', e.target.value as ProgressBarStyle)}
          style={styles.select}
        >
          {PROGRESS_BAR_STYLES.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </Section>

    <Section title="Performance">
      <div style={styles.fieldRow}>
        <span>Max FPS</span>
        <select
          value={settings.maxFps}
          onChange={(e) => updateSetting('maxFps', Number(e.target.value))}
          style={styles.select}
        >
          {FPS_OPTIONS.map((fps) => (
            <option key={fps} value={fps}>
              {fps === 0 ? 'Unlimited' : fps}
            </option>
          ))}
        </select>
      </div>
    </Section>
  </div>
)

const NetworkTab: React.FC<TabProps> = ({ settings, updateSetting }) => {
  // Apply rate limits to engine when settings change
  const handleDownloadLimitChange = (v: number) => {
    updateSetting('downloadSpeedLimit', v)
    engineManager.setRateLimits(v, settings.uploadSpeedLimit)
  }

  const handleUploadLimitChange = (v: number) => {
    updateSetting('uploadSpeedLimit', v)
    engineManager.setRateLimits(settings.downloadSpeedLimit, v)
  }

  // Apply connection limits to engine when settings change
  const handleMaxPeersPerTorrentChange = (v: number) => {
    updateSetting('maxPeersPerTorrent', v)
    engineManager.setConnectionLimits(v, settings.maxGlobalPeers, settings.maxUploadSlots)
  }

  const handleMaxGlobalPeersChange = (v: number) => {
    updateSetting('maxGlobalPeers', v)
    engineManager.setConnectionLimits(settings.maxPeersPerTorrent, v, settings.maxUploadSlots)
  }

  const handleMaxUploadSlotsChange = (v: number) => {
    updateSetting('maxUploadSlots', v)
    engineManager.setConnectionLimits(settings.maxPeersPerTorrent, settings.maxGlobalPeers, v)
  }

  return (
    <div>
      <Section title="Listening Port">
        <NumberRow
          label="Port for incoming connections"
          value={settings.listeningPort}
          onChange={(v) => updateSetting('listeningPort', v)}
          min={1024}
          max={65535}
        />
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
          Changes require restart to take effect.
        </div>
      </Section>

      <Section title="Speed Limits">
        <SpeedLimitRow
          label="Download"
          value={settings.downloadSpeedLimit}
          onChange={handleDownloadLimitChange}
        />
        <SpeedLimitRow
          label="Upload"
          value={settings.uploadSpeedLimit}
          onChange={handleUploadLimitChange}
        />
      </Section>

      <Section title="Connection Limits">
        <NumberRow
          label="Max peers per torrent"
          value={settings.maxPeersPerTorrent}
          onChange={handleMaxPeersPerTorrentChange}
          min={1}
          max={500}
        />
        <NumberRow
          label="Global max peers"
          value={settings.maxGlobalPeers}
          onChange={handleMaxGlobalPeersChange}
          min={1}
          max={2000}
        />
        <NumberRow
          label="Max upload slots"
          value={settings.maxUploadSlots}
          onChange={handleMaxUploadSlotsChange}
          min={0}
          max={50}
        />
      </Section>
    </div>
  )
}

const AdvancedTab: React.FC<TabProps> = ({
  settings: _settings,
  updateSetting: _updateSetting,
}) => (
  <div>
    <Section title="Advanced">
      <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
        Advanced settings will be added here in future updates.
      </div>
    </Section>
  </div>
)

// ============ Reusable Components ============

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={styles.section}>
    <h3 style={styles.sectionTitle}>{title}</h3>
    {children}
  </div>
)

interface ToggleRowProps {
  label: string
  sublabel?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, sublabel, checked, onChange }) => (
  <label style={styles.toggleRow}>
    <div style={{ flex: 1 }}>
      <div>{label}</div>
      {sublabel && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{sublabel}</div>
      )}
    </div>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
  </label>
)

interface SpeedLimitRowProps {
  label: string
  value: number
  onChange: (value: number) => void
}

const SpeedLimitRow: React.FC<SpeedLimitRowProps> = ({ label, value, onChange }) => {
  const isUnlimited = value === 0
  const derivedValue = isUnlimited ? '' : String(Math.round(value / 1024))

  // Track if user is actively editing (to prevent prop sync during edit)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(derivedValue)

  // Display either the edit value (while editing) or derived value (from props)
  const displayValue = isEditing ? editValue : derivedValue

  const handleFocus = () => {
    setIsEditing(true)
    setEditValue(derivedValue)
  }

  const handleBlur = () => {
    setIsEditing(false)
    const kb = Number(editValue)
    if (Number.isFinite(kb) && kb > 0) {
      onChange(kb * 1024)
    } else if (editValue === '' || kb <= 0) {
      // Empty or zero means unlimited
      onChange(0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur()
      ;(e.target as HTMLInputElement).blur()
    }
  }

  return (
    <div style={styles.fieldRow}>
      <span style={{ minWidth: '80px' }}>{label}</span>
      <input
        type="number"
        value={displayValue}
        onChange={(e) => setEditValue(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={isUnlimited}
        placeholder="0"
        style={{ ...styles.numberInput, opacity: isUnlimited ? 0.5 : 1 }}
      />
      <span style={{ fontSize: '12px' }}>KB/s</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '12px' }}>
        <input
          type="checkbox"
          checked={isUnlimited}
          onChange={(e) => onChange(e.target.checked ? 0 : 1024)}
        />
        Unlimited
      </label>
    </div>
  )
}

interface NumberRowProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
}

const NumberRow: React.FC<NumberRowProps> = ({ label, value, onChange, min = 0, max = 9999 }) => {
  const [inputValue, setInputValue] = useState(String(value))

  // Sync from prop when it changes externally
  useEffect(() => {
    setInputValue(String(value))
  }, [value])

  const handleBlur = () => {
    const v = Number(inputValue)
    if (Number.isFinite(v)) {
      // Clamp to range and update
      const clamped = Math.max(min, Math.min(max, v))
      onChange(clamped)
      setInputValue(String(clamped))
    } else {
      // Invalid input, reset to current value
      setInputValue(String(value))
    }
  }

  return (
    <div style={styles.fieldRow}>
      <span style={{ flex: 1 }}>{label}</span>
      <input
        type="number"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        min={min}
        max={max}
        style={styles.numberInput}
      />
    </div>
  )
}

// ============ Styles ============

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '80px',
    zIndex: 1000,
  },
  modal: {
    background: 'var(--bg-primary)',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '800px',
    minHeight: '500px',
    maxHeight: 'calc(100vh - 120px)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    border: '1px solid var(--border-color)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border-color)',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
    padding: '0 4px',
    lineHeight: 1,
  },
  content: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: '140px',
    borderRight: '1px solid var(--border-color)',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flexShrink: 0,
    background: 'var(--bg-secondary)',
  },
  tabButton: {
    background: 'transparent',
    border: 'none',
    padding: '10px 12px',
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: '4px',
    color: 'var(--text-primary)',
    fontSize: '14px',
  },
  tabButtonActive: {
    background: 'var(--accent-primary)',
    color: 'white',
  },
  tabContent: {
    flex: 1,
    padding: '20px',
    overflowY: 'auto',
    background: 'var(--bg-primary)',
  },
  section: {
    marginBottom: '16px',
    padding: '12px',
    background: 'var(--bg-secondary)',
    borderRadius: '6px',
    border: '1px solid var(--border-color)',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    letterSpacing: '0.5px',
  },
  warning: {
    padding: '12px',
    background: 'var(--bg-warning, rgba(234, 179, 8, 0.1))',
    border: '1px solid var(--border-warning, #eab308)',
    borderRadius: '4px',
    marginBottom: '12px',
  },
  rootItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-light)',
    borderRadius: '4px',
  },
  iconButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    fontSize: '16px',
    opacity: 0.6,
  },
  defaultBadge: {
    padding: '4px 8px',
    background: 'var(--accent-primary)',
    color: 'white',
    borderRadius: '4px',
    fontSize: '12px',
  },
  addButton: {
    marginTop: '12px',
    padding: '8px 16px',
    background: 'var(--accent-success)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  fieldRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
    padding: '10px 12px',
    background: 'var(--bg-tertiary)',
    borderRadius: '4px',
    border: '1px solid var(--border-light)',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
    padding: '10px 12px',
    background: 'var(--bg-tertiary)',
    borderRadius: '4px',
    border: '1px solid var(--border-light)',
    cursor: 'pointer',
  },
  radioGroup: {
    display: 'flex',
    gap: '16px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
  },
  select: {
    padding: '6px 10px',
    borderRadius: '4px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
  },
  numberInput: {
    width: '80px',
    padding: '6px 10px',
    borderRadius: '4px',
    border: '1px solid var(--border-color)',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
  },
}
