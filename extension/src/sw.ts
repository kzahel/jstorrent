console.log('Service Worker loaded')

import { DaemonLifecycleManager, NativeEvent } from './lib/daemon-lifecycle-manager'
import { NativeHostConnection } from './lib/native-connection'
import { handleKVMessage } from './lib/kv-handlers'
import { NotificationManager, ProgressStats } from './lib/notifications'

// ============================================================================
// Notification Manager
// ============================================================================
const notificationManager = new NotificationManager()

// ============================================================================
// UI Port Management (single UI enforcement)
// ============================================================================
let primaryUIPort: chrome.runtime.Port | null = null

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
    }
  })
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
// Daemon Manager with event forwarding
// ============================================================================
const daemonManager = new DaemonLifecycleManager(
  () => new NativeHostConnection(),
  (event) => {
    console.log('[SW] Native event received:', event.event)
    sendToUI(event)
    // Open UI tab if needed
    if (event.event === 'TorrentAdded' || event.event === 'MagnetAdded') {
      openUiTab()
    }
  },
)

// ============================================================================
// Installation handler - generate install ID
// ============================================================================
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed')
  const installId = await getOrGenerateInstallId()
  console.log('Generated/Retrieved Install ID:', installId)

  // Perform immediate handshake to register install ID with native host
  try {
    const port = chrome.runtime.connectNative('com.jstorrent.native')
    port.postMessage({
      op: 'handshake',
      extensionId: chrome.runtime.id,
      installId,
      id: crypto.randomUUID(),
    })
    console.log('Sent initial handshake to native host')

    // Disconnect after a short delay to allow message to be sent
    setTimeout(() => {
      port.disconnect()
      console.log('Disconnected initial handshake port')
    }, 100)
  } catch (e) {
    console.error('Failed to perform initial handshake:', e)
  }
})

async function getOrGenerateInstallId(): Promise<string> {
  const result = await chrome.storage.local.get('installId')
  if (result.installId) {
    return result.installId as string
  }
  const newId = crypto.randomUUID()
  await chrome.storage.local.set({ installId: newId })
  return newId
}

// ============================================================================
// UI Tab Management
// ============================================================================
async function openUiTab() {
  const url = chrome.runtime.getURL('src/ui/app.html')
  const tabs = await chrome.tabs.query({ url })
  if (tabs.length > 0 && tabs[0].id) {
    // Focus existing tab
    await chrome.tabs.update(tabs[0].id, { active: true })
    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true })
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
    case 'notification:progress':
      if (message.stats) {
        notificationManager.updateProgress(message.stats)
      }
      break
    case 'notification:torrent-complete':
      if (message.infoHash && message.name) {
        notificationManager.onTorrentComplete(message.infoHash, message.name)
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

  // UI startup: get daemon connection info
  if (message.type === 'GET_DAEMON_INFO') {
    daemonManager
      .getDaemonInfo()
      .then((info) => sendResponse({ ok: true, daemonInfo: info }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }

  // UI shutdown: decrement UI count
  if (message.type === 'UI_CLOSING') {
    daemonManager.onUIClosing()
    sendResponse({ ok: true })
    return true
  }

  // Folder picker (requires native host)
  if (message.type === 'PICK_DOWNLOAD_FOLDER') {
    daemonManager
      .pickDownloadFolder()
      .then((root) => sendResponse({ ok: true, root }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
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
// External messages (from jstorrent.com launch page or localhost dev server)
// ============================================================================
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('Received external message:', message, 'from:', sender.origin)

  // Launch ping from website
  if (message.type === 'launch-ping') {
    openUiTab().then(() => sendResponse({ ok: true }))
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
  console.log('Received internal message:', message.type)
  return handleMessage(message, sendResponse)
})
