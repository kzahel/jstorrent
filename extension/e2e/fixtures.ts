/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, chromium, type BrowserContext } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const EXTENSION_PATH = path.resolve(__dirname, '../dist')

export const test = base.extend<{
  context: BrowserContext
  extensionId: string
  configDir: string
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use, testInfo) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jstorrent-e2e-'))

    // Create a separate temp dir for JSTORRENT_CONFIG_DIR to avoid messing with real install
    const configDir = path.join(userDataDir, 'jstorrent-config')
    fs.mkdirSync(configDir, { recursive: true })
    // Store configDir in testInfo for access by other fixtures
    ;(testInfo as { configDir?: string }).configDir = configDir

    // Install Native Host Manifest into userDataDir
    const manifestDir = path.join(userDataDir, 'NativeMessagingHosts')
    fs.mkdirSync(manifestDir, { recursive: true })

    const manifestPath = path.join(manifestDir, 'com.jstorrent.native.json')
    const realHostPath = path.join(
      os.homedir(),
      '.local/lib/jstorrent-native/jstorrent-native-host',
    )

    // Create a wrapper script that sets JSTORRENT_CONFIG_DIR before calling the real binary.
    // This ensures the native host uses our temp config dir instead of ~/.config/jstorrent-native
    const wrapperPath = path.join(userDataDir, 'native-host-wrapper.sh')
    const wrapperScript = `#!/bin/bash
export JSTORRENT_CONFIG_DIR="${configDir}"
exec "${realHostPath}" "$@"
`
    fs.writeFileSync(wrapperPath, wrapperScript, { mode: 0o755 })

    // Point the manifest to the wrapper script instead of the real binary
    const manifest = {
      name: 'com.jstorrent.native',
      description: 'JSTorrent Native Messaging Host',
      path: wrapperPath,
      type: 'stdio',
      allowed_origins: [
        'chrome-extension://dbokmlpefliilbjldladbimlcfgbolhk/',
        'chrome-extension://opkmhecbhgngcbglpcdfmnomkffenapc/',
        // Add more if needed or try to find a way to make it deterministic
      ],
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--headless=new',
        '--no-sandbox',
      ],
    })

    await use(context)

    await context.close()
    // fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    let extensionId = 'dbokmlpefliilbjldladbimlcfgbolhk' // Fallback

    // Wait for service worker to find ID
    let worker = context.serviceWorkers()[0]
    if (!worker) {
      try {
        worker = await context.waitForEvent('serviceworker', { timeout: 5000 })
      } catch (_e) {
        // Ignore
      }
    }

    if (worker) {
      const match = worker.url().match(/chrome-extension:\/\/([^/]+)\//)
      if (match) {
        extensionId = match[1]
      }
    }

    await use(extensionId)
  },
  configDir: async ({ context: _context }, use, testInfo) => {
    // Get configDir from testInfo (set by context fixture)
    const configDir = (testInfo as { configDir?: string }).configDir
    if (!configDir) {
      throw new Error('configDir not set - context fixture must run first')
    }
    await use(configDir)
  },
})

export { expect } from '@playwright/test'
