import { test, expect } from './fixtures'

test('Extension initializes Daemon Engine', async ({ context, extensionId }) => {
  // Wait for service worker (still need it running)
  if (!context.serviceWorkers()[0]) {
    await context.waitForEvent('serviceworker')
  }

  // Open extension page to trigger initialization
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  // Wait for engine to initialize (EngineManager.init() is called on page load)
  // Use page.evaluate to access window.engineManager in UI thread
  const engineState = await page.evaluate(async () => {
    // window.engineManager is exposed for debugging in engine-manager.ts
    const em = (window as unknown as { engineManager: unknown }).engineManager as {
      engine: {
        peerId?: unknown
        storageRootManager?: unknown
        socketFactory?: unknown
        torrents?: unknown[]
      } | null
    }

    // Wait for engine to be ready (it initializes async on page load)
    let retries = 0
    while (!em.engine && retries < 50) {
      await new Promise((r) => setTimeout(r, 100))
      retries++
    }

    const engine = em.engine
    return {
      hasEngine: !!engine,
      hasPeerId: !!engine?.peerId,
      hasStorageManager: !!engine?.storageRootManager,
      hasSocketFactory: !!engine?.socketFactory,
      torrentCount: engine?.torrents?.length ?? 0,
    }
  })

  expect(engineState.hasEngine).toBe(true)
  expect(engineState.hasPeerId).toBe(true)
  expect(engineState.hasStorageManager).toBe(true)
  expect(engineState.hasSocketFactory).toBe(true)
  expect(engineState.torrentCount).toBe(0)
})
