import { test, expect, chromium } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const EXTENSION_PATH = path.resolve(__dirname, '../dist')
const NATIVE_HOST_CONFIG_DIR = path.join(os.homedir(), '.config/jstorrent-native-host')

test('browser discovery works with extension', async () => {
  // 1. Clean up old rpc-info files
  if (fs.existsSync(NATIVE_HOST_CONFIG_DIR)) {
    const files = fs
      .readdirSync(NATIVE_HOST_CONFIG_DIR)
      .filter((f) => f.startsWith('rpc-info-') && f.endsWith('.json'))
      .map((f) => path.join(NATIVE_HOST_CONFIG_DIR, f))

    for (const file of files) {
      fs.unlinkSync(file)
    }
  }

  // 2. Launch Chrome with Extension
  // We use persistent context to load extension
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jstorrent-e2e-'))

  // Install Native Host Manifest into userDataDir
  // Chrome might look here if we are using a custom user data dir
  const manifestDir = path.join(userDataDir, 'NativeMessagingHosts')
  fs.mkdirSync(manifestDir, { recursive: true })

  const manifestPath = path.join(manifestDir, 'com.jstorrent.native.json')
  const hostPath = path.join(os.homedir(), '.local/lib/jstorrent-native/jstorrent-native-host')

  const manifest = {
    name: 'com.jstorrent.native',
    description: 'JSTorrent Native Messaging Host',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [
      'chrome-extension://bnceafpojmnimbnhamaeedgomdcgnbjk/',
      'chrome-extension://opkmhecbhgngcbglpcdfmnomkffenapc/',
    ],
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`Installed manifest to ${manifestPath}`)

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // We set this to false to let the args control headless mode
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--headless=new', // Explicitly request new headless for extension support
      '--no-sandbox', // Often needed in CI/docker
    ],
  })

  try {
    // 3. Find Extension ID
    // We can find it by looking at the service worker or just iterating pages
    let extensionId = 'bnceafpojmnimbnhamaeedgomdcgnbjk' // Default from user, but might change

    console.log('Waiting for service worker...')
    // Wait for service worker
    let worker = context.serviceWorkers()[0]
    if (!worker) {
      try {
        worker = await context.waitForEvent('serviceworker', { timeout: 10000 })
      } catch (e) {
        console.log('No service worker found in time. Checking targets...')
        const pages = context.pages()
        console.log(`Open pages: ${pages.length}`)
        pages.forEach((p) => console.log(`Page: ${p.url()}`))
      }
    }

    if (worker) {
      console.log(`Found worker: ${worker.url()}`)
      // Extract ID from worker URL: chrome-extension://<id>/sw.js
      const workerUrl = worker.url()
      const match = workerUrl.match(/chrome-extension:\/\/([^\/]+)\//)
      if (match) {
        extensionId = match[1]
        console.log(`Detected Extension ID: ${extensionId}`)
      } else {
        console.log(
          `Could not detect ID from worker URL ${workerUrl}, using default: ${extensionId}`,
        )
      }

      // Try to connect to native host manually to see error
      console.log('Attempting manual native connection...')
      const result = await worker.evaluate(async () => {
        try {
          const port = chrome.runtime.connectNative('com.jstorrent.native')
          return new Promise((resolve) => {
            port.onDisconnect.addListener(() => {
              resolve({
                success: false,
                error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Disconnected',
              })
            })
            port.onMessage.addListener((msg) => {
              resolve({ success: true, msg })
            })
            // Send a ping to provoke a response or just wait
            // The host doesn't send anything on connect, but we can check if it disconnects immediately
            setTimeout(() => resolve({ success: true, status: 'Connected (timeout)' }), 1000)
          })
        } catch (e: any) {
          return { success: false, error: e.toString() }
        }
      })
      console.log('Manual connection result:', result)
    }

    // 4. Navigate to Extension Page to trigger native host connection
    // The app.html page should trigger connection if the app logic does so.
    // If not, we might need to evaluate code in the service worker.
    // Assuming app.tsx connects on mount or similar.
    const page = await context.newPage()
    try {
      await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)
    } catch (e) {
      console.log('Page load failed:', e)
    }

    // Wait a bit for connection
    await page.waitForTimeout(5000)

    // 5. Check rpc-info file
    const files = fs
      .readdirSync(NATIVE_HOST_CONFIG_DIR)
      .filter((f) => f.startsWith('rpc-info-') && f.endsWith('.json'))
      .map((f) => path.join(NATIVE_HOST_CONFIG_DIR, f))

    expect(files.length).toBeGreaterThan(0)

    // Get latest file
    const latestFile = files.reduce((latest, file) => {
      const stats = fs.statSync(file)
      const latestStats = fs.statSync(latest)
      return stats.mtimeMs > latestStats.mtimeMs ? file : latest
    })

    console.log(`Reading info from: ${latestFile}`)
    const info = JSON.parse(fs.readFileSync(latestFile, 'utf-8'))

    console.log('RPC Info:', JSON.stringify(info, null, 2))

    const browserBinary = info.browser?.binary || ''
    const browserName = info.browser?.name || ''
    const extensionIdInInfo = info.browser?.extension_id || ''

    console.log(`Detected Browser: ${browserName} (${browserBinary})`)
    console.log(`Detected Extension ID in Info: ${extensionIdInInfo}`)

    // 6. Assertions
    expect(browserBinary).not.toBe('')
    // It should be chrome or chromium
    expect(browserBinary.toLowerCase()).toMatch(/chrome|chromium/)
    // It should NOT be the host or wrapper
    expect(browserBinary).not.toContain('jstorrent-host')
    expect(browserBinary).not.toContain('native-host')
    expect(browserBinary).not.toContain('python')

    // Verify extension ID
    expect(extensionIdInInfo).toBe(extensionId)
  } finally {
    await context.close()
    // Cleanup user data dir? Maybe keep for debugging if failed
    // fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})
