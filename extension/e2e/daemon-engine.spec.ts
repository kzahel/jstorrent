import { test, expect } from './fixtures'

test('Extension initializes Daemon Engine', async ({ context, extensionId }) => {
  let worker = context.serviceWorkers()[0]
  if (!worker) {
    await context.waitForEvent('serviceworker')
    worker = context.serviceWorkers()[0]
  }

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  const sw = context.serviceWorkers()[0]
  expect(sw).toBeTruthy()

  const engineState = await sw.evaluate(async () => {
    // @ts-expect-error -- client is exposed on self
    const client = self.client

    if (!client.ready) {
      await client.ensureDaemonReady()
    }

    const engine = client.engine
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
