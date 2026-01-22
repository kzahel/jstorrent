const SW_START_TIME = new Date().toISOString()
console.log(`[SW] Service Worker loaded at ${SW_START_TIME}`)
console.log('[SW] Deploy test - this log confirms deploy workflow works!')

import { getDaemonBridge, type NativeEvent, type DaemonBridgeState } from './lib/daemon-bridge'
import { handleKVMessage } from './lib/kv-handlers'
import { NotificationManager, ProgressStats } from './lib/notifications'
import { PowerManager } from './lib/power'
import { getOrCreateInstallId } from './lib/install-id'
import { detectPlatform, findAndroidDaemonPort } from './lib/platform'
import { getChromeOSBootstrap, type BootstrapState } from './lib/chromeos-bootstrap'
import {
  registerDevice,
  updateUninstallUrl,
  setupSyncListener,
  incrementTorrentsAdded,
  incrementCompletedDownloads,
  incrementSessionsStarted,
} from './lib/metrics'

// ============================================================================
// Notification Manager
// ============================================================================
const notificationManager = new NotificationManager()

// ============================================================================
// Power Manager (prevents sleep during active downloads)
// ============================================================================
const powerManager = new PowerManager()

// ============================================================================
// UI Port Management (single UI enforcement)
// ============================================================================
let primaryUIPort: chrome.runtime.Port | null = null

// ============================================================================
// Idle Timeout Management (allows SW to suspend when no UI)
// ============================================================================
const IDLE_TIMEOUT_MS = 10 * 1000 // 10 seconds
let idleTimer: ReturnType<typeof setTimeout> | null = null

function startIdleTimer(): void {
  clearIdleTimer()
  console.log(`[SW] Starting idle timer (${IDLE_TIMEOUT_MS / 1000}s)`)
  idleTimer = setTimeout(() => {
    console.log('[SW] Idle timeout fired - disconnecting daemon bridge')
    const state = bridge.getState()
    console.log('[SW] Bridge state before disconnect:', state.status)
    bridge.disconnect()
    console.log('[SW] Bridge disconnected, timer cleared')
    idleTimer = null
  }, IDLE_TIMEOUT_MS)
}

function clearIdleTimer(): void {
  if (idleTimer) {
    console.log('[SW] Clearing idle timer')
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

// Store pending event in chrome.storage.session so it survives SW restarts
const PENDING_EVENT_KEY = 'pending:nativeEvent'

async function sendToUI(event: NativeEvent): Promise<void> {
  if (primaryUIPort) {
    primaryUIPort.postMessage(event)
  } else {
    // Buffer event in storage until UI connects (survives SW termination)
    console.log('[SW] No UI connected, storing pending event:', event.event)
    await chrome.storage.session.set({ [PENDING_EVENT_KEY]: event })
  }
}

function handleUIPortConnect(port: chrome.runtime.Port): void {
  console.log('[SW] UI connected via port')

  // Track session start for metrics
  incrementSessionsStarted().catch((e) => console.error('[SW] Failed to track session:', e))

  // Cancel idle timeout since UI is now active
  clearIdleTimer()

  // Reconnect bridge if it was disconnected due to idle timeout
  const currentState = bridge.getState()
  if (currentState.status === 'disconnected') {
    console.log('[SW] Reconnecting bridge for UI')
    bridge.connect()
  }

  // Close existing UI if any (single UI enforcement)
  if (primaryUIPort) {
    console.log('[SW] Closing existing UI')
    try {
      primaryUIPort.postMessage({ type: 'CLOSE' })
    } catch {
      // Port may already be disconnected
    }
  }

  primaryUIPort = port

  // Send current bridge state immediately
  const state = bridge.getState()
  bridge.hasEverConnected().then((hasConnected: boolean) => {
    port.postMessage({
      type: 'BRIDGE_STATE_CHANGED',
      state,
      hasEverConnected: hasConnected,
    })
  })

  // Send pending event if any (from storage)
  chrome.storage.session
    .get(PENDING_EVENT_KEY)
    .then((result) => {
      const pendingEvent = result[PENDING_EVENT_KEY] as NativeEvent | undefined
      if (pendingEvent) {
        console.log('[SW] Sending pending event from storage:', pendingEvent.event)
        port.postMessage(pendingEvent)
        chrome.storage.session.remove(PENDING_EVENT_KEY)
      }
    })
    .catch((e) => {
      console.error('[SW] Failed to get pending event from storage:', e)
    })

  port.onDisconnect.addListener(() => {
    console.log('[SW] UI port disconnected')
    if (primaryUIPort === port) {
      primaryUIPort = null
      // Start idle timer to allow SW suspension
      startIdleTimer()
    }
  })

  // Start ChromeOS bootstrap if on ChromeOS
  if (platform === 'chromeos' && chromeosBootstrap) {
    const state = chromeosBootstrap.getState()
    if (state.phase === 'idle') {
      chromeosBootstrap
        .start()
        .then((result) => {
          console.log('[SW] ChromeOS bootstrap connected, port:', result.port)
          // daemon-bridge connection is triggered by the subscriber
        })
        .catch((e) => {
          console.log('[SW] ChromeOS bootstrap stopped:', e)
        })
    }
    // Send current state to new UI
    port.postMessage({
      type: 'CHROMEOS_BOOTSTRAP_STATE',
      state,
    })
  }
}

// Internal port connections (from extension UI)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ui') {
    handleUIPortConnect(port)
  }
})

