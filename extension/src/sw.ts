console.log('Service Worker loaded')

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
    // (Native host might need a moment to process)
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

// Listen for messages from the website (externally_connectable)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('Received external message:', message, sender)
  if (message.type === 'launch-ping') {
    handleLaunchPing().then(() => sendResponse({ ok: true }))
    return true // Keep channel open for async response
  }
})

// Listen for messages from UI
chrome.runtime.onMessage.addListener((message, sender, _sendResponse) => {
  console.log('Received internal message:', message, sender)
  if (message.event === 'magnetAdded' || message.event === 'torrentAdded') {
    openUiTab()
  }
})

async function handleLaunchPing() {
  console.log('Handling launch ping...')
  try {
    await client.ensureDaemonReady()
    console.log('Client initialized from launch ping')
  } catch (e) {
    console.error('Failed to initialize client from launch ping:', e)
  }
  await openUiTab()
}

async function openUiTab() {
  const url = chrome.runtime.getURL('src/ui/app.html')
  const tabs = await chrome.tabs.query({ url })
  if (tabs.length > 0 && tabs[0].id) {
    await chrome.tabs.update(tabs[0].id, { active: true })
    if (tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true })
    }
  } else {
    await chrome.tabs.create({ url })
  }
}

// Handle extension icon click
chrome.action.onClicked.addListener(() => {
  openUiTab()
})

import { Client } from './lib/client'
import { NativeHostConnection } from './lib/native-connection'
import { getEngineState } from '@jstorrent/engine'

// ... existing code ...

// Initialize Client
const client = new Client(new NativeHostConnection())

// Expose for testing
// @ts-expect-error -- exposing client for testing
self.client = client

// Handle requests for log entries from UI
// Handle requests for log entries from UI
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_LOGS') {
    const entries = client.logBuffer.getRecent(message.limit || 100, message.filter)
    sendResponse({ entries })
    return true // Keep channel open for async response
  }
  if (message.type === 'ADD_TORRENT') {
    client.ensureDaemonReady().then(async () => {
      try {
        await client.engine?.addTorrent(message.magnet)
        sendResponse({ ok: true })
      } catch (e) {
        console.error('Failed to add torrent:', e)
        sendResponse({ ok: false, error: String(e) })
      }
    })
    return true
  }

  if (message.type === 'GET_ROOTS') {
    client.ensureDaemonReady().then(() => {
      const roots = client.getRoots()
      client.getDefaultRootToken().then((defaultToken) => {
        sendResponse({ roots, defaultToken })
      })
    })
    return true
  }

  if (message.type === 'PICK_DOWNLOAD_FOLDER') {
    client.ensureDaemonReady().then(async () => {
      const root = await client.pickDownloadFolder()
      sendResponse({ root })
    })
    return true
  }

  if (message.type === 'SET_DEFAULT_ROOT') {
    client.ensureDaemonReady().then(async () => {
      try {
        await client.setDefaultRoot(message.token)
        sendResponse({ ok: true })
      } catch (e) {
        sendResponse({ ok: false, error: String(e) })
      }
    })
    return true
  }

  if (message.type === 'GET_STATE') {
    client
      .ensureDaemonReady()
      .then(() => {
        if (!client.engine) {
          sendResponse({ error: 'Engine not initialized' })
          return
        }
        const state = getEngineState(client.engine)
        sendResponse({ state })
      })
      .catch((e) => {
        sendResponse({ error: String(e) })
      })
    return true
  }

  if (message.type === 'START_TORRENT') {
    client.ensureDaemonReady().then(() => {
      client.startTorrent(message.infoHash)
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === 'STOP_TORRENT') {
    client.ensureDaemonReady().then(() => {
      client.stopTorrent(message.infoHash)
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === 'PAUSE_ALL') {
    client.ensureDaemonReady().then(() => {
      client.pauseAll()
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === 'RESUME_ALL') {
    client.ensureDaemonReady().then(() => {
      client.resumeAll()
      sendResponse({ ok: true })
    })
    return true
  }
})

// Forward new log entries to UI via broadcast
client.logBuffer.subscribe((entry) => {
  chrome.runtime.sendMessage({ type: 'LOG_ENTRY', entry }).catch(() => {
    // UI might not be open, ignore errors
  })
})
