// UI routes all logs through SW to use unified buffer

async function log(event, data) {
  const entry = { type: 'log', src: 'ui', event, data }
  try {
    await chrome.runtime.sendMessage(entry)
  } catch (e) {
    console.error('Failed to send log to SW:', e)
  }
}

async function logUser(event, data) {
  const entry = { type: 'log', src: 'user', event, data }
  try {
    await chrome.runtime.sendMessage(entry)
  } catch (e) {
    console.error('Failed to send log to SW:', e)
  }
}

// Test definitions
const TESTS = {
  mailto: {
    name: 'mailto: intent',
    description:
      'Opens a mailto: link. Watch for: Does a picker appear? Which apps are shown? Does email app open?',
    run: async () => {
      const url = 'mailto:test@example.com?subject=Testbed%20Test'
      log('tabs.create', { url })
      try {
        const tab = await chrome.tabs.create({ url })
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status })
      } catch (e) {
        log('tabs.create_error', { error: e.message })
      }
    },
  },

  market_installed: {
    name: 'market:// (installed app)',
    description:
      'Opens Play Store to Files app (should be installed). Watch for: Does Play Store open? Does it show the app page?',
    run: async () => {
      const url = 'market://details?id=com.google.android.apps.nbu.files'
      log('tabs.create', { url })
      try {
        const tab = await chrome.tabs.create({ url })
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status })
      } catch (e) {
        log('tabs.create_error', { error: e.message })
      }
    },
  },

  market_notinstalled: {
    name: 'market:// (not installed)',
    description:
      'Opens Play Store to WhatsApp (probably not installed). Watch for: Does it show install page?',
    run: async () => {
      const url = 'market://details?id=com.whatsapp'
      log('tabs.create', { url })
      try {
        const tab = await chrome.tabs.create({ url })
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status })
      } catch (e) {
        log('tabs.create_error', { error: e.message })
      }
    },
  },

  intent_fake_package: {
    name: 'intent:// (fake package)',
    description:
      'Opens intent to non-existent app. Watch for: What happens? Error? Play Store? Silent fail?',
    run: async () => {
      const url = 'intent://test#Intent;scheme=faketest;package=com.fake.nonexistent.app12345;end'
      log('tabs.create', { url })
      try {
        const tab = await chrome.tabs.create({ url })
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status })
      } catch (e) {
        log('tabs.create_error', { error: e.message })
      }
    },
  },

  intent_jstorrent: {
    name: 'intent:// (jstorrent)',
    description:
      'Opens JSTorrent pairing intent. Watch for: Does picker appear? Does app launch? (Only works if app installed)',
    run: async () => {
      const token = 'testtoken_' + Date.now()
      const url = `intent://pair?token=${token}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`
      log('tabs.create', { url, token })
      try {
        const tab = await chrome.tabs.create({ url })
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status })
      } catch (e) {
        log('tabs.create_error', { error: e.message })
      }
    },
  },

  intent_tabs_update: {
    name: 'intent:// (tabs.update)',
    description:
      'Navigate CURRENT tab to intent (no new tab). Watch: Does picker show on current page? Better UX?',
    run: async () => {
      const token = 'tabsupdate_' + Date.now()
      const url = `intent://pair?token=${token}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`
      log('tabs.update_start', { url, token })
      try {
        // Get current active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        log('tabs.update_current_tab', { tabId: tab.id, currentUrl: tab.url })

        // Navigate it to the intent URL
        const updatedTab = await chrome.tabs.update(tab.id, { url })
        log('tabs.update_result', {
          tabId: updatedTab.id,
          url: updatedTab.url,
          status: updatedTab.status,
        })
      } catch (e) {
        log('tabs.update_error', { error: e.message })
      }
    },
  },

  intent_link_no_target: {
    name: 'intent:// (link no target)',
    description: 'Anchor link WITHOUT target="_blank". CLICK THE LINK when it appears!',
    run: async () => {
      const token = 'notarget_' + Date.now()
      const url = `intent://pair?token=${token}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`
      log('intent_link_no_target_created', { url, token })

      // Create a clickable link WITHOUT target
      const link = document.createElement('a')
      link.href = url
      // NO target attribute - should navigate in place
      link.textContent = '👆 CLICK: intent link (no target="_blank")'
      link.style.cssText =
        'display: block; margin: 10px 0; padding: 12px; background: #ccffcc; border: 3px solid #00aa00; border-radius: 4px; text-decoration: none; color: #000; font-weight: bold; cursor: pointer;'

      link.addEventListener('click', () => {
        log('intent_link_no_target_clicked', { url })
      })

      const runBtn = document.getElementById('runBtn')
      runBtn.parentNode.insertBefore(link, runBtn.nextSibling)

      log('intent_link_no_target_displayed', { url })

      setTimeout(() => {
        if (link.parentNode) {
          link.remove()
          log('intent_link_no_target_timeout')
        }
      }, 30000)
    },
  },

  intent_link_auto: {
    name: 'intent:// (link auto-click)',
    description:
      'Programmatic link click (NO user gesture). Watch: Does it work? Does it create blank tab?',
    run: async () => {
      const token = 'autoclick_' + Date.now()
      const url = `intent://pair?token=${token}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`
      log('intent_link_auto_created', { url, token })

      // Create a temporary link
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.textContent = 'Intent link (auto-clicking in 1s...)'
      link.style.cssText =
        'display: block; margin: 10px 0; padding: 10px; background: #ffffcc; border: 2px solid #ffcc00; border-radius: 4px; text-decoration: none; color: #000;'

      // Insert after the Run Test button
      const testArea = document.getElementById('testArea')
      const runBtn = document.getElementById('runBtn')
      runBtn.parentNode.insertBefore(link, runBtn.nextSibling)

      log('intent_link_auto_displayed', { url })

      // Auto-click after 1 second (no user gesture)
      setTimeout(() => {
        log('intent_link_auto_clicking')
        link.click()

        // Remove link after 3 more seconds
        setTimeout(() => {
          link.remove()
        }, 3000)
      }, 1000)
    },
  },

  intent_link_manual: {
    name: 'intent:// (link manual click)',
    description: 'Manual link click (WITH user gesture). CLICK THE YELLOW LINK when it appears!',
    run: async () => {
      const token = 'manualclick_' + Date.now()
      const url = `intent://pair?token=${token}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`
      log('intent_link_manual_created', { url, token })

      // Create a clickable link
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.textContent = '👆 CLICK THIS LINK to trigger intent with user gesture'
      link.style.cssText =
        'display: block; margin: 10px 0; padding: 12px; background: #ffffcc; border: 3px solid #ff6600; border-radius: 4px; text-decoration: none; color: #000; font-weight: bold; cursor: pointer;'

      // Add click listener for logging
      link.addEventListener('click', () => {
        log('intent_link_manual_clicked', { url, userGesture: true })
      })

      // Insert after the Run Test button
      const testArea = document.getElementById('testArea')
      const runBtn = document.getElementById('runBtn')
      runBtn.parentNode.insertBefore(link, runBtn.nextSibling)

      log('intent_link_manual_displayed', { url, instruction: 'User must click link manually' })

      // Remove link after 30 seconds if not clicked
      setTimeout(() => {
        if (link.parentNode) {
          link.remove()
          log('intent_link_manual_timeout')
        }
      }, 30000)
    },
  },

  unknown_scheme: {
    name: 'unknown:// scheme',
    description: 'Opens completely unknown URL scheme. Watch for: Error page? Silent fail? Picker?',
    run: async () => {
      const url = 'thisdoesnotexist12345://somedata'
      log('tabs.create', { url })
      try {
        const tab = await chrome.tabs.create({ url })
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status })
      } catch (e) {
        log('tabs.create_error', { error: e.message })
      }
    },
  },

  daemon_single: {
    name: 'Daemon: single request',
    description:
      'Single fetch to Android daemon at 100.115.92.2:7800. Watch for: Does it connect or timeout?',
    run: async () => {
      const url = 'http://100.115.92.2:7800/status'
      log('fetch_start', { url })
      const start = Date.now()
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
        const elapsed = Date.now() - start
        const text = await response.text()
        log('fetch_success', { elapsed, status: response.status, body: text.slice(0, 200) })
      } catch (e) {
        const elapsed = Date.now() - start
        log('fetch_error', { elapsed, error: e.message })
      }
    },
  },

  daemon_poll: {
    name: 'Daemon: poll 30s',
    description: 'Poll daemon every 2s for 30s. Use after cold boot to measure startup time.',
    run: async () => {
      const url = 'http://100.115.92.2:7800/status'
      log('poll_start', { url, duration: 30000, interval: 2000 })

      const startTime = Date.now()
      let attempt = 0

      const poll = async () => {
        attempt++
        const elapsed = Date.now() - startTime
        if (elapsed > 30000) {
          log('poll_end', { attempts: attempt, success: false })
          return
        }

        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
          log('poll_success', { attempt, elapsed, status: response.status })
          return // Stop on success
        } catch (e) {
          log('poll_attempt', { attempt, elapsed, error: e.message })
        }

        setTimeout(poll, 2000)
      }

      poll()
    },
  },

  daemon_warm: {
    name: 'Daemon: warm (app running)',
    description:
      'PREREQ: JSTorrent Android app must be running. Single request to measure baseline latency.',
    run: async () => {
      const url = 'http://100.115.92.2:7800/status'
      log('daemon_warm_start', { url })
      const start = Date.now()
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
        const elapsed = Date.now() - start
        const text = await response.text()
        log('daemon_warm_success', { elapsed, status: response.status, body: text.slice(0, 200) })
      } catch (e) {
        const elapsed = Date.now() - start
        log('daemon_warm_error', { elapsed, error: e.message })
      }
    },
  },

  daemon_cold_start: {
    name: 'Daemon: cold (force stopped)',
    description:
      'BEFORE RUNNING: Force stop JSTorrent in Android settings. Then run this to see if daemon auto-starts.',
    run: async () => {
      const url = 'http://100.115.92.2:7800/status'
      log('daemon_cold_start', { url })

      const startTime = Date.now()
      let attempt = 0

      const poll = async () => {
        attempt++
        const elapsed = Date.now() - startTime
        if (elapsed > 15000) {
          log('daemon_cold_timeout', { attempts: attempt, elapsed })
          return
        }

        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
          const text = await response.text()
          log('daemon_cold_success', {
            attempt,
            elapsed,
            status: response.status,
            body: text.slice(0, 200),
          })
          return // Stop on success
        } catch (e) {
          log('daemon_cold_attempt', { attempt, elapsed, error: e.message })
        }

        setTimeout(poll, 2000)
      }

      poll()
    },
  },

  intent_wake_daemon: {
    name: 'Intent: wake daemon test',
    description:
      'BEFORE RUNNING: Force stop JSTorrent. Then run this to see if intent wakes the daemon.',
    run: async () => {
      const token = 'waketest_' + Date.now()
      const url = `intent://pair?token=${token}#Intent;scheme=jstorrent;package=com.jstorrent.app;end`
      log('intent_wake_start', { url, token })

      try {
        const tab = await chrome.tabs.create({ url })
        log('intent_wake_tab_created', { tabId: tab.id, url: tab.url, status: tab.status })

        // Wait a moment for intent to process
        await new Promise((resolve) => setTimeout(resolve, 3000))

        // Try to connect to daemon
        const daemonUrl = 'http://100.115.92.2:7800/status'
        const start = Date.now()
        try {
          const response = await fetch(daemonUrl, { signal: AbortSignal.timeout(3000) })
          const elapsed = Date.now() - start
          const text = await response.text()
          log('intent_wake_daemon_alive', {
            elapsed,
            status: response.status,
            body: text.slice(0, 200),
          })
        } catch (e) {
          const elapsed = Date.now() - start
          log('intent_wake_daemon_down', { elapsed, error: e.message })
        }
      } catch (e) {
        log('intent_wake_error', { error: e.message })
      }
    },
  },

  sw_ping: {
    name: 'Service Worker ping',
    description: 'Send message to SW and measure round-trip. Tests if SW is alive.',
    run: async () => {
      log('sw_ping_start')
      const start = Date.now()
      try {
        const response = await chrome.runtime.sendMessage({ type: 'ping' })
        const elapsed = Date.now() - start
        log('sw_ping_result', { elapsed, response })
      } catch (e) {
        const elapsed = Date.now() - start
        log('sw_ping_error', { elapsed, error: e.message })
      }
    },
  },

  storage_roundtrip: {
    name: 'Storage roundtrip',
    description: 'Write to chrome.storage.local, read back. Tests storage reliability.',
    run: async () => {
      const key = 'testbed_test_' + Date.now()
      const value = { random: Math.random(), ts: Date.now() }
      log('storage_write', { key, value })

      try {
        await chrome.storage.local.set({ [key]: value })
        const result = await chrome.storage.local.get(key)
        log('storage_read', { key, result: result[key] })

        // Cleanup
        await chrome.storage.local.remove(key)
        log('storage_cleanup', { key })
      } catch (e) {
        log('storage_error', { error: e.message })
      }
    },
  },
}

