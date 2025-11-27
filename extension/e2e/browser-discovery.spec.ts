import { test, expect } from './fixtures'
import path from 'path'
import fs from 'fs'

test('browser discovery works with extension', async ({ context, extensionId, configDir }) => {
  // The fixtures set up:
  // - A temp userDataDir with NativeMessagingHosts manifest
  // - A wrapper script that sets JSTORRENT_CONFIG_DIR to configDir
  // - The extension loaded

  // Wait for service worker
  let worker = context.serviceWorkers()[0]
  if (!worker) {
    try {
      worker = await context.waitForEvent('serviceworker', { timeout: 10000 })
    } catch (_e) {
      console.log('No service worker found in time. Checking targets...')
      const pages = context.pages()
      console.log(`Open pages: ${pages.length}`)
      pages.forEach((p) => console.log(`Page: ${p.url()}`))
    }
  }

  if (worker) {
    console.log(`Found worker: ${worker.url()}`)
    console.log(`Detected Extension ID: ${extensionId}`)

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
          // The host doesn't send anything on connect, but we can check if it disconnects immediately
          setTimeout(() => resolve({ success: true, status: 'Connected (timeout)' }), 1000)
        })
      } catch (e: unknown) {
        return { success: false, error: String(e) }
      }
    })
    console.log('Manual connection result:', result)
  }

  // Navigate to Extension Page to trigger native host connection
  const page = await context.newPage()
  try {
    await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)
  } catch (e) {
    console.log('Page load failed:', e)
  }

  // Wait a bit for connection and rpc-info.json to be written
  await page.waitForTimeout(5000)

  // Check rpc-info.json in our temp config dir
  // The native host writes to JSTORRENT_CONFIG_DIR/jstorrent-native/rpc-info.json
  const nativeDir = path.join(configDir, 'jstorrent-native')
  const rpcInfoPath = path.join(nativeDir, 'rpc-info.json')

  console.log(`Looking for rpc-info.json at: ${rpcInfoPath}`)
  console.log(
    `Config dir contents: ${fs.existsSync(configDir) ? fs.readdirSync(configDir) : 'dir not found'}`,
  )
  if (fs.existsSync(nativeDir)) {
    console.log(`Native dir contents: ${fs.readdirSync(nativeDir)}`)
  }

  expect(fs.existsSync(rpcInfoPath)).toBe(true)

  const info = JSON.parse(fs.readFileSync(rpcInfoPath, 'utf-8'))
  console.log('RPC Info:', JSON.stringify(info, null, 2))

  // Find our profile - look for matching extension_id
  const profiles = info.profiles || []
  const profile = profiles.find((p: { install_id?: string }) => p.install_id) || profiles[0]

  expect(profile).toBeTruthy()

  const browserBinary = profile?.browser?.binary || ''
  const browserName = profile?.browser?.name || ''
  const extensionIdInInfo = profile?.browser?.extension_id || ''

  console.log(`Detected Browser: ${browserName} (${browserBinary})`)
  console.log(`Detected Extension ID in Info: ${extensionIdInInfo}`)

  // Assertions
  expect(browserBinary).not.toBe('')
  // It should be chrome or chromium
  expect(browserBinary.toLowerCase()).toMatch(/chrome|chromium/)
  // It should NOT be the host or wrapper
  expect(browserBinary).not.toContain('jstorrent-host')
  expect(browserBinary).not.toContain('native-host')
  expect(browserBinary).not.toContain('python')

  // Verify extension ID matches
  expect(extensionIdInInfo).toBe(extensionId)
})