// External port connections (from dev server on localhost)
chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name === 'ui') {
    console.log('[SW] External UI connected from:', port.sender?.origin)
    handleUIPortConnect(port)
  }
})

// ============================================================================
// Daemon Bridge (replaces IOBridge state machine)
// ============================================================================
const bridge = getDaemonBridge()

// Start connection attempt
bridge.connect().then((success) => {
  console.log(`[SW] Initial connection: ${success ? 'success' : 'failed'}`)
})

// Forward native events to UI
bridge.onEvent(async (event: NativeEvent) => {
  console.log('[SW] Native event received:', event.event)
  await sendToUI(event) // Wait for storage write to complete before opening tab
  if (event.event === 'TorrentAdded' || event.event === 'MagnetAdded') {
    // Track torrent added for metrics
    incrementTorrentsAdded().catch((e) => console.error('[SW] Failed to track torrent added:', e))
    openUiTab()
  }
})

// Forward state changes to UI
bridge.subscribe((state: DaemonBridgeState) => {
  if (primaryUIPort) {
    console.log('[SW] Forwarding state change to UI:', state.status)
    bridge.hasEverConnected().then((hasConnected: boolean) => {
      primaryUIPort?.postMessage({
        type: 'BRIDGE_STATE_CHANGED',
        state,
        hasEverConnected: hasConnected,
      })
    })
  }
})

console.log(`[SW] Daemon Bridge started, platform: ${bridge.getPlatform()}`)

// ============================================================================
// ChromeOS Bootstrap (if on ChromeOS)
// ============================================================================

const platform = detectPlatform()
let chromeosBootstrap: ReturnType<typeof getChromeOSBootstrap> | null = null

if (platform === 'chromeos') {
  chromeosBootstrap = getChromeOSBootstrap()

  // Forward state to UI and trigger daemon-bridge on connection
  let wasConnected = false
  chromeosBootstrap.subscribe((state: BootstrapState) => {
    console.log(
      `[SW] ChromeOS bootstrap state changed: ${state.phase}, problem: ${state.problem}, hasUIPort: ${!!primaryUIPort}`,
    )
    if (primaryUIPort) {
      primaryUIPort.postMessage({
        type: 'CHROMEOS_BOOTSTRAP_STATE',
        state,
      })
    }

    // When bootstrap becomes connected, trigger daemon-bridge to connect
    if (state.phase === 'connected' && !wasConnected) {
      console.log('[SW] Bootstrap connected, triggering daemon-bridge connect')
      bridge.connect().catch((e) => {
        console.error('[SW] DaemonBridge connect after bootstrap failed:', e)
      })
    }
    wasConnected = state.phase === 'connected'
  })

  // Start bootstrap when UI connects
  // (handled in handleUIPortConnect)
}

