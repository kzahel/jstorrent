console.log('Offscreen document loaded')

chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  console.log('Offscreen received message:', message)
  if (message.type === 'start-native-host') {
    console.log('Starting native host connection...')
    try {
      const port = chrome.runtime.connectNative('com.jstorrent.native')

      port.onMessage.addListener((nativeMessage) => {
        console.log('Received message from native host:', nativeMessage)
        // Forward to the rest of the extension
        chrome.runtime.sendMessage(nativeMessage)
      })

      port.onDisconnect.addListener(() => {
        console.log('Native host disconnected')
        if (chrome.runtime.lastError) {
          console.error('Native host error:', chrome.runtime.lastError.message)
        }
      })

      console.log('Native host connected')
    } catch (e) {
      console.error('Failed to connect to native host:', e)
    }
  }
})
