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
    // @ts-ignore
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
    // @ts-ignore
    const client = self.client
    const sockets = await client.ensureDaemonReady()

    // Connect to a public echo server or just google.com:80
    // We can't easily spawn a local TCP server accessible from the extension
    // without more setup.
    // But we can try to connect to the io-daemon's HTTP port itself!
    // The io-daemon listens on HTTP.
    // We can try to send "GET /health HTTP/1.1\r\n\r\n"

    // We need to know the port. It's in client.daemon.ws.url
    // But that's private.
    // Let's just trust that if createTcpSocket works, we are good.

    // Actually, let's try to connect to google.com:80 just to see if it doesn't crash
    const socket = await sockets.createTcpSocket('google.com', 80)

    // Send something
    const data = new TextEncoder().encode('HEAD / HTTP/1.1\r\nHost: google.com\r\n\r\n')
    socket.send(data)

    // Wait for data
    await new Promise<void>((resolve, reject) => {
      socket.onData((chunk) => {
        console.log('Received data:', new TextDecoder().decode(chunk))
        resolve()
      })
      setTimeout(() => reject(new Error('Timeout waiting for data')), 5000)
    })

    socket.close()
  })
})
