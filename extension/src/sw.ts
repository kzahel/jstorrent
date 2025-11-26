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

import { Client } from './lib/client'
import { NativeHostConnection } from './lib/native-connection'

// ... existing code ...

// Initialize Client
const client = new Client(new NativeHostConnection())

// Expose for testing
// @ts-expect-error -- exposing client for testing
self.client = client
