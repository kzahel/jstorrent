const LOG_URL = 'http://100.115.92.206:9999/log'
const HEALTH_URL = 'http://100.115.92.206:9999/health'
const COMMAND_URL = 'http://100.115.92.206:9999/command'
const LOG_BUFFER_KEY = 'testbed_log_buffer'
const FLUSH_INTERVAL = 5000 // Try to flush every 5s
const COMMAND_POLL_INTERVAL = 3000 // Poll for commands every 3s

// Core logging - buffers locally, flushes when collector is reachable
async function log(event, data, src = 'sw') {
  const entry = {
    ts: Date.now(),
    src,
    event,
    ...(data !== undefined && { data }),
  }

  // Always buffer first (guarantees we don't lose events)
  await bufferLog(entry)

  // Try to flush (will send this entry + any previously buffered)
  flushLogs()
}

async function bufferLog(entry) {
  try {
    const { [LOG_BUFFER_KEY]: buffer = [] } = await chrome.storage.local.get(LOG_BUFFER_KEY)
    buffer.push(entry)
    await chrome.storage.local.set({ [LOG_BUFFER_KEY]: buffer })
  } catch (e) {
    console.error('Failed to buffer log:', e)
  }
}

let flushInProgress = false

async function flushLogs() {
  if (flushInProgress) return
  flushInProgress = true

  try {
    const { [LOG_BUFFER_KEY]: buffer = [] } = await chrome.storage.local.get(LOG_BUFFER_KEY)
    if (buffer.length === 0) {
      flushInProgress = false
      return
    }

    // Check if collector is healthy before sending payload
    const healthCheck = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(1000),
    })
    if (!healthCheck.ok) {
      flushInProgress = false
      return
    }

    // Collector is up - send all buffered entries
    const response = await fetch(LOG_URL, {
      method: 'POST',
      body: buffer.map((e) => JSON.stringify(e)).join('\n'),
      signal: AbortSignal.timeout(5000),
    })

    if (response.ok) {
      // Success - clear buffer
      await chrome.storage.local.set({ [LOG_BUFFER_KEY]: [] })
      console.log(`Flushed ${buffer.length} log entries`)
    }
  } catch (e) {
    // Collector not reachable - entries stay buffered
    console.log('Collector not reachable, keeping buffer')
  } finally {
    flushInProgress = false
  }
}

// Periodic flush attempt
setInterval(flushLogs, FLUSH_INTERVAL)

// Command polling - check for remote commands (e.g., reload)
async function pollCommands() {
  try {
    const response = await fetch(COMMAND_URL, {
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) {
      const data = await response.json()
      if (data.action === 'reload') {
        log('remote_reload_triggered')
        console.log('Remote reload command received - reloading extension...')
        chrome.runtime.reload()
      }
    }
  } catch (e) {
    // Collector not reachable or error - silently continue
  }
}

// Poll for commands periodically
setInterval(pollCommands, COMMAND_POLL_INTERVAL)

// Helper function to open or focus the testbed UI
async function openTestbed() {
  const testbedUrl = chrome.runtime.getURL('src/ui.html')

  // Check if testbed is already open in a tab
  const tabs = await chrome.tabs.query({ url: testbedUrl })

  if (tabs.length > 0) {
    // Found existing tab - focus it
    const tab = tabs[0]
    await chrome.tabs.update(tab.id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
  } else {
    // No existing tab - create new one
    await chrome.tabs.create({ url: testbedUrl })
  }
}

// Lifecycle events
chrome.runtime.onInstalled.addListener((details) => {
  log('onInstalled', { reason: details.reason })
})

chrome.runtime.onStartup.addListener(async () => {
  log('onStartup')
  // Auto-open testbed on ChromeOS login
  await openTestbed()
})

self.addEventListener('activate', () => {
  log('sw_activate')
})

// Open testbed UI in a new tab when extension icon is clicked
// If already open, focus that tab instead of opening a new one
chrome.action.onClicked.addListener(async () => {
  await openTestbed()
})

// Message handling from UI
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ping') {
    log('ping_response')
    sendResponse({ pong: true, ts: Date.now() })
    return
  }

  // Allow UI to log through SW (ensures single buffer)
  if (msg.type === 'log') {
    log(msg.event, msg.data, msg.src)
    sendResponse({ ok: true })
    return
  }

  return true
})

log('sw_loaded', { version: '1.1.0', reload_test: 'successful' })
