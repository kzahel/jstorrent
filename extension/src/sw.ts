console.log('Service Worker loaded')

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed')
})

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
  // Native host is already connected on startup
  // We can just ensure UI is open
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
// @ts-ignore
self.client = client

async function init() {
  try {
    console.log('Initializing Client...')
    const sockets = await client.ensureDaemonReady()
    console.log('Client initialized, sockets ready')

    // Example usage:
    // const tcp = await sockets.createTcpSocket('google.com', 80)
    // tcp.close()
  } catch (e) {
    console.error('Client initialization failed:', e)
  }
}

init()
