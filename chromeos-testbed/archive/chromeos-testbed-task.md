# ChromeOS Testbed Extension - Agent Guide

## Overview

Build a minimal Chrome extension to empirically test ChromeOS-specific behaviors: intent handling, Android container connectivity, service worker lifecycle, and cold boot timing. Results are logged to a remote collector so the agent can analyze without manual copy-paste.

**Human-in-the-loop workflow:** The agent cannot click buttons or observe visual UI. The human runs tests and adds notes describing what they saw. The agent reads the log file and analyzes results.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Crostini Container                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   chromeos-testbed/          log-collector.js                   │
│   ├── manifest.json          ┌─────────────────┐               │
│   ├── src/                   │ :9999           │               │
│   │   ├── sw.js              │                 │               │
│   │   ├── ui.html            │ → testbed.log   │               │
│   │   └── ui.js              └─────────────────┘               │
│   └── README.md                     ▲                          │
│         │                           │                          │
│         │ loaded unpacked           │                          │
│         ▼                           │                          │
│   Chrome ─── POST /log ─────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

Before starting, determine the Crostini container IP. The human can find this by running `hostname -I` in the Crostini terminal. Update this variable:

```
CROSTINI_IP = "100.115.92.xxx"  # Replace with actual IP
LOG_PORT = 9999
```

## Phase 1: Log Collector

### 1.1 Create log-collector.js

Location: `chromeos-testbed/log-collector.js`

```javascript
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9999;
const LOG_FILE = path.join(__dirname, 'testbed.log');

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
    return;
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Body may contain multiple newline-separated JSON entries (buffered flush)
      const lines = body.trim().split('\n').filter(line => line.length > 0);
      for (const line of lines) {
        fs.appendFileSync(LOG_FILE, line + '\n');
        console.log(line);
      }
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Log collector listening on http://0.0.0.0:${PORT}`);
  console.log(`Writing to ${LOG_FILE}`);
});
```

### 1.2 Verify log collector

```bash
cd chromeos-testbed
node log-collector.js &
curl http://localhost:9999/health
# Should return: ok
curl -X POST http://localhost:9999/log -d '{"test":"hello"}'
cat testbed.log
# Should show: {"test":"hello"}
```

## Phase 2: Extension Scaffold

### 2.1 Create manifest.json

Location: `chromeos-testbed/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "ChromeOS Testbed",
  "version": "0.1",
  "description": "Test ChromeOS-specific extension behaviors",
  "permissions": [
    "storage",
    "tabs"
  ],
  "host_permissions": [
    "http://100.115.92.2/*",
    "http://CROSTINI_IP:9999/*"
  ],
  "background": {
    "service_worker": "src/sw.js"
  },
  "action": {
    "default_popup": "src/ui.html"
  }
}
```

**Note:** Replace `CROSTINI_IP` with actual IP. Only needed here and in `sw.js` (UI routes logs through SW).

### 2.2 Create src/sw.js

```javascript
const LOG_URL = 'http://CROSTINI_IP:9999/log';
const HEALTH_URL = 'http://CROSTINI_IP:9999/health';
const LOG_BUFFER_KEY = 'testbed_log_buffer';
const FLUSH_INTERVAL = 5000; // Try to flush every 5s

// Core logging - buffers locally, flushes when collector is reachable
async function log(event, data, src = 'sw') {
  const entry = {
    ts: Date.now(),
    src,
    event,
    ...(data !== undefined && { data })
  };
  
  // Always buffer first (guarantees we don't lose events)
  await bufferLog(entry);
  
  // Try to flush (will send this entry + any previously buffered)
  flushLogs();
}

async function bufferLog(entry) {
  try {
    const { [LOG_BUFFER_KEY]: buffer = [] } = await chrome.storage.local.get(LOG_BUFFER_KEY);
    buffer.push(entry);
    await chrome.storage.local.set({ [LOG_BUFFER_KEY]: buffer });
  } catch (e) {
    console.error('Failed to buffer log:', e);
  }
}

