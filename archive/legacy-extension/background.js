// =============================================================================
// JSTorrent Helper Extension
// =============================================================================
//
// Purpose: Adds "Add to JSTorrent" context menu for magnet links and .torrent files
//
// Scenarios:
//   - ChromeOS + App installed     → Send to app, done
//   - ChromeOS + App not installed → Offer: install app OR join waitlist
//   - Desktop (any)                → Offer: join waitlist (apps don't work)
//
// =============================================================================

const JSTORRENT_APP_ID = 'anhdpjpojoipgpmfanmedjghaligalgb'
const CHROME_WEB_STORE_URL = 'https://chrome.google.com/webstore/detail/'
const WAITLIST_URL = 'https://new.jstorrent.com/comingsoon.html'

// =============================================================================
// Context Menu Setup
// =============================================================================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'add-to-jstorrent',
    title: 'Add to JSTorrent',
    contexts: ['link'],
    targetUrlPatterns: [
      'magnet:*',
      '*://*/*.torrent',
      '*://*/*.torrent?*',
      '*://*/*.torrent#*'
    ]
  })
})

// =============================================================================
// Context Menu Click Handler
// =============================================================================

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'add-to-jstorrent') return

  tryAddToApp(info.linkUrl, info.pageUrl)
})

function tryAddToApp(linkUrl, pageUrl) {
  chrome.runtime.sendMessage(
    JSTORRENT_APP_ID,
    { command: 'add-url', url: linkUrl, pageUrl: pageUrl },
    (response) => {
      if (response) {
        recordEvent('add_success')
      } else {
        recordEvent('add_failed')
        showAppNotFoundNotification()
      }
    }
  )
}

// =============================================================================
// Notifications
// =============================================================================

function showAppNotFoundNotification() {
  chrome.runtime.getPlatformInfo((info) => {
    if (info.os === 'cros') {
      showChromeOSNotification()
    } else {
      showDesktopNotification()
    }
  })
}

function showChromeOSNotification() {
  chrome.notifications.create('chromeos-options', {
    type: 'basic',
    iconUrl: 'js-128.png',
    title: 'JSTorrent Not Found',
    message: 'Install the JSTorrent app, or join the waitlist for the new version.',
    buttons: [
      { title: 'Install JSTorrent', iconUrl: 'cws_32.png' },
      { title: 'Join Waitlist' }
    ],
    priority: 2
  })
}

function showDesktopNotification() {
  chrome.notifications.create('desktop-waitlist', {
    type: 'basic',
    iconUrl: 'js-128.png',
    title: 'JSTorrent is Coming Back',
    message: 'Chrome Apps no longer work on desktop. Click to join the waitlist.',
    priority: 2
  })
}

chrome.notifications.onClicked.addListener((id) => {
  if (id === 'desktop-waitlist') {
    chrome.tabs.create({ url: WAITLIST_URL })
    recordEvent('waitlist_click')
  }
  chrome.notifications.clear(id)
})

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  if (id === 'chromeos-options') {
    if (buttonIndex === 0) {
      chrome.tabs.create({ url: CHROME_WEB_STORE_URL + JSTORRENT_APP_ID })
      recordEvent('install_click')
    } else {
      chrome.tabs.create({ url: WAITLIST_URL })
      recordEvent('waitlist_click')
    }
  }
  chrome.notifications.clear(id)
})

// =============================================================================
// Analytics (lightweight, local only)
// =============================================================================

function recordEvent(eventName) {
  chrome.storage.local.get(['events'], (result) => {
    const events = result.events || {}
    events[eventName] = (events[eventName] || 0) + 1
    events['last_' + eventName] = Date.now()
    chrome.storage.local.set({ events })
  })
}

// =============================================================================
// External Message Handler (for JSTorrent app to check if helper is installed)
// =============================================================================

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  sendResponse({
    installed: true,
    version: chrome.runtime.getManifest().version
  })
})