// UI State
let currentTest = null

// DOM elements
const testButtons = document.getElementById('testButtons')
const testName = document.getElementById('testName')
const testDescription = document.getElementById('testDescription')
const runBtn = document.getElementById('runBtn')
const completeBtn = document.getElementById('completeBtn')
const notes = document.getElementById('notes')
const status = document.getElementById('status')

// Build test buttons
Object.entries(TESTS).forEach(([id, test]) => {
  const btn = document.createElement('button')
  btn.textContent = test.name
  btn.dataset.testId = id
  btn.addEventListener('click', () => selectTest(id))
  testButtons.appendChild(btn)
})

function selectTest(id) {
  currentTest = id
  const test = TESTS[id]

  // Update button states
  testButtons.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.testId === id)
  })

  // Update test area
  testName.textContent = test.name
  testDescription.textContent = test.description
  runBtn.disabled = false
  completeBtn.disabled = true
  notes.value = ''
  status.textContent = ''
}

runBtn.addEventListener('click', async () => {
  if (!currentTest) return

  const test = TESTS[currentTest]
  status.textContent = 'Running...'
  log('test_started', { test: currentTest })

  await test.run()

  status.textContent = 'Test executed. Describe what you observed, then click Complete.'
  completeBtn.disabled = false
})

completeBtn.addEventListener('click', async () => {
  if (!currentTest) return

  const userNotes = notes.value.trim()
  await logUser('test_completed', {
    test: currentTest,
    notes: userNotes || '(no notes provided)',
  })

  status.textContent = 'Test completed and logged.'
  completeBtn.disabled = true
  notes.value = ''
})

// Log page load
log('ui_loaded')