let flushInProgress = false;

async function flushLogs() {
  if (flushInProgress) return;
  flushInProgress = true;
  
  try {
    const { [LOG_BUFFER_KEY]: buffer = [] } = await chrome.storage.local.get(LOG_BUFFER_KEY);
    if (buffer.length === 0) {
      flushInProgress = false;
      return;
    }
    
    // Check if collector is healthy before sending payload
    const healthCheck = await fetch(HEALTH_URL, { 
      signal: AbortSignal.timeout(1000) 
    });
    if (!healthCheck.ok) {
      flushInProgress = false;
      return;
    }
    
    // Collector is up - send all buffered entries
    const response = await fetch(LOG_URL, {
      method: 'POST',
      body: buffer.map(e => JSON.stringify(e)).join('\n'),
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      // Success - clear buffer
      await chrome.storage.local.set({ [LOG_BUFFER_KEY]: [] });
      console.log(`Flushed ${buffer.length} log entries`);
    }
  } catch (e) {
    // Collector not reachable - entries stay buffered
    console.log('Collector not reachable, keeping buffer');
  } finally {
    flushInProgress = false;
  }
}

// Periodic flush attempt
setInterval(flushLogs, FLUSH_INTERVAL);

// Lifecycle events
chrome.runtime.onInstalled.addListener((details) => {
  log('onInstalled', { reason: details.reason });
});

chrome.runtime.onStartup.addListener(() => {
  log('onStartup');
});

self.addEventListener('activate', () => {
  log('sw_activate');
});

// Message handling from UI
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ping') {
    log('ping_response');
    sendResponse({ pong: true, ts: Date.now() });
    return;
  }
  
  // Allow UI to log through SW (ensures single buffer)
  if (msg.type === 'log') {
    log(msg.event, msg.data, msg.src);
    sendResponse({ ok: true });
    return;
  }
  
  return true;
});

log('sw_loaded');
```

**Note:** Replace `CROSTINI_IP` with actual IP (appears in both `LOG_URL` and `HEALTH_URL`).

**Buffering behavior:**
- All log entries go to `chrome.storage.local` first (with accurate timestamps)
- SW attempts to flush to collector every 5 seconds
- On successful flush, buffer is cleared
- On cold boot, events are buffered until Crostini starts and collector is reachable
- UI routes all logs through SW to use single buffer

### 2.3 Create src/ui.html

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ChromeOS Testbed</title>
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      width: 450px;
      padding: 16px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
    }
    h2 {
      margin: 0 0 12px 0;
      font-size: 16px;
    }
    .test-section {
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 16px;
    }
    .test-name {
      font-weight: 600;
      margin-bottom: 8px;
    }
    .test-description {
      color: #666;
      font-size: 12px;
      margin-bottom: 12px;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      margin-right: 8px;
      margin-bottom: 8px;
    }
    .run-btn {
      background: #0066cc;
      color: white;
    }
    .run-btn:hover {
      background: #0055aa;
    }
    .complete-btn {
      background: #22863a;
      color: white;
    }
    .complete-btn:hover {
      background: #1b6d30;
    }
    textarea {
      width: 100%;
      height: 60px;
      margin: 8px 0;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-family: inherit;
      font-size: 13px;
      resize: vertical;
    }
    .status {
      font-size: 12px;
      color: #666;
      margin-top: 8px;
    }
    .test-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 16px;
    }
    .test-buttons button {
      font-size: 12px;
      padding: 6px 10px;
      background: #f0f0f0;
      margin: 0;
    }
    .test-buttons button:hover {
      background: #e0e0e0;
    }
    .test-buttons button.active {
      background: #0066cc;
      color: white;
    }
  </style>
</head>
<body>
  <h2>ChromeOS Testbed</h2>

  <div class="test-buttons" id="testButtons"></div>

  <div class="test-section" id="testArea">
    <div class="test-name" id="testName">Select a test above</div>
    <div class="test-description" id="testDescription"></div>
    <button class="run-btn" id="runBtn" disabled>Run Test</button>
    <div>
      <label>What happened?</label>
      <textarea id="notes" placeholder="Describe what you observed (picker appeared, app opened, error shown, etc.)"></textarea>
    </div>
    <button class="complete-btn" id="completeBtn" disabled>Complete Test</button>
    <div class="status" id="status"></div>
  </div>

  <script src="ui.js"></script>
</body>
</html>
```

