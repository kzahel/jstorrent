console.log('Service Worker loaded')

import { DaemonLifecycleManager } from './lib/daemon-lifecycle-manager'
import { NativeHostConnection } from './lib/native-connection'
import { handleKVMessage } from './lib/kv-handlers'

const daemonManager = new DaemonLifecycleManager(() => new NativeHostConnection())

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

function handleMessage(
  message: { type?: string; event?: string; key?: string; keys?: string[]; value?: string; prefix?: string },
  sendResponse: SendResponse,
): boolean {
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
