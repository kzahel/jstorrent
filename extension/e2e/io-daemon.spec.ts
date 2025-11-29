import { test, expect } from './fixtures'

test('Extension connects to IO Daemon', async ({ context, extensionId }) => {
  // Wait for service worker
  let worker = context.serviceWorkers()[0]
  if (!worker) {
    await context.waitForEvent('serviceworker')
    worker = context.serviceWorkers()[0]
  }

  // Open extension page to trigger initialization
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  const sw = context.serviceWorkers()[0]
  expect(sw).toBeTruthy()

  // Verify client initializes and connects to daemon
  const result = await sw.evaluate(async () => {
    // @ts-expect-error -- client is exposed on self
    const client = self.client

    // Give it time to initialize
    if (!client.ready) {
      await new Promise((r) => setTimeout(r, 2000))
    }

    // Try explicit init if still not ready
    if (!client.ready) {
      try {
        await client.ensureDaemonReady()
      } catch (e) {
        return { ready: false, error: String(e) }
      }
    }

    return {
      ready: client.ready,
      hasDaemonInfo: !!client.daemonInfo,
      hasEngine: !!client.engine,
    }
  })

  expect(result.ready).toBe(true)
  expect(result.hasEngine).toBe(true)
})
