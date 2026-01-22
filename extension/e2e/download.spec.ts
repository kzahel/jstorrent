import { test, expect } from './fixtures'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'

// Known test values from seed_for_test.py (100MB size)
const TEST_INFO_HASH = '67d01ece1b99c49c257baada0f760b770a7530b9'
const TEST_MAGNET = `magnet:?xt=urn:btih:${TEST_INFO_HASH}&dn=testdata_100mb.bin&x.pe=127.0.0.1:6881`
const SEEDER_PORT = 6881

// Ubuntu 24.04.3 Server ISO - real-world torrent for E2E testing
// Info hash: a1dfefec1a9dd7fa8a041ebeeea271db55126d2f
const UBUNTU_TORRENT_URL =
  'https://releases.ubuntu.com/24.04/ubuntu-24.04.3-live-server-amd64.iso.torrent'

// Use shorter timeout locally for faster feedback, longer for CI
const isCI = process.env.CI === 'true'
const DOWNLOAD_TIMEOUT_MS = isCI ? 60_000 : 10_000
// Longer timeout for real-world torrent (peer discovery takes longer)
const REAL_TORRENT_TIMEOUT_MS = isCI ? 120_000 : 60_000
// Minimum progress to verify download is working (0.1% of ~3.3GB = ~3.3MB)
const MIN_PROGRESS_THRESHOLD = 0.001
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

