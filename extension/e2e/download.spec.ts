import { test, expect } from './fixtures'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'

// Known test values from seed_for_test.py (100MB size)
const TEST_INFO_HASH = '67d01ece1b99c49c257baada0f760b770a7530b9'
const TEST_MAGNET = `magnet:?xt=urn:btih:${TEST_INFO_HASH}&dn=testdata_100mb.bin&x.pe=127.0.0.1:6881`
const SEEDER_PORT = 6881

// Use shorter timeout locally for faster feedback, longer for CI
const isCI = process.env.CI === 'true'
const DOWNLOAD_TIMEOUT_MS = isCI ? 60_000 : 10_000
const TEST_DOWNLOAD_ROOT_KEY = 'e2e-test-downloads'
const TEST_DOWNLOAD_PATH = '/tmp/jstorrent-e2e-downloads'

interface RpcProfile {
  install_id?: string
  download_roots: Array<{
    key: string
    path: string
    display_name: string
    removable: boolean
    last_stat_ok: boolean
    last_checked: number
  }>
  [key: string]: unknown
}

interface RpcInfo {
  profiles: RpcProfile[]
  [key: string]: unknown
}

// Add a download root to the rpc-info.json and tell the daemon to reload
async function addDownloadRootToConfig(configDir: string): Promise<void> {
  const rpcInfoPath = path.join(configDir, 'jstorrent-native', 'rpc-info.json')

  // Wait for rpc-info.json to exist (native host creates it)
  let attempts = 0
  while (!fs.existsSync(rpcInfoPath) && attempts < 50) {
    await new Promise((r) => setTimeout(r, 100))
    attempts++
  }

  if (!fs.existsSync(rpcInfoPath)) {
    throw new Error(`rpc-info.json not found at ${rpcInfoPath} after waiting`)
  }

  // Read and modify the config
  const rpcInfo: RpcInfo = JSON.parse(fs.readFileSync(rpcInfoPath, 'utf-8'))

  // Add download root to all profiles
  for (const profile of rpcInfo.profiles) {
    if (!profile.download_roots) {
      profile.download_roots = []
    }
    // Check if root already exists
    if (!profile.download_roots.some((r) => r.key === TEST_DOWNLOAD_ROOT_KEY)) {
      profile.download_roots.push({
        key: TEST_DOWNLOAD_ROOT_KEY,
        path: TEST_DOWNLOAD_PATH,
        display_name: 'E2E Test Downloads',
        removable: false,
        last_stat_ok: true,
        last_checked: Date.now(),
      })
    }
  }

  // Write back
  fs.writeFileSync(rpcInfoPath, JSON.stringify(rpcInfo, null, 2))

  // Ensure the download directory exists
  fs.mkdirSync(TEST_DOWNLOAD_PATH, { recursive: true })
}

async function isSeederRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new net.Socket()
    client.setTimeout(2000)

    client.connect(SEEDER_PORT, '127.0.0.1', () => {
      client.destroy()
      resolve(true)
    })

    client.on('error', () => {
      client.destroy()
      resolve(false)
    })

    client.on('timeout', () => {
      client.destroy()
      resolve(false)
    })
  })
}