### 2.4 Create src/ui.js

```javascript
// UI routes all logs through SW to use unified buffer

async function log(event, data) {
  const entry = { type: 'log', src: 'ui', event, data };
  try {
    await chrome.runtime.sendMessage(entry);
  } catch (e) {
    console.error('Failed to send log to SW:', e);
  }
}

async function logUser(event, data) {
  const entry = { type: 'log', src: 'user', event, data };
  try {
    await chrome.runtime.sendMessage(entry);
  } catch (e) {
    console.error('Failed to send log to SW:', e);
  }
}

// Test definitions
const TESTS = {
  mailto: {
    name: 'mailto: intent',
    description: 'Opens a mailto: link. Watch for: Does a picker appear? Which apps are shown? Does email app open?',
    run: async () => {
      const url = 'mailto:test@example.com?subject=Testbed%20Test';
      log('tabs.create', { url });
      try {
        const tab = await chrome.tabs.create({ url });
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status });
      } catch (e) {
        log('tabs.create_error', { error: e.message });
      }
    }
  },

  market_installed: {
    name: 'market:// (installed app)',
    description: 'Opens Play Store to Files app (should be installed). Watch for: Does Play Store open? Does it show the app page?',
    run: async () => {
      const url = 'market://details?id=com.google.android.apps.nbu.files';
      log('tabs.create', { url });
      try {
        const tab = await chrome.tabs.create({ url });
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status });
      } catch (e) {
        log('tabs.create_error', { error: e.message });
      }
    }
  },

  market_notinstalled: {
    name: 'market:// (not installed)',
    description: 'Opens Play Store to WhatsApp (probably not installed). Watch for: Does it show install page?',
    run: async () => {
      const url = 'market://details?id=com.whatsapp';
      log('tabs.create', { url });
      try {
        const tab = await chrome.tabs.create({ url });
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status });
      } catch (e) {
        log('tabs.create_error', { error: e.message });
      }
    }
  },

  intent_fake_package: {
    name: 'intent:// (fake package)',
    description: 'Opens intent to non-existent app. Watch for: What happens? Error? Play Store? Silent fail?',
    run: async () => {
      const url = 'intent://test#Intent;scheme=faketest;package=com.fake.nonexistent.app12345;end';
      log('tabs.create', { url });
      try {
        const tab = await chrome.tabs.create({ url });
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status });
      } catch (e) {
        log('tabs.create_error', { error: e.message });
      }
    }
  },

  intent_jstorrent: {
    name: 'intent:// (jstorrent)',
    description: 'Opens JSTorrent pairing intent. Watch for: Does picker appear? Does app launch? (Only works if app installed)',
    run: async () => {
      const token = 'testtoken_' + Date.now();
      const url = `intent://pair?token=${token}#Intent;scheme=jstorrent;package=com.jstorrent;end`;
      log('tabs.create', { url, token });
      try {
        const tab = await chrome.tabs.create({ url });
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status });
      } catch (e) {
        log('tabs.create_error', { error: e.message });
      }
    }
  },

  unknown_scheme: {
    name: 'unknown:// scheme',
    description: 'Opens completely unknown URL scheme. Watch for: Error page? Silent fail? Picker?',
    run: async () => {
      const url = 'thisdoesnotexist12345://somedata';
      log('tabs.create', { url });
      try {
        const tab = await chrome.tabs.create({ url });
        log('tabs.create_result', { tabId: tab.id, url: tab.url, status: tab.status });
      } catch (e) {
        log('tabs.create_error', { error: e.message });
      }
    }
  },

  daemon_single: {
    name: 'Daemon: single request',
    description: 'Single fetch to Android daemon at 100.115.92.2:7800. Watch for: Does it connect or timeout?',
    run: async () => {
      const url = 'http://100.115.92.2:7800/status';
      log('fetch_start', { url });
      const start = Date.now();
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const elapsed = Date.now() - start;
        const text = await response.text();
        log('fetch_success', { elapsed, status: response.status, body: text.slice(0, 200) });
      } catch (e) {
        const elapsed = Date.now() - start;
        log('fetch_error', { elapsed, error: e.message });
      }
    }
  },

  daemon_poll: {
    name: 'Daemon: poll 30s',
    description: 'Poll daemon every 2s for 30s. Use after cold boot to measure startup time.',
    run: async () => {
      const url = 'http://100.115.92.2:7800/status';
      log('poll_start', { url, duration: 30000, interval: 2000 });
      
      const startTime = Date.now();
      let attempt = 0;
      
      const poll = async () => {
        attempt++;
        const elapsed = Date.now() - startTime;
        if (elapsed > 30000) {
          log('poll_end', { attempts: attempt, success: false });
          return;
        }
        
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
          log('poll_success', { attempt, elapsed, status: response.status });
          return; // Stop on success
        } catch (e) {
          log('poll_attempt', { attempt, elapsed, error: e.message });
        }
        
        setTimeout(poll, 2000);
      };
      
      poll();
    }
  },

  sw_ping: {
    name: 'Service Worker ping',
    description: 'Send message to SW and measure round-trip. Tests if SW is alive.',
    run: async () => {
      log('sw_ping_start');
      const start = Date.now();
      try {
        const response = await chrome.runtime.sendMessage({ type: 'ping' });
        const elapsed = Date.now() - start;
        log('sw_ping_result', { elapsed, response });
      } catch (e) {
        const elapsed = Date.now() - start;
        log('sw_ping_error', { elapsed, error: e.message });
      }
    }
  },

  storage_roundtrip: {
    name: 'Storage roundtrip',
    description: 'Write to chrome.storage.local, read back. Tests storage reliability.',
    run: async () => {
      const key = 'testbed_test_' + Date.now();
      const value = { random: Math.random(), ts: Date.now() };
      log('storage_write', { key, value });
      
      try {
        await chrome.storage.local.set({ [key]: value });
        const result = await chrome.storage.local.get(key);
        log('storage_read', { key, result: result[key] });
        
        // Cleanup
        await chrome.storage.local.remove(key);
        log('storage_cleanup', { key });
      } catch (e) {
        log('storage_error', { error: e.message });
      }
    }
  }
};