// ============================================================================
// Metrics Initialization
// ============================================================================
// Set up sync listener (READ-ONLY - never writes, just updates local cache)
setupSyncListener()

// Register device and update uninstall URL with metrics
registerDevice()
  .then(() => updateUninstallUrl())
  .catch((e) => console.error('[SW] Failed to initialize metrics:', e))

// ============================================================================
// Installation handler - generate install ID
// ============================================================================
// Browser startup event (when Chrome starts with extension already installed)
chrome.runtime.onStartup.addListener(() => {
  console.log(`[SW] onStartup fired at ${new Date().toISOString()} (SW loaded at ${SW_START_TIME})`)
})

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[SW] onInstalled fired at ${new Date().toISOString()} - reason: ${details.reason}`)
  // Just ensure install ID exists - connection happens via IOBridgeService when UI opens
  const installId = await getOrCreateInstallId()
  console.log('Generated/Retrieved Install ID:', installId)
})

// ============================================================================
// UI Tab Management
// ============================================================================
async function openUiTab() {
  const url = chrome.runtime.getURL('src/ui/app.html')
  // Use getContexts() instead of tabs.query({ url }) - works without "tabs" permission
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] })
  const existing = contexts.find((c) => c.documentUrl === url)
  if (existing?.tabId && existing.tabId !== -1) {
    // Focus existing tab
    await chrome.tabs.update(existing.tabId, { active: true })
    if (existing.windowId && existing.windowId !== -1) {
      await chrome.windows.update(existing.windowId, { focused: true })
    }
  } else {
    // Create new tab
    await chrome.tabs.create({ url })
  }
}

// Handle extension icon click
chrome.action.onClicked.addListener(() => {
  openUiTab()
})

// ============================================================================
// Message Handler (shared between internal and external)
// ============================================================================
type SendResponse = (response: unknown) => void

// Notification message types
interface NotificationMessage {
  type: string
  visible?: boolean
  stats?: ProgressStats
  infoHash?: string
  name?: string
  error?: string
}

function handleNotificationMessage(message: NotificationMessage): void {
  switch (message.type) {
    case 'notification:visibility':
      if (message.visible !== undefined) {
        notificationManager.setUiVisibility(message.visible)
      }
      break
    case 'notification:stats':
      if (message.stats) {
        if (message.visible !== undefined) {
          notificationManager.setUiVisibility(message.visible)
        }
        notificationManager.updateProgress(message.stats)
        powerManager.updateActiveDownloads(message.stats.activeCount)
      }
      break
    case 'notification:torrent-complete':
      if (message.infoHash && message.name) {
        notificationManager.onTorrentComplete(message.infoHash, message.name)
        // Track completed download for metrics
        incrementCompletedDownloads().catch((e) =>
          console.error('[SW] Failed to track download complete:', e),
        )
      }
      break
    case 'notification:torrent-error':
      if (message.infoHash && message.name && message.error) {
        notificationManager.onTorrentError(message.infoHash, message.name, message.error)
      }
      break
    case 'notification:all-complete':
      notificationManager.onAllComplete()
      break
    case 'notification:duplicate-torrent':
      if (message.name) {
        notificationManager.onDuplicateTorrent(message.name)
      }
      break
  }
}

function handleMessage(
  message: {
    type?: string
    event?: string
    key?: string
    keys?: string[]
    value?: string
    prefix?: string
    rootKey?: string
    path?: string
  },
  sendResponse: SendResponse,
): boolean {
  // Notification messages
  if (message.type?.startsWith('notification:')) {
    handleNotificationMessage(message as NotificationMessage)
    sendResponse({ ok: true })
    return true
  }

  // KV operations (external session store)
  if (message.type?.startsWith('KV_')) {
    return handleKVMessage(message, sendResponse)
  }

  // Get bridge state
  if (message.type === 'GET_BRIDGE_STATE') {
    const state = bridge.getState()
    bridge.hasEverConnected().then((hasConnected: boolean) => {
      sendResponse({ ok: true, state, hasEverConnected: hasConnected })
    })
    return true
  }

  // Get daemon stats (for debug panel)
  if (message.type === 'GET_DAEMON_STATS') {
    bridge.getStats().then((stats) => {
      sendResponse({ ok: true, stats })
    })
    return true
  }

  // Get daemon info (for engine initialization)
  if (message.type === 'GET_DAEMON_INFO') {
    const state = bridge.getState()

    if (state.status === 'connected' && state.daemonInfo) {
      sendResponse({
        ok: true,
        daemonInfo: state.daemonInfo,
        roots: state.roots,
      })
    } else {
      sendResponse({
        ok: false,
        status: state.status,
        error: state.lastError || `Not connected: ${state.status}`,
      })
    }
    return true
  }

  // Trigger launch (ChromeOS)
  if (message.type === 'TRIGGER_LAUNCH') {
    bridge.triggerLaunch().then((success: boolean) => {
      sendResponse({ ok: success })
    })
    return true
  }

  // Retry connection
  if (message.type === 'RETRY_CONNECTION') {
    bridge.connect().then((success: boolean) => {
      sendResponse({ ok: success })
    })
    return true
  }

  // Folder picker
  if (message.type === 'PICK_DOWNLOAD_FOLDER') {
    bridge
      .pickDownloadFolder()
      .then((root) => sendResponse({ ok: true, root }))
      .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  // Remove download root
  if (message.type === 'REMOVE_DOWNLOAD_ROOT') {
    const key = message.key as string | undefined
    console.log('[SW] REMOVE_DOWNLOAD_ROOT received, key:', key)
    if (!key) {
      sendResponse({ ok: false, error: 'Missing key' })
      return true
    }
    bridge
      .removeDownloadRoot(key)
      .then((success) => {
        console.log('[SW] removeDownloadRoot result:', success)
        sendResponse({ ok: success })
      })
      .catch((e: unknown) => {
        console.error('[SW] removeDownloadRoot error:', e)
        sendResponse({ ok: false, error: String(e) })
      })
    return true
  }

  // Open file with default application
  if (message.type === 'OPEN_FILE') {
    const rootKey = message.rootKey as string | undefined
    const path = message.path as string | undefined
    if (!rootKey || !path) {
      sendResponse({ ok: false, error: 'Missing rootKey or path' })
      return true
    }
    bridge
      .openFile(rootKey, path)
      .then((result) => sendResponse(result))
      .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  // Reveal file in folder
  if (message.type === 'REVEAL_IN_FOLDER') {
    const rootKey = message.rootKey as string | undefined
    const path = message.path as string | undefined
    if (!rootKey || !path) {
      sendResponse({ ok: false, error: 'Missing rootKey or path' })
      return true
    }
    bridge
      .revealInFolder(rootKey, path)
      .then((result) => sendResponse(result))
      .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  // UI closing - no longer need to track UI count with simplified bridge
  if (message.type === 'UI_CLOSING') {
    sendResponse({ ok: true })
    return true
  }

  // ChromeOS bootstrap actions
  if (message.type === 'CHROMEOS_OPEN_INTENT') {
    chromeosBootstrap?.openIntent()
    sendResponse({ ok: true })
    return true
  }

  if (message.type === 'CHROMEOS_RESET_PAIRING') {
    chromeosBootstrap?.resetPairing().then(() => {
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === 'GET_CHROMEOS_BOOTSTRAP_STATE') {
    const state = chromeosBootstrap?.getState() ?? null
    sendResponse({ ok: true, state })
    return true
  }

  // Magnet/torrent added (from content script or other source)
  if (message.event === 'magnetAdded' || message.event === 'torrentAdded') {
    openUiTab()
    return false
  }

  return false
}

// ============================================================================
// Status Request Handler (for website installation diagnostics)
// ============================================================================
const STATUS_TIMEOUT_MS = 3000

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

async function handleStatusRequest(
  sendResponse: (response: StatusResponse) => void,
): Promise<void> {
  const platform = bridge.getPlatform()
  const manifest = chrome.runtime.getManifest()

  // Gather static info first
  const [installId, hasEverConnected, lastConnectedTime] = await Promise.all([
    getOrCreateInstallId(),
    bridge.hasEverConnected(),
    bridge.getLastConnectedTime(),
  ])

  const baseResponse: StatusResponse = {
    ok: true,
    installed: true,
    extensionVersion: manifest.version,
    platform,
    nativeHostConnected: false,
    hasEverConnected,
    lastConnectedTime: lastConnectedTime ?? undefined,
    installId,
  }

  // Check current state first
  const currentState = bridge.getState()
  if (currentState.status === 'connected' && currentState.daemonInfo) {
    sendResponse({
      ...baseResponse,
      nativeHostConnected: true,
      nativeHostVersion: currentState.daemonInfo.version,
    })
    return
  }

  // For ChromeOS: passive detection only (no user gesture available)
  if (platform === 'chromeos') {
    // Try to detect if Android daemon is reachable without triggering pairing
    try {
      const port = await Promise.race([
        findAndroidDaemonPort(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), STATUS_TIMEOUT_MS)),
      ])

      if (port) {
        // Daemon is reachable, try to get version from /status endpoint
        try {
          const response = await fetch(`http://100.115.92.2:${port}/status`)
          if (response.ok) {
            const data = await response.json()
            sendResponse({
              ...baseResponse,
              nativeHostConnected: true,
              nativeHostVersion: data.version ?? 'unknown',
            })
            return
          }
        } catch {
          // Status endpoint didn't return version, but daemon is reachable
          sendResponse({
            ...baseResponse,
            nativeHostConnected: true,
            nativeHostVersion: 'unknown',
          })
          return
        }
      }
    } catch {
      // Timeout or error - daemon not reachable
    }

    sendResponse(baseResponse)
    return
  }

  // For desktop: actively try to connect with timeout
  try {
    const connected = await Promise.race([
      bridge.connect(),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), STATUS_TIMEOUT_MS)),
    ])

    if (connected) {
      const state = bridge.getState()
      sendResponse({
        ...baseResponse,
        nativeHostConnected: true,
        nativeHostVersion: state.daemonInfo?.version ?? 'unknown',
        // Re-fetch these since connection just succeeded
        hasEverConnected: true,
        lastConnectedTime: Date.now(),
      })
    } else {
      sendResponse(baseResponse)
    }
  } catch {
    sendResponse(baseResponse)
  }
}

// ============================================================================
// External messages (from jstorrent.com launch page or localhost dev server)
// ============================================================================
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('Received external message:', message, 'from:', sender.origin)

  // Simple ping to detect if extension is installed
  if (message.type === 'ping') {
    sendResponse({ ok: true, installed: true })
    return false
  }

  // Comprehensive status check
  if (message.type === 'status') {
    handleStatusRequest(sendResponse)
    return true // async response
  }

  // Launch ping from website
  if (message.type === 'launch-ping') {
    openUiTab().then(() => {
      sendResponse({ ok: true })
      // Close the launch page tab if we have access to it
      if (sender.tab?.id) {
        chrome.tabs.remove(sender.tab.id).catch((err) => {
          console.log('Could not close launch tab:', err)
        })
      }
    })
    return true
  }

  // Handle other messages (GET_DAEMON_INFO, UI_CLOSING, PICK_DOWNLOAD_FOLDER)
  // This allows the dev server on localhost to communicate with the extension
  return handleMessage(message, sendResponse)
})

// ============================================================================
// Internal messages (from extension UI)
// ============================================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'notification:stats') {
    console.log('Received internal message:', message.type)
  }
  return handleMessage(message, sendResponse)
})
