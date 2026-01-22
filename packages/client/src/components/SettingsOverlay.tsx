import React, { useEffect, useState, useSyncExternalStore, useCallback } from 'react'
import { useEngineManager, useFileOperations } from '../context/EngineManagerContext'
import { useConfig } from '../context/ConfigContext'
import type { ConfigHub, UPnPStatus } from '@jstorrent/engine'
import { clearAllUISettings } from '@jstorrent/ui'
import type { IEngineManager } from '../engine-manager/types'
import { standaloneConfirm, standaloneAlert } from '../utils/dialogs'

// Component log level type (matches ConfigHub's ComponentLogLevel)
type ComponentLogLevel = 'default' | 'debug' | 'info' | 'warn' | 'error'

/**
 * Build a config snapshot object from ConfigHub.
 * This is extracted to ensure consistent structure.
 */
function buildConfigSnapshot(config: ConfigHub) {
  return {
    // Notifications
    notifyOnTorrentComplete: config.notifyOnTorrentComplete.get(),
    notifyOnAllComplete: config.notifyOnAllComplete.get(),
    notifyOnError: config.notifyOnError.get(),
    notifyProgressWhenBackgrounded: config.notifyProgressWhenBackgrounded.get(),
    // Behavior
    keepAwake: config.keepAwake.get(),
    preventBackgroundThrottling: config.preventBackgroundThrottling.get(),
    // UI
    theme: config.theme.get(),
    progressBarStyle: config.progressBarStyle.get(),
    maxFps: config.maxFps.get(),
    // Network
    listeningPort: config.listeningPort.get(),
    upnpEnabled: config.upnpEnabled.get(),
    encryptionPolicy: config.encryptionPolicy.get(),
    downloadSpeedLimit: config.downloadSpeedLimit.get(),
    uploadSpeedLimit: config.uploadSpeedLimit.get(),
    maxPeersPerTorrent: config.maxPeersPerTorrent.get(),
    maxGlobalPeers: config.maxGlobalPeers.get(),
    maxUploadSlots: config.maxUploadSlots.get(),
    dhtEnabled: config.dhtEnabled.get(),
    // Advanced
    loggingLevel: config.loggingLevel.get(),
    loggingLevelClient: config.loggingLevelClient.get(),
    loggingLevelTorrent: config.loggingLevelTorrent.get(),
    loggingLevelPeer: config.loggingLevelPeer.get(),
    loggingLevelActivePieces: config.loggingLevelActivePieces.get(),
    loggingLevelContentStorage: config.loggingLevelContentStorage.get(),
    loggingLevelPartsFile: config.loggingLevelPartsFile.get(),
    loggingLevelTrackerManager: config.loggingLevelTrackerManager.get(),
    loggingLevelHttpTracker: config.loggingLevelHttpTracker.get(),
    loggingLevelUdpTracker: config.loggingLevelUdpTracker.get(),
    loggingLevelDht: config.loggingLevelDht.get(),
    daemonOpsPerSecond: config.daemonOpsPerSecond.get(),
    daemonOpsBurst: config.daemonOpsBurst.get(),
  }
}

/**
 * Hook to read all config values as a snapshot for UI rendering.
 * This provides a settings-like object for backward compatibility while
 * using ConfigHub as the source of truth.
 *
 * Uses a ref to cache the snapshot and only creates a new object when
 * values actually change (required by useSyncExternalStore).
 */
function useConfigSnapshot(config: ConfigHub) {
  // Cache the last snapshot to return same reference if unchanged
  const cacheRef = React.useRef<ReturnType<typeof buildConfigSnapshot> | null>(null)

  // getSnapshot must return cached value if nothing changed
  const getSnapshot = useCallback(() => {
    const newSnapshot = buildConfigSnapshot(config)

    // Compare with cached - if all values match, return cached reference
    if (cacheRef.current) {
      const cached = cacheRef.current
      const keys = Object.keys(newSnapshot) as (keyof typeof newSnapshot)[]
      const hasChanges = keys.some((key) => cached[key] !== newSnapshot[key])
      if (!hasChanges) {
        return cached
      }
    }

    // Values changed, update cache and return new snapshot
    cacheRef.current = newSnapshot
    return newSnapshot
  }, [config])

  // Subscribe to all changes
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      return config.subscribeAll(onStoreChange)
    },
    [config],
  )

  return useSyncExternalStore(subscribe, getSnapshot)
}

