console.log('Service Worker loaded')

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed')
  setupOffscreenDocument('src/offscreen/offscreen.html')
})

async function setupOffscreenDocument(path: string) {
  // Check if an offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })

  if (existingContexts.length > 0) {
    return
  }

  // Create the offscreen document
  await chrome.offscreen.createDocument({
    url: path,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'BitTorrent engine needs persistent page for blob handling',
  })
}