test.describe('Download E2E', () => {
  test.beforeAll(async () => {
    const seederRunning = await isSeederRunning()
    if (!seederRunning) {
      throw new Error(
        `Seeder not running on port ${SEEDER_PORT}. Start it with: pnpm seed-for-test --size 100mb`,
      )
    }
    console.log(`Seeder detected on port ${SEEDER_PORT}`)
  })

  test('downloads torrent from local seeder', async ({ context, extensionId, configDir }) => {
    // Set longer timeout for download
    test.setTimeout(DOWNLOAD_TIMEOUT_MS + 30_000)

    // Wait for service worker
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent('serviceworker')
    }

    // Open extension page to trigger engine initialization
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

    // Wait a bit for native host to connect and create rpc-info.json
    await page.waitForTimeout(2000)

    // Add download root to the config file
    await addDownloadRootToConfig(configDir)

    // Add torrent and wait for download to complete
    const result = await page.evaluate(
      async ({ magnet, timeoutMs, rootKey, rootPath }) => {
        type Torrent = {
          progress: number
          isComplete: boolean
          peers: unknown[]
          downloadSpeed: number
          hasMetadata: boolean
          userState: string
          name: string
          errorMessage?: string
        }
        type DaemonConnection = {
          request: <T>(method: string, path: string) => Promise<T>
        }
        type EngineManager = {
          engine: {
            addTorrent: (magnetOrBuffer: string) => Promise<{ torrent: Torrent | null }>
            port: number
            storageRootManager: {
              addRoot: (root: { key: string; label: string; path: string }) => void
              setDefaultRoot: (key: string) => void
              getRoots: () => { key: string }[]
            }
          } | null
          daemonConnection: DaemonConnection | null
        }

        const em = (window as unknown as { engineManager: EngineManager }).engineManager

        // Wait for engine to be ready
        let retries = 0
        while (!em.engine && retries < 100) {
          await new Promise((r) => setTimeout(r, 100))
          retries++
        }

        if (!em.engine) {
          return { success: false, error: 'Engine did not initialize' }
        }

        if (!em.daemonConnection) {
          return { success: false, error: 'No daemon connection' }
        }

        // Tell daemon to reload config (picks up the download root we added)
        try {
          await em.daemonConnection.request('POST', '/api/read-rpc-info-from-disk')
        } catch (e) {
          return { success: false, error: `Daemon reload error: ${e}` }
        }

        // Add the root to the engine's storage root manager
        const existingRoots = em.engine.storageRootManager.getRoots()
        if (!existingRoots.some((r) => r.key === rootKey)) {
          em.engine.storageRootManager.addRoot({
            key: rootKey,
            label: 'E2E Test Downloads',
            path: rootPath,
          })
        }
        em.engine.storageRootManager.setDefaultRoot(rootKey)

        // Add the torrent
        const { torrent } = await em.engine.addTorrent(magnet)
        if (!torrent) {
          return { success: false, error: 'Failed to add torrent' }
        }

        console.log(
          `Torrent added: name=${torrent.name}, hasMetadata=${torrent.hasMetadata}, ` +
            `userState=${torrent.userState}, error=${torrent.errorMessage}`,
        )

        // Poll for completion
        const deadline = Date.now() + timeoutMs
        let lastProgress = -1

        while (Date.now() < deadline) {
          const progress = torrent.progress
          const isComplete = torrent.isComplete

          // Log progress updates (roughly every 5% or state changes)
          const shouldLog =
            Math.floor(progress * 20) !== Math.floor(lastProgress * 20) || lastProgress === -1
          if (shouldLog) {
            console.log(
              `Download: ${(progress * 100).toFixed(1)}% | ` +
                `peers: ${torrent.peers.length} | ` +
                `speed: ${(torrent.downloadSpeed / 1024).toFixed(0)} KB/s | ` +
                `meta: ${torrent.hasMetadata} | ` +
                `state: ${torrent.userState}`,
            )
            lastProgress = progress
          }

          if (isComplete) {
            return {
              success: true,
              progress,
              isComplete: true,
            }
          }

          await new Promise((r) => setTimeout(r, 500))
        }

        // Timeout - return final state
        return {
          success: false,
          error: 'Download timeout',
          progress: torrent.progress,
          isComplete: torrent.isComplete,
          peerCount: torrent.peers.length,
          hasMetadata: torrent.hasMetadata,
          userState: torrent.userState,
          torrentError: torrent.errorMessage,
          enginePort: em.engine.port,
          hasDaemon: !!em.daemonConnection,
        }
      },
      {
        magnet: TEST_MAGNET,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        rootKey: TEST_DOWNLOAD_ROOT_KEY,
        rootPath: TEST_DOWNLOAD_PATH,
      },
    )

    console.log('Download result:', result)

    expect(result.success).toBe(true)
    expect(result.isComplete).toBe(true)
    expect(result.progress).toBeGreaterThanOrEqual(1.0)
  })
})
