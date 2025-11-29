import { test, expect } from './fixtures'

test('Extension connects to IO Daemon', async ({ context, extensionId }) => {
  // Wait for service worker
  const worker = await context.serviceWorkers()[0]
  if (!worker) {
    // Wait for it?
    await context.waitForEvent('serviceworker')
  }

  // We need to evaluate code in the service worker context
  // But Playwright's `worker.evaluate` might be tricky if the worker isn't ready.
  // Let's open the extension popup/UI to ensure everything is loaded.
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  // Now check the service worker state
  const sw = context.serviceWorkers()[0]
  expect(sw).toBeTruthy()

  const isReady = await sw.evaluate(async () => {
    // @ts-expect-error -- client is exposed on self
    const client = self.client

    // Wait for ready
    // It might take a moment for init() to finish
    if (!client.ready) {
      await new Promise((r) => setTimeout(r, 1000))
    }

    // If still not ready, try ensureDaemonReady explicitly
    if (!client.ready) {
      await client.ensureDaemonReady()
    }

    return client.ready
  })
  expect(isReady).toBe(true)

  // Test TCP Socket
  await sw.evaluate(async () => {
    // @ts-expect-error -- client is exposed on self
    const client = self.client
    const sockets = await client.ensureDaemonReady()

    if (!sockets) {
      throw new Error('Sockets not initialized')
    }

    // We just verify that we got the sockets interface back, implying successful handshake
    console.log('Successfully connected to daemon and got sockets interface')
  })
})
