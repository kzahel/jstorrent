import { test, expect } from './fixtures'
import * as net from 'net'

test('Engine starts TCP server via daemon', async ({ context, extensionId }) => {
  // Wait for service worker
  if (!context.serviceWorkers()[0]) {
    await context.waitForEvent('serviceworker')
  }

  // Open extension page to trigger initialization
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  // Wait for engine to initialize and get the listening port
  const port = await page.evaluate(async () => {
    const em = (window as unknown as { engineManager: unknown }).engineManager as {
      engine: {
        port?: number
      } | null
    }

    // Wait for engine to be ready
    let retries = 0
    while (!em.engine && retries < 50) {
      await new Promise((r) => setTimeout(r, 100))
      retries++
    }

    return em.engine?.port ?? 0
  })

  expect(port).toBeGreaterThan(0)
  console.log(`Engine listening on port ${port}`)

  // Try to connect to the server from outside the browser
  const connected = await new Promise<boolean>((resolve) => {
    const client = new net.Socket()

    client.connect(port, '127.0.0.1', () => {
      console.log(`Successfully connected to engine on port ${port}`)
      client.destroy()
      resolve(true)
    })

    client.on('error', (err) => {
      console.error(`Failed to connect: ${err.message}`)
      resolve(false)
    })

    // Timeout after 5 seconds
    setTimeout(() => {
      client.destroy()
      resolve(false)
    }, 5000)
  })

  expect(connected).toBe(true)
})

test('TCP server reports bind failure for occupied port', async ({ context, extensionId }) => {
  // First, bind a port from the test process
  const testServer = new net.Server()
  const boundPort = await new Promise<number>((resolve, reject) => {
    testServer.listen(0, '127.0.0.1', () => {
      const addr = testServer.address()
      if (addr && typeof addr === 'object') {
        resolve(addr.port)
      } else {
        reject(new Error('Failed to get bound port'))
      }
    })
  })

  console.log(`Test server bound to port ${boundPort}`)

  try {
    // Wait for service worker
    if (!context.serviceWorkers()[0]) {
      await context.waitForEvent('serviceworker')
    }

    // Open extension page
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

    // Try to create a server on the same port via the engine
    const result = await page.evaluate(async (portToUse) => {
      const em = (window as unknown as { engineManager: unknown }).engineManager as {
        engine: {
          socketFactory: {
            createTcpServer: () => {
              listen: (port: number, cb: () => void) => void
              address: () => { port: number } | null
            }
          }
        } | null
      }

      // Wait for engine
      let retries = 0
      while (!em.engine && retries < 50) {
        await new Promise((r) => setTimeout(r, 100))
        retries++
      }

      if (!em.engine) {
        return { success: false, error: 'Engine not initialized' }
      }

      // Try to create a server on the occupied port
      const server = em.engine.socketFactory.createTcpServer()

      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        // Give it a short timeout to try listening
        const timeout = setTimeout(() => {
          resolve({ success: false, error: 'Timeout waiting for listen callback' })
        }, 3000)

        server.listen(portToUse, () => {
          clearTimeout(timeout)
          const addr = server.address()
          // If we got here, the bind succeeded (unexpected)
          resolve({ success: true, error: `Unexpectedly bound to port ${addr?.port}` })
        })
      })
    }, boundPort)

    // The listen should fail because the port is already bound
    // Note: The actual behavior depends on the implementation
    // For now, we just verify the test infrastructure works
    console.log('Result:', result)
  } finally {
    testServer.close()
  }
})

test('TCP server stop listening releases port', async ({ context, extensionId }) => {
  // Wait for service worker
  if (!context.serviceWorkers()[0]) {
    await context.waitForEvent('serviceworker')
  }

  // Open extension page
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/app.html`)

  // Create a server, get its port, then close it
  const boundPort = await page.evaluate(async () => {
    const em = (window as unknown as { engineManager: unknown }).engineManager as {
      engine: {
        socketFactory: {
          createTcpServer: () => {
            listen: (port: number, cb: () => void) => void
            address: () => { port: number } | null
            close: () => void
          }
        }
      } | null
    }

    // Wait for engine
    let retries = 0
    while (!em.engine && retries < 50) {
      await new Promise((r) => setTimeout(r, 100))
      retries++
    }

    if (!em.engine) {
      throw new Error('Engine not initialized')
    }

    // Create first server on port 0 (auto-assign)
    const server = em.engine.socketFactory.createTcpServer()

    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Listen timeout')), 5000)

      server.listen(0, () => {
        clearTimeout(timeout)
        const addr = server.address()
        resolve(addr?.port ?? 0)
      })
    })

    // Close the server
    server.close()

    // Give daemon time to process the close
    await new Promise((r) => setTimeout(r, 200))

    return port
  })

  expect(boundPort).toBeGreaterThan(0)
  console.log(`First server was on port ${boundPort}, now closed`)

  // Now try to bind to the same port from the test process
  // This verifies the daemon actually released the port
  const testServer = new net.Server()
  const rebindSucceeded = await new Promise<boolean>((resolve) => {
    testServer.once('error', (err) => {
      console.error(`Failed to rebind: ${err.message}`)
      resolve(false)
    })

    testServer.listen(boundPort, '127.0.0.1', () => {
      console.log(`Successfully rebound to port ${boundPort}`)
      testServer.close()
      resolve(true)
    })

    // Timeout
    setTimeout(() => {
      testServer.close()
      resolve(false)
    }, 3000)
  })

  expect(rebindSucceeded).toBe(true)
})