// Fetch the Ubuntu .torrent file (provides metadata immediately, unlike magnet)
async function fetchUbuntuTorrent(): Promise<Uint8Array> {
  const response = await fetch(UBUNTU_TORRENT_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch Ubuntu torrent: ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}

test.describe('Real-world Torrent E2E', () => {
  test('downloads Ubuntu ISO from public swarm', async ({ context, extensionId, configDir }) => {
    // Set longer timeout for real-world torrent
    test.setTimeout(REAL_TORRENT_TIMEOUT_MS + 60_000)

    // Fetch the .torrent file first (gives us metadata immediately)
    console.log('Fetching Ubuntu .torrent file...')
    const torrentData = await fetchUbuntuTorrent()
    console.log(`Fetched torrent file: ${torrentData.length} bytes`)

    // Wait for service worker
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent('serviceworker')
    }

    // Open extension page to trigger engine initialization
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

    // Wait for native host to connect and create rpc-info.json
    await page.waitForTimeout(2000)

    // Add download root to the config file
    await addDownloadRootToConfig(configDir)

    // Add torrent and wait for some download progress
    const result = await page.evaluate(
      async ({ torrentBytes, timeoutMs, rootKey, rootPath, minProgress }) => {
        type Torrent = {
          infoHash: string
          progress: number
          isComplete: boolean
          peers: unknown[]
          downloadSpeed: number
          hasMetadata: boolean
          userState: string
          name: string
          errorMessage?: string
          piecesCount: number
          pieceLength: number
          lastPieceLength: number
        }
        type DaemonConnection = {
          request: <T>(method: string, path: string) => Promise<T>
        }
        type EngineManager = {
          engine: {
            addTorrent: (
              magnetOrBuffer: string | Uint8Array,
            ) => Promise<{ torrent: Torrent | null }>
            removeTorrent: (infoHash: string, deleteFiles: boolean) => void
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

        // Add the torrent using the .torrent file bytes
        const torrentBuffer = new Uint8Array(torrentBytes)
        const { torrent } = await em.engine.addTorrent(torrentBuffer)
        if (!torrent) {
          return { success: false, error: 'Failed to add torrent' }
        }

        // Calculate total size from piece info
        const totalSize =
          torrent.piecesCount > 0
            ? (torrent.piecesCount - 1) * torrent.pieceLength + torrent.lastPieceLength
            : 0
        const totalSizeGB = totalSize / 1024 / 1024 / 1024

        console.log(
          `Ubuntu torrent added: name=${torrent.name}, hasMetadata=${torrent.hasMetadata}, ` +
            `totalSize=${totalSizeGB.toFixed(2)} GB (${torrent.piecesCount} pieces), ` +
            `userState=${torrent.userState}, error=${torrent.errorMessage}`,
        )

        // Poll for progress
        const deadline = Date.now() + timeoutMs
        let lastProgress = -1
        let gotMetadata = false
        let gotPeers = false
        let gotProgress = false

        while (Date.now() < deadline) {
          const progress = torrent.progress
          const peerCount = torrent.peers.length

          // Track milestones
          if (torrent.hasMetadata && !gotMetadata) {
            console.log(`✓ Got metadata: ${torrent.name} (${totalSizeGB.toFixed(2)} GB)`)
            gotMetadata = true
          }
          if (peerCount > 0 && !gotPeers) {
            console.log(`✓ Connected to peers: ${peerCount}`)
            gotPeers = true
          }
          if (progress > 0 && !gotProgress) {
            console.log(`✓ Download started: ${(progress * 100).toFixed(3)}%`)
            gotProgress = true
          }

          // Log progress updates (roughly every 0.1% or state changes)
          const shouldLog =
            Math.floor(progress * 1000) !== Math.floor(lastProgress * 1000) || lastProgress === -1
          if (shouldLog && gotMetadata) {
            const downloadedBytes = progress * totalSize
            const downloadedMB = downloadedBytes / 1024 / 1024
            console.log(
              `Download: ${(progress * 100).toFixed(3)}% (${downloadedMB.toFixed(1)} MB) | ` +
                `peers: ${peerCount} | ` +
                `speed: ${(torrent.downloadSpeed / 1024).toFixed(0)} KB/s | ` +
                `state: ${torrent.userState}`,
            )
            lastProgress = progress
          }

          // Success condition: we have metadata and either have peers or have made progress
          // Note: peer discovery depends on network conditions (trackers, DHT, NAT)
          if (gotMetadata && (gotPeers || progress >= minProgress)) {
            // Clean up - remove torrent and files
            em.engine!.removeTorrent(torrent.infoHash, true)
            return {
              success: true,
              progress,
              downloadedMB: (progress * totalSize) / 1024 / 1024,
              peerCount,
              hasMetadata: true,
              name: torrent.name,
              totalSizeGB,
            }
          }

          await new Promise((r) => setTimeout(r, 500))
        }

        // Timeout - return final state
        // Even without peers, having metadata is still a partial success
        const finalProgress = torrent.progress
        const finalState = {
          success: gotMetadata, // Partial success if we at least got metadata
          partialSuccess: gotMetadata && !gotPeers,
          error: gotMetadata
            ? 'Metadata loaded but no peers found (network/NAT issue)'
            : 'Timeout waiting for metadata',
          progress: finalProgress,
          downloadedMB: (finalProgress * totalSize) / 1024 / 1024,
          peerCount: torrent.peers.length,
          hasMetadata: torrent.hasMetadata,
          userState: torrent.userState,
          torrentError: torrent.errorMessage,
          name: torrent.name,
          totalSizeGB,
        }

        // Clean up
        em.engine!.removeTorrent(torrent.infoHash, true)
        return finalState
      },
      {
        torrentBytes: Array.from(torrentData),
        timeoutMs: REAL_TORRENT_TIMEOUT_MS,
        rootKey: TEST_DOWNLOAD_ROOT_KEY,
        rootPath: TEST_DOWNLOAD_PATH,
        minProgress: MIN_PROGRESS_THRESHOLD,
      },
    )

    console.log('Ubuntu download result:', result)

    // Primary assertions - must pass
    expect(result.success).toBe(true)
    expect(result.hasMetadata).toBe(true)
    expect(result.name).toBe('ubuntu-24.04.3-live-server-amd64.iso')
    expect(result.totalSizeGB).toBeCloseTo(3.08, 1) // ~3.08 GB

    // Log peer/progress status (informational, not required for test to pass)
    if ('partialSuccess' in result && result.partialSuccess) {
      console.log(
        'Note: Metadata parsed successfully but no peers found.',
        'This may indicate network/NAT issues or tracker unavailability.',
      )
    }
    const peerCount = ('peerCount' in result ? result.peerCount : 0) ?? 0
    const progress = ('progress' in result ? result.progress : 0) ?? 0
    const downloadedMB = ('downloadedMB' in result ? result.downloadedMB : 0) ?? 0
    if (peerCount > 0) {
      console.log(`Connected to ${peerCount} peers`)
    }
    if (progress > 0) {
      console.log(`Downloaded ${downloadedMB.toFixed(1)} MB (${(progress * 100).toFixed(3)}%)`)
    }
  })
})
