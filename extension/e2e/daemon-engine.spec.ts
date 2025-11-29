import { test, expect } from './fixtures'

test('Extension initializes Daemon Engine', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  const sw = context.serviceWorkers()[0]
  expect(sw).toBeTruthy()

  const isReady = await sw.evaluate(async () => {
    // @ts-expect-error -- client is exposed on self
    const client = self.client
    await client.ensureDaemonReady()
    return !!client.engine
  })
  expect(isReady).toBe(true)
})
