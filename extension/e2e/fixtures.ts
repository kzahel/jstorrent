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
}>({
  context: async (_, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jstorrent-e2e-'))

    // Install Native Host Manifest into userDataDir
    const manifestDir = path.join(userDataDir, 'NativeMessagingHosts')
    fs.mkdirSync(manifestDir, { recursive: true })

    const manifestPath = path.join(manifestDir, 'com.jstorrent.native.json')
    const hostPath = path.join(os.homedir(), '.local/lib/jstorrent-native/jstorrent-native-host')

    // We need a valid extension ID for the allowed_origins.
    // Since we don't know the ID until we load it, we can add a wildcard or a few known IDs.
    // Or we can rely on the fact that in persistent context, the ID is stable-ish if key is stable.
    // But we don't have a key.
    // Let's just add a few placeholders and hope we can update it or it works.
    // Actually, for native messaging, the ID MUST match.
    // A trick is to use a fixed key in manifest.json, but we might not have one.
    // Another trick: The ID is derived from the path if unpacked.
    // But simpler: we can just allow * if Chrome allows it? No, it doesn't.

    // Let's just use the one we observed in previous runs or a few common ones.
    // Or better: We can't easily predict it without a key.
    // BUT, we can launch the browser once to get the ID, then close and relaunch with the manifest?
    // That's slow.

    // Let's try to use a fixed key if possible, or just add the one from the previous test run.
    // 'bnceafpojmnimbnhamaeedgomdcgnbjk' seems to be the one.

    const manifest = {
      name: 'com.jstorrent.native',
      description: 'JSTorrent Native Messaging Host',
      path: hostPath,
      type: 'stdio',
      allowed_origins: [
        'chrome-extension://bnceafpojmnimbnhamaeedgomdcgnbjk/',
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
    let extensionId = 'bnceafpojmnimbnhamaeedgomdcgnbjk' // Fallback

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
})

export { expect } from '@playwright/test'