type ConfigSnapshot = ReturnType<typeof useConfigSnapshot>

// Chrome extension API may not be available in non-extension contexts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any

type SettingsTab = 'general' | 'interface' | 'network' | 'advanced'
type Theme = 'system' | 'dark' | 'light'
type ProgressBarStyle = 'text' | 'bar'

/** Strip Windows extended-length path prefix for display */
function formatPathForDisplay(path: string): string {
  if (path.startsWith('\\\\?\\')) {
    return path.slice(4)
  }
  return path
}

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

const FPS_OPTIONS = [1, 5, 10, 20, 30, 60, 120, 144, 165, 240, 0] // 0 = unlimited

export const SettingsOverlay: React.FC<SettingsOverlayProps> = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
}) => {
  const { config, resetAll } = useConfig()
  const settings = useConfigSnapshot(config)
  const engineManager = useEngineManager()
  const fileOps = useFileOperations()

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
  }, [isOpen, engineManager])

  const reloadRoots = async () => {
    setLoadingRoots(true)
    const loadedRoots = engineManager.getRoots()
    const loadedDefaultKey = await engineManager.getDefaultRootKey()
    setRoots(loadedRoots)
    setDefaultKey(loadedDefaultKey)
    setLoadingRoots(false)
  }

  const handleAddRoot = () => {
    if (!fileOps) return
    setAddingRoot(true)
    // Re-enable button after 2s (notification may be missed, allow retry)
    setTimeout(() => setAddingRoot(false), 2000)

    // Start picker in background, update UI when result comes back
    fileOps.pickDownloadFolder().then(async (root) => {
      if (root) {
        await reloadRoots()
        // If this is the first root, set it as default
        if (roots.length === 0) {
          await handleSetDefault(root.key)
        }
      }
    })
  }

  const handleSetDefault = async (key: string) => {
    await engineManager.setDefaultRoot(key)
    setDefaultKey(key)
  }

  const handleRemoveRoot = async (key: string) => {
    console.log('[SettingsOverlay] handleRemoveRoot called:', key, 'fileOps:', !!fileOps)
    if (!fileOps) {
      console.warn(
        '[SettingsOverlay] fileOps is null - supportsFileOperations:',
        engineManager.supportsFileOperations,
      )
      return
    }
    const root = roots.find((r) => r.key === key)

    const confirmed = standaloneConfirm(
      `Remove download location "${root?.label || key}"?\n\n` +
        'Existing downloads using this location will need to be moved or removed.',
    )
    console.log('[SettingsOverlay] confirmed:', confirmed)
    if (!confirmed) return

    console.log('[SettingsOverlay] Calling removeDownloadRoot for key:', key)
    const success = await fileOps.removeDownloadRoot(key)
    console.log('[SettingsOverlay] removeDownloadRoot returned:', success)
    if (success) {
      await reloadRoots()
    } else {
      standaloneAlert('Failed to remove download location.')
    }
  }

  // Handle reset UI settings
  const handleResetUISettings = () => {
    const confirmed = standaloneConfirm(
      'Reset all user interface settings to defaults?\n\n' +
        'This will restore default column configurations for all tables.\n' +
        'The page will reload to apply changes.',
    )
    if (confirmed) {
      clearAllUISettings()
      window.location.reload()
    }
  }

  // Handle reset all settings
  const handleResetAllSettings = async () => {
    const confirmed = standaloneConfirm(
      'Reset ALL settings to their default values?\n\n' +
        'This includes network limits, notification preferences, theme, and UI layout.\n' +
        'Your download locations and downloaded files will not be affected.\n\n' +
        'The page will reload to apply changes.',
    )
    if (confirmed) {
      await resetAll()
      clearAllUISettings()
      window.location.reload()
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
                config={config}
                supportsFileOperations={engineManager.supportsFileOperations}
                isStandalone={engineManager.isStandalone}
              />
            )}
            {activeTab === 'interface' && (
              <InterfaceTab
                settings={settings}
                config={config}
                onResetUISettings={handleResetUISettings}
                isStandalone={engineManager.isStandalone}
              />
            )}
            {activeTab === 'network' && (
              <NetworkTab settings={settings} config={config} engineManager={engineManager} />
            )}
            {activeTab === 'advanced' && (
              <AdvancedTab
                settings={settings}
                config={config}
                onResetAllSettings={handleResetAllSettings}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ Tab Components ============

interface TabProps {
  settings: ConfigSnapshot
  config: ConfigHub
}

interface GeneralTabProps extends TabProps {
  roots: DownloadRoot[]
  defaultKey: string | null
  loadingRoots: boolean
  addingRoot: boolean
  onAddRoot: () => void
  onSetDefault: (key: string) => void
  onRemoveRoot: (key: string) => void
  supportsFileOperations: boolean
  isStandalone: boolean
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
  config,
  supportsFileOperations,
  isStandalone,
}) => {
  // Handle keepAwake toggle with permission request (Chrome only)
  const handleKeepAwakeChange = async (enabled: boolean) => {
    if (enabled) {
      // Request power permission before enabling (Chrome extension only)
      if (typeof chrome !== 'undefined' && chrome.permissions?.request) {
        try {
          const granted = await chrome.permissions.request({ permissions: ['power'] })
          if (granted) {
            config.set('keepAwake', true)
          }
          // If denied, toggle stays off (no action needed)
        } catch (e) {
          console.error('Failed to request power permission:', e)
        }
      } else {
        // Non-Chrome platforms: just enable without permission request
        config.set('keepAwake', true)
      }
    } else {
      config.set('keepAwake', false)
    }
  }

  return (
    <div>
      {supportsFileOperations && (
        <Section title="Download Locations">
          {loadingRoots ? (
            <div style={{ color: 'var(--text-secondary)' }}>Loading...</div>
          ) : roots.length === 0 ? (
            <div style={styles.warning}>
              <strong>No download location configured</strong>
              <p style={{ margin: '8px 0 0 0' }}>
                You need to select a download folder before you can download torrents.
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
                        {formatPathForDisplay(root.path)}
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
      )}

      <Section title="Notifications">
        <ToggleRow
          label="Notify when torrent completes"
          sublabel={
            isStandalone
              ? 'Not available in standalone mode'
              : 'Show notification when a single download finishes'
          }
          checked={settings.notifyOnTorrentComplete}
          onChange={(v) => config.set('notifyOnTorrentComplete', v)}
          disabled={isStandalone}
        />
        <ToggleRow
          label="Notify when all complete"
          sublabel={
            isStandalone
              ? 'Not available in standalone mode'
              : 'Show notification when all downloads finish'
          }
          checked={settings.notifyOnAllComplete}
          onChange={(v) => config.set('notifyOnAllComplete', v)}
          disabled={isStandalone}
        />
        <ToggleRow
          label="Notify on errors"
          sublabel={
            isStandalone
              ? 'Not available in standalone mode'
              : 'Show notification when a download fails'
          }
          checked={settings.notifyOnError}
          onChange={(v) => config.set('notifyOnError', v)}
          disabled={isStandalone}
        />
        <ToggleRow
          label="Show progress when backgrounded"
          sublabel={
            isStandalone
              ? 'Not available in standalone mode'
              : 'Persistent notification with download progress when UI is hidden'
          }
          checked={settings.notifyProgressWhenBackgrounded}
          onChange={(v) => config.set('notifyProgressWhenBackgrounded', v)}
          disabled={isStandalone}
        />
      </Section>

      <Section title="Behavior">
        <ToggleRow
          label="Keep system awake while downloading"
          sublabel={
            isStandalone
              ? 'Not available in standalone mode'
              : 'Prevents sleep during active downloads (requires permission)'
          }
          checked={settings.keepAwake}
          onChange={handleKeepAwakeChange}
          disabled={isStandalone}
        />
        <ToggleRow
          label="Prevent background throttling"
          sublabel={
            isStandalone
              ? 'Not available in standalone mode'
              : 'Keeps downloads running at full speed when tab is in background'
          }
          checked={settings.preventBackgroundThrottling}
          onChange={(v) => config.set('preventBackgroundThrottling', v)}
          disabled={isStandalone}
        />
      </Section>
    </div>
  )
}

interface InterfaceTabProps extends TabProps {
  onResetUISettings: () => void
  isStandalone: boolean
}

const InterfaceTab: React.FC<InterfaceTabProps> = ({
  settings,
  config,
  onResetUISettings,
  isStandalone,
}) => (
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
                onChange={() => config.set('theme', theme)}
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
          onChange={(e) => config.set('progressBarStyle', e.target.value as ProgressBarStyle)}
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
          onChange={(e) => config.set('maxFps', Number(e.target.value))}
          style={styles.select}
        >
          {FPS_OPTIONS.map((fps) => (
            <option key={fps} value={fps}>
              {fps === 0 ? 'Match refresh rate' : fps}
            </option>
          ))}
        </select>
      </div>
    </Section>

    <Section title="User Interface">
      <div style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Restore default column visibility, order, and sizes for all tables.
      </div>
      <button onClick={onResetUISettings} style={styles.dangerButton}>
        Reset UI Settings
      </button>
    </Section>

    {isStandalone && (
      <Section title="Interface Mode">
        <div style={styles.fieldRow}>
          <div style={{ flex: 1 }}>
            <div>Switch Interface</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Currently using the full-featured interface
            </div>
          </div>
          <button
            style={styles.addButton}
            onClick={() => {
              window.location.href = 'jstorrent://switch-ui?mode=standalone'
            }}
          >
            Switch to Light
          </button>
        </div>
      </Section>
    )}
  </div>
)

interface NetworkTabProps extends TabProps {
  engineManager: IEngineManager
}

// Default display value for speed limit when unlimited (1 MB/s)
const DEFAULT_SPEED_LIMIT_BYTES = 1024 * 1024

const NetworkTab: React.FC<NetworkTabProps> = ({ settings, config, engineManager }) => {
  // UPnP status state - initialize from engine if available
  const [upnpStatus, setUpnpStatus] = useState<UPnPStatus>(
    () => engineManager.engine?.upnpStatus ?? 'disabled',
  )

  // Speed limit display values (ConfigHub stores 0 for unlimited, but UI needs a display value)
  // When config value is 0 (unlimited), we use a default display value
  const [downloadDisplayValue, setDownloadDisplayValue] = useState(() =>
    settings.downloadSpeedLimit > 0 ? settings.downloadSpeedLimit : DEFAULT_SPEED_LIMIT_BYTES,
  )
  const [uploadDisplayValue, setUploadDisplayValue] = useState(() =>
    settings.uploadSpeedLimit > 0 ? settings.uploadSpeedLimit : DEFAULT_SPEED_LIMIT_BYTES,
  )

  // Derive unlimited state from config (0 = unlimited)
  const downloadUnlimited = settings.downloadSpeedLimit === 0
  const uploadUnlimited = settings.uploadSpeedLimit === 0

  // Subscribe to UPnP status changes
  useEffect(() => {
    const engine = engineManager.engine
    if (!engine) return

    // Subscribe to changes
    const handler = (status: UPnPStatus) => setUpnpStatus(status)
    engine.on('upnpStatusChanged', handler)
    return () => {
      engine.off('upnpStatusChanged', handler)
    }
  }, [engineManager])

  // Rate limit handlers - ConfigHub stores effective value (0 = unlimited)
  const handleDownloadLimitChange = (v: number) => {
    setDownloadDisplayValue(v)
    if (!downloadUnlimited) {
      config.set('downloadSpeedLimit', v)
    }
  }

  const handleDownloadUnlimitedChange = (unlimited: boolean) => {
    config.set('downloadSpeedLimit', unlimited ? 0 : downloadDisplayValue)
  }

  const handleUploadLimitChange = (v: number) => {
    setUploadDisplayValue(v)
    if (!uploadUnlimited) {
      config.set('uploadSpeedLimit', v)
    }
  }

  const handleUploadUnlimitedChange = (unlimited: boolean) => {
    config.set('uploadSpeedLimit', unlimited ? 0 : uploadDisplayValue)
  }

  // UPnP status indicator
  const getUpnpStatusInfo = (): { text: string; color: string } => {
    switch (upnpStatus) {
      case 'discovering':
        return { text: 'Discovering...', color: 'var(--text-secondary)' }
      case 'mapped': {
        const externalIP = engineManager.engine?.upnpExternalIP
        return { text: externalIP ? `✓ ${externalIP}` : '✓ Mapped', color: 'var(--accent-success)' }
      }
      case 'failed':
        return { text: 'Failed', color: 'var(--accent-error)' }
      default:
        return { text: '', color: '' }
    }
  }

  const statusInfo = getUpnpStatusInfo()

  return (
    <div>
      <Section title="Listening Port">
        <NumberRow
          label="Port for incoming connections"
          value={settings.listeningPort}
          onChange={(v) => config.set('listeningPort', v)}
          min={1024}
          max={65535}
        />
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
          Changes require restart to take effect.
        </div>
      </Section>

      <Section title="Port Forwarding">
        <label style={styles.toggleRow}>
          <div style={{ flex: 1 }}>
            <div>Enable UPnP</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Automatically configure router for incoming connections
            </div>
          </div>
          {statusInfo.text && (
            <span style={{ fontSize: '12px', color: statusInfo.color, marginRight: '12px' }}>
              {statusInfo.text}
            </span>
          )}
          <input
            type="checkbox"
            checked={settings.upnpEnabled}
            onChange={(e) => config.set('upnpEnabled', e.target.checked)}
          />
        </label>
      </Section>

      <Section title="Encryption">
        <label style={styles.toggleRow}>
          <div style={{ flex: 1 }}>
            <div>Protocol encryption (MSE/PE)</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Encrypts BitTorrent protocol traffic
            </div>
          </div>
          <select
            value={settings.encryptionPolicy}
            onChange={(e) =>
              config.set(
                'encryptionPolicy',
                e.target.value as 'disabled' | 'allow' | 'prefer' | 'required',
              )
            }
            style={styles.select}
          >
            <option value="disabled">Disable</option>
            <option value="allow">Allow</option>
            <option value="prefer">Prefer</option>
            <option value="required">Require</option>
          </select>
        </label>
      </Section>

      <Section title="Speed Limits">
        <SpeedLimitRow
          label="Download"
          value={downloadDisplayValue}
          unlimited={downloadUnlimited}
          onValueChange={handleDownloadLimitChange}
          onUnlimitedChange={handleDownloadUnlimitedChange}
        />
        <SpeedLimitRow
          label="Upload"
          value={uploadDisplayValue}
          unlimited={uploadUnlimited}
          onValueChange={handleUploadLimitChange}
          onUnlimitedChange={handleUploadUnlimitedChange}
        />
      </Section>

      <Section title="Connection Limits">
        <NumberRow
          label="Max peers per torrent"
          value={settings.maxPeersPerTorrent}
          onChange={(v) => config.set('maxPeersPerTorrent', v)}
          min={1}
          max={500}
        />
        <NumberRow
          label="Global max peers"
          value={settings.maxGlobalPeers}
          onChange={(v) => config.set('maxGlobalPeers', v)}
          min={1}
          max={2000}
        />
        <NumberRow
          label="Max upload slots"
          value={settings.maxUploadSlots}
          onChange={(v) => config.set('maxUploadSlots', v)}
          min={0}
          max={50}
        />
      </Section>

      <Section title="Peer Discovery">
        <ToggleRow
          label="Enable DHT"
          sublabel="Distributed Hash Table for finding peers without trackers"
          checked={settings.dhtEnabled}
          onChange={(enabled) => config.set('dhtEnabled', enabled)}
        />
      </Section>
    </div>
  )
}

interface AdvancedTabProps extends TabProps {
  onResetAllSettings: () => void
}

// Log level options for global setting
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
type LogLevelValue = (typeof LOG_LEVELS)[number]

// Log level options for per-component setting (includes 'default')
const COMPONENT_LOG_LEVELS = ['default', 'debug', 'info', 'warn', 'error'] as const

// Component config keys for logging (maps display name -> ConfigHub key)
const LOG_COMPONENT_CONFIG_KEYS = {
  client: 'loggingLevelClient',
  torrent: 'loggingLevelTorrent',
  peer: 'loggingLevelPeer',
  'active-pieces': 'loggingLevelActivePieces',
  'content-storage': 'loggingLevelContentStorage',
  'parts-file': 'loggingLevelPartsFile',
  'tracker-manager': 'loggingLevelTrackerManager',
  'http-tracker': 'loggingLevelHttpTracker',
  'udp-tracker': 'loggingLevelUdpTracker',
  dht: 'loggingLevelDht',
} as const

type LogComponentName = keyof typeof LOG_COMPONENT_CONFIG_KEYS

const AdvancedTab: React.FC<AdvancedTabProps> = ({ settings, config, onResetAllSettings }) => {
  // Component overrides collapsed by default
  const [overridesExpanded, setOverridesExpanded] = useState(false)

  // Get the value for a component log level from the snapshot
  const getComponentLogLevel = (comp: LogComponentName): ComponentLogLevel => {
    const key = LOG_COMPONENT_CONFIG_KEYS[comp]
    return settings[key]
  }

  // Set a component log level
  const setComponentLogLevel = (comp: LogComponentName, level: ComponentLogLevel) => {
    const key = LOG_COMPONENT_CONFIG_KEYS[comp]
    config.set(key, level)
  }

  // Reset logging settings to defaults
  const handleResetLogging = () => {
    config.set('loggingLevel', 'info')
    for (const comp of Object.keys(LOG_COMPONENT_CONFIG_KEYS) as LogComponentName[]) {
      setComponentLogLevel(comp, 'default')
    }
  }

  return (
    <div>
      <Section title="Logging">
        <div style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Controls the verbosity of engine logs. More verbose levels (debug) may generate
          significant output.
        </div>
        <div style={styles.fieldRow}>
          <span style={{ flex: 1 }}>Global log level</span>
          <select
            value={settings.loggingLevel}
            onChange={(e) => config.set('loggingLevel', e.target.value as LogLevelValue)}
            style={styles.select}
          >
            {LOG_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div
          style={styles.collapsibleHeader}
          onClick={() => setOverridesExpanded(!overridesExpanded)}
        >
          <span style={{ marginRight: '8px' }}>{overridesExpanded ? '▼' : '▶'}</span>
          Component Overrides (select &ldquo;Default&rdquo; to use global level)
        </div>
        {overridesExpanded &&
          (Object.keys(LOG_COMPONENT_CONFIG_KEYS) as LogComponentName[]).map((comp) => (
            <div key={comp} style={styles.fieldRow}>
              <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '12px' }}>{comp}</span>
              <select
                value={getComponentLogLevel(comp)}
                onChange={(e) => setComponentLogLevel(comp, e.target.value as ComponentLogLevel)}
                style={styles.select}
              >
                {COMPONENT_LOG_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level === 'default'
                      ? 'Default'
                      : level.charAt(0).toUpperCase() + level.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          ))}

        <button
          onClick={handleResetLogging}
          style={{ ...styles.addButton, marginTop: '16px', background: 'var(--accent-primary)' }}
        >
          Reset Logging to Defaults
        </button>
      </Section>

      <Section title="Daemon Rate Limiting">
        <div style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Controls how fast new connections and tracker announces are initiated. Lower values reduce
          resource usage but slow down peer discovery.
        </div>
        <NumberRow
          label="Operations per second"
          value={settings.daemonOpsPerSecond}
          onChange={(v) => config.set('daemonOpsPerSecond', v)}
          min={1}
          max={100}
        />
        <NumberRow
          label="Burst capacity"
          value={settings.daemonOpsBurst}
          onChange={(v) => config.set('daemonOpsBurst', v)}
          min={1}
          max={200}
        />
      </Section>

      <Section title="Danger Zone">
        <div style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Restore all settings to their default values. This includes network limits, notification
          preferences, theme, and UI layout. Your download locations and downloaded files will not
          be affected.
        </div>
        <button onClick={onResetAllSettings} style={styles.dangerButton}>
          Reset All Settings
        </button>
      </Section>
    </div>
  )
}

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
  disabled?: boolean
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, sublabel, checked, onChange, disabled }) => (
  <label
    style={{
      ...styles.toggleRow,
      opacity: disabled ? 0.5 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
    }}
  >
    <div style={{ flex: 1 }}>
      <div>{label}</div>
      {sublabel && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{sublabel}</div>
      )}
    </div>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => !disabled && onChange(e.target.checked)}
      disabled={disabled}
    />
  </label>
)

interface SpeedLimitRowProps {
  label: string
  value: number
  unlimited: boolean
  onValueChange: (value: number) => void
  onUnlimitedChange: (unlimited: boolean) => void
}

const SpeedLimitRow: React.FC<SpeedLimitRowProps> = ({
  label,
  value,
  unlimited,
  onValueChange,
  onUnlimitedChange,
}) => {
  const derivedValue = String(Math.round(value / 1024))

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
      onValueChange(kb * 1024)
    } else {
      // Invalid or zero - reset to current value
      setEditValue(derivedValue)
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
        disabled={unlimited}
        placeholder="0"
        min={0}
        style={{ ...styles.numberInput, opacity: unlimited ? 0.5 : 1 }}
      />
      <span style={{ fontSize: '12px' }}>KB/s</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '12px' }}>
        <input
          type="checkbox"
          checked={unlimited}
          onChange={(e) => onUnlimitedChange(e.target.checked)}
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
  dangerButton: {
    padding: '8px 16px',
    background: 'var(--accent-error, #ef4444)',
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
  collapsibleHeader: {
    color: 'var(--text-secondary)',
    marginTop: '16px',
    marginBottom: '8px',
    cursor: 'pointer',
    userSelect: 'none',
  },
}
