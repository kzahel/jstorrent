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

// Native Host Connection
let nativePort: chrome.runtime.Port | null = null

function connectToNativeHost() {
  try {
    console.log('Connecting to native host...')
    nativePort = chrome.runtime.connectNative('com.jstorrent.native')

    nativePort.onMessage.addListener((message) => {
      console.log('Received message from native host:', message)
      // Broadcast to all parts of the extension (UI)
      // Suppress "Receiving end does not exist" error if no UI is open
      chrome.runtime.sendMessage(message).catch(() => {
        // Ignore error if no receivers are active
      })

      // If the message is about adding a torrent, ensure the UI is open
      if (message.event === 'magnetAdded' || message.event === 'torrentAdded') {
        openUiTab()
      }
    })

    nativePort.onDisconnect.addListener(() => {
      console.log('Native host disconnected')
      nativePort = null
      if (chrome.runtime.lastError) {
        console.error('Native host error:', chrome.runtime.lastError.message)
      }
    })

    console.log('Native host connected')

    // Send handshake with extension ID
    nativePort.postMessage({
      op: 'handshake',
      extensionId: chrome.runtime.id,
      id: crypto.randomUUID(),
    })
  } catch (e) {
    console.error('Failed to connect to native host:', e)
  }
}

// Connect on startup
connectToNativeHost()