// UI State
let currentTest = null;

// DOM elements
const testButtons = document.getElementById('testButtons');
const testName = document.getElementById('testName');
const testDescription = document.getElementById('testDescription');
const runBtn = document.getElementById('runBtn');
const completeBtn = document.getElementById('completeBtn');
const notes = document.getElementById('notes');
const status = document.getElementById('status');

// Build test buttons
Object.entries(TESTS).forEach(([id, test]) => {
  const btn = document.createElement('button');
  btn.textContent = test.name;
  btn.dataset.testId = id;
  btn.addEventListener('click', () => selectTest(id));
  testButtons.appendChild(btn);
});

function selectTest(id) {
  currentTest = id;
  const test = TESTS[id];
  
  // Update button states
  testButtons.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.testId === id);
  });
  
  // Update test area
  testName.textContent = test.name;
  testDescription.textContent = test.description;
  runBtn.disabled = false;
  completeBtn.disabled = true;
  notes.value = '';
  status.textContent = '';
}

runBtn.addEventListener('click', async () => {
  if (!currentTest) return;
  
  const test = TESTS[currentTest];
  status.textContent = 'Running...';
  log('test_started', { test: currentTest });
  
  await test.run();
  
  status.textContent = 'Test executed. Describe what you observed, then click Complete.';
  completeBtn.disabled = false;
});

