import { test, expect } from './fixtures'

test('Extension connects to IO Daemon', async ({ context, extensionId }) => {
  // Wait for service worker
  if (!context.serviceWorkers()[0]) {
    await context.waitForEvent('serviceworker')
  }

  // Open extension page to trigger initialization
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  // Verify engine initializes and connects to daemon via UI thread
  const result = await page.evaluate(async () => {
    const em = (window as unknown as { engineManager: unknown }).engineManager as {
      engine: unknown
      daemonConnection: unknown
    }

    // Wait for initialization
    let retries = 0
    while (!em.engine && retries < 50) {
      await new Promise((r) => setTimeout(r, 100))
      retries++
    }

    return {
      ready: !!em.engine,
      hasDaemonConnection: !!em.daemonConnection,
      hasEngine: !!em.engine,
    }
  })

  expect(result.ready).toBe(true)
  expect(result.hasDaemonConnection).toBe(true)
  expect(result.hasEngine).toBe(true)
})