completeBtn.addEventListener('click', async () => {
  if (!currentTest) return;
  
  const userNotes = notes.value.trim();
  await logUser('test_completed', { 
    test: currentTest, 
    notes: userNotes || '(no notes provided)'
  });
  
  status.textContent = 'Test completed and logged.';
  completeBtn.disabled = true;
  notes.value = '';
});

// Log page load
log('ui_loaded');
```

**Note:** UI no longer needs `LOG_URL` - all logs route through SW.

## Phase 3: Load and Verify

### 3.1 Human setup steps

Tell the human:

1. Find Crostini IP: Run `hostname -I` in Crostini terminal
2. Update the three files with actual IP (manifest.json, sw.js, ui.js)
3. Start log collector: `node log-collector.js`
4. Open Chrome, go to `chrome://extensions`
5. Enable Developer Mode
6. Click "Load unpacked", select the `chromeos-testbed` folder
7. Click the extension icon to open popup

### 3.2 Verify logging works

Ask human to:
1. Click "Service Worker ping" test
2. Click "Run Test"
3. Type any note
4. Click "Complete Test"

Agent verifies by checking `testbed.log`:
```bash
cat testbed.log
```

Should see entries with `src: "sw"`, `src: "ui"`, and `src: "user"`.

## Test Scenarios

Once setup is verified, run these scenarios:

### Scenario 1: Intent behaviors

Run each intent test in order:
1. mailto:
2. market:// (installed app)
3. market:// (not installed)
4. intent:// (fake package)
5. unknown:// scheme

For each, human describes: Did a picker appear? What options were shown? Did anything open? Any errors?

### Scenario 2: Daemon connectivity

1. Run "Daemon: single request" - note if it connects or times out
2. If JSTorrent Android app is installed and running, try again

### Scenario 3: Cold boot timing

**How buffering works:** On cold boot, Crostini (and the log collector) won't be ready. The extension buffers all log entries to `chrome.storage.local` with accurate timestamps. Once Crostini starts and you run the collector, the SW will auto-flush buffered entries (polls every 5s).

1. Human starts log collector: `node log-collector.js`
2. Human restarts Chromebook
3. Immediately after login, human opens testbed extension
4. Human runs "Daemon: poll 30s" test
5. Human adds notes about what they observed during boot
6. Human waits for Crostini to become available (open terminal or just wait)
7. Buffered logs auto-flush once collector is reachable
8. Agent analyzes `testbed.log`:
   - Look at `ts` values on `onStartup`, `sw_loaded`, `ui_loaded` events
   - Compare to `poll_success` timing
   - Calculate how long Android container took to respond

### Scenario 4: Service worker lifecycle

1. Human closes all Chrome windows
2. Human waits 30 seconds
3. Human reopens Chrome and extension
4. Human runs "Service Worker ping"
5. Agent checks if sw_loaded appears in log (SW was restarted)

### Scenario 5: "Always" checkbox persistence (requires JSTorrent app)

1. Human runs "intent:// (jstorrent)" test
2. Human checks "Always" in picker, selects JSTorrent
3. Human notes what happened
4. Human closes popup, reopens, runs same test again
5. Human notes: Did picker appear again, or did it go straight to app?
6. Human restarts Chrome, repeats
7. Human restarts Chromebook, repeats

## Log Analysis

The agent can analyze logs by reading `testbed.log`. Each line is JSON.

**Useful patterns:**

```bash
# All events for a specific test
grep "mailto" testbed.log

# All user observations
grep '"src":"user"' testbed.log

# Timing analysis for daemon polling
grep "poll_" testbed.log

# Service worker lifecycle
grep '"src":"sw"' testbed.log
```

**Key questions to answer from logs:**

| Question | What to look for |
|----------|------------------|
| Can we detect if app is installed? | Compare tabs.create_result for installed vs not-installed intents |
| What happens with fake package? | Check intent_fake_package test results + user notes |
| Cold boot delay? | Time between poll_start and first poll_success |
| Does "Always" persist? | User notes across multiple test runs |
| SW termination behavior? | Gap between sw_loaded events |
